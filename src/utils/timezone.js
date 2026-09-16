// A customer's booking `schedule.date`/`schedule.time` are plain wall-clock
// values with no timezone attached (e.g. "2026-07-14" + "22:10"). Naively
// parsing them with `new Date(...)` interprets them in whatever timezone the
// Node process/OS happens to be running in — NOT the customer's actual
// region — which silently corrupts any lead-time check (see bookJob's
// 2-hour rule). These helpers pin that interpretation to the customer's
// region instead, using Intl so DST is handled automatically.

export const REGION_TIMEZONE = { UK: 'Europe/London', BD: 'Asia/Dhaka' };

export function timeZoneForRegion(region) {
  return REGION_TIMEZONE[region] || REGION_TIMEZONE.BD;
}

function getPartsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  return parts.reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
}

// Converts a wall-clock "YYYY-MM-DD" + "HH:mm" pair, understood to be in
// `timeZone`, into the actual UTC instant it represents.
//
// Method: first guess the instant by treating the numbers as if they were
// already UTC. Ask Intl what that guessed instant reads as in `timeZone` —
// the gap between the guess and that reading is exactly the zone's UTC
// offset at this date (DST-aware, since it's computed for this specific
// date rather than assumed fixed). Subtract that gap from the guess to land
// on the real UTC instant.
export function zonedDateTimeToUtc(dateStr, timeStr, timeZone) {
  const naiveUtc = new Date(`${dateStr}T${timeStr}:00.000Z`);

  const parts = getPartsInZone(naiveUtc, timeZone);
  const tzReadingAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  const offsetMs = tzReadingAsUtc - naiveUtc.getTime();
  return new Date(naiveUtc.getTime() - offsetMs);
}

// Formats a Date as "YYYY-MM-DD" in the given timezone.
export function formatDateInZone(date, timeZone) {
  const p = getPartsInZone(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

// Formats a Date as "HH:mm" (24-hour) in the given timezone.
export function formatTimeInZone(date, timeZone) {
  const p = getPartsInZone(date, timeZone);
  return `${p.hour}:${p.minute}`;
}

// Formats a Date as a short weekday ('Mon'..'Sun') in the given timezone —
// matches Provider.availability.days exactly.
export function formatWeekdayInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone }).format(date);
}
