import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Empty, ListSkeleton } from "@/components/ui";
import { useTeam } from "@/lib/data";
import { TASK_STATUSES, label } from "@/lib/types";
import { TaskRow, useTasks } from "@/features/projects/ProjectsPage";

export function TasksPage() {
  const { profile, can } = useAuth(); const team = useTeam(); const tasks = useTasks();
  const projects = useQuery({ queryKey: ["projects-min"], queryFn: async () => new Map(((await supabase.from("projects").select("id,name,team_lead_id")).data ?? []).map((p) => [p.id as string, p as { id: string; name: string; team_lead_id: string | null }])) });
  const [scope, setScope] = useState<"mine" | "all">(can("tasks.view_all") ? "all" : "mine"); const [status, setStatus] = useState("open"); const [project, setProject] = useState("");
  const list = useMemo(() => (tasks.data ?? []).filter((t) => (scope === "all" || t.assigned_to === profile!.id) && (!project || t.project_id === project)
    && (status === "open" ? t.status !== "done" && t.status !== "cancelled" : status === "" ? true : t.status === status)), [tasks.data, scope, status, project, profile]);
  const editable = (pid: string) => can("tasks.create") && (profile!.role !== "team_lead" || projects.data?.get(pid)?.team_lead_id === profile!.id);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Tasks</h1><p>{can("tasks.view_all") ? "All tasks across projects." : "Tasks assigned to you and the projects you lead."}</p></div></div>
      <div className="glass">
        <div className="card" style={{ paddingBottom: 0 }}><div className="toolbar">
          <div className="seg" role="group" aria-label="Scope"><button aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>Assigned to me</button><button aria-pressed={scope === "all"} onClick={() => setScope("all")}>{can("tasks.view_all") ? "All tasks" : "My projects"}</button></div>
          <select className="select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="">Any status</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
          <select className="select" aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{[...(projects.data?.values() ?? [])].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div></div>
        {tasks.isLoading ? <div className="card"><ListSkeleton /></div> : !list.length ? <Empty icon={<ListChecks size={32} />} title="No tasks here">Nothing matches this view.</Empty>
          : <div className="table-wrap"><table className="table"><thead><tr><th>Task</th><th>Assignee</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>{list.map((t) => (
            <TaskRow key={t.id} t={t} project={projects.data?.get(t.project_id)?.name} assignee={team.data?.find((u) => u.id === t.assigned_to)?.full_name} canEdit={editable(t.project_id)} />))}</tbody></table></div>}
      </div>
    </div>
  );
}
