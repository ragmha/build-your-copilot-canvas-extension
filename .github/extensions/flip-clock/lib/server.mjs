import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";

import {
    PreferenceStorageError,
    PreferenceValidationError,
    createMemoryPreferenceStore,
} from "./preferences.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
].join("; ");

const ASSET_DEFINITIONS = Object.freeze({
    "/styles.css": {
        source: new URL("../assets/styles.css", import.meta.url),
        contentType: "text/css; charset=utf-8",
    },
    "/app.js": {
        source: new URL("../assets/app.js", import.meta.url),
        contentType: "text/javascript; charset=utf-8",
    },
    "/clock-core.js": {
        source: new URL("../assets/clock-core.js", import.meta.url),
        contentType: "text/javascript; charset=utf-8",
    },
});

let assetsPromise;

class HttpError extends Error {
    constructor(statusCode, code, message) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
        this.code = code;
    }
}

function loadAssets() {
    if (!assetsPromise) {
        assetsPromise = Promise.all([
            fs.readFile(new URL("../assets/index.html", import.meta.url)),
            ...Object.entries(ASSET_DEFINITIONS).map(
                async ([path, definition]) => [
                    path,
                    {
                        content: await fs.readFile(definition.source),
                        contentType: definition.contentType,
                    },
                ],
            ),
        ]).then(([index, ...assets]) => ({
            index,
            assets: new Map(assets),
        }));
    }
    return assetsPromise;
}

function setCommonHeaders(response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
}

function send(response, statusCode, contentType, body) {
    if (response.writableEnded) {
        return;
    }

    setCommonHeaders(response);
    response.statusCode = statusCode;
    response.setHeader("Content-Type", contentType);
    response.end(body);
}

function sendJson(response, statusCode, body) {
    send(
        response,
        statusCode,
        "application/json; charset=utf-8",
        `${JSON.stringify(body)}\n`,
    );
}

function tokensMatch(candidate, expected) {
    if (typeof candidate !== "string") {
        return false;
    }

    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);
    return (
        candidateBuffer.length === expectedBuffer.length &&
        timingSafeEqual(candidateBuffer, expectedBuffer)
    );
}

async function readJsonBody(request) {
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.startsWith("application/json")) {
        throw new HttpError(
            415,
            "unsupported_media_type",
            "Send preferences as application/json.",
        );
    }

    const chunks = [];
    let byteLength = 0;

    for await (const chunk of request) {
        byteLength += chunk.length;
        if (byteLength > MAX_BODY_BYTES) {
            throw new HttpError(
                413,
                "payload_too_large",
                "The preferences payload is too large.",
            );
        }
        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new HttpError(
                400,
                "invalid_json",
                "The preferences payload is not valid JSON.",
            );
        }
        throw error;
    }
}

function writeSettingsEvent(response, preferences) {
    response.write(
        `event: settings\ndata: ${JSON.stringify(preferences)}\n\n`,
    );
}

export async function startClockServer({
    instanceId,
    preferenceStore = createMemoryPreferenceStore(),
    initialPreferences,
    reportError = async (error) => {
        const message =
            error instanceof Error
                ? error.stack ?? error.message
                : String(error);
        process.stderr.write(`Flip Clock: ${message}\n`);
    },
}) {
    const token = randomBytes(24).toString("base64url");
    const { index, assets } = await loadAssets();
    const eventClients = new Set();
    let currentPreferences =
        initialPreferences ?? (await preferenceStore.get());
    let origin;
    let closed = false;

    const unsubscribe = preferenceStore.subscribe((preferences) => {
        currentPreferences = preferences;
        for (const response of eventClients) {
            if (!response.writableEnded) {
                writeSettingsEvent(response, preferences);
            }
        }
    });

    const heartbeat = setInterval(() => {
        for (const response of eventClients) {
            if (!response.writableEnded) {
                response.write(": keep-alive\n\n");
            }
        }
    }, 20_000);
    heartbeat.unref();

    async function handleRequest(request, response) {
        const requestUrl = new URL(request.url ?? "/", origin);
        const path = requestUrl.pathname;

        if (request.method === "GET" && assets.has(path)) {
            const asset = assets.get(path);
            send(response, 200, asset.contentType, asset.content);
            return;
        }

        if (request.method === "GET" && path === "/favicon.ico") {
            setCommonHeaders(response);
            response.statusCode = 204;
            response.end();
            return;
        }

        if (!tokensMatch(requestUrl.searchParams.get("token"), token)) {
            sendJson(response, 404, {
                code: "not_found",
                message: "This Flip Clock canvas URL is no longer available.",
            });
            return;
        }

        if (request.method === "GET" && path === "/") {
            send(response, 200, "text/html; charset=utf-8", index);
            return;
        }

        if (request.method === "GET" && path === "/api/state") {
            sendJson(response, 200, {
                preferences: currentPreferences,
                instanceId,
            });
            return;
        }

        if (request.method === "GET" && path === "/events") {
            setCommonHeaders(response);
            response.statusCode = 200;
            response.setHeader(
                "Content-Type",
                "text/event-stream; charset=utf-8",
            );
            response.setHeader("Connection", "keep-alive");
            response.flushHeaders();

            eventClients.add(response);
            writeSettingsEvent(response, currentPreferences);

            request.on("close", () => {
                eventClients.delete(response);
            });
            return;
        }

        if (
            request.method === "POST" &&
            (path === "/api/preferences" || path === "/api/reset")
        ) {
            const requestOrigin = request.headers.origin;
            if (requestOrigin && requestOrigin !== origin) {
                throw new HttpError(
                    403,
                    "origin_rejected",
                    "The preferences request came from an untrusted origin.",
                );
            }

            const preferences =
                path === "/api/reset"
                    ? await preferenceStore.reset()
                    : await preferenceStore.update(await readJsonBody(request));

            sendJson(response, 200, { preferences });
            return;
        }

        sendJson(response, 404, {
            code: "not_found",
            message: "The requested Flip Clock resource does not exist.",
        });
    }

    async function handleRequestError(error, response) {
        if (error instanceof HttpError) {
            sendJson(response, error.statusCode, {
                code: error.code,
                message: error.message,
            });
            return;
        }

        if (error instanceof PreferenceValidationError) {
            sendJson(response, 422, {
                code: error.code,
                message: error.message,
            });
            return;
        }

        if (error instanceof PreferenceStorageError) {
            await reportError(error);
            sendJson(response, 500, {
                code: "preference_storage_failed",
                message:
                    "Flip Clock could not save its preferences. Check the extension log and try again.",
            });
            return;
        }

        await reportError(error);
        sendJson(response, 500, {
            code: "internal_error",
            message:
                "Flip Clock hit an unexpected error. Check the extension log and reload the canvas.",
        });
    }

    const server = createServer((request, response) => {
        void handleRequest(request, response).catch((error) => {
            void handleRequestError(error, response).catch(
                (reportingError) => {
                    process.stderr.write(
                        `Flip Clock could not report an HTTP error: ${
                            reportingError instanceof Error
                                ? reportingError.stack ??
                                  reportingError.message
                                : String(reportingError)
                        }\n`,
                    );
                    if (!response.writableEnded) {
                        response.destroy();
                    }
                },
            );
        });
    });

    await new Promise((resolve, reject) => {
        const handleListenError = (error) => {
            server.off("listening", handleListening);
            reject(error);
        };
        const handleListening = () => {
            server.off("error", handleListenError);
            resolve();
        };

        server.once("error", handleListenError);
        server.once("listening", handleListening);
        server.listen(0, "127.0.0.1");
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        await new Promise((resolve) => server.close(resolve));
        throw new Error("Flip Clock could not determine its loopback port.");
    }

    origin = `http://127.0.0.1:${address.port}`;

    return {
        server,
        url: `${origin}/?token=${encodeURIComponent(token)}`,
        getViewPreferences() {
            return { ...currentPreferences };
        },
        setViewPreferences(preferences) {
            currentPreferences = { ...preferences };
            for (const response of eventClients) {
                if (!response.writableEnded) {
                    writeSettingsEvent(response, currentPreferences);
                }
            }
        },
        async close() {
            if (closed) {
                return;
            }
            closed = true;

            clearInterval(heartbeat);
            unsubscribe();

            for (const response of eventClients) {
                response.end();
            }
            eventClients.clear();

            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
        },
    };
}
