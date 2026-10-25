import { describe, expect, it } from "vitest";
import { addMonths, convertWithBase, effectiveTarget, monthKey, sumConverted, targetProgress, type Rate } from "./money";

const rates: Rate[] = [
  { month: "2026-10-01", currency: "USD", usd_per_unit: 1, pkr_per_unit: 280 },
  { month: "2026-10-01", currency: "EUR", usd_per_unit: 1.1, pkr_per_unit: 308 },
  { month: "2026-09-01", currency: "EUR", usd_per_unit: 1.05, pkr_per_unit: 294 },
  { month: "2026-10-01", currency: "GBP", usd_per_unit: 1.3, pkr_per_unit: 364 },
];

describe("currency conversion", () => {
  it("uses the rate entered for the deal's own month (exact)", () => {
    const c = convertWithBase(rates, "EUR", "2026-10-01", 1000)!;
    expect(c.usd).toBeCloseTo(1100); expect(c.pkr).toBeCloseTo(308000); expect(c.exact).toBe(true);
  });
  it("falls back to the latest EARLIER rate and flags it as an estimate", () => {
    const c = convertWithBase(rates, "EUR", "2026-11-01", 1000)!;
    expect(c.usd).toBeCloseTo(1100); expect(c.exact).toBe(false);
    expect(convertWithBase(rates, "EUR", "2026-09-01", 1000)!.usd).toBeCloseTo(1050);
  });
  it("never guesses: no rate at or before the month → null", () => {
    expect(convertWithBase(rates, "EUR", "2026-08-01", 1000)).toBeNull();
    expect(convertWithBase(rates, "AED", "2026-10-01", 1000)).toBeNull();
  });
  it("USD→PKR uses the USD row; PKR→USD uses the PKR row or the inverse of USD", () => {
    expect(convertWithBase(rates, "USD", "2026-10-01", 100)!.pkr).toBeCloseTo(28000);
    expect(convertWithBase(rates, "PKR", "2026-10-01", 28000)!.usd).toBeCloseTo(100);
  });
  it("sums mixed currencies and reports the ones missing a rate", () => {
    const s = sumConverted(rates, [
      { amount: 1000, currency: "EUR", month: "2026-10-01" }, { amount: 500, currency: "GBP", month: "2026-10-01" },
      { amount: 100, currency: "AED", month: "2026-10-01" }]);
    expect(s.usd).toBeCloseTo(1100 + 650); expect(s.missing).toEqual(["AED 2026-10"]); expect(s.allExact).toBe(true);
  });
});

describe("monthly targets", () => {
  const targets = [
    { user_id: "u1", month: "2026-08-01", target_usd: 10000, target_pkr: 2800000 },
    { user_id: "u1", month: "2026-10-01", target_usd: 15000, target_pkr: null },
    { user_id: "u2", month: "2026-10-01", target_usd: 99, target_pkr: null },
  ];
  it("a month's own target wins; otherwise the previous one carries forward", () => {
    expect(effectiveTarget(targets, "u1", "2026-10-01")).toMatchObject({ target_usd: 15000, carried: false });
    expect(effectiveTarget(targets, "u1", "2026-09-01")).toMatchObject({ target_usd: 10000, carried: true });
    expect(effectiveTarget(targets, "u1", "2026-12-01")).toMatchObject({ target_usd: 15000, carried: true });
    expect(effectiveTarget(targets, "u1", "2026-07-01")).toBeNull();
  });
  it("does not leak another user's target", () => { expect(effectiveTarget(targets, "u3", "2026-10-01")).toBeNull(); });
  it("measures progress in USD and PKR against the converted won deals", () => {
    const won = sumConverted(rates, [{ amount: 6000, currency: "EUR", month: "2026-10-01" }]);
    const p = targetProgress(effectiveTarget(targets, "u1", "2026-10-01"), won);
    expect(p.achievedUsd).toBeCloseTo(6600); expect(p.pctUsd).toBeCloseTo(44); expect(p.pctPkr).toBeNull();
  });
});

describe("calendar months", () => {
  it("buckets by the organisation's calendar, not UTC", () => {
    expect(monthKey("2026-10-31T20:00:00Z", "Asia/Karachi")).toBe("2026-11-01");
    expect(monthKey("2026-10-31T20:00:00Z", "UTC")).toBe("2026-10-01");
  });
  it("adds months across a year end", () => { expect(addMonths("2026-12-01", 1)).toBe("2027-01-01"); expect(addMonths("2026-01-01", -1)).toBe("2025-12-01"); });
});
