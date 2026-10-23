import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, UserPlus } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, Field, ListSkeleton, Modal, Pager, errMsg, useToast } from "@/components/ui";
import { LEAD_SOURCES, LEAD_STATUSES, label, type Lead, type LeadSource, type LeadStatus } from "@/lib/types";

const PAGE = 25;
export const statusTone = (s: LeadStatus) => (s === "converted" || s === "qualified" ? "ok" : s === "lost" || s === "archived" ? undefined : s === "no_response" ? "warn" : "brand") as "ok" | "warn" | "brand" | undefined;

const schema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(160),
  company: z.string().trim().max(200).optional(),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  phone: z.string().trim().max(40).optional(),
  linkedin_url: z.string().trim().max(400).optional(),
  notes: z.string().max(10000).optional(),
});

export function useOwners() {
  return useQuery({ queryKey: ["owners"], staleTime: 60_000, queryFn: async () => (await supabase.from("profiles").select("id,full_name,role").eq("is_active", true).order("full_name")).data ?? [] });
}

export function LeadForm({ lead, onClose }: { lead?: Lead; onClose: () => void }) {
  const { profile, can } = useAuth();
  const toast = useToast(); const qc = useQueryClient();
  const owners = useOwners();
  const [f, setF] = useState({
    full_name: lead?.full_name ?? "", company: lead?.company ?? "", job_title: lead?.job_title ?? "", email: lead?.email ?? "", phone: lead?.phone ?? "",
    linkedin_url: lead?.linkedin_url ?? "", country: lead?.country ?? "", source: (lead?.source ?? "linkedin") as LeadSource,
    status: (lead?.status ?? "new") as LeadStatus, temperature: lead?.temperature ?? "cold", owner_id: lead?.owner_id ?? profile!.id, notes: lead?.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const row = { ...f, company: f.company || null, job_title: f.job_title || null, email: f.email || null, phone: f.phone || null, linkedin_url: f.linkedin_url || null, country: f.country || null, notes: f.notes || null };
      const { error } = lead ? await supabase.from("leads").update(row).eq("id", lead.id) : await supabase.from("leads").insert(row);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["leads"] }); void qc.invalidateQueries({ queryKey: ["entity"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] }); toast(lead ? "Lead updated." : "Lead created."); onClose(); },
    onError: (e) => toast(errMsg(e), "error"),
  });

  function submit() {
    const r = schema.safeParse(f);
    if (!r.success) { setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]))); return; }
    setErrors({}); save.mutate();
  }
  const text = (k: keyof typeof f, lab: string, extra: { type?: string; span?: boolean } = {}) => (
    <Field label={lab} error={errors[k]} className={extra.span ? "span-2" : ""}>{(id) => <input id={id} type={extra.type ?? "text"} className="input" value={String(f[k])} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} />}</Field>);

  return (
    <Modal title={lead ? "Edit lead" : "New lead"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={submit}>{save.isPending ? "Saving…" : "Save lead"}</Button></>}>
      <div className="form-grid">
        {text("full_name", "Full name *")}{text("company", "Company")}{text("job_title", "Job title")}{text("country", "Country")}
        {text("email", "Email", { type: "email" })}{text("phone", "Phone", { type: "tel" })}{text("linkedin_url", "LinkedIn / profile URL", { span: true })}
        <Field label="Source">{(id) => <select id={id} className="select" value={f.source} onChange={(e) => set("source", e.target.value as LeadSource)}>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>}</Field>
        <Field label="Status">{(id) => <select id={id} className="select" value={f.status} onChange={(e) => set("status", e.target.value as LeadStatus)}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>}</Field>
        <Field label="Temperature">{(id) => <select id={id} className="select" value={f.temperature} onChange={(e) => set("temperature", e.target.value as "cold")}>{["cold", "warm", "hot"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>}</Field>
        <Field label="Assigned to">{(id) => <select id={id} className="select" value={f.owner_id ?? ""} disabled={!can("leads.view_all")} onChange={(e) => set("owner_id", e.target.value)}>{owners.data?.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}</select>}</Field>
        <Field label="Notes" className="span-2">{(id) => <textarea id={id} className="textarea" value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

export function LeadsPage() {
  const { can, profile } = useAuth();
  const [search, setSearch] = useState(""); const [q, setQ] = useState("");
  const [status, setStatus] = useState(""); const [source, setSource] = useState(""); const [owner, setOwner] = useState("");
  const [page, setPage] = useState(0); const [editing, setEditing] = useState<Lead | "new" | null>(null);
  const owners = useOwners();
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);

  const list = useQuery({
    queryKey: ["leads", q, status, source, owner, page], placeholderData: (p) => p,
    queryFn: async () => {
      let r = supabase.from("leads").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (q) { const s = q.replace(/[%,()]/g, ""); r = r.or(`full_name.ilike.%${s}%,company.ilike.%${s}%,email.ilike.%${s}%`); }
      if (status) r = r.eq("status", status); if (source) r = r.eq("source", source); if (owner) r = r.eq("owner_id", owner);
      const { data, count, error } = await r; if (error) throw error;
      return { rows: data as Lead[], total: count ?? 0 };
    },
  });
  const ownerName = (id: string | null) => owners.data?.find((o) => o.id === id)?.full_name ?? "—";

  return (
    <div className="page">
      <div className="page-head"><div><h1>Leads</h1><p>{can("leads.view_all") ? "All leads you are authorised to see." : "Leads assigned to you."}</p></div>
        {can("leads.create") && <div className="page-actions"><Button variant="primary" onClick={() => setEditing("new")}><Plus size={18} />New lead</Button></div>}</div>
      <div className="glass">
        <div className="card" style={{ paddingBottom: 0 }}>
          <div className="toolbar">
            <div style={{ position: "relative", flex: "2 1 220px", maxWidth: 360 }}><Search size={16} style={{ position: "absolute", left: 12, top: 13 }} aria-hidden />
              <input className="input" style={{ paddingLeft: 36, maxWidth: "none" }} aria-label="Search leads" placeholder="Search name, company, email" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select className="select" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            <select className="select" aria-label="Source" value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}><option value="">All sources</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            {can("leads.view_all") && <select className="select" aria-label="Owner" value={owner} onChange={(e) => { setOwner(e.target.value); setPage(0); }}><option value="">All owners</option>{owners.data?.map((o) => <option key={o.id} value={o.id}>{o.full_name}{o.id === profile!.id ? " (me)" : ""}</option>)}</select>}
          </div>
        </div>
        {list.isLoading ? <div className="card"><ListSkeleton /></div> : list.error ? <p className="error-text card" role="alert">Could not load leads.</p>
          : !list.data?.rows.length ? <Empty icon={<UserPlus size={32} />} title="No leads found">{q || status || source || owner ? "Try clearing the filters." : "Create your first lead to get started."}</Empty>
          : <>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Lead</th><th>Status</th><th>Source</th><th>Owner</th><th>Contact</th><th></th></tr></thead>
              <tbody>{list.data.rows.map((l) => (
                <tr key={l.id}>
                  <td className="cell-main"><Link className="cell-strong" to={`/leads/${l.id}`}>{l.full_name}</Link><div className="cell-sub">{[l.job_title, l.company].filter(Boolean).join(" · ") || "—"}</div></td>
                  <td data-label="Status"><Badge tone={statusTone(l.status)}>{label(l.status)}</Badge></td>
                  <td data-label="Source">{label(l.source)}</td><td data-label="Owner">{ownerName(l.owner_id)}</td>
                  <td data-label="Contact">{l.email ?? l.phone ?? "—"}</td>
                  <td className="cell-actions"><Button size="sm" onClick={() => setEditing(l)}>Edit</Button></td>
                </tr>))}</tbody></table></div>
            <Pager page={page} pageSize={PAGE} total={list.data.total} onPage={setPage} /></>}
      </div>
      {editing && <LeadForm lead={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
