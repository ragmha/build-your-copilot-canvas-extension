import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";

const [appPath, htmlPath] = process.argv.slice(2);
if (!appPath || !htmlPath) {
    throw new Error("Usage: node renderer-smoke.mjs <app.js> <index.html>");
}

const [appSource, html] = await Promise.all([
    fs.readFile(appPath, "utf8"),
    fs.readFile(htmlPath, "utf8"),
]);
const activeHtml = html.replace(/<!--[\s\S]*?-->/g, "");
const appUrl = pathToFileURL(appPath);
const imports = [
    ...appSource.matchAll(/from\s+["'](\.[^"']+)["']/g),
].map((match) => match[1]);

assert.deepEqual(imports, ["./clock-core.js"]);
for (const specifier of imports) {
    await fs.access(new URL(specifier, appUrl));
}

const requiredIds = new Set(
    [...appSource.matchAll(/querySelector\(\s*["']#([^"']+)["']\s*\)/g)]
        .map((match) => match[1]),
);
assert.ok(requiredIds.size >= 15);

for (const id of requiredIds) {
    assert.match(
        activeHtml,
        new RegExp(`\\bid=["']${id}["']`),
        `index.html is missing active markup for #${id}`,
    );
}

assert.match(
    activeHtml,
    /<script\s+type=["']module["']\s+src=["']\/app\.js["']/,
);
assert.match(
    activeHtml,
    /<link\s+rel=["']stylesheet["']\s+href=["']\/styles\.css["']/,
);

const elements = new Map();
const activeIds = new Set(
    [...activeHtml.matchAll(/\bid=["']([^"']+)["']/g)]
        .map((match) => match[1]),
);

class FakeElement {
    constructor() {
        this.classList = {
            add() {},
            remove() {},
        };
        this.dataset = {};
        this.style = { setProperty() {} };
        this.textContent = "";
        this.hidden = false;
        this.open = false;
        this.value = "";
        this.disabled = false;
        this.title = "";
        this.dateTime = "";
        this.offsetWidth = 1;
    }

    addEventListener() {}

    append() {}

    close() {
        this.open = false;
    }

    focus() {}

    querySelector() {
        return new FakeElement();
    }

    replaceChildren() {}

    showModal() {
        this.open = true;
    }

    toggleAttribute() {}
}

const document = {
    body: new FakeElement(),
    hidden: false,
    title: "",
    addEventListener() {},
    createDocumentFragment: () => new FakeElement(),
    createElement: () => new FakeElement(),
    querySelector(selector) {
        const id = selector.match(/^#(.+)$/)?.[1];
        if (id && !activeIds.has(id)) {
            return null;
        }
        if (!elements.has(selector)) {
            elements.set(selector, new FakeElement());
        }
        return elements.get(selector);
    },
};
const window = {
    location: {
        origin: "http://127.0.0.1:4173",
        search: "?token=renderer-smoke",
    },
    addEventListener() {},
    clearTimeout() {},
    matchMedia: () => ({
        matches: false,
        addEventListener() {},
    }),
    setTimeout: () => 1,
};

for (const [name, value] of Object.entries({
    document,
    window,
    navigator: { language: "en-US" },
    ResizeObserver: class {
        observe() {}
    },
    EventSource: class {
        addEventListener() {}
        close() {}
    },
    fetch: async () => ({
        ok: true,
        async json() {
            return {
                preferences: {
                    timeZone: "UTC",
                    hourCycle: "24",
                    theme: "midnight",
                    motion: "reduced",
                },
            };
        },
    }),
})) {
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value,
    });
}

const clockCoreSource = await fs.readFile(
    new URL("./clock-core.js", appUrl),
    "utf8",
);
const clockCoreUrl = `data:text/javascript;base64,${Buffer.from(
    clockCoreSource,
).toString("base64")}`;
let rewrittenImports = 0;
const executableApp = appSource.replace(
    /(from\s+)(["'])\.\/clock-core\.js\2/,
    (_match, prefix) => {
        rewrittenImports += 1;
        return `${prefix}${JSON.stringify(clockCoreUrl)}`;
    },
);
assert.equal(rewrittenImports, 1);

const executableUrl = `data:text/javascript;base64,${Buffer.from(
    executableApp,
).toString("base64")}`;
await import(executableUrl);
await new Promise((resolve) => setImmediate(resolve));

assert.equal(elements.get("#app")?.dataset.ready, "true");
assert.equal(document.body.dataset.theme, "midnight");
assert.equal(elements.get("#timezoneLabel")?.textContent, "UTC");
