import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { monthKey, sumConverted, type Rate } from "@/lib/money";
import { useRates, useStages, useTeam } from "@/lib/data";
import { useDeals, type DealRow } from "@/features/deals/api";
import { useProjects, useTasks } from "@/features/projects/ProjectsPage";
import type { InvoiceBalance, Payment, Stage } from "@/lib/types";

export type PeriodKey = "7d" | "30d" | "90d" | "month" | "quarter" | "year";
export type Range = { from: number; to: number };
export const PERIODS: { id: PeriodKey; label: string }[] = [
  { id: "7d", label: "Last 7 days" }, { id: "30d", label: "Last 30 days" }, { id: "90d", label: "Last 90 days" },
  { id: "month", label: "This month" }, { id: "quarter", label: "This quarter" }, { id: "year", label: "This year" },
];
const DAY = 86400_000;

export function periodRanges(key: PeriodKey, tz: string, now = Date.now()): { cur: Range; prev: Range; label: string } {
  const mk = monthKey(now, tz); const [y, m] = mk.split("-").map(Number);
  let from: number;
  if (key === "7d") from = now - 7 * DAY; else if (key === "30d") from = now - 30 * DAY; else if (key === "90d") from = now - 90 * DAY;
  else if (key === "month") from = Date.UTC(y, m - 1, 1);
  else if (key === "quarter") from = Date.UTC(y, Math.floor((m - 1) / 3) * 3, 1);
  else from = Date.UTC(y, 0, 1);
  const len = now - from;
  return { cur: { from, to: now + 1 }, prev: { from: from - len, to: from }, label: PERIODS.find((p) => p.id === key)!.label };
}
export const inRange = (iso: string | null | undefined, r: Range) => !!iso && Date.parse(iso) >= r.from && Date.parse(iso) < r.to;
export const delta = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : null);

/** Time buckets for a line chart: daily for short ranges, weekly for medium, monthly for a year. */
export function buckets(r: Range): { start: number; end: number; label: string }[] {
  const span = (r.to - r.from) / DAY; const step = span <= 35 ? 1 : span <= 120 ? 7 : 30; const out: { start: number; end: number; label: string }[] = [];
  for (let s = r.from; s < r.to; s += step * DAY) out.push({ start: s, end: Math.min(s + step * DAY, r.to), label: new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
  return out;
}

export type LeadRow = { id: string; status: string; source: string; created_at: string; owner_id: string | null };

export function useAnalytics() {
  const { profile, can } = useAuth();
  const deals = useDeals(); const stages = useStages(); const rates = useRates(); const team = useTeam(); const projects = useProjects(); const tasks = useTasks();
  const leads = useQuery({ queryKey: ["analytics", "leads"], refetchInterval: 120_000, queryFn: async () => {
    const { data } = await supabase.from("leads").select("id,status,source,created_at,owner_id").order("created_at", { ascending: false }).limit(10000); return (data ?? []) as LeadRow[]; } });
  const invoices = useQuery({ queryKey: ["analytics", "invoices"], queryFn: async () => ((await supabase.from("invoice_balances").select("*").limit(5000)).data ?? []).map((d) => ({ ...d, currency: String(d.currency).trim(), total: Number(d.total), amount_paid: Number(d.amount_paid), balance_due: Number(d.balance_due) })) as InvoiceBalance[] });
  const payments = useQuery({ queryKey: ["analytics", "payments"], queryFn: async () => ((await supabase.from("payments").select("id,invoice_id,amount,paid_at").limit(10000)).data ?? []).map((p) => ({ ...p, amount: Number(p.amount) })) as Payment[] });
  const loading = deals.isLoading || stages.isLoading || leads.isLoading || rates.isLoading;
  return { tz: profile!.timezone, can, loading, deals: deals.data ?? [], stages: stages.data ?? [], rates: rates.data ?? [], team: team.data ?? [], leads: leads.data ?? [],
    invoices: invoices.data ?? [], payments: payments.data ?? [], projects: projects.data?.projects ?? [], projectStats: projects.data?.stats ?? new Map(), tasks: tasks.data ?? [] };
}

export const isWon = (d: DealRow) => !!d.won_confirmed_at;
export const stageOf = (stages: Stage[], d: DealRow) => stages.find((s) => s.id === d.stage_id);

/** Won revenue in a range, converted to USD and PKR with each deal's own won-month rate. */
export function wonRevenue(deals: DealRow[], rates: Rate[], tz: string, r: Range) {
  const won = deals.filter((d) => isWon(d) && inRange(d.won_confirmed_at, r));
  const sum = sumConverted(rates, won.map((d) => ({ amount: d.value, currency: d.currency, month: monthKey(d.won_confirmed_at!, tz) })));
  return { won, ...sum };
}
/** Cash actually received (payments), converted with the rate of the month it was received. */
export function collected(payments: Payment[], invoices: InvoiceBalance[], rates: Rate[], tz: string, r: Range) {
  const cur = new Map(invoices.map((i) => [i.invoice_id, i.currency]));
  return sumConverted(rates, payments.filter((p) => inRange(p.paid_at, r) && cur.has(p.invoice_id)).map((p) => ({ amount: p.amount, currency: cur.get(p.invoice_id)!, month: monthKey(p.paid_at, tz) })));
}

export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]); const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // prefix cells that spreadsheets would treat as formulas
  const safe = (v: unknown) => { const s = esc(v); return /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s; };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => safe(r[c])).join(","))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
