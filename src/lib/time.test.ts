import { describe, expect, it } from "vitest";
import { addDaysToKey, bucketOf, dayKey, formatTime, splitLocal, weekRange } from "./time";

describe("time", () => {
  it("buckets the same instant into different calendar days per timezone", () => {
    const iso = "2026-11-05T20:30:00Z"; // 01:30 next day in Karachi (UTC+5), still the 5th in New York
    expect(dayKey(iso, "Asia/Karachi")).toBe("2026-11-06");
    expect(dayKey(iso, "America/New_York")).toBe("2026-11-05");
  });
  it("splits an instant into local date/time for form prefill", () => {
    expect(splitLocal("2026-11-05T10:05:00Z", "Asia/Karachi")).toEqual({ date: "2026-11-05", time: "15:05" });
    expect(splitLocal("2026-11-05T19:00:00Z", "Asia/Karachi")).toEqual({ date: "2026-11-06", time: "00:00" });
  });
  it("formats time in the viewer's zone", () => {
    expect(formatTime("2026-11-05T10:05:00Z", "Asia/Karachi")).toMatch(/3:05\s?pm/i);
  });
  it("computes Monday–Sunday weeks and day arithmetic across month ends", () => {
    expect(weekRange("2026-10-22")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(addDaysToKey("2026-10-31", 1)).toBe("2026-11-01");
  });
  it("overdue means pending AND past — compared as instants", () => {
    const now = Date.parse("2026-10-22T10:00:00Z");
    expect(bucketOf({ status: "pending", due_at: "2026-10-22T09:59:00Z" }, "UTC", now)).toBe("overdue");
    expect(bucketOf({ status: "pending", due_at: "2026-10-22T10:30:00Z" }, "UTC", now)).toBe("due_soon");
    expect(bucketOf({ status: "pending", due_at: "2026-10-22T15:00:00Z" }, "UTC", now)).toBe("today");
    expect(bucketOf({ status: "pending", due_at: "2026-10-23T15:00:00Z" }, "UTC", now)).toBe("upcoming");
    expect(bucketOf({ status: "completed", due_at: "2026-10-01T00:00:00Z" }, "UTC", now)).toBe("completed");
    expect(bucketOf({ status: "cancelled", due_at: "2026-10-01T00:00:00Z" }, "UTC", now)).toBe("cancelled");
  });
});
