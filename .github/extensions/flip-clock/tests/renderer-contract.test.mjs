import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const assetDirectory = new URL("../assets/", import.meta.url);
const smokeScript = fileURLToPath(
    new URL("../../../scripts/renderer-smoke.mjs", import.meta.url),
);
const appPath = fileURLToPath(new URL("app.js", assetDirectory));
const htmlPath = fileURLToPath(new URL("index.html", assetDirectory));
const SMOKE_TIMEOUT_MS = 2_000;

function runSmoke({
    targetAppPath = appPath,
    targetHtmlPath = htmlPath,
    timeout = SMOKE_TIMEOUT_MS,
} = {}) {
    return execFileAsync(
        process.execPath,
        [smokeScript, targetAppPath, targetHtmlPath],
        {
            timeout,
            killSignal: "SIGKILL",
            maxBuffer: 128 * 1024,
        },
    );
}

async function createFixture(context, { app, html }) {
    const directory = await fs.mkdtemp(
        join(tmpdir(), "flip-clock-renderer-"),
    );
    context.after(() =>
        fs.rm(directory, { recursive: true, force: true }),
    );

    const fixtureAppPath = join(directory, "app.js");
    const fixtureHtmlPath = join(directory, "index.html");
    await Promise.all([
        fs.writeFile(fixtureAppPath, app, "utf8"),
        fs.writeFile(fixtureHtmlPath, html, "utf8"),
        fs.copyFile(
            fileURLToPath(new URL("clock-core.js", assetDirectory)),
            join(directory, "clock-core.js"),
        ),
    ]);
    return {
        targetAppPath: fixtureAppPath,
        targetHtmlPath: fixtureHtmlPath,
    };
}

test(
    "renderer imports, DOM contract, and initialization pass",
    { timeout: SMOKE_TIMEOUT_MS + 1_000 },
    async () => {
        await runSmoke();
    },
);

test(
    "renderer smoke terminates an app that does not finish importing",
    { timeout: 2_000 },
    async (context) => {
        const [app, html] = await Promise.all([
            fs.readFile(appPath, "utf8"),
            fs.readFile(htmlPath, "utf8"),
        ]);
        const fixture = await createFixture(context, {
            app: `${app}\nwhile (true) {}\n`,
            html,
        });

        await assert.rejects(
            runSmoke({ ...fixture, timeout: 300 }),
            (error) => {
                assert.equal(error.killed, true);
                assert.equal(error.signal, "SIGKILL");
                return true;
            },
        );
    },
);

test(
    "renderer rejects IDs that exist only inside HTML comments",
    { timeout: SMOKE_TIMEOUT_MS + 1_000 },
    async (context) => {
        const [app, html] = await Promise.all([
            fs.readFile(appPath, "utf8"),
            fs.readFile(htmlPath, "utf8"),
        ]);
        const fixture = await createFixture(context, {
            app,
            html: html.replace('id="app"', '<!-- id="app" -->'),
        });

        await assert.rejects(runSmoke(fixture), (error) => {
            assert.equal(error.killed, false);
            assert.match(
                error.stderr,
                /missing active markup for #app/,
            );
            return true;
        });
    },
);

test(
    "renderer executes a single-quoted clock-core import",
    { timeout: SMOKE_TIMEOUT_MS + 1_000 },
    async (context) => {
        const [app, html] = await Promise.all([
            fs.readFile(appPath, "utf8"),
            fs.readFile(htmlPath, "utf8"),
        ]);
        const fixture = await createFixture(context, {
            app: app.replace(
                '"./clock-core.js"',
                "'./clock-core.js'",
            ),
            html,
        });

        await runSmoke(fixture);
    },
);
