import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Handshake, TrendingUp, UserPlus, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Empty, ListSkeleton } from "@/components/ui";
import { Bars, Donut, LineChart, MissingRates, PALETTE, Stat } from "@/components/extra";
import { effectiveTarget, formatMoney, missingFor, monthKey, sumConverted, targetProgress } from "@/lib/money";
import { formatInTz, relative } from "@/lib/time";
import { ROLE_LABEL, label } from "@/lib/types";
import { useFollowUps } from "@/features/followups/api";
import { useFollowUpGroups } from "@/features/followups/FollowUpsPage";
import { FollowUpItem } from "@/features/followups/FollowUpItem";
import { useTargets } from "@/features/targets/TargetsPage";
import { buckets, delta, inRange, isWon, periodRanges, stageOf, useAnalytics, wonRevenue, type PeriodKey } from "@/features/reports/analytics";

const RANGES: { id: PeriodKey; label: string }[] = [{ id: "7d", label: "7D" }, { id: "30d", label: "30D" }, { id: "90d", label: "90D" }, { id: "year", label: "1Y" }];
const DAY = 86400_000;
const Delta = ({ v }: { v: number | null }) => (v == null ? <span className="faint">vs previous period</span> : <Badge tone={v >= 0 ? "ok" : "danger"}>{v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}% vs previous</Badge>);

function useRecentActivity() {
  return useQuery({ queryKey: ["activities", "recent"], queryFn: async () => (await supabase.from("activities").select("id,kind,summary,created_at,entity_type").order("created_at", { ascending: false }).limit(7)).data ?? [] });
}
function useSchedulerHealth() {
  const { can } = useAuth();
  return useQuery({ queryKey: ["dashboard", "scheduler"], enabled: can("audit.view"), refetchInterval: 60_000, queryFn: async () => (await supabase.from("scheduler_runs").select("ran_at").order("id", { ascending: false }).limit(1).maybeSingle()).data });
}
function useQuotesWaiting() {
  const { can } = useAuth();
  return useQuery({ queryKey: ["quotes", "waiting"], enabled: can("quotes.review"), refetchInterval: 60_000, queryFn: async () => (await supabase.from("quotes").select("id", { count: "exact", head: true }).eq("status", "submitted")).count ?? 0 });
}

export function DashboardPage() {
  const { profile, can } = useAuth(); const tz = profile!.timezone; const a = useAnalytics(); const fu = useFollowUps(); const g = useFollowUpGroups(fu.data, tz);
  const act = useRecentActivity(); const health = useSchedulerHealth(); const waiting = useQuotesWaiting(); const targets = useTargets();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [show, setShow] = useState<"USD" | "PKR">(() => (localStorage.getItem("fartech.showcur") as "PKR") || "USD");
  const R = useMemo(() => periodRanges(period, tz), [period, tz]);
  const fmt = (n: number) => formatMoney(n, show, { compact: true });
  const pick = (s: { usd: number; pkr: number }) => (show === "USD" ? s.usd : s.pkr);
  const salesView = can("leads.create") || can("leads.view_all") || can("deals.write") || can("deals.view_all");
  const showRevenue = can("reports.sales") || can("finance.view") || profile!.role === "sales_executive";

  const m = useMemo(() => {
    const leadsCur = a.leads.filter((l) => inRange(l.created_at, R.cur)).length, leadsPrev = a.leads.filter((l) => inRange(l.created_at, R.prev)).length;
    const open = a.deals.filter((d) => { const s = stageOf(a.stages, d); return s && !s.is_won && !s.is_lost; });
    const newCur = a.deals.filter((d) => inRange(d.created_at, R.cur)).length, newPrev = a.deals.filter((d) => inRange(d.created_at, R.prev)).length;
    const wonCur = wonRevenue(a.deals, a.rates, tz, R.cur), wonPrev = wonRevenue(a.deals, a.rates, tz, R.prev);
    const bs = buckets(R.cur); let acc = 0;
    const actual = bs.map((b) => { acc += pick(wonRevenue(a.deals, a.rates, tz, { from: b.start, to: b.end })); return acc; });
    const month = monthKey(Date.now(), tz);
    const reps = a.team.filter((u) => (u.role === "sales_executive" || u.role === "cso") && u.is_active && (can("targets.manage") || u.id === profile!.id));
    const tgt = reps.map((u) => effectiveTarget(targets.data ?? [], u.id, month)).filter(Boolean);
    const monthly = tgt.reduce((x, t) => x + ((show === "USD" ? t!.target_usd : t!.target_pkr) ?? 0), 0);
    const days = (R.cur.to - R.cur.from) / DAY;
    // straight-line pace towards one month of target, scaled to the chosen window
    const projection = monthly ? bs.map((b) => (monthly * Math.min(days, 30) / Math.max(days, 1)) * ((b.end - R.cur.from) / DAY) / Math.min(days, 30)) : [];
    const stageRows = a.stages.filter((s) => !s.is_won && !s.is_lost).map((s) => {
      const ds = open.filter((d) => d.stage_id === s.id);
      const sm = sumConverted(a.rates, ds.map((d) => ({ amount: d.value, currency: d.currency, month })));
      return { label: s.name, sub: `(${ds.length})`, value: pick(sm), display: fmt(pick(sm)) };
    });
    const src = new Map<string, number>(); for (const l of a.leads.filter((x) => inRange(x.created_at, R.cur))) src.set(l.source, (src.get(l.source) ?? 0) + 1);
    const closed = a.deals.filter((d) => (isWon(d) && inRange(d.won_confirmed_at, R.cur)) || (stageOf(a.stages, d)?.is_lost && inRange(d.closed_at, R.cur))).length;
    const myProgress = profile!.role === "sales_executive" || profile!.role === "cso" ? (() => {
      const t = effectiveTarget(targets.data ?? [], profile!.id, month);
      const w = wonRevenue(a.deals.filter((d) => d.owner_id === profile!.id), a.rates, tz, { from: Date.parse(month), to: Date.now() + 1 });
      return { t, p: targetProgress(t, w) };
    })() : null;
    return { leadsCur, leadsPrev, open, newCur, newPrev, wonCur, wonPrev, labels: bs.map((b) => b.label), actual, projection, stageRows, pipelineTotal: stageRows.reduce((x, r) => x + r.value, 0),
      src: [...src.entries()].sort((x, y) => y[1] - x[1]), winRatio: closed ? (wonCur.won.length / closed) * 100 : 0, myProgress };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, R, tz, show, can, profile, targets.data]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const myOpen = a.tasks.filter((t) => t.assigned_to === profile!.id && t.status !== "done" && t.status !== "cancelled" && t.due_date);
  const dueTasks = myOpen.filter((t) => t.due_date! <= new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10)).length;
  const overdueTasks = myOpen.filter((t) => t.due_date! < todayStr).length;
  const overdueAll = g.overdue.length + overdueTasks;
  const tasksDue = g.overdue.length + g.due_soon.length + g.today.length + dueTasks;
  const sched = health.data; const schedStale = can("audit.view") && (!sched || Date.now() - new Date(sched.ran_at).getTime() > 5 * 60_000);
  const upcoming = [...g.overdue, ...g.due_soon, ...g.today].slice(0, 4);
  const hour = new Date().getHours(); const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const outstanding = sumConverted(a.rates, a.invoices.filter((i) => i.status === "sent" && i.balance_due > 0).map((i) => ({ amount: i.balance_due, currency: i.currency, month: monthKey(Date.now(), tz) })));

  return (
    <div className="page">
      <div className="page-head"><div><h1>{greet}, {profile!.full_name.split(" ")[0]}</h1><p>{ROLE_LABEL[profile!.role]} · here’s what’s happening across FAR Tech &amp; Developers.</p></div>
        <div className="page-actions">
          <div className="seg" role="group" aria-label="Currency">{(["USD", "PKR"] as const).map((c) => <button key={c} aria-pressed={show === c} onClick={() => { setShow(c); localStorage.setItem("fartech.showcur", c); }}>{c}</button>)}</div>
          <div className="seg" role="group" aria-label="Period">{RANGES.map((r) => <button key={r.id} aria-pressed={period === r.id} onClick={() => setPeriod(r.id)}>{r.label}</button>)}</div></div></div>

      {schedStale && <div className="glass card" role="alert" style={{ borderColor: "var(--danger)" }}><div className="row"><AlertTriangle size={20} color="var(--danger)" /><div><strong>Reminder scheduler has not run in the last 5 minutes.</strong><p className="muted">{sched ? `Last run ${relative(sched.ran_at)}.` : "No run recorded yet."} Reminders are queued and will be delivered when it resumes. Check pg_cron.</p></div></div></div>}
      {(waiting.data ?? 0) > 0 && <Link to="/finance?tab=quotes" className="glass card card-link"><div className="row"><ClipboardList size={20} color="var(--warn)" /><strong>{waiting.data} quote{waiting.data === 1 ? "" : "s"} waiting for your approval</strong><ArrowRight size={16} style={{ marginLeft: "auto" }} /></div></Link>}

      <div className="grid kpis">
        {salesView && <Stat icon={<UserPlus size={16} />} label="Total leads" value={m.leadsCur.toLocaleString()} sub={<Delta v={delta(m.leadsCur, m.leadsPrev)} />} />}
        {salesView && <Stat icon={<Handshake size={16} />} label="Active deals" value={m.open.length} sub={<Delta v={delta(m.newCur, m.newPrev)} />} />}
        {showRevenue && <Stat icon={<TrendingUp size={16} />} label="Revenue won" value={fmt(pick(m.wonCur))} sub={<Delta v={delta(m.wonCur.usd, m.wonPrev.usd)} />} tone="ok" />}
        {can("finance.view") && <Stat icon={<Wallet size={16} />} label="Outstanding" value={fmt(pick(outstanding))} sub="Invoiced, not yet received" />}
        <Stat icon={<CalendarClock size={16} />} label="Tasks & follow-ups due" value={tasksDue} sub={overdueAll > 0 ? <Badge tone="danger">{overdueAll} overdue · action required</Badge> : "Nothing overdue"} tone={overdueAll > 0 ? "danger" : undefined} />
      </div>
      <MissingRates missing={missingFor(m.wonCur, show)} />

      {m.myProgress && (
        <section className="glass card"><div className="card-head"><h2>My monthly target</h2>{m.myProgress.t?.carried && <Badge tone="warn">Carried over</Badge>}</div>
          {!m.myProgress.t ? <p className="muted">No target has been set for you yet.</p> : <div className="grid cols-2">{([["USD", m.myProgress.p.achievedUsd, m.myProgress.p.usd, m.myProgress.p.pctUsd], ["PKR", m.myProgress.p.achievedPkr, m.myProgress.p.pkr, m.myProgress.p.pctPkr]] as const).filter((x) => x[2] != null).map(([c, v, t, pc]) => (
            <div key={c}><div className="row" style={{ justifyContent: "space-between" }}><strong>{formatMoney(v, c, { compact: true })}</strong><span className="muted">of {formatMoney(t!, c, { compact: true })}</span></div><div className="meter" data-tone={(pc ?? 0) >= 100 ? "ok" : undefined}><i style={{ width: `${Math.min(100, pc ?? 0)}%` }} /></div><span className="faint" style={{ fontSize: "0.8rem" }}>{(pc ?? 0).toFixed(1)}%</span></div>))}</div>}
        </section>)}

      <div className="grid cols-3-2">
        {showRevenue && (
          <section className="glass card" aria-labelledby="rev-h"><div className="card-head"><div><h2 id="rev-h">Revenue overview</h2><span className="faint">Cumulative Finance-confirmed wins ({show})</span></div><Badge tone="brand">{R.label}</Badge></div>
            {a.loading ? <ListSkeleton /> : m.labels.length < 2 ? <Empty title="Not enough data yet" /> : <LineChart labels={m.labels} series={[{ name: "Actual", values: m.actual }, ...(m.projection.length ? [{ name: "Target projection", values: m.projection, color: PALETTE[1], dashed: true }] : [])]} format={fmt} />}
            <div className="legend" style={{ marginTop: 8 }}><span><span className="dot" style={{ color: PALETTE[0] }} />Actual {fmt(pick(m.wonCur))}</span>{m.projection.length > 0 && <span><span className="dot" style={{ color: PALETTE[1] }} />Target projection</span>}</div></section>)}
        {salesView && (
          <section className="glass card" aria-labelledby="pl-h"><div className="card-head"><div><h2 id="pl-h">Sales pipeline</h2><span className="faint">{m.open.length} active deals · {fmt(m.pipelineTotal)}</span></div><Link to="/deals">View pipeline <ArrowRight size={14} style={{ verticalAlign: "middle" }} /></Link></div>
            {a.loading ? <ListSkeleton /> : <Bars rows={m.stageRows} />}<div className="row" style={{ marginTop: 12 }}><Badge tone="ok">Won ratio {m.winRatio.toFixed(1)}%</Badge></div></section>)}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <section className="glass card" aria-labelledby="up-h"><div className="card-head"><h2 id="up-h">Upcoming &amp; overdue</h2><Link to="/follow-ups">View all</Link></div>
          {fu.isLoading ? <ListSkeleton /> : upcoming.length === 0 ? <Empty icon={<CheckCircle2 size={28} />} title="You’re on top of it">Nothing overdue or due today.</Empty> : <div className="fu-list">{upcoming.map((f) => <FollowUpItem key={f.id} f={f} />)}</div>}
          {dueTasks > 0 && <p className="hint" style={{ marginTop: 10 }}>{dueTasks} task{dueTasks === 1 ? "" : "s"} of yours due within 2 days · <Link to="/tasks">Open tasks</Link></p>}</section>
        <section className="glass card" aria-labelledby="ac-h"><div className="card-head"><h2 id="ac-h">Recent activity</h2></div>
          {act.isLoading ? <ListSkeleton /> : !act.data?.length ? <Empty title="No activity yet" /> : <div className="timeline">{act.data.map((x) => <div className="tl-item" key={x.id as number}><span className="tl-dot" /><div><div>{x.summary as string}</div><div className="tl-meta">{label(x.entity_type as string)} · {formatInTz(x.created_at as string, tz)}</div></div></div>)}</div>}</section>
        {salesView && (
          <section className="glass card" aria-labelledby="ls-h"><div className="card-head"><div><h2 id="ls-h">Lead sources</h2><span className="faint">{m.leadsCur} new in {R.label.toLowerCase()}</span></div></div>
            {m.src.length === 0 ? <Empty title="No new leads in this period" /> : <div className="row" style={{ alignItems: "center", gap: 20 }}><Donut slices={m.src.map(([l, v], i) => ({ label: label(l), value: v, color: PALETTE[i % PALETTE.length] }))} center={String(m.leadsCur)} sub="TOTAL" />
              <div className="legend" style={{ flexDirection: "column" }}>{m.src.slice(0, 6).map(([l, v], i) => <span key={l}><span className="dot" style={{ color: PALETTE[i % PALETTE.length] }} />{label(l)} · {Math.round((v / m.leadsCur) * 100)}%</span>)}</div></div>}</section>)}
      </div>
    </div>
  );
}
