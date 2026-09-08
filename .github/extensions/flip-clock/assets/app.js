import {
    delayToNextSecond,
    formatClockTime,
    formatTimeZoneLabel,
} from "./clock-core.js";

const token = new URLSearchParams(window.location.search).get("token");
if (!token) {
    throw new Error("Flip Clock is missing its canvas access token.");
}

const elements = {
    app: document.querySelector("#app"),
    accessibleTime: document.querySelector("#accessibleTime"),
    weekdayLabel: document.querySelector("#weekdayLabel"),
    dateLabel: document.querySelector("#dateLabel"),
    periodLabel: document.querySelector("#periodLabel"),
    timezoneLabel: document.querySelector("#timezoneLabel"),
    timezoneButton: document.querySelector("#timezoneButton"),
    systemStatus: document.querySelector("#systemStatus"),
    settingsButton: document.querySelector("#settingsButton"),
    settingsDialog: document.querySelector("#settingsDialog"),
    settingsForm: document.querySelector("#settingsForm"),
    closeSettingsButton: document.querySelector("#closeSettingsButton"),
    timezoneInput: document.querySelector("#timezoneInput"),
    timezoneOptions: document.querySelector("#timezoneOptions"),
    formMessage: document.querySelector("#formMessage"),
    saveButton: document.querySelector("#saveButton"),
    resetButton: document.querySelector("#resetButton"),
};

const reducedMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
);
const state = {
    preferences: null,
    tickTimer: null,
    events: null,
};

const digitResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
        const digitSize = Math.max(
            80,
            Math.min(384, entry.contentRect.width * 0.82),
        );
        entry.target.style.setProperty("--digit-size", `${digitSize}px`);
    }
});

class FlipCard {
    constructor(element) {
        this.element = element;
        this.top = element.querySelector('[data-role="top"]');
        this.bottom = element.querySelector('[data-role="bottom"]');
        this.front = element.querySelector('[data-role="front"]');
        this.back = element.querySelector('[data-role="back"]');
        this.value = null;
        this.finishTimer = null;
        digitResizeObserver.observe(element);
    }

    set(nextValue, animate) {
        if (this.value === nextValue) {
            return;
        }

        if (this.value === null || !animate) {
            this.finish(nextValue);
            return;
        }

        const previousValue = this.value;
        this.value = nextValue;
        window.clearTimeout(this.finishTimer);

        this.top.textContent = nextValue;
        this.bottom.textContent = previousValue;
        this.front.textContent = previousValue;
        this.back.textContent = nextValue;

        this.element.classList.remove("is-flipping");
        void this.element.offsetWidth;
        this.element.classList.add("is-flipping");

        this.finishTimer = window.setTimeout(() => {
            this.finish(nextValue);
        }, 650);
    }

    finish(value) {
        window.clearTimeout(this.finishTimer);
        this.value = value;
        this.top.textContent = value;
        this.bottom.textContent = value;
        this.front.textContent = value;
        this.back.textContent = value;
        this.element.classList.remove("is-flipping");
    }
}

const hourCard = new FlipCard(document.querySelector("#hourCard"));
const minuteCard = new FlipCard(document.querySelector("#minuteCard"));

function apiUrl(path) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("token", token);
    return url;
}

async function apiRequest(path, options = {}) {
    const response = await fetch(apiUrl(path), {
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
        },
    });

    const body = await response.json();
    if (!response.ok) {
        throw new Error(
            body.message || "Flip Clock could not complete the request.",
        );
    }
    return body;
}

function selectedValue(name) {
    return new FormData(elements.settingsForm).get(name);
}

function selectRadio(name, value) {
    const input = elements.settingsForm.querySelector(
        `input[name="${name}"][value="${value}"]`,
    );
    if (input) {
        input.checked = true;
    }
}

function shouldAnimate() {
    if (!state.preferences) {
        return false;
    }
    if (state.preferences.motion === "full") {
        return true;
    }
    if (state.preferences.motion === "reduced") {
        return false;
    }
    return !reducedMotionQuery.matches;
}

function tick() {
    window.clearTimeout(state.tickTimer);
    if (!state.preferences) {
        return;
    }

    const now = new Date();
    const formatted = formatClockTime(
        now,
        state.preferences,
        navigator.language || "en-US",
    );
    const animate = shouldAnimate();

    hourCard.set(formatted.hour, animate);
    minuteCard.set(formatted.minute, animate);
    elements.periodLabel.textContent = formatted.period;
    elements.periodLabel.hidden = !formatted.period;
    elements.weekdayLabel.textContent = formatted.weekday;
    elements.dateLabel.textContent = formatted.dateLabel;
    elements.accessibleTime.dateTime = formatted.iso;
    elements.accessibleTime.textContent = formatted.accessibleTime;
    document.title = `${formatted.hour}:${formatted.minute} · Flip Clock`;

    state.tickTimer = window.setTimeout(tick, delayToNextSecond());
}

function fillForm(preferences) {
    elements.timezoneInput.value = preferences.timeZone;
    selectRadio("hourCycle", preferences.hourCycle);
    selectRadio("theme", preferences.theme);
    selectRadio("motion", preferences.motion);
}

function applyPreferences(preferences, { syncForm = true } = {}) {
    state.preferences = preferences;
    document.body.dataset.theme = preferences.theme;
    document.body.dataset.motion = preferences.motion;
    elements.timezoneLabel.textContent = formatTimeZoneLabel(
        preferences.timeZone,
    );
    elements.timezoneButton.title = `Timezone: ${preferences.timeZone}`;
    elements.systemStatus.textContent =
        preferences.hourCycle === "12"
            ? "12 hour · On device"
            : "24 hour · On device";

    if (syncForm || !elements.settingsDialog.open) {
        fillForm(preferences);
    }
    tick();
}

function setFormBusy(isBusy) {
    elements.saveButton.disabled = isBusy;
    elements.resetButton.disabled = isBusy;
    elements.timezoneInput.disabled = isBusy;
    elements.settingsForm.toggleAttribute("aria-busy", isBusy);
}

function openSettings() {
    fillForm(state.preferences);
    elements.formMessage.textContent = "";
    elements.settingsDialog.showModal();
    window.setTimeout(() => elements.timezoneInput.focus(), 0);
}

async function saveSettings(event) {
    event.preventDefault();
    elements.formMessage.textContent = "Saving…";
    setFormBusy(true);

    try {
        const { preferences } = await apiRequest("/api/preferences", {
            method: "POST",
            body: JSON.stringify({
                timeZone: elements.timezoneInput.value.trim(),
                hourCycle: selectedValue("hourCycle"),
                theme: selectedValue("theme"),
                motion: selectedValue("motion"),
            }),
        });
        applyPreferences(preferences);
        elements.formMessage.textContent = "Settings saved.";
        elements.settingsDialog.close();
        elements.settingsButton.focus();
    } catch (error) {
        elements.formMessage.textContent =
            error instanceof Error ? error.message : String(error);
    } finally {
        setFormBusy(false);
    }
}

async function resetSettings() {
    elements.formMessage.textContent = "Restoring defaults…";
    setFormBusy(true);

    try {
        const { preferences } = await apiRequest("/api/reset", {
            method: "POST",
        });
        applyPreferences(preferences);
        elements.formMessage.textContent = "Defaults restored.";
    } catch (error) {
        elements.formMessage.textContent =
            error instanceof Error ? error.message : String(error);
    } finally {
        setFormBusy(false);
    }
}

function populateTimeZones(currentTimeZone) {
    const commonTimeZones = [
        "UTC",
        "America/Los_Angeles",
        "America/Chicago",
        "America/New_York",
        "America/Toronto",
        "America/Sao_Paulo",
        "Europe/London",
        "Europe/Paris",
        "Europe/Berlin",
        "Europe/Istanbul",
        "Africa/Cairo",
        "Asia/Riyadh",
        "Asia/Dubai",
        "Asia/Karachi",
        "Asia/Kolkata",
        "Asia/Singapore",
        "Asia/Hong_Kong",
        "Asia/Tokyo",
        "Australia/Sydney",
        "Pacific/Auckland",
    ];

    const supportedTimeZones =
        typeof Intl.supportedValuesOf === "function"
            ? Intl.supportedValuesOf("timeZone")
            : commonTimeZones;
    const timeZones = new Set([
        currentTimeZone,
        "UTC",
        ...supportedTimeZones,
    ]);
    const fragment = document.createDocumentFragment();

    for (const timeZone of [...timeZones].sort()) {
        const option = document.createElement("option");
        option.value = timeZone;
        fragment.append(option);
    }

    elements.timezoneOptions.replaceChildren(fragment);
}

function connectEvents() {
    state.events?.close();
    state.events = new EventSource(apiUrl("/events"));

    state.events.addEventListener("settings", (event) => {
        try {
            applyPreferences(JSON.parse(event.data), {
                syncForm: !elements.settingsDialog.open,
            });
        } catch (error) {
            elements.systemStatus.textContent = "Settings sync failed";
            elements.systemStatus.title =
                error instanceof Error ? error.message : String(error);
        }
    });

    state.events.addEventListener("open", () => {
        elements.systemStatus.removeAttribute("title");
    });
}

async function initialize() {
    const { preferences } = await apiRequest("/api/state");
    populateTimeZones(preferences.timeZone);
    applyPreferences(preferences);
    connectEvents();
    elements.app.dataset.ready = "true";
}

elements.settingsButton.addEventListener("click", openSettings);
elements.timezoneButton.addEventListener("click", openSettings);
elements.closeSettingsButton.addEventListener("click", () => {
    elements.settingsDialog.close();
    elements.settingsButton.focus();
});
elements.settingsForm.addEventListener("submit", saveSettings);
elements.resetButton.addEventListener("click", () => {
    void resetSettings();
});
reducedMotionQuery.addEventListener("change", tick);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        tick();
    }
});
window.addEventListener("pagehide", () => {
    window.clearTimeout(state.tickTimer);
    state.events?.close();
});

void initialize().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    elements.systemStatus.textContent = "Clock unavailable";
    elements.systemStatus.title = message;
    elements.dateLabel.textContent = "Reload the canvas";
    elements.app.dataset.error = "true";
});
