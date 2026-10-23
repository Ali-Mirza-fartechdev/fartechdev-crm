import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, AlertTriangle, CalendarClock, CheckCircle2, FolderKanban, ListChecks, Receipt, UserPlus, Users, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Empty, ListSkeleton } from "@/components/ui";
import { formatInTz, relative } from "@/lib/time";
import { ROLE_LABEL } from "@/lib/types";
import { useFollowUps } from "@/features/followups/api";
import { useFollowUpGroups } from "@/features/followups/FollowUpsPage";
import { FollowUpItem } from "@/features/followups/FollowUpItem";

const head = (table: string) => supabase.from(table).select("id", { count: "exact", head: true });
const money = (n: number, cur = "USD") => new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);

function useDashboard() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["dashboard"], refetchInterval: 60_000,
    queryFn: async () => {
      const out: Record<string, number | null> = {};
      const jobs: Promise<void>[] = [];
      const count = (k: string, q: PromiseLike<{ count: number | null; error: unknown }>) => jobs.push(Promise.resolve(q).then((r) => { out[k] = r.error ? null : r.count ?? 0; }));
      if (can("leads.create") || can("leads.view_all")) count("newLeads", head("leads").eq("status", "new"));
      if (can("clients.view_all") || can("clients.write")) count("clients", head("clients").eq("is_active", true));
      count("projects", head("projects").eq("status", "active"));
      count("tasks", head("tasks").in("status", ["todo", "in_progress", "in_review", "blocked"]));
      if (can("finance.view")) {
        jobs.push(Promise.resolve(supabase.from("invoice_balances").select("balance_due,is_overdue,currency").eq("status", "sent").gt("balance_due", 0))
          .then((r) => { const rows = r.data ?? []; out.outstanding = rows.reduce((a, x) => a + Number(x.balance_due), 0); out.overdueInvoices = rows.filter((x) => x.is_overdue).length; }));
      }
      await Promise.all(jobs);
      return out;
    },
  });
}

function usePipeline() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["dashboard", "pipeline"], enabled: can("deals.write") || can("deals.view_all"),
    queryFn: async () => {
      const { data, error } = await supabase.from("deals").select("value,closed_at,stage:pipeline_stages(name,position,is_won,is_lost)");
      if (error) throw error;
      type Row = { value: number; stage: { name: string; position: number; is_won: boolean; is_lost: boolean } | { name: string; position: number; is_won: boolean; is_lost: boolean }[] | null };
      const byStage = new Map<string, { name: string; pos: number; total: number; n: number }>();
      let won = 0;
      for (const r of (data ?? []) as unknown as Row[]) {
        const s = Array.isArray(r.stage) ? r.stage[0] : r.stage; if (!s) continue;
        if (s.is_won) won += Number(r.value);
        if (s.is_won || s.is_lost) continue;
        const e = byStage.get(s.name) ?? { name: s.name, pos: s.position, total: 0, n: 0 };
        e.total += Number(r.value); e.n += 1; byStage.set(s.name, e);
      }
      return { stages: [...byStage.values()].sort((a, b) => a.pos - b.pos), won };
    },
  });
}

function useActivity() {
  return useQuery({
    queryKey: ["activities", "recent"],
    queryFn: async () => (await supabase.from("activities").select("id,kind,summary,created_at,entity_type,entity_id").order("created_at", { ascending: false }).limit(8)).data ?? [],
  });
}

function useSchedulerHealth() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ["dashboard", "scheduler"], enabled: can("audit.view"), refetchInterval: 60_000,
    queryFn: async () => (await supabase.from("scheduler_runs").select("ran_at,fired,max_lag_seconds").order("id", { ascending: false }).limit(1).maybeSingle()).data,
  });
}

type FuFilter = "all" | "mine";

export function DashboardPage() {
  const { profile, can } = useAuth();
  const tz = profile!.timezone;
  const d = useDashboard(), pipe = usePipeline(), act = useActivity(), health = useSchedulerHealth();
  const fu = useFollowUps();
  const g = useFollowUpGroups(fu.data, tz);
  const [fuFilter, setFuFilter] = useState<FuFilter>("all");
  const mine = (l: typeof g.overdue) => (fuFilter === "mine" ? l.filter((f) => f.assigned_to === profile!.id) : l);
  const shown = [...mine(g.overdue), ...mine(g.due_soon), ...mine(g.today)].slice(0, 6);
  const maxStage = Math.max(1, ...(pipe.data?.stages.map((s) => s.total) ?? [1]));
  const sched = health.data;
  const schedStale = can("audit.view") && (!sched || Date.now() - new Date(sched.ran_at).getTime() > 5 * 60_000);
  const v = d.data ?? {};
  const kpi = (icon: React.ReactNode, label: string, value: string | number | null | undefined, sub?: string, tone?: string, to?: string) => {
    if (value === undefined) return null;
    const body = <><span className="kpi-label">{icon}{label}</span><span className="kpi-value">{value ?? "—"}</span>{sub && <span className="kpi-sub">{sub}</span>}</>;
    return to ? <Link className="glass kpi card-link" data-tone={tone} to={to}>{body}</Link> : <div className="glass kpi" data-tone={tone}>{body}</div>;
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>Welcome back, {profile!.full_name.split(" ")[0]}</h1><p>{ROLE_LABEL[profile!.role]} · {formatInTz(new Date().toISOString(), tz, { hour: undefined, minute: undefined, weekday: "long" })}</p></div></div>

      {schedStale && (
        <div className="glass card" role="alert" style={{ borderColor: "var(--danger)" }}>
          <div className="row"><AlertTriangle size={20} color="var(--danger)" /><div>
            <strong>Reminder scheduler has not run in the last 5 minutes.</strong>
            <p className="muted">{sched ? `Last run ${relative(sched.ran_at)}.` : "No run recorded yet."} Follow-up notifications are queued and will be delivered once it resumes. Check pg_cron (docs/SETUP.md §6).</p>
          </div></div>
        </div>)}

      <div className="grid kpis">
        {kpi(<CalendarClock size={16} />, "Overdue follow-ups", g.overdue.length, "Open until resolved", g.overdue.length ? "danger" : undefined, "/follow-ups")}
        {kpi(<CalendarClock size={16} />, "Due today", g.due_soon.length + g.today.length, `${g.upcoming.length} upcoming`, undefined, "/follow-ups")}
        {kpi(<UserPlus size={16} />, "New leads", v.newLeads, undefined, undefined, "/leads")}
        {kpi(<Users size={16} />, "Active clients", v.clients, undefined, undefined, "/clients")}
        {kpi(<FolderKanban size={16} />, "Active projects", v.projects)}
        {kpi(<ListChecks size={16} />, "Open tasks", v.tasks)}
        {can("finance.view") && kpi(<Wallet size={16} />, "Outstanding (invoiced, unpaid)", v.outstanding == null ? null : money(Number(v.outstanding)))}
        {can("finance.view") && kpi(<Receipt size={16} />, "Overdue invoices", v.overdueInvoices, undefined, Number(v.overdueInvoices) > 0 ? "danger" : undefined)}
      </div>

      <div className="grid cols-3-2">
        <section className="glass card" aria-labelledby="fu-h">
          <div className="card-head"><h2 id="fu-h">Follow-ups needing attention</h2>
            <div className="seg" role="group" aria-label="Scope">
              <button aria-pressed={fuFilter === "all"} onClick={() => setFuFilter("all")}>{can("followups.view_all") ? "All" : "Mine"}</button>
              {can("followups.view_all") && <button aria-pressed={fuFilter === "mine"} onClick={() => setFuFilter("mine")}>Assigned to me</button>}
            </div></div>
          {fu.isLoading ? <ListSkeleton /> : shown.length === 0
            ? <Empty icon={<CheckCircle2 size={30} />} title="You're on top of it">Nothing overdue or due today.</Empty>
            : <div className="fu-list">{shown.map((f) => <FollowUpItem key={f.id} f={f} />)}</div>}
          {(g.overdue.length + g.due_soon.length + g.today.length > shown.length) && <p style={{ marginTop: 12 }}><Link to="/follow-ups">See all follow-ups</Link></p>}
          {g.completed.length > 0 && <p className="hint" style={{ marginTop: 10 }}>{g.completed.length} completed in the last 7 days.</p>}
        </section>

        <div className="grid">
          {(can("deals.write") || can("deals.view_all")) && (
            <section className="glass card" aria-labelledby="pl-h">
              <div className="card-head"><h2 id="pl-h">Open pipeline</h2>{pipe.data && <Badge tone="ok">Won {money(pipe.data.won)}</Badge>}</div>
              {pipe.isLoading ? <ListSkeleton /> : !pipe.data?.stages.length ? <Empty title="No open deals">Deals you can see will appear here by stage.</Empty>
                : <div className="bars">{pipe.data.stages.map((s) => (
                  <div className="bar-row" key={s.name}><span>{s.name} <span className="faint">({s.n})</span></span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(s.total / maxStage) * 100}%` }} /></div><strong>{money(s.total)}</strong></div>))}</div>}
            </section>)}
          <section className="glass card" aria-labelledby="ac-h">
            <div className="card-head"><h2 id="ac-h">Recent activity</h2><ActivityIcon size={18} className="faint" /></div>
            {act.isLoading ? <ListSkeleton /> : !act.data?.length ? <Empty title="No activity yet" />
              : <div className="timeline">{act.data.map((a) => (
                <div className="tl-item" key={a.id}><span className="tl-dot" /><div><div>{a.summary}</div><div className="tl-meta">{formatInTz(a.created_at, tz)}</div></div></div>))}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
