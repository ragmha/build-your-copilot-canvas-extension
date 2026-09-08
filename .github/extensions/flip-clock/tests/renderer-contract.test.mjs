import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import test from "node:test";

const assetDirectory = new URL("../assets/", import.meta.url);

test("renderer imports exist and required DOM IDs are present", async () => {
    const [appSource, html] = await Promise.all([
        fs.readFile(new URL("app.js", assetDirectory), "utf8"),
        fs.readFile(new URL("index.html", assetDirectory), "utf8"),
    ]);

    const imports = [
        ...appSource.matchAll(/from\s+["'](\.[^"']+)["']/g),
    ].map((match) => match[1]);
    assert.deepEqual(imports, ["./clock-core.js"]);

    for (const specifier of imports) {
        await fs.access(new URL(specifier, new URL("app.js", assetDirectory)));
    }

    const requiredIds = new Set(
        [...appSource.matchAll(/querySelector\(\s*["']#([^"']+)["']\s*\)/g)]
            .map((match) => match[1]),
    );
    assert.ok(requiredIds.size >= 15);

    for (const id of requiredIds) {
        assert.match(
            html,
            new RegExp(`\\bid=["']${id}["']`),
            `index.html is missing #${id}`,
        );
    }

    assert.match(
        html,
        /<script\s+type=["']module["']\s+src=["']\/app\.js["']/,
    );
    assert.match(
        html,
        /<link\s+rel=["']stylesheet["']\s+href=["']\/styles\.css["']/,
    );
});

test("renderer initializes against its documented DOM contract", async (context) => {
    const [appSource, clockCoreSource] = await Promise.all([
        fs.readFile(new URL("app.js", assetDirectory), "utf8"),
        fs.readFile(new URL("clock-core.js", assetDirectory), "utf8"),
    ]);
    const elements = new Map();

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

    const originalDescriptors = new Map();
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
        originalDescriptors.set(
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        );
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value,
        });
    }

    context.after(() => {
        for (const [name, descriptor] of originalDescriptors) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        }
    });

    const clockCoreUrl = `data:text/javascript;base64,${Buffer.from(
        clockCoreSource,
    ).toString("base64")}`;
    const executableApp = appSource.replace(
        '"./clock-core.js"',
        JSON.stringify(clockCoreUrl),
    );
    assert.notEqual(executableApp, appSource);

    const appUrl = `data:text/javascript;base64,${Buffer.from(
        executableApp,
    ).toString("base64")}`;
    await import(appUrl);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(elements.get("#app").dataset.ready, "true");
    assert.equal(document.body.dataset.theme, "midnight");
    assert.equal(elements.get("#timezoneLabel").textContent, "UTC");
});
