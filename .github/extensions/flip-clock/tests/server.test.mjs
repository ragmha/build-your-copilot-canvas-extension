import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PreferenceStore } from "../lib/preferences.mjs";
import { startClockServer } from "../lib/server.mjs";

test("serves a token-protected canvas on loopback", async (context) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "flip-clock-server-"));
    const preferenceStore = new PreferenceStore({
        filePath: join(directory, "preferences.json"),
    });
    const errors = [];
    const entry = await startClockServer({
        instanceId: "test-clock",
        preferenceStore,
        reportError: async (error) => errors.push(error),
    });

    context.after(async () => {
        await entry.close();
        await fs.rm(directory, { recursive: true, force: true });
    });

    const url = new URL(entry.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.notEqual(url.port, "");
    assert.ok(url.searchParams.get("token"));

    const page = await fetch(entry.url);
    assert.equal(page.status, 200);
    assert.match(
        page.headers.get("content-security-policy"),
        /default-src 'self'/,
    );
    assert.match(await page.text(), /<title>Flip Clock<\/title>/);

    const blocked = await fetch(new URL("/", url.origin));
    assert.equal(blocked.status, 404);

    const stateUrl = new URL("/api/state", url.origin);
    stateUrl.search = url.search;
    const state = await fetch(stateUrl).then((response) => response.json());
    assert.equal(state.instanceId, "test-clock");
    assert.equal(state.preferences.theme, "obsidian");
    assert.deepEqual(errors, []);
});

test("uses a distinct access token for each renderer", async (context) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "flip-clock-tokens-"));
    const preferenceStore = new PreferenceStore({
        filePath: join(directory, "preferences.json"),
    });
    const first = await startClockServer({
        instanceId: "first",
        preferenceStore,
    });
    const second = await startClockServer({
        instanceId: "second",
        preferenceStore,
    });

    context.after(async () => {
        await Promise.all([first.close(), second.close()]);
        await fs.rm(directory, { recursive: true, force: true });
    });

    assert.notEqual(
        new URL(first.url).searchParams.get("token"),
        new URL(second.url).searchParams.get("token"),
    );
});
