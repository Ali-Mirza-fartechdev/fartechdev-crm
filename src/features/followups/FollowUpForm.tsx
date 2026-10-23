import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Button, Field, Modal, errMsg, useToast } from "@/components/ui";
import { FOLLOW_UP_TYPES, PRIORITIES, REMINDER_OPTIONS, label, type FollowUp } from "@/lib/types";
import { dayKey, splitLocal } from "@/lib/time";
import { useCreateFollowUp, useReschedule } from "./api";

/** Create (for a lead or client) or reschedule. The server converts date + time + timezone into a UTC instant. */
export function FollowUpForm({ onClose, fixed, existing }: {
  onClose: () => void;
  fixed?: { type: "lead" | "client"; id: string; name: string };
  existing?: FollowUp;
}) {
  const { profile, can } = useAuth();
  const toast = useToast();
  const tz = profile!.timezone;
  const create = useCreateFollowUp(), resched = useReschedule();
  const init = existing ? splitLocal(existing.due_at, tz) : { date: dayKey(Date.now() + 3600_000, tz), time: "10:00" };

  const [kind, setKind] = useState<"lead" | "client">(fixed?.type ?? "lead");
  const [entityId, setEntityId] = useState(fixed?.id ?? "");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [type, setType] = useState(existing?.follow_up_type ?? "call");
  const [priority, setPriority] = useState(existing?.priority ?? "medium");
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [assignee, setAssignee] = useState(existing?.assigned_to ?? profile!.id);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [offsets, setOffsets] = useState<number[]>(existing?.reminder_offsets ?? [15, 0]);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const prefs = useQuery({
    queryKey: ["prefs-offsets"], enabled: !existing,
    queryFn: async () => (await supabase.from("user_preferences").select("default_reminder_offsets").maybeSingle()).data?.default_reminder_offsets as number[] | undefined,
  });
  useEffect(() => { if (!existing && prefs.data) setOffsets(prefs.data); }, [prefs.data, existing]);

  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const picker = useQuery({
    queryKey: ["entity-picker", kind, debounced], enabled: !fixed && !existing,
    queryFn: async () => {
      const q = supabase.from(kind === "lead" ? "leads" : "clients").select(kind === "lead" ? "id,full_name,company" : "id,name").limit(30);
      const { data } = debounced
        ? await q.ilike(kind === "lead" ? "full_name" : "name", `%${debounced.replace(/[%,]/g, "")}%`)
        : await q.order("created_at", { ascending: false });
      return (data ?? []) as unknown as { id: string; full_name?: string; company?: string; name?: string }[];
    },
  });
  const team = useQuery({
    queryKey: ["assignable-users"], enabled: can("followups.view_all"),
    queryFn: async () => (await supabase.from("profiles").select("id,full_name,role").eq("is_active", true).order("full_name")).data ?? [],
  });

  const toggle = (v: number) => setOffsets((o) => (o.includes(v) ? o.filter((x) => x !== v) : [...o, v]));
  const busy = create.isPending || resched.isPending;

  async function submit() {
    setErr(null);
    if (!existing && !entityId) return setErr("Choose the lead or client this follow-up is about.");
    if (!existing && !title.trim()) return setErr("Add a title so you know what to do when it is due.");
    if (!date || !time) return setErr("Pick a date and time.");
    try {
      if (existing) {
        await resched.mutateAsync({ id: existing.id, date, time, timezone: tz, offsets, reason: reason.trim() || null });
        toast("Follow-up rescheduled. Old reminders were cancelled.");
      } else {
        await create.mutateAsync({
          lead_id: kind === "lead" ? entityId : null, client_id: kind === "client" ? entityId : null, title: title.trim(),
          type, date, time, timezone: tz, assigned_to: assignee, notes: notes.trim() || null, priority, offsets,
        });
        toast("Follow-up scheduled.");
      }
      onClose();
    } catch (e) { setErr(errMsg(e)); }
  }

  return (
    <Modal title={existing ? "Reschedule follow-up" : "Schedule follow-up"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : existing ? "Save new time" : "Schedule follow-up"}</Button></>}>
      {existing && <p className="muted"><strong>{existing.title}</strong> — {existing.entity_name}</p>}
      {!existing && (fixed ? <p className="muted">For {fixed.type}: <strong>{fixed.name}</strong></p> : (
        <div className="stack">
          <div className="seg" role="group" aria-label="Related to">
            {(["lead", "client"] as const).map((k) => <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setEntityId(""); }}>{label(k)}</button>)}
          </div>
          <Field label={`Search ${kind}s`}>{(id) => <input id={id} className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a name" />}</Field>
          <Field label={`Select ${kind}`}>{(id) => (
            <select id={id} className="select" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">{picker.isLoading ? "Loading…" : `Choose a ${kind}`}</option>
              {picker.data?.map((r) => <option key={r.id} value={r.id}>{r.full_name ?? r.name}{r.company ? ` · ${r.company}` : ""}</option>)}
            </select>)}
          </Field>
        </div>))}
      <div className="form-grid">
        {!existing && <Field label="Title" className="span-2">{(id) => <input id={id} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call about the website proposal" maxLength={200} />}</Field>}
        {!existing && <Field label="Type">{(id) => <select id={id} className="select" value={type} onChange={(e) => setType(e.target.value as typeof type)}>{FOLLOW_UP_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>}</Field>}
        {!existing && <Field label="Priority">{(id) => <select id={id} className="select" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>{PRIORITIES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>}</Field>}
        <Field label="Date">{(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Time" hint={`Your timezone: ${tz}`}>{(id) => <input id={id} type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        {!existing && can("followups.view_all") && (
          <Field label="Assigned to" className="span-2">{(id) => (
            <select id={id} className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {team.data?.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>)}
          </Field>)}
      </div>
      <div className="field"><span className="label">Remind me</span>
        <div className="chips" role="group" aria-label="Reminder timing">
          {REMINDER_OPTIONS.map((o) => (
            <label key={o.value} className="chip-toggle"><input type="checkbox" checked={offsets.includes(o.value)} onChange={() => toggle(o.value)} /><span>{o.label}</span></label>))}
        </div>
        <span className="hint">You also get an overdue alert if it is still open after the grace period.</span>
      </div>
      {existing
        ? <Field label="Reason (optional)">{(id) => <input id={id} className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
        : <Field label="Notes">{(id) => <textarea id={id} className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />}</Field>}
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}
