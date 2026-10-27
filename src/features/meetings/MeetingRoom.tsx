import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiveKitRoom, PreJoin, VideoConference, type LocalUserChoices } from "@livekit/components-react";
import "@livekit/components-styles";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { callFunction } from "@/lib/functions";
import { Button, Skeleton } from "@/components/ui";

/** Lazy-loaded (LiveKit is large). Flow: choose camera/mic → server marks you joined → server issues a token → connect. */
export default function MeetingRoom() {
  const { id = "" } = useParams(); const nav = useNavigate(); const { profile } = useAuth();
  const [choices, setChoices] = useState<LocalUserChoices | null>(null);
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null); const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!choices) return; let alive = true;
    (async () => {
      try {
        const j = await supabase.rpc("join_meeting", { p_id: id }); if (j.error) throw j.error;
        const r = await callFunction<{ token: string; url: string }>("meeting-token", { meeting_id: id });
        if (alive) setConn(r);
      } catch (e) { if (alive) setErr((e as { message?: string }).message ?? "Could not join"); }
    })();
    return () => { alive = false; };
  }, [choices, id]);

  const back = <Button onClick={() => nav("/meetings")}><ArrowLeft size={15} />Back to meetings</Button>;
  if (err) return <div className="page"><div className="glass card stack"><h2>Could not join the meeting</h2><p className="error-text" role="alert">{err}</p>{back}</div></div>;
  if (!choices) return (
    <div className="page"><div className="glass card" data-lk-theme="default" style={{ display: "grid", placeItems: "center", padding: 24 }}>
      <PreJoin defaults={{ username: profile!.full_name, videoEnabled: true, audioEnabled: true }} onSubmit={setChoices} onError={(e) => setErr(e.message)} joinLabel="Join meeting" micLabel="Microphone" camLabel="Camera" userLabel="Your name" />
      <div style={{ marginTop: 12 }}>{back}</div></div></div>);
  if (!conn) return <div className="page"><div className="glass card"><Skeleton h={24} w="40%" /><p className="muted" style={{ marginTop: 10 }}>Connecting…</p></div></div>;
  return (
    <div data-lk-theme="default" style={{ height: "calc(100dvh - 110px)", margin: "8px", borderRadius: 18, overflow: "hidden" }}>
      <LiveKitRoom serverUrl={conn.url} token={conn.token} connect video={choices.videoEnabled} audio={choices.audioEnabled} onDisconnected={() => nav("/meetings")} onError={(e) => setErr(e.message)}>
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
