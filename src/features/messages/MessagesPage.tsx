import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessagesSquare, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, ListSkeleton, errMsg, useToast } from "@/components/ui";
import { formatTime, relative } from "@/lib/time";
import { ROLE_LABEL, type Contact, type Message } from "@/lib/types";

const M_KEY = ["messages"] as const;
const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function useUnreadMessages() {
  return useQuery({
    queryKey: [...M_KEY, "unread"], refetchInterval: 60_000, refetchOnWindowFocus: true,
    queryFn: async () => {
      // Only messages sent TO me count. RLS also lets me read messages I sent, which must never show as unread.
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return 0;
      const { count } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("recipient_id", u.user.id).is("read_at", null);
      return count ?? 0;
    },
  });
}

export function MessagesPage() {
  const { profile, session } = useAuth();
  const toast = useToast(); const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const withId = params.get("with");
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const me = session!.user.id;

  const contacts = useQuery({
    queryKey: [...M_KEY, "contacts"], refetchInterval: 30_000,
    queryFn: async () => { const { data, error } = await supabase.rpc("chat_contacts"); if (error) throw error; return (data ?? []) as Contact[]; },
  });
  const active = contacts.data?.find((c) => c.id === withId) ?? null;

  const thread = useQuery({
    queryKey: [...M_KEY, "thread", withId], enabled: !!withId, refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("id,sender_id,recipient_id,body,created_at,read_at")
        .or(`and(sender_id.eq.${me},recipient_id.eq.${withId}),and(sender_id.eq.${withId},recipient_id.eq.${me})`)
        .order("created_at", { ascending: true }).limit(500);
      if (error) throw error;
      return data as Message[];
    },
  });

  // mark the open conversation as read
  useEffect(() => {
    if (!withId || !thread.data?.some((m) => m.recipient_id === me && !m.read_at)) return;
    void supabase.from("messages").update({ read_at: new Date().toISOString() }).eq("sender_id", withId).eq("recipient_id", me).is("read_at", null)
      .then(() => { void qc.invalidateQueries({ queryKey: M_KEY }); void qc.invalidateQueries({ queryKey: ["notifications"] }); });
  }, [withId, thread.data, me, qc]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [thread.data?.length, withId]);

  // live updates for open tabs (polling above is the safety net)
  useEffect(() => {
    const ch = supabase.channel(`messages:${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${me}` }, () => { void qc.invalidateQueries({ queryKey: M_KEY }); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [me, qc]);

  const send = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("send_message", { p_recipient: withId, p_body: text.trim() }); if (error) throw error; },
    onSuccess: () => { setText(""); void qc.invalidateQueries({ queryKey: M_KEY }); },
    onError: (e) => toast(errMsg(e), "error"),
  });
  const submit = () => { if (text.trim() && !send.isPending) send.mutate(); };

  return (
    <div className="page">
      <div className="page-head"><div><h1>Messages</h1><p>Direct messages with the colleagues your role can reach.</p></div></div>
      <div className="glass chat" data-open={withId ? "true" : "false"}>
        <div className="chat-list" aria-label="Conversations">
          {contacts.isLoading ? <div style={{ padding: 14 }}><ListSkeleton /></div>
            : !contacts.data?.length ? <Empty icon={<MessagesSquare size={28} />} title="No one to message yet" />
            : contacts.data.map((c) => (
              <button key={c.id} className="chat-contact" aria-current={c.id === withId} onClick={() => setParams({ with: c.id })}>
                <span className="avatar">{initials(c.full_name)}</span>
                <span style={{ minWidth: 0 }}><strong>{c.full_name}</strong><div className="sub">{c.last_body ? `${c.last_from_me ? "You: " : ""}${c.last_body}` : ROLE_LABEL[c.role]}</div></span>
                <span style={{ textAlign: "right" }}>{c.unread > 0 && <span className="nav-count">{c.unread}</span>}{c.last_at && <div className="faint" style={{ fontSize: "0.7rem" }}>{relative(c.last_at)}</div>}</span>
              </button>))}
        </div>
        <div className="chat-pane">
          {!withId || !active
            ? <div style={{ gridRow: "1 / -1", display: "grid", placeItems: "center" }}><Empty icon={<MessagesSquare size={32} />} title="Choose a conversation">Pick a colleague on the left to start or continue a chat.</Empty></div>
            : (<>
              <div className="chat-head">
                <Button variant="ghost" size="sm" className="btn-icon menu-btn" aria-label="Back to conversations" onClick={() => setParams({})}><ArrowLeft size={18} /></Button>
                <span className="avatar">{initials(active.full_name)}</span>
                <div><strong>{active.full_name}</strong><div className="faint" style={{ fontSize: "0.8rem" }}>{ROLE_LABEL[active.role]} {!active.can_start && <Badge>Reply only</Badge>}</div></div>
              </div>
              <div className="chat-msgs">
                {thread.isLoading ? <ListSkeleton />
                  : !thread.data?.length ? <p className="faint" style={{ textAlign: "center", marginTop: 40 }}>No messages yet. Say hello.</p>
                  : thread.data.map((m) => (
                    <div key={m.id} className="bubble" data-me={m.sender_id === me}>{m.body}<time>{formatTime(m.created_at, profile!.timezone)}</time></div>))}
                <div ref={endRef} />
              </div>
              <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <textarea className="textarea" style={{ minHeight: 44, maxHeight: 140 }} aria-label="Message" placeholder="Write a message…" value={text} maxLength={4000} rows={1}
                  onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
                <Button type="submit" variant="primary" disabled={!text.trim() || send.isPending} aria-label="Send"><Send size={16} />Send</Button>
              </form>
            </>)}
        </div>
      </div>
      <p className="hint" style={{ padding: "0 8px" }}>You can start chats only with the roles yours is allowed to contact; anyone can reply to a message sent to them.</p>
    </div>
  );
}
