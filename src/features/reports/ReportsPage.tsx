import { useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, ListSkeleton } from "@/components/ui";
import { Bars, Donut, LineChart, MissingRates, PALETTE, PairedColumns, Stat } from "@/components/extra";
import { addMonths, formatMoney, missingFor, monthKey, monthLabel, sumConverted } from "@/lib/money";
import { label } from "@/lib/types";
import { PERIODS, buckets, collected, delta, downloadCsv, inRange, isWon, periodRanges, stageOf, useAnalytics, wonRevenue, type PeriodKey } from "./analytics";

const pct = (n: number | null) => (n == null ? null : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const Delta = ({ v }: { v: number | null }) => (v == null ? <span className="faint">no prior data</span> : <Badge tone={v >= 0 ? "ok" : "danger"}>{pct(v)} vs prior period</Badge>);

export function ReportsPage() {
  const { profile } = useAuth(); const a = useAnalytics(); const { tz, can } = a;
  const [period, setPeriod] = useState<PeriodKey>("90d"); const [show, setShow] = useState<"USD" | "PKR">("USD");
  const tabs = [["overview", "Executive overview", true], ["sales", "Sales & pipeline", can("reports.sales")], ["revenue", "Revenue & billing", can("reports.finance") || can("reports.sales")],
    ["delivery", "Project delivery", can("reports.projects")], ["team", "Team workload", can("reports.projects")], ["library", "Reports library", true]].filter((t) => t[2]) as [string, string, boolean][];
  const [tab, setTab] = useState("overview");
  const R = useMemo(() => periodRanges(period, tz), [period, tz]);
  const fmt = (n: number) => formatMoney(n, show, { compact: true });

  const d = useMemo(() => {
    const leadsCur = a.leads.filter((l) => inRange(l.created_at, R.cur)), leadsPrev = a.leads.filter((l) => inRange(l.created_at, R.prev));
    const wonCur = wonRevenue(a.deals, a.rates, tz, R.cur), wonPrev = wonRevenue(a.deals, a.rates, tz, R.prev);
    const cashCur = collected(a.payments, a.invoices, a.rates, tz, R.cur);
    const qualified = leadsCur.filter((l) => l.status === "qualified" || l.status === "converted").length;
    const dealsCur = a.deals.filter((x) => inRange(x.created_at, R.cur));
    const pos = (x: typeof a.deals[number]) => stageOf(a.stages, x)?.position ?? 0;
    const proposals = dealsCur.filter((x) => pos(x) >= 5 || isWon(x)).length, nego = dealsCur.filter((x) => pos(x) >= 6 || isWon(x)).length;
    const bs = buckets(R.cur);
    const line = {
      labels: bs.map((b) => b.label),
      leads: bs.map((b) => a.leads.filter((l) => Date.parse(l.created_at) >= b.start && Date.parse(l.created_at) < b.end).length),
      newDeals: bs.map((b) => a.deals.filter((x) => Date.parse(x.created_at) >= b.start && Date.parse(x.created_at) < b.end).length),
      won: bs.map((b) => a.deals.filter((x) => isWon(x) && Date.parse(x.won_confirmed_at!) >= b.start && Date.parse(x.won_confirmed_at!) < b.end).length),
    };
    const src = new Map<string, number>(); for (const l of leadsCur) src.set(l.source, (src.get(l.source) ?? 0) + 1);
    const lost = a.deals.filter((x) => stageOf(a.stages, x)?.is_lost && inRange(x.closed_at, R.cur)).length;
    return { leadsCur, leadsPrev, wonCur, wonPrev, cashCur, qualified, dealsCur, proposals, nego, line, src: [...src.entries()].sort((x, y) => y[1] - x[1]), lost };
  }, [a, R, tz]);

  // last 6 calendar months: invoiced vs collected (USD or PKR), plus receivables aging
  const rev = useMemo(() => {
    const now = monthKey(Date.now(), tz); const months = Array.from({ length: 6 }, (_, i) => addMonths(now, i - 5));
    const conv = (s: { usd: number; pkr: number }) => (show === "USD" ? s.usd : s.pkr);
    const cur = new Map(a.invoices.map((i) => [i.invoice_id, i.currency]));
    const invoiced = months.map((m) => conv(sumConverted(a.rates, a.invoices.filter((i) => i.status === "sent" && monthKey(i.issue_date + "T12:00:00Z", "UTC") === m).map((i) => ({ amount: i.total, currency: i.currency, month: m })))));
    const cash = months.map((m) => conv(sumConverted(a.rates, a.payments.filter((p) => monthKey(p.paid_at, tz) === m && cur.has(p.invoice_id)).map((p) => ({ amount: p.amount, currency: cur.get(p.invoice_id)!, month: m })))));
    const open = a.invoices.filter((i) => i.status === "sent" && i.balance_due > 0); const today = new Date().toISOString().slice(0, 10);
    const age = (i: typeof open[number]) => (i.due_date >= today ? 0 : Math.floor((Date.parse(today) - Date.parse(i.due_date)) / 86400_000));
    const bucket = (lo: number, hi: number) => open.filter((i) => { const g = age(i); return g >= lo && g <= hi; });
    const mk = (lst: typeof open) => sumConverted(a.rates, lst.map((i) => ({ amount: i.balance_due, currency: i.currency, month: now })));
    const groups = [["Not yet due", bucket(0, 0)], ["1–30 days late", bucket(1, 30)], ["31–60 days late", bucket(31, 60)], ["60+ days late", bucket(61, 99999)]] as const;
    return { months, invoiced, cash, aging: groups.map(([l, lst]) => ({ label: l, n: lst.length, sum: mk(lst) })), outstanding: mk(open), openCount: open.length };
  }, [a, tz, show]);

  const people = useMemo(() => a.team.filter((u) => ["developer", "team_lead", "project_manager"].includes(u.role) && u.is_active).map((u) => {
    const mine = a.tasks.filter((t) => t.assigned_to === u.id && t.status !== "cancelled"); const today = new Date().toISOString().slice(0, 10);
    const done = mine.filter((t) => t.status === "done").length, prog = mine.filter((t) => t.status === "in_progress" || t.status === "in_review").length, over = mine.filter((t) => t.status !== "done" && t.due_date && t.due_date < today).length;
    return { u, assigned: mine.length, done, prog, over, vel: mine.length ? Math.round((done / mine.length) * 100) : 0 };
  }).filter((p) => p.assigned > 0), [a.team, a.tasks]);

  const missing = [...new Set([...missingFor(d.wonCur, show), ...missingFor(d.cashCur, show)])];
  const winRate = d.leadsCur.length ? (d.wonCur.won.length / d.leadsCur.length) * 100 : 0;
  const exports: [string, string, () => Record<string, unknown>[]][] = [
    ["Leads", "Source, status and owner of every lead you can see.", () => a.leads.map((l) => ({ id: l.id, status: l.status, source: l.source, created_at: l.created_at }))],
    ["Deals & pipeline", "Stage, value, currency and win date of every deal.", () => a.deals.map((x) => ({ title: x.title, stage: stageOf(a.stages, x)?.name, value: x.value, currency: x.currency, expected_close: x.expected_close_date, won_confirmed_at: x.won_confirmed_at, created_at: x.created_at }))],
    ["Invoices", "Totals, paid and balance per invoice.", () => a.invoices.map((i) => ({ invoice: i.invoice_number, status: i.status, currency: i.currency, total: i.total, paid: i.amount_paid, balance: i.balance_due, issued: i.issue_date, due: i.due_date }))],
    ["Payments", "Every recorded payment.", () => a.payments.map((p) => ({ invoice_id: p.invoice_id, amount: p.amount, paid_at: p.paid_at }))],
    ["Tasks", "Status, assignee and due date of every task.", () => a.tasks.map((t) => ({ title: t.title, status: t.status, priority: t.priority, assignee: a.team.find((u) => u.id === t.assigned_to)?.full_name, due: t.due_date }))],
  ];
  const showFin = a.invoices.length > 0 || can("finance.view");

  return (
    <div className="page">
      <div className="page-head"><div><h1>Reports &amp; analytics</h1><p>Live from your CRM records only. Figures respect what your role is allowed to see. {R.label} vs the previous period.</p></div>
        <div className="page-actions"><div className="seg" role="group" aria-label="Currency"><button aria-pressed={show === "USD"} onClick={() => setShow("USD")}>USD</button><button aria-pressed={show === "PKR"} onClick={() => setShow("PKR")}>PKR</button></div>
          <select className="select" style={{ minWidth: 170 }} aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>{PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div></div>
      {a.loading ? <div className="glass card"><ListSkeleton /></div> : (<>
        <div className="grid kpis">
          <Stat label="New leads" value={d.leadsCur.length} sub={<Delta v={delta(d.leadsCur.length, d.leadsPrev.length)} />} />
          <Stat label="Deals won" value={d.wonCur.won.length} sub={<Delta v={delta(d.wonCur.won.length, d.wonPrev.won.length)} />} tone="ok" />
          <Stat label="Won value" value={fmt(show === "USD" ? d.wonCur.usd : d.wonCur.pkr)} sub={<Delta v={delta(d.wonCur.usd, d.wonPrev.usd)} />} />
          {showFin && <Stat label="Cash received" value={fmt(show === "USD" ? d.cashCur.usd : d.cashCur.pkr)} sub="Recorded payments only" />}
          <Stat label="Active projects" value={a.projects.filter((p) => p.status === "active").length} sub={`${a.projects.filter((p) => p.status === "completed").length} completed`} />
        </div>
        <MissingRates missing={missing} />
        <div className="glass card"><div className="tabs" role="tablist" style={{ overflowX: "auto", flexWrap: "nowrap" }}>{tabs.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className="tab" style={{ whiteSpace: "nowrap" }} onClick={() => setTab(id)}>{l}</button>)}</div></div>

        {(tab === "overview" || tab === "sales") && (<>
          <div className="grid cols-3-2">
            <section className="glass card"><div className="card-head"><div><h2>Sales velocity</h2><span className="faint">New leads, new deals and Finance-confirmed wins over time</span></div></div>
              {d.line.labels.length < 2 ? <Empty title="Not enough data" /> : <LineChart labels={d.line.labels} series={[{ name: "New leads", values: d.line.leads }, { name: "New deals", values: d.line.newDeals, color: PALETTE[2] }, { name: "Deals won", values: d.line.won, color: PALETTE[3] }]} />}
              <div className="legend" style={{ marginTop: 8 }}>{[["New leads", PALETTE[0]], ["New deals", PALETTE[2]], ["Deals won", PALETTE[3]]].map(([n, c]) => <span key={n}><span className="dot" style={{ color: c }} />{n}</span>)}</div></section>
            <section className="glass card"><div className="card-head"><h2>Conversion funnel</h2><Badge tone="brand">{winRate.toFixed(1)}% win rate</Badge></div>
              <Bars rows={[["1. Initial inquiries", d.leadsCur.length], ["2. Qualified", d.qualified], ["3. Proposals sent", d.proposals], ["4. Negotiation", d.nego], ["5. Deals won", d.wonCur.won.length]].map(([l, v]) => ({ label: l as string, value: v as number, display: `${v} (${d.leadsCur.length ? Math.round(((v as number) / d.leadsCur.length) * 100) : 0}%)` }))} />
              <p className="hint" style={{ marginTop: 10 }}>{d.lost} deal{d.lost === 1 ? "" : "s"} lost in this period.</p></section>
          </div>
          <div className="grid cols-2">
            <section className="glass card"><div className="card-head"><h2>Lead origin</h2></div>{d.src.length === 0 ? <Empty title="No leads in this period" /> : (
              <div className="row" style={{ alignItems: "center", gap: 24 }}><Donut slices={d.src.map(([l, v], i) => ({ label: label(l), value: v, color: PALETTE[i % PALETTE.length] }))} center={String(d.leadsCur.length)} sub="LEADS" />
                <div className="legend" style={{ flexDirection: "column" }}>{d.src.map(([l, v], i) => <span key={l}><span className="dot" style={{ color: PALETTE[i % PALETTE.length] }} />{label(l)} · {v} ({Math.round((v / d.leadsCur.length) * 100)}%)</span>)}</div></div>)}</section>
            <section className="glass card"><div className="card-head"><h2>Pipeline by stage</h2></div>{(() => { const open = a.stages.filter((s) => !s.is_won && !s.is_lost); const rows = open.map((s) => { const ds = a.deals.filter((x) => x.stage_id === s.id); const sm = sumConverted(a.rates, ds.map((x) => ({ amount: x.value, currency: x.currency, month: monthKey(Date.now(), tz) }))); return { label: s.name, sub: `(${ds.length})`, value: show === "USD" ? sm.usd : sm.pkr, display: fmt(show === "USD" ? sm.usd : sm.pkr) }; }); return rows.some((r) => r.value > 0 || true) ? <Bars rows={rows} /> : null; })()}</section>
          </div></>)}

        {(tab === "overview" || tab === "revenue") && showFin && (
          <div className="grid cols-2">
            <section className="glass card"><div className="card-head"><div><h2>Monthly revenue realisation</h2><span className="faint">Invoiced vs cash received ({show})</span></div></div>
              <PairedColumns labels={rev.months.map((m) => monthLabel(m).split(" ")[0].slice(0, 3))} a={rev.invoiced} b={rev.cash} aName="Invoiced" bName="Received" format={fmt} /></section>
            <section className="glass card"><div className="card-head"><div><h2>Receivables &amp; aging</h2><span className="faint">{rev.openCount} open invoices</span></div></div>
              <div className="kpi-value" style={{ marginBottom: 10 }}>{fmt(show === "USD" ? rev.outstanding.usd : rev.outstanding.pkr)}</div>
              <Bars rows={rev.aging.map((g, i) => ({ label: g.label, sub: `(${g.n})`, value: show === "USD" ? g.sum.usd : g.sum.pkr, display: fmt(show === "USD" ? g.sum.usd : g.sum.pkr), color: i >= 2 ? "var(--danger)" : i === 1 ? "var(--warn)" : undefined }))} />
              <MissingRates missing={missingFor(rev.outstanding, show)} /></section>
          </div>)}

        {(tab === "overview" || tab === "delivery") && can("reports.projects") && (
          <section className="glass card"><div className="card-head"><div><h2>Project delivery</h2><span className="faint">Progress is calculated from completed tasks</span></div></div>
            {!a.projects.length ? <Empty title="No projects yet" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Project</th><th>Status</th><th>Progress</th><th>Due</th><th>Health</th></tr></thead><tbody>{a.projects.map((p) => {
              const s = a.projectStats.get(p.id) ?? { total: 0, done: 0, overdue: 0 }; const pc = s.total ? Math.round((s.done / s.total) * 100) : 0; const today = new Date().toISOString().slice(0, 10);
              const health = p.status === "completed" ? ["Delivered", "ok"] : p.status === "cancelled" ? ["Cancelled", undefined] : p.due_date && p.due_date < today ? ["Overdue", "danger"] : s.overdue > 0 || (p.due_date && Date.parse(p.due_date) - Date.now() < 7 * 86400_000 && pc < 80) ? ["At risk", "warn"] : ["On track", "ok"];
              return (<tr key={p.id}><td className="cell-main"><span className="cell-strong">{p.name}</span><div className="cell-sub">PM {a.team.find((u) => u.id === p.project_manager_id)?.full_name ?? "—"}</div></td><td data-label="Status"><Badge>{label(p.status)}</Badge></td>
                <td data-label="Progress" style={{ minWidth: 150 }}><div className="meter"><i style={{ width: `${pc}%` }} /></div><span className="faint" style={{ fontSize: "0.76rem" }}>{s.done}/{s.total} tasks · {pc}%</span></td><td data-label="Due">{p.due_date ?? "—"}</td><td data-label="Health"><Badge tone={health[1] as "ok"}>{health[0]}</Badge></td></tr>); })}</tbody></table></div>}</section>)}

        {(tab === "overview" || tab === "team") && can("reports.projects") && (
          <section className="glass card"><div className="card-head"><div><h2>Team productivity &amp; capacity</h2><span className="faint">{people.length} people with assigned tasks</span></div></div>
            {!people.length ? <Empty title="No assigned tasks yet" /> : <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>{people.map((p) => (
              <div key={p.u.id} className="glass card" style={{ padding: 16 }}><div className="row"><span className="avatar">{p.u.full_name.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</span><div><strong>{p.u.full_name}</strong><div className="faint" style={{ fontSize: "0.76rem" }}>{label(p.u.role)}</div></div></div>
                <div className="row" style={{ justifyContent: "space-between", margin: "12px 0 6px" }}><span>Assigned <strong>{p.assigned}</strong></span><span>Completed <strong>{p.done}</strong></span></div>
                <div className="meter" data-tone={p.vel >= 80 ? "ok" : p.vel < 40 ? "warn" : undefined}><i style={{ width: `${p.vel}%` }} /></div><div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}><span className="faint" style={{ fontSize: "0.78rem" }}>{p.prog} in progress</span><Badge tone={p.over ? "danger" : "ok"}>{p.over} overdue</Badge></div></div>))}</div>}</section>)}

        {tab === "library" && (
          <section className="glass card"><div className="card-head"><div><h2>Reports library</h2><span className="faint">Download CSV exports of the records your role can see. Opens in Excel or Google Sheets.</span></div></div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>{exports.map(([t, desc, fn]) => (
              <div key={t} className="glass card" style={{ padding: 16, display: "grid", gap: 8, alignContent: "space-between" }}><div><FileSpreadsheet size={20} color="var(--accent-ink)" /><h3 style={{ marginTop: 6 }}>{t}</h3><p className="muted" style={{ fontSize: "0.86rem" }}>{desc}</p></div>
                <Button size="sm" onClick={() => downloadCsv(t.toLowerCase().replace(/\W+/g, "-"), fn())}><Download size={14} />Download CSV</Button></div>))}</div></section>)}
        <p className="hint" style={{ padding: "0 8px" }}>Viewing as {profile!.full_name}. Totals convert each deal and payment with the exchange rate for the month it was won or received; amounts without a rate are excluded and flagged.</p>
      </>)}
    </div>
  );
}
