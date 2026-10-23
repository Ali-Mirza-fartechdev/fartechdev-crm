import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3, BellRing, CalendarClock, ChevronsLeft, ChevronsRight, FolderKanban, Handshake, LayoutDashboard, ListChecks,
  LogOut, Menu, Monitor, Moon, Receipt, Settings, Sun, UserPlus, Users, UsersRound, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme, type ThemeMode } from "@/theme/ThemeProvider";
import { Button } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/types";
import { NotificationBell, useNotificationRealtime, useUnreadCount } from "@/features/notifications/notifications";

type Item = { to: string; label: string; icon: LucideIcon; show: (can: (p: string) => boolean) => boolean; soon?: boolean; count?: boolean };
const NAV: Item[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, show: () => true },
  { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock, show: (c) => c("followups.create") || c("followups.view_all") },
  { to: "/notifications", label: "Notifications", icon: BellRing, show: () => true, count: true },
  { to: "/leads", label: "Leads", icon: UserPlus, show: (c) => c("leads.create") || c("leads.view_all") },
  { to: "/clients", label: "Clients", icon: Users, show: (c) => c("clients.view_all") || c("clients.write") },
  { to: "/deals", label: "Deals", icon: Handshake, show: (c) => c("deals.write") || c("deals.view_all"), soon: true },
  { to: "/projects", label: "Projects", icon: FolderKanban, show: () => true, soon: true },
  { to: "/tasks", label: "Tasks", icon: ListChecks, show: () => true, soon: true },
  { to: "/finance", label: "Finance", icon: Receipt, show: (c) => c("finance.view"), soon: true },
  { to: "/reports", label: "Reports", icon: BarChart3, show: (c) => c("reports.sales") || c("reports.projects") || c("reports.finance"), soon: true },
  { to: "/team", label: "Team", icon: UsersRound, show: () => true },
];

function ThemeSwitch() {
  const { mode, setMode } = useTheme();
  const opts: { m: ThemeMode; icon: LucideIcon; label: string }[] = [
    { m: "light", icon: Sun, label: "Light" }, { m: "dark", icon: Moon, label: "Dark" }, { m: "system", icon: Monitor, label: "System" },
  ];
  return (
    <div className="seg" role="group" aria-label="Appearance">
      {opts.map(({ m, icon: I, label }) => <button key={m} aria-pressed={mode === m} aria-label={label} title={label} onClick={() => setMode(m)}><I size={16} /></button>)}
    </div>
  );
}

export function AppShell() {
  const { profile, can, signOut } = useAuth();
  const { pathname } = useLocation();
  const unread = useUnreadCount();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("fartech.sidebar") === "1");
  const [drawer, setDrawer] = useState(false);
  useNotificationRealtime();
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => { localStorage.setItem("fartech.sidebar", collapsed ? "1" : "0"); }, [collapsed]);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc);
  }, [drawer]);

  const initials = profile!.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const n = unread.data ?? 0;

  return (
    <div className="shell" data-collapsed={collapsed} data-drawer={drawer ? "open" : "closed"}>
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden />
      <aside className="sidebar glass-strong" aria-label="Main navigation">
        <div className="brand"><div className="brand-mark">F</div><div className="brand-name">FAR Tech<small>CRM</small></div></div>
        <nav className="nav">
          {NAV.filter((i) => i.show(can)).map((i) => i.soon ? (
            <span key={i.to} className="nav-item" aria-disabled="true" title="Interface arrives in a later phase"><i.icon size={20} /><span className="nav-label">{i.label}</span><span className="nav-soon">Soon</span></span>
          ) : (
            <NavLink key={i.to} to={i.to} end={i.to === "/"} className="nav-item" title={i.label}>
              <i.icon size={20} />
              <span className="nav-label">{i.label}</span>
              {i.count && n > 0 && <span className="nav-count">{n > 99 ? "99+" : n}</span>}
            </NavLink>))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/settings" className="nav-item"><Settings size={20} /><span className="nav-label">Settings</span></NavLink>
          <button className="nav-item" style={{ background: "none", border: 0, width: "100%", cursor: "pointer" }} onClick={() => void signOut()}><LogOut size={20} /><span className="nav-label">Sign out</span></button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar glass">
          <Button variant="ghost" className="btn-icon menu-btn" aria-label="Open navigation" onClick={() => setDrawer(true)}><Menu size={20} /></Button>
          <Button variant="ghost" className="btn-icon collapse-btn" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}</Button>
          <div className="topbar-spacer" />
          <ThemeSwitch />
          <NotificationBell />
          <NavLink to="/settings" className="row" style={{ gap: 10, textDecoration: "none", color: "inherit" }} aria-label="Profile settings">
            <span className="avatar">{initials}</span>
            <span className="topbar-user" style={{ lineHeight: 1.2 }}><strong style={{ fontSize: "0.88rem" }}>{profile!.full_name}</strong><br /><span className="faint" style={{ fontSize: "0.74rem" }}>{ROLE_LABEL[profile!.role]}</span></span>
          </NavLink>
        </header>
        <main id="main"><Outlet /></main>
      </div>
      <style>{`@media (max-width: 640px){ .topbar-user{display:none} }`}</style>
    </div>
  );
}

