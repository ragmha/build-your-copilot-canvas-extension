import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
    gradeStep,
    gradeStep1,
    gradeStep2,
    gradeStep3,
    gradeStep4,
    gradeThrough,
    renderReport,
} from "../scripts/grade.mjs";

const extensionDirectory = ".github/extensions/flip-clock";
const completedExtensionSource = `
import {
    CanvasError,
    createCanvas,
    joinSession,
} from "@github/copilot-sdk/extension";
import {
    PREFERENCE_SCHEMA_PROPERTIES,
    PreferenceValidationError,
    createPreferenceStore,
} from "./lib/preferences.mjs";
import { startClockServer } from "./lib/server.mjs";

const preferenceStore = createPreferenceStore();
const servers = new Map();

await joinSession({
    canvases: [
        createCanvas({
            id: "flip-clock",
            displayName: "Flip Clock",
            description:
                "A serene split-flap clock with timezone, theme, and motion controls.",
            actions: [
                {
                    name: "configure",
                    inputSchema: {
                        type: "object",
                        properties: PREFERENCE_SCHEMA_PROPERTIES,
                        additionalProperties: false,
                        minProperties: 1,
                    },
                    handler: async (ctx) => {
                        try {
                            return await preferenceStore.update(ctx.input ?? {});
                        } catch (error) {
                            if (error instanceof PreferenceValidationError) {
                                throw new CanvasError(error.code, error.message);
                            }
                            throw error;
                        }
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startClockServer({
                        instanceId: ctx.instanceId,
                        preferenceStore,
                    });
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Flip Clock", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await entry.close();
                }
            },
        }),
    ],
});
`;

async function fixture(context, files) {
    const root = await fs.mkdtemp(join(tmpdir(), "canvas-grader-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));

    for (const [relativePath, contents] of Object.entries(files)) {
        const path = join(root, relativePath);
        await fs.mkdir(join(path, ".."), { recursive: true });
        await fs.writeFile(path, contents, "utf8");
    }
    return root;
}

async function runtimeFixture(context, source = completedExtensionSource) {
    const root = await fs.mkdtemp(join(tmpdir(), "canvas-runtime-"));
    context.after(() => fs.rm(root, { recursive: true, force: true }));

    const target = join(root, extensionDirectory);
    await fs.mkdir(join(target, ".."), { recursive: true });
    await fs.cp(
        new URL("../extensions/flip-clock/", import.meta.url),
        target,
        { recursive: true },
    );
    await fs.writeFile(
        join(target, "extension.mjs"),
        source,
        "utf8",
    );
    return root;
}

test("step 1 reports precise missing requirements", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]:
            'import { createCanvas } from "@github/copilot-sdk/extension";\n',
    });

    const checks = await gradeStep1(root);
    assert.equal(checks[0].passed, true);
    assert.equal(checks.some((item) => !item.passed), true);
    assert.match(renderReport(1, checks), /How to fix the remaining checks/);
});

test("step 1 rejects an empty open handler", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]: `
import {
    createCanvas,
    joinSession,
} from "@github/copilot-sdk/extension";
await joinSession({
    canvases: [
        createCanvas({
            id: "flip-clock",
            displayName: "Flip Clock",
            description: "A useful and sufficiently long canvas description.",
            open: async () => {},
        }),
    ],
});
`,
    });

    assert.equal(
        (await gradeStep1(root)).some((item) => !item.passed),
        true,
    );
});

test("step 2 accepts lifecycle wiring without importing the SDK", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]: `
import { startClockServer } from "./lib/server.mjs";
const servers = new Map();
const canvas = {
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        if (!entry) {
            entry = await startClockServer({ instanceId: ctx.instanceId });
            servers.set(ctx.instanceId, entry);
        }
        return { url: entry.url };
    },
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        servers.delete(ctx.instanceId);
        await entry.close();
    },
};
`,
        [`${extensionDirectory}/lib/server.mjs`]:
            'server.listen(0, "127.0.0.1");\n',
    });

    assert.equal(
        (await gradeStep2(root)).every((item) => item.passed),
        true,
    );
});

test("step 2 rejects lifecycle code that never starts the renderer", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]: `
import { startClockServer } from "./lib/server.mjs";
const servers = new Map();
const canvas = {
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        entry = { url: "http://127.0.0.1:1/" };
        servers.set(ctx.instanceId, entry);
        return { url: entry.url };
    },
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        servers.delete(ctx.instanceId);
        await entry.close();
    },
};
`,
        [`${extensionDirectory}/lib/server.mjs`]:
            'server.listen(0, "127.0.0.1");\n',
    });

    assert.equal(
        (await gradeStep2(root)).some((item) => !item.passed),
        true,
    );
});

test("step 2 rejects unconditional server replacement", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]: `
import { startClockServer } from "./lib/server.mjs";
const servers = new Map();
const canvas = {
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        entry = await startClockServer({ instanceId: ctx.instanceId });
        servers.set(ctx.instanceId, entry);
        return { url: entry.url };
    },
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        servers.delete(ctx.instanceId);
        await entry.close();
    },
};
`,
        [`${extensionDirectory}/lib/server.mjs`]:
            'server.listen(0, "127.0.0.1");\n',
    });

    assert.equal(
        (await gradeStep2(root)).some((item) => !item.passed),
        true,
    );
});

test("step 3 accepts schema-backed durable preference wiring", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]: `
import { CanvasError } from "@github/copilot-sdk/extension";
import {
    PREFERENCE_SCHEMA_PROPERTIES,
    PreferenceValidationError,
    createPreferenceStore,
} from "./lib/preferences.mjs";
const preferenceStore = createPreferenceStore();
const canvas = {
    actions: [
        {
            name: "configure",
            inputSchema: {
                type: "object",
                properties: PREFERENCE_SCHEMA_PROPERTIES,
                additionalProperties: false,
                minProperties: 1,
            },
            handler: async (ctx) => {
                try {
                    return await preferenceStore.update(ctx.input ?? {});
                } catch (error) {
                    if (error instanceof PreferenceValidationError) {
                        throw new CanvasError(error.code, error.message);
                    }
                    throw error;
                }
            },
        },
    ],
};
startClockServer({ preferenceStore });
`,
        [`${extensionDirectory}/lib/preferences.mjs`]: `
const home = process.env.COPILOT_HOME;
const path = join(home, "extensions", "flip-clock", "artifacts");
`,
    });

    assert.equal(
        (await gradeStep3(root)).every((item) => item.passed),
        true,
    );
});

test("step 3 rejects a detached or incompletely validated action", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]: `
import {
    PREFERENCE_SCHEMA_PROPERTIES,
    createPreferenceStore,
} from "./lib/preferences.mjs";
const preferenceStore = createPreferenceStore();
const action = {
    name: "configure",
    inputSchema: {
        properties: PREFERENCE_SCHEMA_PROPERTIES,
        additionalProperties: false,
        minProperties: 1,
    },
    handler: async (ctx) =>
        await preferenceStore.update(ctx.input ?? {}),
};
startClockServer({ preferenceStore });
`,
        [`${extensionDirectory}/lib/preferences.mjs`]: `
const home = process.env.COPILOT_HOME;
const path = join(home, "extensions", "flip-clock", "artifacts");
`,
    });

    assert.equal(
        (await gradeStep3(root)).some((item) => !item.passed),
        true,
    );
});

test("step 3 rejects unimported or non-instance validation errors", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]: `
const preferenceStore = createPreferenceStore();
const canvas = {
    actions: [
        {
            name: "configure",
            inputSchema: {
                type: "object",
                properties: PREFERENCE_SCHEMA_PROPERTIES,
                additionalProperties: false,
                minProperties: 1,
            },
            handler: async (ctx) => {
                try {
                    return await preferenceStore.update(ctx.input ?? {});
                } catch (error) {
                    if (PreferenceValidationError) {
                        throw new CanvasError(error.code, error.message);
                    }
                    throw error;
                }
            },
        },
    ],
};
startClockServer({ preferenceStore });
`,
        [`${extensionDirectory}/lib/preferences.mjs`]: `
const home = process.env.COPILOT_HOME;
const path = join(home, "extensions", "flip-clock", "artifacts");
`,
    });

    assert.equal(
        (await gradeStep3(root)).some((item) => !item.passed),
        true,
    );
});

test("step 4 validates package and hardening artifacts", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/copilot-extension.json`]:
            '{"name":"flip-clock","version":1}\n',
        [`${extensionDirectory}/extension.mjs`]: "session.log('ready');\n",
        [`${extensionDirectory}/lib/server.mjs`]:
            "randomBytes(); timingSafeEqual(); response.setHeader('Content-Security-Policy', policy);\n",
        [`${extensionDirectory}/tests/allowed.test.mjs`]:
            "console.log('test diagnostics are outside the runtime');\n",
        [`${extensionDirectory}/assets/styles.css`]:
            "@media (prefers-reduced-motion: reduce) {}\n",
        [`${extensionDirectory}/assets/index.html`]:
            '<time id="accessibleTime"></time><button aria-label="Open clock settings"></button>\n',
    });

    assert.equal(
        (await gradeStep4(root)).every((item) => item.passed),
        true,
    );
});

test("step 4 rejects hardening evidence hidden in comments or strings", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/copilot-extension.json`]:
            '{"name":"flip-clock","version":1}\n',
        [`${extensionDirectory}/extension.mjs`]:
            'const evidence = "console.log";\n',
        [`${extensionDirectory}/lib/server.mjs`]:
            'const evidence = "randomBytes() timingSafeEqual()";\n',
        [`${extensionDirectory}/assets/styles.css`]:
            "/* @media (prefers-reduced-motion: reduce) {} */\n",
        [`${extensionDirectory}/assets/index.html`]:
            '<!-- <time id="accessibleTime"></time><button aria-label="Open clock settings"></button> -->\n',
    });

    assert.equal(
        (await gradeStep4(root)).some((item) => !item.passed),
        true,
    );
});

test("step 4 rejects console.log in every non-test runtime module", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/copilot-extension.json`]:
            '{"name":"flip-clock","version":1}\n',
        [`${extensionDirectory}/extension.mjs`]: "session.log('ready');\n",
        [`${extensionDirectory}/lib/server.mjs`]:
            "randomBytes(); timingSafeEqual(); response.setHeader('Content-Security-Policy', policy);\n",
        [`${extensionDirectory}/lib/preferences.mjs`]:
            "export function reset() { console.log('reset'); }\n",
        [`${extensionDirectory}/tests/allowed.test.mjs`]:
            "console.log('test diagnostics are outside the runtime');\n",
        [`${extensionDirectory}/assets/styles.css`]:
            "@media (prefers-reduced-motion: reduce) {}\n",
        [`${extensionDirectory}/assets/index.html`]:
            '<time id="accessibleTime"></time><button aria-label="Open clock settings"></button>\n',
    });

    const checks = await gradeStep4(root);
    assert.equal(
        checks.find((item) =>
            item.description.includes("do not write to stdout"),
        )?.passed,
        false,
    );
});

test("a completed learner solution passes all four graders", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]: completedExtensionSource,
        [`${extensionDirectory}/lib/preferences.mjs`]: `
const home = process.env.COPILOT_HOME;
const path = join(home, "extensions", "flip-clock", "artifacts");
`,
        [`${extensionDirectory}/lib/server.mjs`]: `
server.listen(0, "127.0.0.1");
randomBytes();
timingSafeEqual();
response.setHeader("Content-Security-Policy", policy);
`,
        [`${extensionDirectory}/copilot-extension.json`]:
            '{"name":"flip-clock","version":1}\n',
        [`${extensionDirectory}/assets/styles.css`]:
            "@media (prefers-reduced-motion: reduce) {}\n",
        [`${extensionDirectory}/assets/index.html`]:
            '<time id="accessibleTime"></time><button aria-label="Open clock settings"></button>\n',
    });

    for (const step of [1, 2, 3, 4]) {
        const checks = await gradeStep(step, root);
        assert.equal(
            checks.every((item) => item.passed),
            true,
            `Step ${step}: ${JSON.stringify(checks)}`,
        );
    }

    const cumulative = await gradeThrough(4, root);
    assert.equal(cumulative.length, 4);
    assert.equal(
        cumulative.every((result) =>
            result.checks.every((item) => item.passed),
        ),
        true,
    );
});

test("controlled runtime executes the completed learner solution", async (context) => {
    const root = await runtimeFixture(context);
    const results = await gradeThrough(3, root, { runtime: true });

    assert.equal(
        results.every((result) =>
            result.checks.every((item) => item.passed),
        ),
        true,
        JSON.stringify(results),
    );
});

test("controlled runtime rejects implementation text hidden in a string", async (context) => {
    const root = await runtimeFixture(
        context,
        `const gradingEvidence = ${JSON.stringify(completedExtensionSource)};\n`,
    );
    const results = await gradeThrough(3, root, { runtime: true });

    assert.equal(
        results.some((result) =>
            result.checks.some(
                (item) =>
                    item.description.includes("controlled runtime") &&
                    !item.passed,
            ),
        ),
        true,
    );
});

test("cumulative grading catches removed earlier functionality", async (context) => {
    const root = await fixture(context, {
        [`${extensionDirectory}/extension.mjs`]: "session.log('ready');\n",
        [`${extensionDirectory}/lib/server.mjs`]:
            "server.listen(0, '127.0.0.1'); randomBytes(); timingSafeEqual(); response.setHeader('Content-Security-Policy', policy);\n",
        [`${extensionDirectory}/lib/preferences.mjs`]: `
const home = process.env.COPILOT_HOME;
const path = join(home, "extensions", "flip-clock", "artifacts");
`,
        [`${extensionDirectory}/copilot-extension.json`]:
            '{"name":"flip-clock","version":1}\n',
        [`${extensionDirectory}/assets/styles.css`]:
            "@media (prefers-reduced-motion: reduce) {}\n",
        [`${extensionDirectory}/assets/index.html`]:
            '<time id="accessibleTime"></time><button aria-label="Open clock settings"></button>\n',
    });

    const results = await gradeThrough(4, root);
    assert.equal(
        results[3].checks.every((item) => item.passed),
        true,
    );
    assert.equal(
        results.slice(0, 3).some((result) =>
            result.checks.some((item) => !item.passed),
        ),
        true,
    );
});
