import { lazy, Suspense } from "react";
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
import { Skeleton } from "@/components/ui";
import { MessagesPage } from "@/features/messages/MessagesPage";
import { DealsPage } from "@/features/deals/DealsPage";
import { QuotesPage, QuoteDocPage } from "@/features/quotes/quotes";
import { FinancePage, InvoiceDocPage } from "@/features/finance/FinancePage";
import { ProjectsPage, ProjectDetailPage } from "@/features/projects/ProjectsPage";
import { TasksPage } from "@/features/tasks/TasksPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { TargetsPage } from "@/features/targets/TargetsPage";
import { MeetingsPage } from "@/features/meetings/MeetingsPage";
const MeetingRoom = lazy(() => import("@/features/meetings/MeetingRoom"));


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
        <Route path="messages" element={<MessagesPage />} />
        <Route path="meetings" element={<MeetingsPage />} />
        <Route path="meetings/:id/room" element={<Suspense fallback={<div className="page"><Skeleton h={24} w="40%" /></div>}><MeetingRoom /></Suspense>} />
        <Route path="deals" element={<DealsPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="targets" element={<TargetsPage />} />
        <Route path="print/quote/:id" element={<QuoteDocPage />} />
        <Route path="print/invoice/:id" element={<InvoiceDocPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
