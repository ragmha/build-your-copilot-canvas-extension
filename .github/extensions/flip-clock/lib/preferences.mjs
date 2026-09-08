import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const THEMES = Object.freeze(["obsidian", "porcelain", "midnight"]);
export const HOUR_CYCLES = Object.freeze(["12", "24"]);
export const MOTION_PREFERENCES = Object.freeze([
    "system",
    "full",
    "reduced",
]);

export const PREFERENCE_SCHEMA_PROPERTIES = Object.freeze({
    timeZone: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        description: "An IANA timezone such as Europe/London or Asia/Tokyo.",
    },
    hourCycle: {
        type: "string",
        enum: HOUR_CYCLES,
        description: "Use a 12-hour or 24-hour clock.",
    },
    theme: {
        type: "string",
        enum: THEMES,
        description: "The visual theme.",
    },
    motion: {
        type: "string",
        enum: MOTION_PREFERENCES,
        description:
            "Follow the system motion setting, force flips, or reduce motion.",
    },
});

const ALLOWED_KEYS = new Set(Object.keys(PREFERENCE_SCHEMA_PROPERTIES));

export class PreferenceValidationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "PreferenceValidationError";
        this.code = code;
    }
}

export class PreferenceStorageError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = "PreferenceStorageError";
    }
}

export function isValidTimeZone(timeZone) {
    if (typeof timeZone !== "string" || timeZone.length === 0) {
        return false;
    }

    try {
        new Intl.DateTimeFormat("en-US", { timeZone }).format();
        return true;
    } catch (error) {
        if (error instanceof RangeError) {
            return false;
        }
        throw error;
    }
}

export function getDefaultPreferences() {
    const localTimeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    return {
        timeZone: isValidTimeZone(localTimeZone) ? localTimeZone : "UTC",
        hourCycle: "12",
        theme: "obsidian",
        motion: "system",
    };
}

function isPlainObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

function assertEnumValue(key, value, allowed) {
    if (!allowed.includes(value)) {
        throw new PreferenceValidationError(
            `invalid_${key}`,
            `${key} must be one of: ${allowed.join(", ")}.`,
        );
    }
}

export function normalizePreferences(
    input,
    basePreferences = getDefaultPreferences(),
) {
    if (!isPlainObject(input)) {
        throw new PreferenceValidationError(
            "invalid_preferences",
            "Preferences must be a JSON object.",
        );
    }

    for (const key of Object.keys(input)) {
        if (!ALLOWED_KEYS.has(key)) {
            throw new PreferenceValidationError(
                "unknown_preference",
                `Unknown preference: ${key}.`,
            );
        }
    }

    const next = { ...basePreferences };

    if (Object.hasOwn(input, "timeZone")) {
        if (
            typeof input.timeZone !== "string" ||
            input.timeZone.length > 128 ||
            !isValidTimeZone(input.timeZone)
        ) {
            throw new PreferenceValidationError(
                "invalid_timezone",
                "Choose a valid IANA timezone, such as Europe/London or Asia/Tokyo.",
            );
        }
        next.timeZone = input.timeZone;
    }

    if (Object.hasOwn(input, "hourCycle")) {
        assertEnumValue("hour_cycle", input.hourCycle, HOUR_CYCLES);
        next.hourCycle = input.hourCycle;
    }

    if (Object.hasOwn(input, "theme")) {
        assertEnumValue("theme", input.theme, THEMES);
        next.theme = input.theme;
    }

    if (Object.hasOwn(input, "motion")) {
        assertEnumValue(
            "motion",
            input.motion,
            MOTION_PREFERENCES,
        );
        next.motion = input.motion;
    }

    return next;
}

function preferencesEqual(left, right) {
    return (
        left.timeZone === right.timeZone &&
        left.hourCycle === right.hourCycle &&
        left.theme === right.theme &&
        left.motion === right.motion
    );
}

export function createMemoryPreferenceStore(
    initialPreferences = getDefaultPreferences(),
) {
    let value = normalizePreferences(initialPreferences);
    const listeners = new Set();

    function notify() {
        for (const listener of listeners) {
            listener({ ...value });
        }
    }

    return {
        async get() {
            return { ...value };
        },
        async update(patch) {
            value = normalizePreferences(patch, value);
            notify();
            return { ...value };
        },
        async reset() {
            value = getDefaultPreferences();
            notify();
            return { ...value };
        },
        subscribe(listener) {
            if (typeof listener !== "function") {
                throw new TypeError(
                    "Preference listener must be a function.",
                );
            }
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

export class PreferenceStore {
    #filePath;
    #listeners = new Set();
    #loadPromise;
    #tail = Promise.resolve();
    #value;

    constructor({ filePath } = {}) {
        const copilotHome =
            process.env.COPILOT_HOME || join(homedir(), ".copilot");
        this.#filePath =
            filePath ??
            join(
                copilotHome,
                "extensions",
                "flip-clock",
                "artifacts",
                ".preferences.json",
            );
    }

    async get() {
        if (!this.#loadPromise) {
            let trackedLoad;
            trackedLoad = this.#load().catch((error) => {
                if (this.#loadPromise === trackedLoad) {
                    this.#loadPromise = undefined;
                }
                throw error;
            });
            this.#loadPromise = trackedLoad;
        }
        await this.#loadPromise;
        return { ...this.#value };
    }

    async update(patch) {
        return this.#enqueue(async () => {
            const current = await this.get();
            const next = normalizePreferences(patch, current);

            if (preferencesEqual(current, next)) {
                return current;
            }

            await this.#write(next);
            this.#value = next;
            this.#notify(next);
            return { ...next };
        });
    }

    async reset() {
        return this.#enqueue(async () => {
            const next = getDefaultPreferences();

            await this.#write(next);
            this.#value = next;
            this.#loadPromise = Promise.resolve();
            this.#notify(next);
            return { ...next };
        });
    }

    subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TypeError("Preference listener must be a function.");
        }

        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    async #load() {
        let source;
        try {
            source = await fs.readFile(this.#filePath, "utf8");
        } catch (error) {
            if (error && error.code === "ENOENT") {
                this.#value = getDefaultPreferences();
                return;
            }

            throw new PreferenceStorageError(
                `Could not read Flip Clock preferences at ${this.#filePath}.`,
                { cause: error },
            );
        }

        let parsed;
        try {
            parsed = JSON.parse(source);
        } catch (error) {
            throw new PreferenceStorageError(
                `Flip Clock preferences are not valid JSON at ${this.#filePath}.`,
                { cause: error },
            );
        }

        try {
            this.#value = normalizePreferences(parsed);
        } catch (error) {
            if (error instanceof PreferenceValidationError) {
                throw new PreferenceStorageError(
                    `Flip Clock preferences are invalid: ${error.message}`,
                    { cause: error },
                );
            }
            throw error;
        }
    }

    async #write(preferences) {
        const directory = dirname(this.#filePath);
        const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;

        await fs.mkdir(directory, { recursive: true });

        try {
            await fs.writeFile(
                temporaryPath,
                `${JSON.stringify(preferences, null, 2)}\n`,
                { encoding: "utf8", mode: 0o600 },
            );
            await fs.rename(temporaryPath, this.#filePath);
        } catch (error) {
            await fs.rm(temporaryPath, { force: true });
            throw new PreferenceStorageError(
                `Could not save Flip Clock preferences at ${this.#filePath}.`,
                { cause: error },
            );
        }
    }

    #enqueue(operation) {
        const run = this.#tail.then(operation);
        this.#tail = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    #notify(preferences) {
        for (const listener of this.#listeners) {
            listener({ ...preferences });
        }
    }
}

export function createPreferenceStore(options) {
    return new PreferenceStore(options);
}
