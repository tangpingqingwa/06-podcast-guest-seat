export const DEFAULT_BOARD_TZ = "UTC";

export function boardTimeZone(tz = process.env.BOARD_TZ): string {
  if (tz === undefined || tz.trim() === "") {
    return DEFAULT_BOARD_TZ;
  }
  return tz;
}

/** Validate the configured IANA zone before a listener reports readiness. */
export function validateBoardTimeZone(tz = process.env.BOARD_TZ): string {
  const value = boardTimeZone(tz);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new Error("BLOCKED-CONFIG: BOARD_TZ must be a valid IANA timezone");
  }
  return value;
}

function formatInZone(
  now: Date,
  tz: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...options }).formatToParts(now);
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((item) => item.type === type)?.value ?? "";
}

/** Calendar date `YYYY-MM-DD` in `BOARD_TZ` (default UTC). */
export function dayKey(now: Date = new Date(), tz: string = boardTimeZone()): string {
  const parts = formatInZone(now, tz, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const year = part(parts, "year");
  const month = part(parts, "month");
  const day = part(parts, "day");
  if (!year || !month || !day) {
    throw new Error(`could not format day key for tz ${JSON.stringify(tz)}`);
  }
  return `${year}-${month}-${day}`;
}

/** Long weekday + month + day for the morning issue. `day` is the BOARD_TZ civil date. */
export function formatIssueDate(day: string, _tz: string = boardTimeZone()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) {
    return day;
  }
  const noonUtc = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00.000Z`);
  const parts = formatInZone(noonUtc, "UTC", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const weekday = part(parts, "weekday");
  const month = part(parts, "month");
  const dayNum = part(parts, "day");
  const year = part(parts, "year");
  if (!weekday || !month || !dayNum || !year) {
    return day;
  }
  return `${weekday}, ${month} ${dayNum}, ${year}`;
}
