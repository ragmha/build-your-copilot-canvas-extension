import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
    PreferenceStore,
    PreferenceValidationError,
    createMemoryPreferenceStore,
    getDefaultPreferences,
    isValidTimeZone,
    normalizePreferences,
} from "../lib/preferences.mjs";

test("default preferences are valid and local", () => {
    const preferences = getDefaultPreferences();

    assert.equal(isValidTimeZone(preferences.timeZone), true);
    assert.equal(preferences.hourCycle, "12");
    assert.equal(preferences.theme, "obsidian");
    assert.equal(preferences.motion, "system");
});

test("normalization rejects unknown settings and invalid timezones", () => {
    assert.throws(
        () => normalizePreferences({ unknown: true }),
        PreferenceValidationError,
    );
    assert.throws(
        () => normalizePreferences({ timeZone: "Mars/Olympus_Mons" }),
        /valid IANA timezone/,
    );
});

test("memory preferences broadcast without writing durable state", async () => {
    const store = createMemoryPreferenceStore({
        timeZone: "UTC",
        hourCycle: "24",
        theme: "midnight",
        motion: "reduced",
    });
    const updates = [];
    const unsubscribe = store.subscribe((preferences) => {
        updates.push(preferences);
    });

    const saved = await store.update({ theme: "porcelain" });
    assert.equal(saved.theme, "porcelain");
    assert.deepEqual(updates, [saved]);
    unsubscribe();
});

test("preference store persists, broadcasts, and resets", async (context) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "flip-clock-"));
    const filePath = join(directory, "preferences.json");
    context.after(() => fs.rm(directory, { recursive: true, force: true }));

    const store = new PreferenceStore({ filePath });
    const updates = [];
    const unsubscribe = store.subscribe((preferences) => {
        updates.push(preferences);
    });

    const saved = await store.update({
        timeZone: "Asia/Tokyo",
        hourCycle: "24",
        theme: "midnight",
        motion: "reduced",
    });
    assert.deepEqual(saved, {
        timeZone: "Asia/Tokyo",
        hourCycle: "24",
        theme: "midnight",
        motion: "reduced",
    });

    const reloaded = new PreferenceStore({ filePath });
    assert.deepEqual(await reloaded.get(), saved);
    assert.deepEqual(updates, [saved]);

    const reset = await store.reset();
    assert.deepEqual(reset, getDefaultPreferences());
    assert.equal(updates.length, 2);
    unsubscribe();
});

test("reset repairs a corrupt preferences file", async (context) => {
    const directory = await fs.mkdtemp(
        join(tmpdir(), "flip-clock-corrupt-"),
    );
    const filePath = join(directory, "preferences.json");
    context.after(() => fs.rm(directory, { recursive: true, force: true }));

    await fs.writeFile(filePath, '{"futureKey":true}\n', "utf8");
    const store = new PreferenceStore({ filePath });

    await assert.rejects(store.get(), /Unknown preference/);
    assert.deepEqual(await store.reset(), getDefaultPreferences());
    assert.deepEqual(await store.get(), getDefaultPreferences());
});
