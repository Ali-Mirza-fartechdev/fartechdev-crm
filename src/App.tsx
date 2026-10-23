import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { envReady } from "@/lib/env";
import { AppShell } from "@/layout/AppShell";
import { LoginPage, SetupNotice } from "@/features/auth/LoginPage";
import { ForcePasswordChange } from "@/features/auth/ForcePasswordChange";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { FollowUpsPage } from "@/features/followups/FollowUpsPage";
import { NotificationsPage } from "@/features/notifications/notifications";
import { LeadsPage } from "@/features/leads/LeadsPage";
import { EntityDetailPage } from "@/features/leads/EntityDetailPage";
import { ClientsPage } from "@/features/clients/ClientsPage";
import { TeamPage } from "@/features/team/TeamPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { NotBuilt } from "@/features/soon/NotBuilt";
import { Skeleton } from "@/components/ui";

const soon = (title: string, phase: string, note: string) => <NotBuilt title={title} phase={phase} note={note} />;

export default function App() {
  const { loading, session, profile } = useAuth();
  if (!envReady) return <SetupNotice />;
  if (loading) return <div className="login-wrap"><div style={{ width: 240 }}><Skeleton h={14} /></div></div>;
  if (!session || !profile) return <Routes><Route path="*" element={<LoginPage />} /></Routes>;
  if (profile.must_change_password) return <ForcePasswordChange />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="follow-ups" element={<FollowUpsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="leads/:id" element={<EntityDetailPage type="lead" />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<EntityDetailPage type="client" />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="deals" element={soon("Deals & pipeline", "Phase E", "The deals table, pipeline stages, stage history and access rules are in the database and tested. The Kanban/list screens come next.")} />
        <Route path="projects" element={soon("Projects", "Phase E", "Projects, members and the Project Manager → Team Lead → Developer assignment rules are enforced in the database. Screens come next.")} />
        <Route path="tasks" element={soon("Tasks", "Phase E", "Task rules (who may assign to whom, developers updating only their own status) are enforced and tested in the database. Screens come next.")} />
        <Route path="finance" element={soon("Finance", "Phase G", "Invoices, line items, payments, balances and overpayment protection exist and are tested. Screens come next.")} />
        <Route path="reports" element={soon("Reports", "Phase G", "Reports will be built on real records only.")} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
