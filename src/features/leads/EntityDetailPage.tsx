import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarPlus, Pencil, UserCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, ListSkeleton, Skeleton, errMsg, useToast } from "@/components/ui";
import { formatInTz } from "@/lib/time";
import { LEAD_STATUSES, label, type Activity, type Client, type Lead, type LeadStatus } from "@/lib/types";
import { FollowUpForm } from "@/features/followups/FollowUpForm";
import { FollowUpItem } from "@/features/followups/FollowUpItem";
import { useEntityFollowUps } from "@/features/followups/api";
import { LeadForm, statusTone, useOwners } from "./LeadsPage";
import { ClientForm } from "@/features/clients/ClientsPage";

/** One page for both leads and clients: details, notes, activity timeline, follow-ups. */
export function EntityDetailPage({ type }: { type: "lead" | "client" }) {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { profile, can } = useAuth();
  const tz = profile!.timezone;
  const toast = useToast(); const qc = useQueryClient(); const nav = useNavigate();
  const owners = useOwners();
  const [editing, setEditing] = useState(false); const [scheduling, setScheduling] = useState(false);
  const [note, setNote] = useState("");

  const ent = useQuery({
    queryKey: ["entity", type, id],
    queryFn: async () => { const { data, error } = await supabase.from(type === "lead" ? "leads" : "clients").select("*").eq("id", id).maybeSingle(); if (error) throw error; return data as Lead | Client | null; },
  });
  const acts = useQuery({
    queryKey: ["activities", type, id],
    queryFn: async () => (await supabase.from("activities").select("id,kind,summary,created_at,actor_id,metadata").eq("entity_type", type).eq("entity_id", id).order("created_at", { ascending: false }).limit(100)).data as Activity[] ?? [],
  });
  const fus = useEntityFollowUps(type, id);

  const highlight = params.get("followup");
  useEffect(() => { if (highlight && fus.data) document.getElementById(`fu-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [highlight, fus.data]);

  const addNote = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("add_note", { p_entity_type: type, p_entity_id: id, p_text: note.trim() }); if (error) throw error; },
    onSuccess: () => { setNote(""); void qc.invalidateQueries({ queryKey: ["activities"] }); toast("Note added."); }, onError: (e) => toast(errMsg(e), "error"),
  });
  const setStatus = useMutation({
    mutationFn: async (s: LeadStatus) => { const { error } = await supabase.from("leads").update({ status: s }).eq("id", id); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["entity"] }); void qc.invalidateQueries({ queryKey: ["activities"] }); void qc.invalidateQueries({ queryKey: ["leads"] }); }, onError: (e) => toast(errMsg(e), "error"),
  });
  const convert = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc("convert_lead_to_client", { p_lead_id: id }); if (error) throw error; return data as string; },
    onSuccess: (cid) => { toast("Lead converted to client."); void qc.invalidateQueries(); nav(`/clients/${cid}`); }, onError: (e) => toast(errMsg(e), "error"),
  });

  if (ent.isLoading) return <div className="page"><Skeleton h={40} w="50%" /><ListSkeleton /></div>;
  if (!ent.data) return <div className="page"><div className="glass card"><Empty title="Not found">This record does not exist or you do not have access to it.</Empty><p style={{ textAlign: "center" }}><Link to={type === "lead" ? "/leads" : "/clients"}>Back to list</Link></p></div></div>;

  const e = ent.data; const isLead = type === "lead"; const lead = e as Lead; const client = e as Client;
  const name = isLead ? lead.full_name : client.name;
  const ownerName = owners.data?.find((o) => o.id === e.owner_id)?.full_name ?? "—";
  const rows: [string, string | null | undefined][] = isLead
    ? [["Company", lead.company], ["Job title", lead.job_title], ["Email", lead.email], ["Phone", lead.phone], ["LinkedIn", lead.linkedin_url], ["Country", lead.country], ["Source", label(lead.source)], ["Owner", ownerName]]
    : [["Contact", client.contact_name], ["Email", client.email], ["Phone", client.phone], ["Website", client.website], ["Industry", client.industry], ["Country", client.country], ["Owner", ownerName]];
  const canEdit = isLead ? can("leads.create") : can("clients.write");

  return (
    <div className="page">
      <div className="page-head">
        <div><Link to={isLead ? "/leads" : "/clients"} className="row" style={{ gap: 6, marginBottom: 8 }}><ArrowLeft size={16} />{isLead ? "Leads" : "Clients"}</Link>
          <h1>{name}</h1>
          <div className="row" style={{ marginTop: 8 }}>{isLead ? <Badge tone={statusTone(lead.status)}>{label(lead.status)}</Badge> : <Badge tone={client.is_active ? "ok" : undefined}>{client.is_active ? "Active" : "Inactive"}</Badge>}
            {isLead && <Badge>{label(lead.temperature)}</Badge>}</div></div>
        <div className="page-actions">
          {can("followups.create") && <Button variant="primary" onClick={() => setScheduling(true)}><CalendarPlus size={18} />Schedule follow-up</Button>}
          {canEdit && <Button onClick={() => setEditing(true)}><Pencil size={16} />Edit</Button>}
          {isLead && can("clients.write") && !lead.converted_client_id && lead.status !== "converted" && <Button disabled={convert.isPending} onClick={() => { if (confirm("Convert this lead into a client?")) convert.mutate(); }}><UserCheck size={16} />Convert to client</Button>}
          {isLead && lead.converted_client_id && <Link className="btn" to={`/clients/${lead.converted_client_id}`}>View client</Link>}
        </div>
      </div>

      <div className="grid cols-3-2">
        <div className="grid">
          <section className="glass card"><div className="card-head"><h2>Follow-ups</h2></div>
            {fus.isLoading ? <ListSkeleton /> : !fus.data?.length ? <Empty title="No follow-ups yet">Schedule one so the right person is reminded automatically.</Empty>
              : <div className="fu-list">{fus.data.map((f) => <FollowUpItem key={f.id} f={f} showEntity={false} />)}</div>}
          </section>
          <section className="glass card"><div className="card-head"><h2>Activity &amp; notes</h2></div>
            <div className="stack" style={{ marginBottom: 16 }}>
              <textarea className="textarea" aria-label="Add a note" placeholder="Add a note about a call, message or decision…" value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={5000} />
              <div><Button variant="primary" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>Add note</Button></div></div>
            {acts.isLoading ? <ListSkeleton /> : !acts.data?.length ? <Empty title="No activity yet" />
              : <div className="timeline">{acts.data.map((a) => (<div className="tl-item" key={a.id}><span className="tl-dot" /><div><div style={{ whiteSpace: "pre-wrap" }}>{a.summary}</div>
                <div className="tl-meta">{label(a.kind)} · {formatInTz(a.created_at, tz)}</div></div></div>))}</div>}
          </section>
        </div>
        <div className="grid" style={{ alignContent: "start" }}>
          <section className="glass card"><div className="card-head"><h2>Details</h2></div>
            <dl className="kv">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            {isLead && canEdit && lead.status !== "converted" && (<div className="field" style={{ marginTop: 16 }}><label htmlFor="qs">Change status</label>
              <select id="qs" className="select" value={lead.status} onChange={(ev) => setStatus.mutate(ev.target.value as LeadStatus)}>{LEAD_STATUSES.filter((s) => s !== "converted").map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>)}
            {(isLead ? lead.notes : client.notes) && <><h3 style={{ marginTop: 16 }}>Profile notes</h3><p className="muted" style={{ whiteSpace: "pre-wrap" }}>{isLead ? lead.notes : client.notes}</p></>}
          </section>
        </div>
      </div>
      {scheduling && <FollowUpForm fixed={{ type, id, name }} onClose={() => setScheduling(false)} />}
      {editing && (isLead ? <LeadForm lead={lead} onClose={() => setEditing(false)} /> : <ClientForm client={client} onClose={() => setEditing(false)} />)}
    </div>
  );
}
