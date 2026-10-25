import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, ExternalLink, Mail, MessageSquare, NotebookPen, Pencil, Phone, Trash2, Video, Users, X } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Modal, errMsg, useToast } from "@/components/ui";
import { bucketOf, formatInTz, relative } from "@/lib/time";
import { label, type FollowUp } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/extra";
import { useQueryClient } from "@tanstack/react-query";
import { FollowUpForm } from "./FollowUpForm";
import { useAddFollowUpNote, useCancel, useComplete } from "./api";

const ICON = { call: Phone, email: Mail, meeting: Video, message: MessageSquare, whatsapp: MessageSquare, linkedin: Users, other: Clock } as const;

export function FollowUpItem({ f, showEntity = true }: { f: FollowUp; showEntity?: boolean }) {
  const { profile } = useAuth();
  const toast = useToast();
  const tz = profile!.timezone;
  const [mode, setMode] = useState<null | "edit" | "complete" | "note" | "cancel">(null);
  const [text, setText] = useState("");
  const complete = useComplete(), cancel = useCancel(), note = useAddFollowUpNote();
  const confirm = useConfirm(); const qc = useQueryClient();
  const remove = async () => {
    if (!(await confirm({ title: "Delete this follow-up?", body: "It and its reminders are removed permanently.", danger: true, confirmLabel: "Delete" }))) return;
    const { error } = await supabase.rpc("delete_follow_up", { p_id: f.id });
    if (error) return toast(errMsg(error), "error");
    toast("Follow-up deleted."); void qc.invalidateQueries({ queryKey: ["follow-ups"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const bucket = bucketOf(f, tz);
  const Icon = ICON[f.follow_up_type] ?? Clock;
  const state = bucket === "overdue" ? "overdue" : bucket === "due_soon" ? "due-soon" : bucket === "today" ? "today"
    : bucket === "completed" || bucket === "cancelled" ? "done" : "";
  const open = f.status === "pending";
  const link = `/${f.entity_type === "lead" ? "leads" : "clients"}/${f.entity_id}?followup=${f.id}`;
  const close = () => { setMode(null); setText(""); };

  async function run(kind: "complete" | "note" | "cancel") {
    try {
      if (kind === "complete") await complete.mutateAsync({ id: f.id, note: text.trim() || null });
      if (kind === "cancel") await cancel.mutateAsync({ id: f.id, reason: text.trim() || null });
      if (kind === "note") await note.mutateAsync({ id: f.id, text: text.trim() });
      toast(kind === "complete" ? "Follow-up completed." : kind === "cancel" ? "Follow-up cancelled." : "Note added.");
      close();
    } catch (e) { toast(errMsg(e), "error"); }
  }
  const busy = complete.isPending || cancel.isPending || note.isPending;

  return (
    <div className="fu" data-state={state} id={`fu-${f.id}`}>
      <div className="fu-icon" aria-hidden><Icon size={18} /></div>
      <div>
        <div className="fu-title">{f.title}</div>
        <div className="fu-meta">
          {showEntity && <span>{f.entity_name ?? "Record"}</span>}
          <span>{formatInTz(f.due_at, tz)}</span>
          {open && <span>{relative(f.due_at)}</span>}
          <span>{label(f.follow_up_type)}</span>
          {f.assigned_to !== profile!.id && f.assigned_to_name && <span>→ {f.assigned_to_name}</span>}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {bucket === "overdue" && <Badge tone="danger">Overdue</Badge>}
          {bucket === "due_soon" && <Badge tone="warn">Due soon</Badge>}
          {bucket === "today" && <Badge tone="brand">Today</Badge>}
          {bucket === "completed" && <Badge tone="ok">Completed</Badge>}
          {bucket === "cancelled" && <Badge>Cancelled</Badge>}
          {(f.priority === "high" || f.priority === "urgent") && open && <Badge tone="warn">{label(f.priority)}</Badge>}
        </div>
      </div>
      <div className="fu-actions">
        {open && <Button size="sm" variant="primary" onClick={() => setMode("complete")}><Check size={15} />Complete</Button>}
        {open && <Button size="sm" onClick={() => setMode("edit")}><Pencil size={15} />Reschedule</Button>}
        <Button size="sm" onClick={() => setMode("note")}><NotebookPen size={15} />Note</Button>
        <Link className="btn btn-sm" to={link}><ExternalLink size={15} />Open</Link>
        {open && <Button size="sm" variant="ghost" aria-label="Cancel follow-up" onClick={() => setMode("cancel")}><X size={15} /></Button>}
        <Button size="sm" variant="ghost" aria-label="Delete follow-up" onClick={() => void remove()}><Trash2 size={15} /></Button>
      </div>

      {mode === "edit" && <FollowUpForm existing={f} onClose={close} />}
      {mode && mode !== "edit" && (
        <Modal title={mode === "complete" ? "Complete follow-up" : mode === "cancel" ? "Cancel follow-up" : "Add a note"} onClose={close}
          footer={<><Button onClick={close}>Back</Button>
            <Button variant={mode === "cancel" ? "danger" : "primary"} disabled={busy || (mode === "note" && !text.trim())} onClick={() => run(mode)}>
              {mode === "complete" ? "Mark complete" : mode === "cancel" ? "Cancel follow-up" : "Save note"}</Button></>}>
          <p className="muted"><strong>{f.title}</strong></p>
          <div className="field">
            <label htmlFor={`n-${f.id}`}>{mode === "note" ? "Note" : mode === "cancel" ? "Reason (optional)" : "Outcome (optional)"}</label>
            <textarea id={`n-${f.id}`} data-autofocus className="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
          </div>
          {mode === "cancel" && <p className="hint">Cancelling stops all future reminders. History is kept.</p>}
        </Modal>)}
    </div>
  );
}
