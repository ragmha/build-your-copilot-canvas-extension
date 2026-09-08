import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const EXTENSION_DIRECTORY = ".github/extensions/flip-clock";
const execFileAsync = promisify(execFile);

async function readText(root, relativePath) {
    try {
        return await fs.readFile(join(root, relativePath), "utf8");
    } catch (error) {
        if (error && error.code === "ENOENT") {
            return "";
        }
        throw error;
    }
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
}

function stripCommentsAndStrings(source) {
    const withoutComments = stripComments(source);
    let result = "";
    let quote = null;
    let escaped = false;

    for (const character of withoutComments) {
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === quote) {
                quote = null;
            }
            result += character === "\n" ? "\n" : " ";
            continue;
        }

        if (
            character === '"' ||
            character === "'" ||
            character === "`"
        ) {
            quote = character;
            result += " ";
            continue;
        }

        result += character;
    }

    return result;
}

function check(description, passed, fix) {
    return { description, passed: Boolean(passed), fix };
}

function matches(source, pattern) {
    return pattern.test(stripComments(source));
}

async function extensionSource(root) {
    return readText(root, `${EXTENSION_DIRECTORY}/extension.mjs`);
}

async function readRuntimeModules(root) {
    const extensionRoot = join(root, EXTENSION_DIRECTORY);
    const modules = [];

    async function visit(directory) {
        let entries;
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (error && error.code === "ENOENT") {
                return;
            }
            throw error;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name !== "tests") {
                    await visit(join(directory, entry.name));
                }
                continue;
            }

            if (
                entry.isFile() &&
                entry.name.endsWith(".mjs") &&
                !entry.name.endsWith(".test.mjs")
            ) {
                modules.push(
                    await fs.readFile(join(directory, entry.name), "utf8"),
                );
            }
        }
    }

    await visit(extensionRoot);
    return modules;
}

export async function gradeStep1(root = DEFAULT_ROOT) {
    const source = await extensionSource(root);
    const description = source.match(
        /description\s*:\s*["'`]([^"'`]+)["'`]/,
    )?.[1];

    return [
        check(
            "`extension.mjs` exists in the project extension folder",
            source.length > 0,
            "Create `.github/extensions/flip-clock/extension.mjs`.",
        ),
        check(
            "The entry point imports `joinSession` and `createCanvas` from the extension SDK",
            matches(
                source,
                /import\s*\{[^}]*\bjoinSession\b[^}]*\bcreateCanvas\b[^}]*\}\s*from\s*["']@github\/copilot-sdk\/extension["']/s,
            ) ||
                matches(
                    source,
                    /import\s*\{[^}]*\bcreateCanvas\b[^}]*\bjoinSession\b[^}]*\}\s*from\s*["']@github\/copilot-sdk\/extension["']/s,
                ),
            "Import both APIs from `@github/copilot-sdk/extension`.",
        ),
        check(
            "`joinSession` registers a canvas created with `createCanvas`",
            matches(
                source,
                /joinSession\s*\(\s*\{[\s\S]*?canvases\s*:\s*\[[\s\S]*?createCanvas\s*\(/,
            ),
            "Pass `canvases: [createCanvas({ ... })]` to `joinSession`.",
        ),
        check(
            "The declaration uses the stable `flip-clock` canvas ID and a learner-facing name",
            matches(source, /id\s*:\s*["']flip-clock["']/) &&
                matches(source, /displayName\s*:\s*["']Flip Clock["']/),
            "Set `id: \"flip-clock\"` and `displayName: \"Flip Clock\"`.",
        ),
        check(
            "The canvas description is concise and meaningful",
            Boolean(
                description &&
                    description.length >= 20 &&
                    !description.toLowerCase().includes("replace"),
            ),
            "Add a one-sentence description that helps Copilot decide when to open the clock.",
        ),
        check(
            "The canvas declares an `open` handler with an initial host result",
            matches(
                source,
                /createCanvas\s*\(\s*\{[\s\S]*\bopen\s*:\s*async\s*(?:\([^)]*\)|[^=(),\s]+)\s*=>[\s\S]{0,1200}?title\s*:\s*["']Flip Clock["']/,
            ),
            "Add an `open` handler inside `createCanvas({ ... })` that returns a `Flip Clock` title.",
        ),
    ];
}

export async function gradeStep2(root = DEFAULT_ROOT) {
    const source = await extensionSource(root);
    const server = await readText(
        root,
        `${EXTENSION_DIRECTORY}/lib/server.mjs`,
    );

    return [
        check(
            "The extension imports the supplied loopback renderer",
            matches(
                source,
                /import\s*\{[^}]*\bstartClockServer\b[^}]*\}\s*from\s*["']\.\/lib\/server\.mjs["']/s,
            ),
            "Import `startClockServer` from `./lib/server.mjs`.",
        ),
        check(
            "Open canvas instances are tracked in a map",
            matches(source, /(?:const|let)\s+servers\s*=\s*new Map\s*\(/),
            "Create one module-level `servers` map for the open canvas instances.",
        ),
        check(
            "`open` reuses a server by `ctx.instanceId` and returns its URL",
            matches(source, /open\s*:\s*async\s*\(\s*ctx\s*\)\s*=>/) &&
                matches(
                    source,
                    /(?:let|const)\s+entry\s*=\s*servers\.get\s*\(\s*ctx\.instanceId\s*\)\s*;?[\s\S]{0,300}?if\s*\(\s*!entry\s*\)\s*\{[\s\S]{0,800}?entry\s*=\s*await\s+startClockServer\s*\(\s*\{[\s\S]{0,500}?instanceId\s*:\s*ctx\.instanceId[\s\S]{0,500}?\}\s*\)\s*;?[\s\S]{0,300}?servers\.set\s*\(\s*ctx\.instanceId\s*,\s*entry\s*\)/,
                ) &&
                matches(source, /url\s*:\s*(?:entry\.)?url/),
            "In `open`, get or start the server for `ctx.instanceId`, save it, and return `url: entry.url`.",
        ),
        check(
            "`onClose` removes and closes that instance's server",
            matches(source, /onClose\s*:\s*async\s*\(\s*ctx\s*\)\s*=>/) &&
                matches(source, /servers\.delete\s*\(\s*ctx\.instanceId\s*\)/) &&
                matches(source, /await\s+(?:entry\.)?close\s*\(/),
            "In `onClose`, delete the map entry and await the server entry's `close()` method.",
        ),
        check(
            "The supplied server binds an ephemeral loopback port",
            matches(
                server,
                /server\.listen\s*\(\s*0\s*,\s*["']127\.0\.0\.1["']/,
            ),
            "Keep `server.listen(0, \"127.0.0.1\")` in `lib/server.mjs`.",
        ),
    ];
}

export async function gradeStep3(root = DEFAULT_ROOT) {
    const source = await extensionSource(root);
    const configureAction =
        stripComments(source).match(
            /actions\s*:\s*\[[\s\S]*?\{([\s\S]{0,2600}?name\s*:\s*["']configure["'][\s\S]{0,2600}?)\}\s*,?\s*\]/,
        )?.[1] ?? "";
    const preferences = await readText(
        root,
        `${EXTENSION_DIRECTORY}/lib/preferences.mjs`,
    );

    return [
        check(
            "Canvas and preference error types are imported from their owning modules",
            matches(
                source,
                /import\s*\{[^}]*\bCanvasError\b[^}]*\}\s*from\s*["']@github\/copilot-sdk\/extension["']/s,
            ) &&
                matches(
                    source,
                    /import\s*\{[^}]*\bPREFERENCE_SCHEMA_PROPERTIES\b[^}]*\bPreferenceValidationError\b[^}]*\bcreatePreferenceStore\b[^}]*\}\s*from\s*["']\.\/lib\/preferences\.mjs["']/s,
                ),
            "Import `CanvasError` from the extension SDK and import `PREFERENCE_SCHEMA_PROPERTIES`, `PreferenceValidationError`, and `createPreferenceStore` from `./lib/preferences.mjs`.",
        ),
        check(
            "The extension creates the supplied durable preference store",
            matches(
                source,
                /import\s*\{[\s\S]*\bcreatePreferenceStore\b[\s\S]*\}\s*from\s*["']\.\/lib\/preferences\.mjs["']/,
            ) &&
                matches(
                    source,
                    /(?:const|let)\s+preferenceStore\s*=\s*createPreferenceStore\s*\(/,
                ),
            "Import `createPreferenceStore` and create one module-level `preferenceStore`.",
        ),
        check(
            "A validated `configure` action is declared",
            /name\s*:\s*["']configure["']/.test(configureAction) &&
                /inputSchema\s*:\s*\{[\s\S]*?type\s*:\s*["']object["']/.test(
                    configureAction,
                ) &&
                /properties\s*:\s*PREFERENCE_SCHEMA_PROPERTIES/.test(
                    configureAction,
                ) &&
                /additionalProperties\s*:\s*false/.test(configureAction) &&
                /minProperties\s*:\s*1/.test(configureAction),
            "Add `configure` inside the canvas `actions` array with an object schema, `PREFERENCE_SCHEMA_PROPERTIES`, `additionalProperties: false`, and `minProperties: 1`.",
        ),
        check(
            "The action returns the preference update result directly",
            matches(
                configureAction,
                /handler\s*:\s*async\s*\(\s*ctx\s*\)\s*=>\s*(?:\{[\s\S]*?return\s+)?await\s+preferenceStore\.update\s*\(\s*ctx\.input\s*\?\?\s*\{\}\s*\)/,
            ),
            "Return `await preferenceStore.update(ctx.input ?? {})` directly; canvas action results are not wrapped.",
        ),
        check(
            "Expected validation failures become `CanvasError` results",
            /error\s+instanceof\s+PreferenceValidationError/.test(
                configureAction,
            ) &&
                /throw\s+new\s+CanvasError\s*\(\s*error\.code\s*,\s*error\.message\s*\)/.test(
                    configureAction,
                ),
            "Catch `PreferenceValidationError` in the configure handler and throw `new CanvasError(error.code, error.message)`.",
        ),
        check(
            "The loopback server receives the shared preference store",
            matches(
                source,
                /startClockServer\s*\(\s*\{[\s\S]*?preferenceStore[\s\S]*?\}\s*\)/,
            ),
            "Pass the module-level `preferenceStore` to `startClockServer`.",
        ),
        check(
            "Preferences use a stable user-scoped path instead of an instance ID",
            matches(preferences, /COPILOT_HOME/) &&
                matches(
                    preferences,
                    /["']extensions["'][\s\S]*["']flip-clock["'][\s\S]*["']artifacts["']/,
                ) &&
                !matches(preferences, /instanceId/),
            "Keep durable preferences under `$COPILOT_HOME/extensions/flip-clock/artifacts/`; never key them by `instanceId`.",
        ),
    ];
}

export async function gradeStep4(root = DEFAULT_ROOT) {
    const manifestSource = await readText(
        root,
        `${EXTENSION_DIRECTORY}/copilot-extension.json`,
    );
    const extension = await extensionSource(root);
    const server = await readText(
        root,
        `${EXTENSION_DIRECTORY}/lib/server.mjs`,
    );
    const styles = await readText(
        root,
        `${EXTENSION_DIRECTORY}/assets/styles.css`,
    );
    const html = await readText(
        root,
        `${EXTENSION_DIRECTORY}/assets/index.html`,
    );
    const runtimeModules = await readRuntimeModules(root);
    const executableRuntime = runtimeModules
        .map(stripCommentsAndStrings)
        .join("\n");
    const executableServer = stripCommentsAndStrings(server);
    const activeStyles = styles.replace(/\/\*[\s\S]*?\*\//g, "");
    const activeHtml = html.replace(/<!--[\s\S]*?-->/g, "");

    let manifest;
    try {
        manifest = JSON.parse(manifestSource);
    } catch {
        manifest = null;
    }

    return [
        check(
            "The shareable extension manifest is valid",
            manifest?.name === "flip-clock" && manifest?.version === 1,
            "Create `copilot-extension.json` with `{ \"name\": \"flip-clock\", \"version\": 1 }`.",
        ),
        check(
            "Extension runtime modules do not write to stdout with `console.log`",
            !/\bconsole\.log\s*\(/.test(executableRuntime),
            "Remove `console.log`; stdout is reserved for JSON-RPC. Use `session.log` or stderr for diagnostics.",
        ),
        check(
            "The renderer is protected by a token and restrictive CSP",
            /\brandomBytes\s*\(/.test(executableServer) &&
                /\btimingSafeEqual\s*\(/.test(executableServer) &&
                /setHeader\s*\(\s*["']Content-Security-Policy["']/.test(
                    server,
                ),
            "Keep the random URL token, timing-safe comparison, and Content-Security-Policy headers in the server.",
        ),
        check(
            "The renderer supports reduced motion",
            /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(
                activeStyles,
            ),
            "Keep the `prefers-reduced-motion: reduce` CSS override.",
        ),
        check(
            "The visual clock exposes an accessible text time and labeled controls",
            /<time[^>]+id=["']accessibleTime["']/.test(activeHtml) &&
                /aria-label=["']Open clock settings["']/.test(activeHtml),
            "Keep the screen-reader `<time>` element and accessible settings label.",
        ),
    ];
}

export async function gradeStep(step, root = DEFAULT_ROOT) {
    const graders = {
        1: gradeStep1,
        2: gradeStep2,
        3: gradeStep3,
        4: gradeStep4,
    };
    const grader = graders[step];
    if (!grader) {
        throw new Error(`Unknown exercise step: ${step}`);
    }
    return grader(root);
}

export async function gradeRuntimeStep(step, root = DEFAULT_ROOT) {
    const extensionPath = join(
        root,
        EXTENSION_DIRECTORY,
        "extension.mjs",
    );
    const temporaryHome = await fs.mkdtemp(
        join(tmpdir(), "canvas-runtime-grade-"),
    );

    try {
        const { stdout } = await execFileAsync(
            process.execPath,
            [
                "--no-warnings",
                "--experimental-loader",
                join(SCRIPT_DIRECTORY, "fake-sdk-loader.mjs"),
                join(SCRIPT_DIRECTORY, "runtime-probe.mjs"),
                String(step),
                extensionPath,
            ],
            {
                cwd: root,
                env: {
                    ...process.env,
                    COPILOT_HOME: temporaryHome,
                },
                timeout: 10_000,
                maxBuffer: 128 * 1024,
            },
        );
        const result = JSON.parse(stdout);
        return check(
            `The Step ${step} extension wiring works with a controlled runtime`,
            result.passed,
            result.message ??
                "Make the declared canvas executable, not only text that resembles the lesson snippets.",
        );
    } catch (error) {
        const detail =
            error instanceof SyntaxError
                ? "The runtime probe received unexpected stdout. Remove console.log and keep the implementation executable."
                : error instanceof Error
                  ? error.message
                  : String(error);
        return check(
            `The Step ${step} extension wiring works with a controlled runtime`,
            false,
            `Runtime probe failed: ${detail}`,
        );
    } finally {
        await fs.rm(temporaryHome, { recursive: true, force: true });
    }
}

export async function gradeThrough(
    step,
    root = DEFAULT_ROOT,
    { runtime = false } = {},
) {
    const results = [];
    for (let currentStep = 1; currentStep <= step; currentStep += 1) {
        const checks = await gradeStep(currentStep, root);
        if (runtime && currentStep <= 3) {
            checks.push(await gradeRuntimeStep(currentStep, root));
        }
        results.push({
            step: currentStep,
            checks,
        });
    }
    return results;
}

export function renderReport(step, checks) {
    const passed = checks.filter((item) => item.passed).length;
    const lines = [
        `## Step ${step} results`,
        "",
        `**${passed} of ${checks.length} checks passed.**`,
        "",
        "| Check | Result |",
        "|---|---|",
        ...checks.map(
            (item) =>
                `| ${item.description} | ${item.passed ? "✅ Passed" : "❌ Needs work"} |`,
        ),
    ];

    const failures = checks.filter((item) => !item.passed);
    if (failures.length > 0) {
        lines.push("", "### How to fix the remaining checks", "");
        for (const failure of failures) {
            lines.push(`- ${failure.fix}`);
        }
        lines.push(
            "",
            "Commit and push your changes again. This step will re-run automatically.",
        );
    }

    return `${lines.join("\n")}\n`;
}

async function main() {
    const step = Number.parseInt(process.argv[2], 10);
    const cumulative = process.argv.includes("--cumulative");
    const rootArgument = process.argv
        .slice(3)
        .find((argument) => argument !== "--cumulative");
    const root = rootArgument ? resolve(rootArgument) : DEFAULT_ROOT;
    const results = cumulative
        ? await gradeThrough(step, root, { runtime: true })
        : [
              {
                  step,
                  checks: [
                      ...(await gradeStep(step, root)),
                      ...(step <= 3
                          ? [await gradeRuntimeStep(step, root)]
                          : []),
                  ],
              },
          ];

    process.stdout.write(
        results
            .map((result) => renderReport(result.step, result.checks))
            .join("\n"),
    );
    if (
        results.some((result) =>
            result.checks.some((item) => !item.passed),
        )
    ) {
        process.exitCode = 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await main();
}
