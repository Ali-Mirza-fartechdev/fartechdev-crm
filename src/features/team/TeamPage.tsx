import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, UserCheck, UserX } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, Field, ListSkeleton, Modal, errMsg, useToast } from "@/components/ui";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/types";
import { passwordProblem } from "@/features/auth/ForcePasswordChange";

type Row = { id: string; username: string; full_name: string; role: Role; is_active: boolean; timezone: string };

async function admin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    let msg = "Request failed";
    try { const r = (error as { context?: Response }).context; if (r) msg = (await r.json()).error ?? msg; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  return data as T;
}

function Secret({ title, username, password, onClose }: { title: string; username?: string; password: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal title={title} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>I have saved it</Button>}>
      <p className="muted">Share this temporary password with the user through a private channel. It is shown <strong>once</strong>, is not stored anywhere, and must be changed at first sign-in.</p>
      {username && <p>Username: <strong className="mono">{username}</strong></p>}
      <div className="row"><code className="mono glass" style={{ padding: "10px 14px", fontSize: "1rem" }}>{password}</code>
        <Button size="sm" onClick={() => { void navigator.clipboard.writeText(password); toast("Copied."); }}><Copy size={14} />Copy</Button></div>
    </Modal>
  );
}

export function TeamPage() {
  const { can, profile } = useAuth();
  const manage = can("users.manage");
  const toast = useToast(); const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ title: string; username?: string; password: string } | null>(null);
  const list = useQuery({ queryKey: ["team"], queryFn: async () => (await supabase.from("profiles").select("id,username,full_name,role,is_active,timezone").order("full_name")).data as Row[] ?? [] });
  const refresh = () => qc.invalidateQueries({ queryKey: ["team"] });

  const act = useMutation({
    mutationFn: async (a: { kind: "reset" | "active" | "role"; row: Row; value?: unknown }) => {
      if (a.kind === "reset") { const r = await admin<{ temporary_password?: string }>({ action: "reset_password", user_id: a.row.id }); setSecret({ title: `Password reset for ${a.row.full_name}`, password: r.temporary_password ?? "" }); }
      if (a.kind === "active") { await admin({ action: "set_active", user_id: a.row.id, active: a.value }); toast(a.value ? "Account activated." : "Account deactivated."); }
      if (a.kind === "role") { await admin({ action: "set_role", user_id: a.row.id, role: a.value }); toast("Role updated."); }
    },
    onSuccess: refresh, onError: (e) => toast(errMsg(e), "error"),
  });

  return (
    <div className="page">
      <div className="page-head"><div><h1>Team</h1><p>{manage ? "Create accounts, assign roles and reset passwords." : "Your colleagues and their roles."}</p></div>
        {manage && <div className="page-actions"><Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} />Add user</Button></div>}</div>
      <div className="glass">
        {list.isLoading ? <div className="card"><ListSkeleton /></div> : !list.data?.length ? <Empty title="No users" />
          : <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th>{manage && <th></th>}</tr></thead>
            <tbody>{list.data.map((u) => (<tr key={u.id}>
              <td className="cell-main"><span className="cell-strong">{u.full_name}</span>{u.id === profile!.id && <> <Badge tone="brand">You</Badge></>}</td>
              <td data-label="Username" className="mono">{u.username}</td>
              <td data-label="Role">{manage && u.id !== profile!.id
                ? <select className="select" style={{ minWidth: 170 }} aria-label={`Role for ${u.full_name}`} value={u.role} onChange={(e) => act.mutate({ kind: "role", row: u, value: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                : ROLE_LABEL[u.role]}</td>
              <td data-label="Status"><Badge tone={u.is_active ? "ok" : "danger"}>{u.is_active ? "Active" : "Deactivated"}</Badge></td>
              {manage && <td className="cell-actions"><div className="row" style={{ justifyContent: "flex-end" }}>
                <Button size="sm" onClick={() => { if (confirm(`Reset the password for ${u.full_name}?`)) act.mutate({ kind: "reset", row: u }); }}><KeyRound size={14} />Reset password</Button>
                {u.id !== profile!.id && <Button size="sm" variant={u.is_active ? "danger" : "default"} onClick={() => act.mutate({ kind: "active", row: u, value: !u.is_active })}>{u.is_active ? <><UserX size={14} />Deactivate</> : <><UserCheck size={14} />Activate</>}</Button>}</div></td>}
            </tr>))}</tbody></table></div>}
      </div>
      {creating && <CreateUser onClose={() => setCreating(false)} onCreated={(s) => { setCreating(false); void refresh(); setSecret(s); }} />}
      {secret && <Secret {...secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

function CreateUser({ onClose, onCreated }: { onClose: () => void; onCreated: (s: { title: string; username: string; password: string }) => void }) {
  const [f, setF] = useState({ username: "", full_name: "", role: "sales_executive" as Role, timezone: "Asia/Karachi", password: "" });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit() {
    setErr(null);
    if (!/^[a-z0-9._-]{3,32}$/.test(f.username)) return setErr("Username: 3–32 characters, a–z 0–9 . _ -");
    if (!f.full_name.trim()) return setErr("Full name is required.");
    if (f.password && passwordProblem(f.password)) return setErr(passwordProblem(f.password));
    setBusy(true);
    try {
      const r = await admin<{ username: string; temporary_password?: string }>({ action: "create_user", username: f.username, full_name: f.full_name, role: f.role, timezone: f.timezone, password: f.password || undefined });
      onCreated({ title: "Account created", username: r.username, password: r.temporary_password ?? f.password });
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  }
  return (
    <Modal title="Add user" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create account"}</Button></>}>
      <div className="form-grid">
        <Field label="Full name *">{(id) => <input id={id} className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />}</Field>
        <Field label="Username *" hint="Lower-case letters, digits, . _ -">{(id) => <input id={id} className="input" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} />}</Field>
        <Field label="Role *">{(id) => <select id={id} className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>}</Field>
        <Field label="Timezone">{(id) => <input id={id} className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />}</Field>
        <Field label="Temporary password" hint="Leave blank to generate a strong one." className="span-2">{(id) => <input id={id} type="text" className="input" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}
