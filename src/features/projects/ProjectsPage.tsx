import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FolderKanban, Pencil, Plus, Trash2, UserMinus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, Field, ListSkeleton, Modal, errMsg, useToast } from "@/components/ui";
import { useConfirm } from "@/components/extra";
import { useTeam } from "@/lib/data";
import { PRIORITIES, TASK_STATUSES, label, type Project, type Task, type TaskStatus } from "@/lib/types";

const pTone = (s: Project["status"]) => (s === "active" ? "brand" : s === "completed" ? "ok" : s === "on_hold" ? "warn" : s === "cancelled" ? "danger" : undefined) as "brand" | "ok" | "warn" | "danger" | undefined;
export const taskTone = (s: TaskStatus) => (s === "done" ? "ok" : s === "blocked" ? "danger" : s === "in_progress" ? "brand" : s === "in_review" ? "warn" : undefined) as "ok" | "danger" | "brand" | "warn" | undefined;
const today = () => new Date().toISOString().slice(0, 10);

export function useProjects() {
  return useQuery({ queryKey: ["projects"], refetchInterval: 60_000, queryFn: async () => {
    const [p, t] = await Promise.all([supabase.from("projects").select("*").order("created_at", { ascending: false }), supabase.from("tasks").select("id,project_id,status,due_date").limit(5000)]);
    if (p.error) throw p.error;
    const stats = new Map<string, { total: number; done: number; overdue: number }>();
    for (const x of t.data ?? []) { const s = stats.get(x.project_id as string) ?? { total: 0, done: 0, overdue: 0 }; if (x.status !== "cancelled") { s.total++; if (x.status === "done") s.done++; else if (x.due_date && (x.due_date as string) < today()) s.overdue++; } stats.set(x.project_id as string, s); }
    return { projects: (p.data ?? []) as Project[], stats };
  } });
}

function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient(); const team = useTeam();
  const clients = useQuery({ queryKey: ["clients-pick"], queryFn: async () => (await supabase.from("clients").select("id,name").order("name").limit(500)).data ?? [] });
  const members = useQuery({ queryKey: ["members", project?.id], enabled: !!project, queryFn: async () => ((await supabase.from("project_members").select("user_id").eq("project_id", project!.id)).data ?? []).map((m) => m.user_id as string) });
  const [f, setF] = useState({ name: project?.name ?? "", description: project?.description ?? "", client_id: project?.client_id ?? "", status: project?.status ?? "planning", project_manager_id: project?.project_manager_id ?? "", team_lead_id: project?.team_lead_id ?? "", start_date: project?.start_date ?? "", due_date: project?.due_date ?? "" });
  const [picked, setPicked] = useState<string[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const sel = picked ?? members.data ?? [];
  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error("Project name is required.");
      const row = { name: f.name.trim(), description: f.description.trim() || null, client_id: f.client_id || null, status: f.status, project_manager_id: f.project_manager_id || null, team_lead_id: f.team_lead_id || null, start_date: f.start_date || null, due_date: f.due_date || null };
      let id = project?.id;
      if (id) { const { error } = await supabase.from("projects").update(row).eq("id", id); if (error) throw error; }
      else { const { data, error } = await supabase.from("projects").insert(row).select("id").single(); if (error) throw error; id = data.id as string; }
      const cur = new Set(members.data ?? []); const want = new Set(sel);
      const add = [...want].filter((u) => !cur.has(u)); const rem = [...cur].filter((u) => !want.has(u));
      if (add.length) { const { error } = await supabase.from("project_members").insert(add.map((user_id) => ({ project_id: id, user_id }))); if (error) throw error; }
      if (rem.length) { const { error } = await supabase.from("project_members").delete().eq("project_id", id).in("user_id", rem); if (error) throw error; }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["projects"] }); void qc.invalidateQueries({ queryKey: ["members"] }); toast("Project saved."); onClose(); }, onError: (e) => setErr(errMsg(e)),
  });
  const pms = team.data?.filter((u) => u.is_active && (u.role === "project_manager" || u.role === "super_admin")) ?? []; const tls = team.data?.filter((u) => u.is_active && u.role === "team_lead") ?? [];
  const devs = team.data?.filter((u) => u.is_active && (u.role === "developer" || u.role === "team_lead")) ?? [];
  return (
    <Modal title={project ? "Edit project" : "New project"} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save project</Button></>}>
      <div className="form-grid">
        <Field label="Project name *" className="span-2">{(id) => <input id={id} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Client">{(id) => <select id={id} className="select" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}><option value="">None</option>{clients.data?.map((c) => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}</select>}</Field>
        <Field label="Status">{(id) => <select id={id} className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Project["status"] })}>{["planning", "active", "on_hold", "completed", "cancelled"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>}</Field>
        <Field label="Project manager">{(id) => <select id={id} className="select" value={f.project_manager_id} onChange={(e) => setF({ ...f, project_manager_id: e.target.value })}><option value="">Unassigned</option>{pms.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>}</Field>
        <Field label="Team lead">{(id) => <select id={id} className="select" value={f.team_lead_id} onChange={(e) => setF({ ...f, team_lead_id: e.target.value })}><option value="">Unassigned</option>{tls.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>}</Field>
        <Field label="Start date">{(id) => <input id={id} type="date" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />}</Field>
        <Field label="Due date">{(id) => <input id={id} type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />}</Field>
        <Field label="Description" className="span-2">{(id) => <textarea id={id} className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      </div>
      <div className="field"><span className="label">Assigned developers</span><div className="chips">{devs.map((u) => <label key={u.id} className="chip-toggle"><input type="checkbox" checked={sel.includes(u.id)} onChange={() => setPicked(sel.includes(u.id) ? sel.filter((x) => x !== u.id) : [...sel, u.id])} /><span>{u.full_name}</span></label>)}{!devs.length && <span className="hint">Add Developer users under Team first.</span>}</div></div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

export function ProjectsPage() {
  const { can } = useAuth(); const q = useProjects(); const team = useTeam(); const [creating, setCreating] = useState(false);
  const clients = useQuery({ queryKey: ["clients-names"], queryFn: async () => new Map(((await supabase.from("clients").select("id,name")).data ?? []).map((c) => [c.id as string, c.name as string])) });
  return (
    <div className="page">
      <div className="page-head"><div><h1>Projects</h1><p>Won deals become delivery projects. Project Managers assign Team Leads; Team Leads delegate to developers.</p></div>
        {can("projects.manage") && <div className="page-actions"><Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} />New project</Button></div>}</div>
      {q.isLoading ? <div className="glass card"><ListSkeleton /></div> : !q.data?.projects.length ? <div className="glass card"><Empty icon={<FolderKanban size={32} />} title="No projects yet">{can("projects.manage") ? "Create a project for a won deal." : "Projects you are part of appear here."}</Empty></div>
        : <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>{q.data.projects.map((p) => { const s = q.data.stats.get(p.id) ?? { total: 0, done: 0, overdue: 0 }; const pc = s.total ? Math.round((s.done / s.total) * 100) : 0; return (
          <Link key={p.id} to={`/projects/${p.id}`} className="glass card card-link"><div className="card-head" style={{ marginBottom: 8 }}><h3>{p.name}</h3><Badge tone={pTone(p.status)}>{label(p.status)}</Badge></div>
            <p className="muted" style={{ fontSize: "0.88rem" }}>{p.client_id ? clients.data?.get(p.client_id) : "No client"} · PM {team.data?.find((u) => u.id === p.project_manager_id)?.full_name ?? "—"} · TL {team.data?.find((u) => u.id === p.team_lead_id)?.full_name ?? "—"}</p>
            <div className="meter" style={{ margin: "12px 0 6px" }} data-tone={pc === 100 ? "ok" : undefined} role="progressbar" aria-valuenow={pc} aria-valuemin={0} aria-valuemax={100} aria-label="Progress"><i style={{ width: `${pc}%` }} /></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="faint" style={{ fontSize: "0.8rem" }}>{s.done}/{s.total} tasks · {pc}%</span>{s.overdue > 0 && <Badge tone="danger">{s.overdue} overdue</Badge>}<span className="faint" style={{ fontSize: "0.8rem" }}>{p.due_date ? `Due ${p.due_date}` : ""}</span></div></Link>); })}</div>}
      {creating && <ProjectForm onClose={() => setCreating(false)} />}
    </div>
  );
}

function TaskForm({ project, task, assignees, onClose }: { project: Project; task?: Task; assignees: { id: string; full_name: string }[]; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ title: task?.title ?? "", description: task?.description ?? "", priority: task?.priority ?? "medium", assigned_to: task?.assigned_to ?? "", due_date: task?.due_date ?? "", status: task?.status ?? "todo" }); const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!f.title.trim()) throw new Error("Task title is required.");
      const row = { title: f.title.trim(), description: f.description.trim() || null, priority: f.priority, assigned_to: f.assigned_to || null, due_date: f.due_date || null, status: f.status };
      const { error } = task ? await supabase.from("tasks").update(row).eq("id", task.id) : await supabase.from("tasks").insert({ ...row, project_id: project.id }); if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tasks"] }); void qc.invalidateQueries({ queryKey: ["projects"] }); toast(task ? "Task updated." : "Task created."); onClose(); }, onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal title={task ? "Edit task" : "New task"} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save task</Button></>}>
      <div className="form-grid">
        <Field label="Title *" className="span-2">{(id) => <input id={id} className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Assign to" hint="Only people allowed by the project workflow are listed.">{(id) => <select id={id} className="select" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}><option value="">Unassigned</option>{assignees.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>}</Field>
        <Field label="Priority">{(id) => <select id={id} className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as "low" })}>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>}</Field>
        <Field label="Status">{(id) => <select id={id} className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as TaskStatus })}>{TASK_STATUSES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>}</Field>
        <Field label="Due date">{(id) => <input id={id} type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />}</Field>
        <Field label="Description" className="span-2">{(id) => <textarea id={id} className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

export function useTasks(projectId?: string) {
  return useQuery({ queryKey: ["tasks", projectId ?? "all"], refetchInterval: 60_000, queryFn: async () => {
    let q = supabase.from("tasks").select("*").order("created_at", { ascending: false }).limit(2000); if (projectId) q = q.eq("project_id", projectId);
    const { data, error } = await q; if (error) throw error; return (data ?? []) as Task[]; } });
}

export function TaskRow({ t, project, assignee, onEdit, canEdit }: { t: Task; project?: string; assignee?: string; onEdit?: () => void; canEdit: boolean }) {
  const { profile } = useAuth(); const toast = useToast(); const qc = useQueryClient(); const confirm = useConfirm();
  const mine = t.assigned_to === profile!.id;
  const setStatus = useMutation({ mutationFn: async (s: TaskStatus) => { const { error } = await supabase.from("tasks").update({ status: s }).eq("id", t.id); if (error) throw error; }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tasks"] }); void qc.invalidateQueries({ queryKey: ["projects"] }); }, onError: (e) => toast(errMsg(e), "error") });
  const del = async () => { if (!(await confirm({ title: "Delete this task?", danger: true, confirmLabel: "Delete" }))) return; const { error } = await supabase.from("tasks").delete().eq("id", t.id); if (error) return toast(errMsg(error), "error"); void qc.invalidateQueries({ queryKey: ["tasks"] }); void qc.invalidateQueries({ queryKey: ["projects"] }); };
  const overdue = t.due_date && t.status !== "done" && t.status !== "cancelled" && t.due_date < today();
  return (
    <tr><td className="cell-main"><span className="cell-strong">{t.title}</span><div className="cell-sub">{project ?? ""}{t.priority === "high" || t.priority === "urgent" ? ` · ${label(t.priority)} priority` : ""}</div></td>
      <td data-label="Assignee">{assignee ?? "Unassigned"}</td>
      <td data-label="Status">{(canEdit || mine) ? <select className="select" style={{ minWidth: 140 }} aria-label={`Status of ${t.title}`} value={t.status} onChange={(e) => setStatus.mutate(e.target.value as TaskStatus)}>{TASK_STATUSES.filter((s) => canEdit || s !== "cancelled").map((s) => <option key={s} value={s}>{label(s)}</option>)}</select> : <Badge tone={taskTone(t.status)}>{label(t.status)}</Badge>}</td>
      <td data-label="Due">{t.due_date ?? "—"} {overdue && <Badge tone="danger">Overdue</Badge>}</td>
      <td className="cell-actions"><div className="row" style={{ justifyContent: "flex-end" }}>{canEdit && onEdit && <Button size="sm" onClick={onEdit}><Pencil size={14} /></Button>}{canEdit && <Button size="sm" variant="danger" aria-label="Delete task" onClick={() => void del()}><Trash2 size={14} /></Button>}</div></td></tr>
  );
}

export function ProjectDetailPage() {
  const { id = "" } = useParams(); const { profile, can } = useAuth(); const nav = useNavigate(); const toast = useToast(); const qc = useQueryClient(); const confirm = useConfirm(); const team = useTeam();
  const [editing, setEditing] = useState(false); const [tasking, setTasking] = useState<Task | "new" | null>(null);
  const proj = useQuery({ queryKey: ["project", id], queryFn: async () => (await supabase.from("projects").select("*").eq("id", id).maybeSingle()).data as Project | null });
  const tasks = useTasks(id);
  const members = useQuery({ queryKey: ["members", id], queryFn: async () => ((await supabase.from("project_members").select("user_id").eq("project_id", id)).data ?? []).map((m) => m.user_id as string) });
  const client = useQuery({ queryKey: ["client-name", proj.data?.client_id], enabled: !!proj.data?.client_id, queryFn: async () => (await supabase.from("clients").select("name").eq("id", proj.data!.client_id!).maybeSingle()).data?.name as string | undefined });
  const p = proj.data; const name = (u: string | null) => team.data?.find((x) => x.id === u)?.full_name;
  const role = profile!.role; const isLead = p?.team_lead_id === profile!.id; const manageAll = can("projects.manage"); const canTask = can("tasks.create") && (manageAll || isLead);
  const assignees = useMemo(() => {
    if (!p || !team.data) return [];
    const mem = new Set(members.data ?? []);
    if (role === "team_lead") return team.data.filter((u) => u.is_active && (u.id === profile!.id || (u.role === "developer" && mem.has(u.id))));
    return team.data.filter((u) => u.is_active && (u.id === p.team_lead_id || mem.has(u.id)));
  }, [p, team.data, members.data, role, profile]);
  const del = async () => { if (!(await confirm({ title: "Delete this project?", body: "All its tasks are deleted too. Invoices linked to it are kept.", danger: true, confirmLabel: "Delete project" }))) return; const { error } = await supabase.from("projects").delete().eq("id", id); if (error) return toast(errMsg(error), "error"); void qc.invalidateQueries({ queryKey: ["projects"] }); toast("Project deleted."); nav("/projects"); };
  if (proj.isLoading) return <div className="page"><ListSkeleton /></div>;
  if (!p) return <div className="page"><div className="glass card"><Empty title="Project not found">It does not exist or you are not part of it.</Empty></div></div>;
  const t = tasks.data ?? []; const done = t.filter((x) => x.status === "done").length; const total = t.filter((x) => x.status !== "cancelled").length; const pc = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="page">
      <div className="page-head"><div><Link to="/projects" className="row" style={{ gap: 6, marginBottom: 8 }}><ArrowLeft size={16} />Projects</Link><h1>{p.name}</h1><div className="row" style={{ marginTop: 8 }}><Badge tone={pTone(p.status)}>{label(p.status)}</Badge><span className="faint">{client.data ?? "No client"}</span></div></div>
        <div className="page-actions">{canTask && <Button variant="primary" onClick={() => setTasking("new")}><Plus size={16} />New task</Button>}{manageAll && <Button onClick={() => setEditing(true)}><Pencil size={16} />Edit</Button>}{manageAll && <Button variant="danger" onClick={() => void del()}><Trash2 size={16} />Delete</Button>}</div></div>
      <div className="grid cols-3-2">
        <section className="glass card"><div className="card-head"><h2>Tasks</h2><span className="faint">{done}/{total} done · {pc}%</span></div>
          <div className="meter" style={{ marginBottom: 14 }} data-tone={pc === 100 ? "ok" : undefined}><i style={{ width: `${pc}%` }} /></div>
          {tasks.isLoading ? <ListSkeleton /> : !t.length ? <Empty title="No tasks yet">{canTask ? "Create the first task and assign it." : "Tasks assigned to you appear here."}</Empty>
            : <div className="table-wrap"><table className="table"><thead><tr><th>Task</th><th>Assignee</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>{t.map((x) => <TaskRow key={x.id} t={x} assignee={name(x.assigned_to)} canEdit={canTask} onEdit={() => setTasking(x)} />)}</tbody></table></div>}</section>
        <section className="glass card" style={{ alignContent: "start" }}><div className="card-head"><h2>Team</h2></div>
          <dl className="kv"><dt>Project manager</dt><dd>{name(p.project_manager_id) ?? "—"}</dd><dt>Team lead</dt><dd>{name(p.team_lead_id) ?? "—"}</dd><dt>Developers</dt><dd>{(members.data ?? []).map((u) => name(u)).filter(Boolean).join(", ") || "—"}</dd>
            <dt>Start</dt><dd>{p.start_date ?? "—"}</dd><dt>Due</dt><dd>{p.due_date ?? "—"}</dd></dl>
          {p.description && <><h3 style={{ marginTop: 14 }}>About</h3><p className="muted" style={{ whiteSpace: "pre-wrap" }}>{p.description}</p></>}
          <p className="hint" style={{ marginTop: 12 }}><UserMinus size={12} /> Task assignment: PM → Team Lead or members; Team Lead → developers on this project.</p></section>
      </div>
      {editing && <ProjectForm project={p} onClose={() => { setEditing(false); void qc.invalidateQueries({ queryKey: ["project", id] }); }} />}
      {tasking && <TaskForm project={p} task={tasking === "new" ? undefined : tasking} assignees={assignees} onClose={() => setTasking(null)} />}
    </div>
  );
}
