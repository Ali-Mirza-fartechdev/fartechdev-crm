import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Phone, PhoneCall, Trash2, UserPlus, Users, Video, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, Field, ListSkeleton, Modal, errMsg, useToast } from "@/components/ui";
import { useConfirm } from "@/components/extra";
import { useTeam } from "@/lib/data";
import { formatInTz, relative } from "@/lib/time";
import { dayKey } from "@/lib/time";
import { ROLE_LABEL } from "@/lib/types";

export type Meeting = {
  id: string; title: string; host_id: string; status: "scheduled" | "live" | "ended" | "cancelled"; scheduled_at: string | null; started_at: string | null;
  notes: string | null; created_at: string; meeting_participants: { user_id: string; response: "pending" | "accepted" | "declined"; joined_at: string | null }[];
};
const M_KEY = ["meetings"] as const;

export function useMeetings() {
  return useQuery({
    queryKey: M_KEY, refetchInterval: 20_000, refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.from("meetings").select("*, meeting_participants(user_id,response,joined_at)").order("created_at", { ascending: false }).limit(300);
      if (error) throw error; return (data ?? []) as Meeting[];
    },
  });
}
/** Live calls and pending requests that need the signed-in user's attention. */
export function useMeetingBadge() {
  const { session } = useAuth(); const q = useMeetings();
  const me = session?.user.id;
  return (q.data ?? []).filter((m) => (m.status === "live" || m.status === "scheduled") && m.meeting_participants.some((p) => p.user_id === me && p.response === "pending")).length
    + (q.data ?? []).filter((m) => m.status === "live" && m.host_id !== me && m.meeting_participants.some((p) => p.user_id === me && p.response === "accepted" && !p.joined_at)).length;
}
export function useMeetingRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase.channel("meetings-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, () => { void qc.invalidateQueries({ queryKey: M_KEY }); })
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_participants" }, () => { void qc.invalidateQueries({ queryKey: M_KEY }); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);
}

function InviteePicker({ selected, onChange, exclude = [] }: { selected: string[]; onChange: (ids: string[]) => void; exclude?: string[] }) {
  const { session } = useAuth(); const team = useTeam(); const [q, setQ] = useState("");
  const people = (team.data ?? []).filter((u) => u.is_active && u.id !== session!.user.id && !exclude.includes(u.id) && u.full_name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="field"><span className="label">Invite people ({selected.length} selected)</span>
      <div className="row"><input className="input" style={{ flex: 1 }} aria-label="Search people" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" onClick={() => onChange([...new Set([...selected, ...people.map((p) => p.id)])])}>Select all</Button><Button size="sm" onClick={() => onChange([])}>Clear</Button></div>
      <div className="chips" style={{ maxHeight: 190, overflowY: "auto", padding: "4px 0" }}>
        {people.map((u) => <label key={u.id} className="chip-toggle"><input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} /><span>{u.full_name} · {ROLE_LABEL[u.role]}</span></label>)}
        {!people.length && <span className="hint">No one matches.</span>}</div></div>
  );
}

function NewMeeting({ instant, onClose }: { instant: boolean; onClose: () => void }) {
  const { profile } = useAuth(); const toast = useToast(); const qc = useQueryClient(); const nav = useNavigate();
  const tz = profile!.timezone;
  const [title, setTitle] = useState(""); const [ids, setIds] = useState<string[]>([]); const [notes, setNotes] = useState("");
  const [date, setDate] = useState(() => dayKey(Date.now() + 3600_000, tz)); const [time, setTime] = useState("10:00"); const [err, setErr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Give the meeting a title."); if (!ids.length) throw new Error("Choose at least one person to invite.");
      const { data, error } = await supabase.rpc("create_meeting", { p_title: title.trim(), p_invitees: ids, p_instant: instant, p_local_date: instant ? null : date, p_local_time: instant ? null : time, p_timezone: instant ? null : tz, p_notes: notes.trim() || null });
      if (error) throw error; return data as string;
    },
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: M_KEY }); toast(instant ? "Calling…" : "Meeting request sent. Invitees must accept it."); onClose(); if (instant) nav(`/meetings/${id}/room`); },
    onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal title={instant ? "Start an instant call" : "Schedule a meeting"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>{instant ? <><PhoneCall size={15} />Call now</> : <><Clock size={15} />Send request</>}</Button></>}>
      <Field label="Title *">{(id) => <input id={id} className="input" value={title} maxLength={200} placeholder={instant ? "Quick sync" : "Pricing review"} onChange={(e) => setTitle(e.target.value)} />}</Field>
      {!instant && <div className="form-grid"><Field label="Date">{(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />}</Field><Field label="Time" hint={`Your timezone: ${tz}`}>{(id) => <input id={id} type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />}</Field></div>}
      <InviteePicker selected={ids} onChange={setIds} />
      {!instant && <Field label="Agenda / notes (optional)">{(id) => <textarea id={id} className="textarea" style={{ minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>}
      <p className="hint">{instant ? "Invitees get a “calling you” notification. Their joining counts as accepting. Anyone can be invited, 1-to-1 or a group." : "Invitees accept or decline. Once the time comes, you start the meeting and everyone who accepted can join."}</p>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

function AddPeople({ m, onClose }: { m: Meeting; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient(); const [ids, setIds] = useState<string[]>([]);
  const add = useMutation({ mutationFn: async () => { const { error } = await supabase.rpc("add_meeting_invitees", { p_id: m.id, p_invitees: ids }); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: M_KEY }); toast("Invitations sent."); onClose(); }, onError: (e) => toast(errMsg(e), "error") });
  return <Modal title="Invite more people" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ids.length || add.isPending} onClick={() => add.mutate()}>Invite</Button></>}>
    <InviteePicker selected={ids} onChange={setIds} exclude={[m.host_id, ...m.meeting_participants.map((p) => p.user_id)]} /></Modal>;
}

function MeetingCard({ m, highlighted }: { m: Meeting; highlighted: boolean }) {
  const { session, profile } = useAuth(); const me = session!.user.id; const tz = profile!.timezone; const team = useTeam();
  const toast = useToast(); const qc = useQueryClient(); const confirm = useConfirm(); const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const name = (id: string) => team.data?.find((u) => u.id === id)?.full_name ?? "Someone";
  const mine = m.meeting_participants.find((p) => p.user_id === me); const host = m.host_id === me; const open = m.status === "scheduled" || m.status === "live";
  const run = useMutation({
    mutationFn: async (a: { fn: string; args: Record<string, unknown>; after?: () => void }) => { const { error } = await supabase.rpc(a.fn, a.args); if (error) throw error; return a; },
    onSuccess: (a) => { void qc.invalidateQueries({ queryKey: M_KEY }); a.after?.(); }, onError: (e) => toast(errMsg(e), "error"),
  });
  const rsp = { accepted: "✓", declined: "✕", pending: "…" } as const;
  return (
    <div className="glass card" id={`m-${m.id}`} style={highlighted ? { borderColor: "var(--brand)", boxShadow: "0 0 0 2px rgba(8,169,239,.35)" } : undefined}>
      <div className="card-head" style={{ marginBottom: 8 }}>
        <div><h3>{m.title}</h3><span className="faint">{host ? "You are hosting" : `Hosted by ${name(m.host_id)}`} · {m.status === "live" ? `started ${m.started_at ? relative(m.started_at) : ""}` : m.scheduled_at ? `${formatInTz(m.scheduled_at, tz)} (${relative(m.scheduled_at)})` : ""}</span></div>
        <Badge tone={m.status === "live" ? "ok" : m.status === "scheduled" ? "brand" : m.status === "cancelled" ? "danger" : undefined}>{m.status === "live" ? "● Live now" : m.status === "scheduled" ? "Scheduled" : m.status === "ended" ? "Ended" : "Cancelled"}</Badge></div>
      {m.notes && <p className="muted" style={{ marginBottom: 8, whiteSpace: "pre-wrap" }}>{m.notes}</p>}
      <div className="chips" style={{ marginBottom: 12 }}>{m.meeting_participants.map((p) => <span key={p.user_id} className="badge" title={p.response}>{rsp[p.response]} {p.user_id === me ? "You" : name(p.user_id)}</span>)}</div>
      <div className="row">
        {open && mine?.response === "pending" && m.status === "scheduled" && <><Button size="sm" variant="primary" onClick={() => run.mutate({ fn: "respond_meeting", args: { p_id: m.id, p_accept: true }, after: () => toast("Accepted. You can join once the host starts.") })}><Check size={14} />Accept</Button>
          <Button size="sm" onClick={() => run.mutate({ fn: "respond_meeting", args: { p_id: m.id, p_accept: false } })}><X size={14} />Decline</Button></>}
        {m.status === "live" && <Button size="sm" variant="primary" onClick={() => nav(`/meetings/${m.id}/room`)}><Video size={14} />{mine && !mine.joined_at && !host ? "Answer & join" : "Join"}</Button>}
        {m.status === "live" && mine?.response === "pending" && <Button size="sm" onClick={() => run.mutate({ fn: "respond_meeting", args: { p_id: m.id, p_accept: false } })}><Phone size={14} />Decline</Button>}
        {host && m.status === "scheduled" && <Button size="sm" variant="primary" onClick={() => run.mutate({ fn: "start_meeting", args: { p_id: m.id }, after: () => nav(`/meetings/${m.id}/room`) })}><Video size={14} />Start now</Button>}
        {host && open && <Button size="sm" onClick={() => setAdding(true)}><UserPlus size={14} />Add people</Button>}
        {host && m.status === "live" && <Button size="sm" variant="danger" onClick={async () => { if (await confirm({ title: "End the meeting for everyone?", danger: true, confirmLabel: "End meeting" })) run.mutate({ fn: "end_meeting", args: { p_id: m.id } }); }}>End for all</Button>}
        {host && open && <Button size="sm" variant="danger" onClick={async () => { if (await confirm({ title: "Cancel this meeting?", body: "Everyone invited is notified.", danger: true, confirmLabel: "Cancel meeting" })) run.mutate({ fn: "cancel_meeting", args: { p_id: m.id } }); }}>Cancel</Button>}
        {host && !open && <Button size="sm" variant="ghost" aria-label="Delete meeting" onClick={async () => { if (await confirm({ title: "Delete this meeting from history?", danger: true, confirmLabel: "Delete" })) run.mutate({ fn: "delete_meeting", args: { p_id: m.id } }); }}><Trash2 size={14} /></Button>}
      </div>
      {adding && <AddPeople m={m} onClose={() => setAdding(false)} />}
    </div>
  );
}

export function MeetingsPage() {
  const [params] = useSearchParams(); const focus = params.get("meeting"); const q = useMeetings();
  const [creating, setCreating] = useState<null | "instant" | "schedule">(null); const [tab, setTab] = useState<"open" | "history">("open");
  const open = useMemo(() => (q.data ?? []).filter((m) => m.status === "live" || m.status === "scheduled").sort((a, b) => (a.status === b.status ? Date.parse(a.scheduled_at ?? a.created_at) - Date.parse(b.scheduled_at ?? b.created_at) : a.status === "live" ? -1 : 1)), [q.data]);
  const history = (q.data ?? []).filter((m) => m.status === "ended" || m.status === "cancelled");
  useEffect(() => { if (focus && q.data) document.getElementById(`m-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focus, q.data]);
  const list = tab === "open" ? open : history;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Meetings</h1><p>Video calls with anyone on the team: 1-to-1 or group. Schedule one (invitees accept) or start an instant call.</p></div>
        <div className="page-actions"><Button onClick={() => setCreating("schedule")}><Clock size={16} />Schedule meeting</Button><Button variant="primary" onClick={() => setCreating("instant")}><PhoneCall size={16} />Start instant call</Button></div></div>
      <div className="seg" role="group" aria-label="Meetings" style={{ justifySelf: "start", marginLeft: 8 }}><button aria-pressed={tab === "open"} onClick={() => setTab("open")}>Upcoming &amp; live ({open.length})</button><button aria-pressed={tab === "history"} onClick={() => setTab("history")}>History</button></div>
      {q.isLoading ? <div className="glass card"><ListSkeleton /></div> : !list.length ? <div className="glass card"><Empty icon={<Users size={32} />} title={tab === "open" ? "No meetings yet" : "No past meetings"}>{tab === "open" ? "Start an instant call or schedule a meeting with one person or a whole group." : "Ended and cancelled meetings appear here."}</Empty></div>
        : <div className="stack">{list.map((m) => <MeetingCard key={m.id} m={m} highlighted={focus === m.id} />)}</div>}
      {creating && <NewMeeting instant={creating === "instant"} onClose={() => setCreating(null)} />}
    </div>
  );
}
