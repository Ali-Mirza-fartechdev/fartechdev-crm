import { useMemo, useState } from "react";
import { BellRing, Plus } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { Button, Empty, ListSkeleton } from "@/components/ui";
import { addDaysToKey, bucketOf, dayKey, weekRange } from "@/lib/time";
import type { FollowUp } from "@/lib/types";
import { FollowUpForm } from "./FollowUpForm";
import { FollowUpItem } from "./FollowUpItem";
import { useFollowUps } from "./api";

type Filter = "today" | "tomorrow" | "week" | "overdue" | "mine" | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "today", label: "Today" }, { id: "tomorrow", label: "Tomorrow" }, { id: "week", label: "This week" },
  { id: "overdue", label: "Overdue" }, { id: "mine", label: "Assigned to me" }, { id: "all", label: "All" },
];

export function useFollowUpGroups(list: FollowUp[] | undefined, tz: string) {
  return useMemo(() => {
    const g = { overdue: [] as FollowUp[], due_soon: [] as FollowUp[], today: [] as FollowUp[], upcoming: [] as FollowUp[], completed: [] as FollowUp[] };
    for (const f of list ?? []) {
      const b = bucketOf(f, tz);
      if (b === "overdue") g.overdue.push(f);
      else if (b === "due_soon") g.due_soon.push(f);
      else if (b === "today") g.today.push(f);
      else if (b === "upcoming") g.upcoming.push(f);
      else if (b === "completed") g.completed.push(f);
    }
    g.completed.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    return g;
  }, [list, tz]);
}

export function FollowUpsPage() {
  const { profile, can } = useAuth();
  const tz = profile!.timezone;
  const q = useFollowUps();
  const [filter, setFilter] = useState<Filter>("today");
  const [adding, setAdding] = useState(false);
  const groups = useFollowUpGroups(q.data, tz);

  const visible = useMemo(() => {
    const now = Date.now(), today = dayKey(now, tz), tomorrow = addDaysToKey(today, 1), wk = weekRange(today);
    const pending = (q.data ?? []).filter((f) => f.status === "pending");
    const dk = (f: FollowUp) => dayKey(f.due_at, tz);
    // overdue items stay visible in the Today / This week views until they are resolved
    const overdue = pending.filter((f) => new Date(f.due_at).getTime() < now);
    switch (filter) {
      case "today": return [...overdue, ...pending.filter((f) => dk(f) === today && !overdue.includes(f))];
      case "tomorrow": return pending.filter((f) => dk(f) === tomorrow);
      case "week": return [...overdue, ...pending.filter((f) => dk(f) >= wk.start && dk(f) <= wk.end && !overdue.includes(f))];
      case "overdue": return overdue;
      case "mine": return pending.filter((f) => f.assigned_to === profile!.id);
      default: return pending;
    }
  }, [q.data, filter, tz, profile]);

  const completed = filter === "all" ? groups.completed : [];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Follow-ups</h1><p>Times shown in {tz}. Reminders are sent by the server, even when you are signed out.</p></div>
        {can("followups.create") && <div className="page-actions"><Button variant="primary" onClick={() => setAdding(true)}><Plus size={18} />Schedule follow-up</Button></div>}
      </div>
      <div className="grid kpis">
        <div className="glass kpi" data-tone={groups.overdue.length ? "danger" : undefined}><span className="kpi-label">Overdue</span><span className="kpi-value">{groups.overdue.length}</span><span className="kpi-sub">Stay here until resolved</span></div>
        <div className="glass kpi"><span className="kpi-label">Due within the hour</span><span className="kpi-value">{groups.due_soon.length}</span></div>
        <div className="glass kpi"><span className="kpi-label">Later today</span><span className="kpi-value">{groups.today.length}</span></div>
        <div className="glass kpi"><span className="kpi-label">Upcoming</span><span className="kpi-value">{groups.upcoming.length}</span></div>
      </div>
      <div className="glass card">
        <div className="card-head">
          <div className="seg" role="group" aria-label="Filter follow-ups" style={{ flexWrap: "wrap" }}>
            {FILTERS.filter((f) => f.id !== "all" || can("followups.view_all")).map((f) => (
              <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>))}
            {!can("followups.view_all") && <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All mine</button>}
          </div>
        </div>
        {q.isLoading ? <ListSkeleton />
          : q.error ? <p className="error-text" role="alert">Could not load follow-ups. Check your connection and try again.</p>
          : visible.length === 0 && completed.length === 0
            ? <Empty icon={<BellRing size={32} />} title="Nothing here">{filter === "today" ? "No follow-ups are due today. Schedule one from a lead or client." : "No follow-ups match this view."}</Empty>
            : <div className="fu-list">
                {visible.map((f) => <FollowUpItem key={f.id} f={f} />)}
                {completed.length > 0 && <><h3 style={{ marginTop: 10 }}>Completed recently</h3>{completed.map((f) => <FollowUpItem key={f.id} f={f} />)}</>}
              </div>}
      </div>
      {adding && <FollowUpForm onClose={() => setAdding(false)} />}
    </div>
  );
}
