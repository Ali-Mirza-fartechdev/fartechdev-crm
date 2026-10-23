import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, ListSkeleton, useToast } from "@/components/ui";
import { formatInTz, relative } from "@/lib/time";
import type { AppNotification, FollowUp } from "@/lib/types";
import { FollowUpItem } from "@/features/followups/FollowUpItem";

const N_KEY = ["notifications"] as const;

export function useUnreadCount() {
  return useQuery({
    queryKey: [...N_KEY, "unread"], refetchInterval: 60_000, refetchOnWindowFocus: true,
    queryFn: async () => {
      const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: [...N_KEY, "list", unreadOnly], refetchInterval: 60_000,
    queryFn: async (): Promise<AppNotification[]> => {
      let q = supabase.from("notifications").select("id,type,title,body,link,follow_up_id,entity_type,entity_id,read_at,created_at")
        .order("created_at", { ascending: false }).limit(100);
      if (unreadOnly) q = q.is("read_at", null);
      const { data, error } = await q;
      if (error) throw error;
      return data as AppNotification[];
    },
  });
}

/** Live delivery to open tabs. This is a convenience layer: notifications are created by the server scheduler
 *  and are also fetched by polling/focus refetch, so a missed realtime event never loses anything. */
export function useNotificationRealtime() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel(`notifications:${session.user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` }, (p) => {
        const n = p.new as AppNotification;
        toast(n.title + (n.body ? ` — ${n.body}` : ""), "info");
        void qc.invalidateQueries({ queryKey: N_KEY });
        void qc.invalidateQueries({ queryKey: ["follow-ups"] });
      }).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [session, qc, toast]);
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | "all") => {
      let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
      if (ids !== "all") q = q.in("id", ids);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: N_KEY }),
  });
}

export function NotificationBell() {
  const unread = useUnreadCount();
  const list = useNotifications();
  const markRead = useMarkRead();
  const nav = useNavigate();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const n = unread.data ?? 0;
  return (
    <div className="bell" ref={ref}>
      <Button variant="ghost" className="btn-icon" aria-label={`Notifications${n ? `, ${n} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={20} />{n > 0 && <span className="bell-badge">{n > 99 ? "99+" : n}</span>}
      </Button>
      {open && (
        <div className="popover glass-strong">
          <div className="dialog-head"><h3>Notifications</h3>
            <Button size="sm" disabled={!n} onClick={() => markRead.mutate("all")}><CheckCheck size={15} />Mark all read</Button></div>
          <div style={{ maxHeight: "60dvh", overflowY: "auto" }}>
            {list.isLoading ? <div style={{ padding: 16 }}><ListSkeleton /></div>
              : !list.data?.length ? <Empty icon={<BellOff size={28} />} title="You're all caught up" />
              : list.data.slice(0, 8).map((x) => (
                <button key={x.id} className="notif" data-unread={!x.read_at} style={{ width: "100%", textAlign: "left", background: "none", border: 0, color: "inherit", cursor: "pointer" }}
                  onClick={() => { if (!x.read_at) markRead.mutate([x.id]); setOpen(false); nav(x.link ?? "/notifications"); }}>
                  <span className="notif-dot" />
                  <span><div className="notif-title">{x.title}</div><div className="notif-body">{x.body}</div>
                    <div className="faint" style={{ fontSize: "0.76rem" }}>{formatInTz(x.created_at, profile!.timezone)}</div></span>
                  <span />
                </button>))}
          </div>
          <div style={{ padding: 10, textAlign: "center" }}><Link to="/notifications" onClick={() => setOpen(false)}>Open notification centre</Link></div>
        </div>)}
    </div>
  );
}

const FILTERS = [{ id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "follow_up", label: "Follow-ups" }, { id: "task", label: "Tasks" }] as const;

export function NotificationsPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const q = useNotifications(filter === "unread");
  const markRead = useMarkRead();
  const items = (q.data ?? []).filter((n) => filter === "follow_up" ? n.type.startsWith("follow_up") : filter === "task" ? n.type.startsWith("task") : true);
  const fuIds = [...new Set(items.map((n) => n.follow_up_id).filter(Boolean))] as string[];
  const fus = useQuery({
    queryKey: ["follow-ups", "by-ids", fuIds.join(",")], enabled: fuIds.length > 0,
    queryFn: async () => (await supabase.from("follow_up_details").select("*").in("id", fuIds)).data as FollowUp[] ?? [],
  });
  const fuById = new Map((fus.data ?? []).map((f) => [f.id, f]));
  const [openFu, setOpenFu] = useState<string | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Notifications</h1><p>Stored on the server, so they look the same on every device.</p></div>
        <div className="page-actions"><Button onClick={() => markRead.mutate("all", { onSuccess: () => toast("All notifications marked as read.") })}><CheckCheck size={16} />Mark all read</Button></div>
      </div>
      <div className="glass">
        <div className="card-head" style={{ padding: "16px 16px 0" }}>
          <div className="seg" role="group" aria-label="Filter notifications">
            {FILTERS.map((f) => <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
          </div>
        </div>
        {q.isLoading ? <div style={{ padding: 16 }}><ListSkeleton /></div>
          : q.error ? <p className="error-text" style={{ padding: 16 }} role="alert">Could not load notifications.</p>
          : items.length === 0 ? <Empty icon={<BellOff size={32} />} title="No notifications">{filter === "unread" ? "You have read everything." : "Reminders and assignments will appear here."}</Empty>
          : items.map((n) => {
            const fu = n.follow_up_id ? fuById.get(n.follow_up_id) : undefined;
            return (
              <div key={n.id} className="notif" data-unread={!n.read_at}>
                <span className="notif-dot" aria-label={n.read_at ? "Read" : "Unread"} />
                <div>
                  <div className="notif-title">{n.title}</div>
                  <div className="notif-body">{n.body}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="faint" style={{ fontSize: "0.78rem" }}>{formatInTz(n.created_at, profile!.timezone)} · {relative(n.created_at)}</span>
                    {fu && <Badge tone={fu.is_overdue ? "danger" : fu.status === "completed" ? "ok" : "brand"}>{fu.is_overdue ? "Overdue" : fu.status === "completed" ? "Completed" : fu.status === "cancelled" ? "Cancelled" : "Pending"}</Badge>}
                  </div>
                  {fu && openFu === fu.id && <div style={{ marginTop: 10 }}><FollowUpItem f={fu} /></div>}
                </div>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  {fu && <Button size="sm" onClick={() => setOpenFu(openFu === fu.id ? null : fu.id)}>{openFu === fu.id ? "Hide" : "Actions"}</Button>}
                  {n.link && <Button size="sm" onClick={() => { if (!n.read_at) markRead.mutate([n.id]); nav(n.link!); }}>Open</Button>}
                  {!n.read_at && <Button size="sm" variant="ghost" onClick={() => markRead.mutate([n.id])}>Mark read</Button>}
                </div>
              </div>);
          })}
      </div>
    </div>
  );
}
