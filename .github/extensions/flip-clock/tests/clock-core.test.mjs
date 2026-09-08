import assert from "node:assert/strict";
import test from "node:test";

import {
    delayToNextSecond,
    formatClockTime,
    formatTimeZoneLabel,
} from "../assets/clock-core.js";

test("formats the same instant in 12-hour and 24-hour time", () => {
    const instant = new Date("2026-08-22T07:05:09.000Z");

    const twelveHour = formatClockTime(
        instant,
        { timeZone: "UTC", hourCycle: "12" },
        "en-US",
    );
    assert.equal(twelveHour.hour, "07");
    assert.equal(twelveHour.minute, "05");
    assert.equal(twelveHour.period, "AM");

    const twentyFourHour = formatClockTime(
        instant,
        { timeZone: "UTC", hourCycle: "24" },
        "en-US",
    );
    assert.equal(twentyFourHour.hour, "07");
    assert.equal(twentyFourHour.minute, "05");
    assert.equal(twentyFourHour.period, "");
});

test("renders midnight as 12 AM or 00", () => {
    const midnight = new Date("2026-08-22T00:00:00.000Z");

    assert.equal(
        formatClockTime(
            midnight,
            { timeZone: "UTC", hourCycle: "12" },
            "en-US",
        ).hour,
        "12",
    );
    assert.equal(
        formatClockTime(
            midnight,
            { timeZone: "UTC", hourCycle: "24" },
            "en-US",
        ).hour,
        "00",
    );
});

test("formats timezone labels and aligns the ticker", () => {
    assert.equal(
        formatTimeZoneLabel("America/Los_Angeles"),
        "America / Los Angeles",
    );
    assert.equal(delayToNextSecond(1_250), 762);
});
