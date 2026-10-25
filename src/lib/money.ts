// Money, currency conversion and monthly targets. All conversion uses the month-end rate that a Super Admin or CSO
// entered for the month in which a deal was WON (or a payment RECEIVED). Nothing is converted with a made-up rate.

export type Rate = { month: string; currency: string; usd_per_unit: number; pkr_per_unit: number };
export type Conv = { usd: number; pkr: number; exact: boolean } | null;

export function formatMoney(amount: number, currency: string, opts: { compact?: boolean } = {}): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: opts.compact ? 1 : 2, notation: opts.compact ? "compact" : "standard" }).format(amount);
  } catch { return `${currency} ${amount.toLocaleString()}`; }
}

/** 'YYYY-MM-01' for an instant, on the calendar of `tz`. */
export function monthKey(isoOrMs: string | number, tz: string): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoOrMs));
  return d.slice(0, 7) + "-01";
}
export const addMonths = (key: string, n: number): string => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};
export const monthLabel = (key: string) => new Date(key + "T00:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Conversion factors for one currency in one month.
 *  exact = a rate was entered for that very month; otherwise the most recent EARLIER rate is used and flagged as an estimate.
 *  Returns null when no rate exists at or before the month (the caller must show "rate needed", never a guess).
 */
export function convert(rates: Rate[], currency: string, month: string, amount: number): Conv {
  if (amount === 0) return { usd: 0, pkr: 0, exact: true };
  const pick = (c: string) => {
    const rows = rates.filter((r) => r.currency === c && r.month <= month).sort((a, b) => (a.month < b.month ? 1 : -1));
    return rows[0] ? { r: rows[0], exact: rows[0].month === month } : null;
  };
  const own = pick(currency);
  if (own) return { usd: amount * own.r.usd_per_unit, pkr: amount * own.r.pkr_per_unit, exact: own.exact };
  // Identity cases that need no rate for the currency itself
  if (currency === "USD") { const p = pick("PKR"); const u = pick("USD"); if (u) return { usd: amount, pkr: amount * u.r.pkr_per_unit, exact: u.exact }; if (p) return { usd: amount, pkr: amount / p.r.usd_per_unit, exact: p.exact }; }
  if (currency === "PKR") { const p = pick("PKR"); if (p) return { usd: amount * p.r.usd_per_unit, pkr: amount, exact: p.exact }; }
  return null;
}
/** USD and PKR themselves are always convertible once the USD→PKR rate for the month exists. */
export function convertWithBase(rates: Rate[], currency: string, month: string, amount: number): Conv {
  if (currency === "USD") {
    const usdRow = rates.filter((r) => r.currency === "USD" && r.month <= month).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
    if (usdRow) return { usd: amount, pkr: amount * usdRow.pkr_per_unit, exact: usdRow.month === month };
    return null;
  }
  if (currency === "PKR") {
    const row = rates.filter((r) => r.currency === "PKR" && r.month <= month).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
    if (row) return { usd: amount * row.usd_per_unit, pkr: amount, exact: row.month === month };
    const usdRow = rates.filter((r) => r.currency === "USD" && r.month <= month).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
    if (usdRow) return { usd: amount / usdRow.pkr_per_unit, pkr: amount, exact: usdRow.month === month };
    return null;
  }
  return convert(rates, currency, month, amount);
}

export type Sum = { usd: number; pkr: number; allExact: boolean; missing: string[] };
/** Sum amounts (each with its own currency + month) into USD and PKR, reporting which currencies lacked a rate. */
export function sumConverted(rates: Rate[], items: { amount: number; currency: string; month: string }[]): Sum {
  const out: Sum = { usd: 0, pkr: 0, allExact: true, missing: [] };
  for (const i of items) {
    const c = convertWithBase(rates, i.currency, i.month, Number(i.amount));
    if (!c) { if (!out.missing.includes(`${i.currency} ${i.month.slice(0, 7)}`)) out.missing.push(`${i.currency} ${i.month.slice(0, 7)}`); continue; }
    out.usd += c.usd; out.pkr += c.pkr; if (!c.exact) out.allExact = false;
  }
  return out;
}

// ───────────── monthly targets ─────────────
export type Target = { user_id: string; month: string; target_usd: number | null; target_pkr: number | null };
/** The target for a month is the one set for that month, otherwise the most recent earlier one (it carries forward). */
export function effectiveTarget(targets: Target[], userId: string, month: string): (Target & { carried: boolean }) | null {
  const rows = targets.filter((t) => t.user_id === userId && t.month <= month).sort((a, b) => (a.month < b.month ? 1 : -1));
  return rows[0] ? { ...rows[0], carried: rows[0].month !== month } : null;
}
export type Progress = { usd: number | null; pkr: number | null; achievedUsd: number; achievedPkr: number; pctUsd: number | null; pctPkr: number | null; missing: string[]; estimated: boolean };
export function targetProgress(t: Target | null, won: Sum): Progress {
  const pct = (a: number, b: number | null) => (b && b > 0 ? Math.min(999, (a / b) * 100) : null);
  return { usd: t?.target_usd ?? null, pkr: t?.target_pkr ?? null, achievedUsd: won.usd, achievedPkr: won.pkr,
    pctUsd: pct(won.usd, t?.target_usd ?? null), pctPkr: pct(won.pkr, t?.target_pkr ?? null), missing: won.missing, estimated: !won.allExact };
}
