import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, Field, ListSkeleton, Modal, Pager, errMsg, useToast } from "@/components/ui";
import type { Client } from "@/lib/types";
import { useOwners } from "@/features/leads/LeadsPage";

const PAGE = 25;

export function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const { profile, can } = useAuth();
  const toast = useToast(); const qc = useQueryClient(); const owners = useOwners();
  const [f, setF] = useState({ name: client?.name ?? "", contact_name: client?.contact_name ?? "", email: client?.email ?? "", phone: client?.phone ?? "", website: client?.website ?? "", industry: client?.industry ?? "", country: client?.country ?? "", notes: client?.notes ?? "", owner_id: client?.owner_id ?? profile!.id, is_active: client?.is_active ?? true });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: async () => {
      const row = { ...f, contact_name: f.contact_name || null, email: f.email || null, phone: f.phone || null, website: f.website || null, industry: f.industry || null, country: f.country || null, notes: f.notes || null };
      const { error } = client ? await supabase.from("clients").update(row).eq("id", client.id) : await supabase.from("clients").insert(row);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["clients"] }); void qc.invalidateQueries({ queryKey: ["entity"] }); toast(client ? "Client updated." : "Client created."); onClose(); },
    onError: (e) => toast(errMsg(e), "error"),
  });
  const submit = () => { if (!f.name.trim()) return setErr("Client name is required."); if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return setErr("Enter a valid email."); setErr(null); save.mutate(); };
  const inp = (k: keyof typeof f, lab: string, type = "text", span = false) => <Field label={lab} className={span ? "span-2" : ""}>{(id) => <input id={id} type={type} className="input" value={String(f[k])} onChange={(e) => set(k, e.target.value)} />}</Field>;
  return (
    <Modal title={client ? "Edit client" : "New client"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={submit}>{save.isPending ? "Saving…" : "Save client"}</Button></>}>
      <div className="form-grid">
        {inp("name", "Client / company name *", "text", true)}{inp("contact_name", "Primary contact")}{inp("industry", "Industry")}
        {inp("email", "Email", "email")}{inp("phone", "Phone", "tel")}{inp("website", "Website")}{inp("country", "Country")}
        <Field label="Account owner">{(id) => <select id={id} className="select" value={f.owner_id ?? ""} disabled={!can("clients.manage_all")} onChange={(e) => set("owner_id", e.target.value)}>{owners.data?.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}</select>}</Field>
        <Field label="Status">{(id) => <select id={id} className="select" value={f.is_active ? "1" : "0"} onChange={(e) => set("is_active", e.target.value === "1")}><option value="1">Active</option><option value="0">Inactive</option></select>}</Field>
        <Field label="Notes" className="span-2">{(id) => <textarea id={id} className="textarea" value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

export function ClientsPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState(""); const [q, setQ] = useState(""); const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);
  const list = useQuery({
    queryKey: ["clients", q, page], placeholderData: (p) => p,
    queryFn: async () => {
      let r = supabase.from("clients").select("*", { count: "exact" }).order("name").range(page * PAGE, page * PAGE + PAGE - 1);
      if (q) { const s = q.replace(/[%,()]/g, ""); r = r.or(`name.ilike.%${s}%,contact_name.ilike.%${s}%,email.ilike.%${s}%`); }
      const { data, count, error } = await r; if (error) throw error;
      return { rows: data as Client[], total: count ?? 0 };
    },
  });
  return (
    <div className="page">
      <div className="page-head"><div><h1>Clients</h1><p>Client directory and relationship history.</p></div>
        {can("clients.write") && <div className="page-actions"><Button variant="primary" onClick={() => setEditing("new")}><Plus size={18} />New client</Button></div>}</div>
      <div className="glass">
        <div className="card" style={{ paddingBottom: 0 }}><div className="toolbar"><div style={{ position: "relative", flex: "2 1 220px", maxWidth: 360 }}><Search size={16} style={{ position: "absolute", left: 12, top: 13 }} aria-hidden />
          <input className="input" style={{ paddingLeft: 36, maxWidth: "none" }} aria-label="Search clients" placeholder="Search name, contact, email" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div></div>
        {list.isLoading ? <div className="card"><ListSkeleton /></div> : list.error ? <p className="error-text card" role="alert">Could not load clients.</p>
          : !list.data?.rows.length ? <Empty icon={<Users size={32} />} title="No clients found">{q ? "Try a different search." : "Convert a lead or add a client."}</Empty>
          : <><div className="table-wrap"><table className="table"><thead><tr><th>Client</th><th>Contact</th><th>Email / phone</th><th>Status</th><th></th></tr></thead>
            <tbody>{list.data.rows.map((c) => (<tr key={c.id}>
              <td className="cell-main"><Link className="cell-strong" to={`/clients/${c.id}`}>{c.name}</Link><div className="cell-sub">{c.industry ?? "—"}</div></td>
              <td data-label="Contact">{c.contact_name ?? "—"}</td><td data-label="Email / phone">{c.email ?? c.phone ?? "—"}</td>
              <td data-label="Status"><Badge tone={c.is_active ? "ok" : undefined}>{c.is_active ? "Active" : "Inactive"}</Badge></td>
              <td className="cell-actions">{can("clients.write") && <Button size="sm" onClick={() => setEditing(c)}>Edit</Button>}</td></tr>))}</tbody></table></div>
            <Pager page={page} pageSize={PAGE} total={list.data.total} onPage={setPage} /></>}
      </div>
      {editing && <ClientForm client={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
