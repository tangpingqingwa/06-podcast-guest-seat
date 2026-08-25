import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ROLLING_WEEK_MS,
  bidInRollingWeek,
  rollingWeekStart,
} from "../src/window.js";

test("rolling last-7-days window is 7 * 24h, not Monday 00:00 UTC", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  assert.equal(ROLLING_WEEK_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(rollingWeekStart(now).toISOString(), "2026-08-17T00:00:00.000Z");
  assert.equal(bidInRollingWeek("2026-08-17T00:00:00.000Z", now), true);
  assert.equal(bidInRollingWeek("2026-08-16T23:59:59.000Z", now), false);
  assert.equal(bidInRollingWeek("2026-08-23T23:59:59.000Z", now), true);
  assert.equal(bidInRollingWeek("2026-08-24T00:00:01.000Z", now), false);
  assert.equal(bidInRollingWeek("1970-01-01T00:00:00.000Z", now), false);
  assert.equal(bidInRollingWeek("", now), false);
});

test("Monday 00:00 UTC does not drop a bid still inside the rolling week", () => {
  const sundayPay = "2026-08-16T12:00:00.000Z";
  const mondayMidnight = new Date("2026-08-17T00:00:00.000Z");
  assert.equal(bidInRollingWeek(sundayPay, mondayMidnight), true);
  assert.equal(
    bidInRollingWeek(sundayPay, new Date("2026-08-23T12:00:00.000Z")),
    true,
  );
  assert.equal(
    bidInRollingWeek(sundayPay, new Date("2026-08-23T12:00:01.000Z")),
    false,
  );
});
