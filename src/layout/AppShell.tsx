import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3, BellRing, CalendarClock, ChevronsLeft, ChevronsRight, FileText, FolderKanban, Handshake, LayoutDashboard, ListChecks,
  LogOut, Menu, MessagesSquare, Monitor, Moon, Receipt, Settings, Sun, Target, UserPlus, Users, UsersRound, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme, type ThemeMode } from "@/theme/ThemeProvider";
import { Button } from "@/components/ui";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { useUnreadMessages } from "@/features/messages/MessagesPage";
import { NotificationBell, useNotificationRealtime, useUnreadCount } from "@/features/notifications/notifications";

type Item = { to: string; label: string; icon: LucideIcon; show: (can: (p: string) => boolean, role: Role) => boolean; badge?: "notifications" | "messages" };
type Group = { title: string; items: Item[] };
const NAV: Group[] = [
  { title: "Workspace", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, show: () => true },
    { to: "/follow-ups", label: "Follow-ups", icon: CalendarClock, show: (c) => c("followups.create") || c("followups.view_all") },
    { to: "/messages", label: "Messages", icon: MessagesSquare, show: () => true, badge: "messages" },
    { to: "/notifications", label: "Notifications", icon: BellRing, show: () => true, badge: "notifications" },
  ] },
  { title: "Sales", items: [
    { to: "/leads", label: "Leads", icon: UserPlus, show: (c) => c("leads.create") || c("leads.view_all") },
    { to: "/deals", label: "Sales pipeline", icon: Handshake, show: (c) => c("deals.write") || c("deals.view_all") },
    { to: "/quotes", label: "Quotes", icon: FileText, show: (c) => c("quotes.create") || c("quotes.view_all") },
    { to: "/clients", label: "Clients", icon: Users, show: (c) => c("clients.view_all") || c("clients.write") },
  ] },
  { title: "Delivery & finance", items: [
    { to: "/projects", label: "Projects", icon: FolderKanban, show: (_c, r) => r !== "sales_executive" },
    { to: "/tasks", label: "Tasks", icon: ListChecks, show: (_c, r) => !["sales_executive", "finance", "cso"].includes(r) },
    { to: "/finance", label: "Finance", icon: Receipt, show: (c) => c("finance.view") },
  ] },
  { title: "Insights", items: [
    { to: "/reports", label: "Analytics & reports", icon: BarChart3, show: (c) => c("reports.sales") || c("reports.projects") || c("reports.finance") },
    { to: "/targets", label: "Targets & rates", icon: Target, show: (c, r) => c("targets.manage") || c("rates.manage") || r === "sales_executive" },
  ] },
  { title: "Administration", items: [
    { to: "/team", label: "Team", icon: UsersRound, show: () => true },
  ] },
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
  const msgs = useUnreadMessages();
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
        <div className="brand"><img className="brand-logo" src="/logo.png" alt="" width={38} height={38} /><div className="brand-name">FAR Tech<small>CRM</small></div></div>
        <nav className="nav">
          {NAV.map((g) => {
            const items = g.items.filter((i) => i.show(can, profile!.role));
            if (!items.length) return null;
            return (
              <div key={g.title} className="nav-group">
                <div className="nav-group-title">{g.title}</div>
                {items.map((i) => {
                  const count = i.badge === "notifications" ? n : i.badge === "messages" ? (msgs.data ?? 0) : 0;
                  return (
                    <NavLink key={i.to} to={i.to} end={i.to === "/"} className="nav-item" title={i.label}>
                      <i.icon size={20} /><span className="nav-label">{i.label}</span>
                      {count > 0 && <span className="nav-count">{count > 99 ? "99+" : count}</span>}
                    </NavLink>);
                })}
              </div>);
          })}
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

