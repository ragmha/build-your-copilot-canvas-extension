import { pathToFileURL } from "node:url";

import {
    CanvasError,
    inspectRegistration,
} from "./fake-copilot-sdk.mjs";

const step = Number.parseInt(process.argv[2], 10);
const extensionPath = process.argv[3];
const openInstances = new Set();
let canvas;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function closeInstance(instanceId) {
    if (canvas?.onClose && openInstances.has(instanceId)) {
        openInstances.delete(instanceId);
        await canvas.onClose({ instanceId });
    }
}

async function probeStep1() {
    const session = inspectRegistration();
    assert(session, "`joinSession` was not called.");
    assert(Array.isArray(session.canvases), "No canvases were registered.");

    canvas = session.canvases.find((item) => item?.id === "flip-clock");
    assert(canvas, "Canvas ID `flip-clock` was not registered.");
    assert(
        canvas.displayName === "Flip Clock",
        "The canvas display name must be `Flip Clock`.",
    );
    assert(
        typeof canvas.description === "string" &&
            canvas.description.length >= 20,
        "The canvas needs a meaningful description.",
    );
    assert(typeof canvas.open === "function", "The canvas has no open handler.");

    const result = await canvas.open({ instanceId: "runtime-step-1" });
    assert(
        result?.title === "Flip Clock",
        "The open handler must return the `Flip Clock` title.",
    );
}

async function probeStep2() {
    await probeStep1();
    assert(
        typeof canvas.onClose === "function",
        "The canvas has no onClose handler.",
    );

    const instanceId = "runtime-step-2";
    const first = await canvas.open({ instanceId });
    openInstances.add(instanceId);
    const second = await canvas.open({ instanceId });

    assert(first?.url, "The open handler did not return a renderer URL.");
    assert(
        first.url === second?.url,
        "Opening the same instance must reuse its renderer URL.",
    );

    const url = new URL(first.url);
    assert(
        url.hostname === "127.0.0.1",
        "The renderer must bind to 127.0.0.1.",
    );
    const response = await fetch(first.url);
    assert(response.ok, "The renderer URL did not return a successful page.");
    assert(
        (await response.text()).includes("<title>Flip Clock</title>"),
        "The renderer did not serve the supplied Flip Clock page.",
    );

    await closeInstance(instanceId);
    let rendererStopped = false;
    try {
        await fetch(first.url, {
            signal: AbortSignal.timeout(1_000),
        });
    } catch {
        rendererStopped = true;
    }
    assert(rendererStopped, "The onClose handler did not stop the renderer.");
}

async function probeStep3() {
    await probeStep2();

    const action = canvas.actions?.find(
        (item) => item?.name === "configure",
    );
    assert(action, "The canvas has no `configure` action.");
    assert(
        action.inputSchema?.type === "object" &&
            action.inputSchema.additionalProperties === false &&
            action.inputSchema.minProperties === 1,
        "The configure action schema is incomplete.",
    );
    assert(
        typeof action.handler === "function",
        "The configure action has no handler.",
    );

    const configured = await action.handler({
        input: {
            timeZone: "UTC",
            hourCycle: "24",
            theme: "midnight",
            motion: "reduced",
        },
    });
    assert(
        configured?.timeZone === "UTC" &&
            configured.hourCycle === "24" &&
            configured.theme === "midnight" &&
            configured.motion === "reduced",
        "The configure action did not return the updated preferences directly.",
    );

    let validationError;
    try {
        await action.handler({
            input: { timeZone: "Mars/Olympus_Mons" },
        });
    } catch (error) {
        validationError = error;
    }
    assert(
        validationError instanceof CanvasError,
        "Invalid preferences must throw CanvasError.",
    );

    const instanceId = "runtime-step-3";
    const result = await canvas.open({ instanceId });
    openInstances.add(instanceId);
    const stateUrl = new URL("/api/state", result.url);
    stateUrl.search = new URL(result.url).search;
    const state = await fetch(stateUrl).then((response) => response.json());
    assert(
        state.preferences?.theme === "midnight",
        "The renderer and configure action are not sharing preferences.",
    );
    await closeInstance(instanceId);
}

async function main() {
    await import(pathToFileURL(extensionPath).href);

    if (step === 1) {
        await probeStep1();
    } else if (step === 2) {
        await probeStep2();
    } else if (step === 3) {
        await probeStep3();
    } else {
        throw new Error(`Unsupported runtime probe step: ${step}`);
    }

    return { passed: true };
}

try {
    const result = await main();
    process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
} catch (error) {
    for (const instanceId of [...openInstances]) {
        try {
            await closeInstance(instanceId);
        } catch {
            // The original failure is more useful than cleanup noise.
        }
    }

    const message =
        error instanceof Error ? error.message : String(error);
    process.stdout.write(
        `${JSON.stringify({ passed: false, message })}\n`,
        () => process.exit(0),
    );
}
