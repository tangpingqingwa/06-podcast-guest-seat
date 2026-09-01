/**
 * Occupied live rundown uses rolling last 7 days from Waffo `paidAt`.
 * Not a civil-midnight lock. Not Monday 00:00 UTC. Not a 24h lock on #1.
 * Host lock still freezes the episode. Rows stay stored after they age out.
 */

const DAY_MS = 86_400_000;

/** Inclusive length of the occupied live window. Not a Monday midnight bucket. */
export const ROLLING_WEEK_MS = 7 * DAY_MS;

/** Inclusive start of the rolling last-7-days occupancy window. Not civil midnight. */
export function rollingWeekStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - ROLLING_WEEK_MS);
}

/**
 * Waffo-paid placement still occupies live `/` if `paidAt` is in `[now − 7d, now]`.
 * Monday 00:00 UTC is not the drop. Not a 24h lock on #1.
 */
export function bidInRollingWeek(
  paidAt: string,
  now: Date = new Date(),
): boolean {
  const paid = Date.parse(paidAt);
  if (!Number.isFinite(paid) || paid <= 0) {
    return false;
  }
  const t = now.getTime();
  return paid >= t - ROLLING_WEEK_MS && paid <= t;
}
