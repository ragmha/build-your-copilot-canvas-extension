const formatterCache = new Map();

function formatter(locale, options) {
    const key = `${locale}:${JSON.stringify(options)}`;
    if (!formatterCache.has(key)) {
        formatterCache.set(key, new Intl.DateTimeFormat(locale, options));
    }
    return formatterCache.get(key);
}

function partValue(parts, type, fallback = "") {
    return parts.find((part) => part.type === type)?.value ?? fallback;
}

function assertDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new TypeError("Flip Clock requires a valid Date.");
    }
}

export function formatClockTime(
    date,
    { timeZone, hourCycle },
    locale = "en-US",
) {
    assertDate(date);

    const cycle = hourCycle === "24" ? "h23" : "h12";
    const timeParts = formatter(locale, {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: cycle,
    }).formatToParts(date);

    const dateParts = formatter(locale, {
        timeZone,
        weekday: "long",
        month: "long",
        day: "numeric",
    }).formatToParts(date);

    const zoneParts = formatter(locale, {
        timeZone,
        timeZoneName: "short",
    }).formatToParts(date);

    const period = partValue(timeParts, "dayPeriod").toUpperCase();
    const hour = partValue(timeParts, "hour", "00").padStart(2, "0");
    const minute = partValue(timeParts, "minute", "00").padStart(2, "0");
    const second = partValue(timeParts, "second", "00").padStart(2, "0");
    const weekday = partValue(dateParts, "weekday");
    const month = partValue(dateParts, "month");
    const day = partValue(dateParts, "day");

    const accessibleTime = formatter(locale, {
        timeZone,
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: cycle,
        timeZoneName: "long",
    }).format(date);

    return {
        hour,
        minute,
        second,
        period,
        weekday,
        dateLabel: `${month} ${day}`,
        zoneAbbreviation: partValue(zoneParts, "timeZoneName", timeZone),
        accessibleTime,
        iso: date.toISOString(),
    };
}

export function formatTimeZoneLabel(timeZone) {
    return timeZone
        .split("/")
        .map((segment) => segment.replaceAll("_", " "))
        .join(" / ");
}

export function delayToNextSecond(timestamp = Date.now()) {
    return 1_000 - (timestamp % 1_000) + 12;
}
