// Issues a short-lived LiveKit room token to a signed-in CRM user, ONLY if the database says they may join.
// Secrets (set in Supabase → Edge Functions → Secrets; never in the browser):
//   LIVEKIT_URL         e.g. wss://your-project.livekit.cloud
//   LIVEKIT_API_KEY     from LiveKit Cloud → Settings → Keys
//   LIVEKIT_API_SECRET  from LiveKit Cloud → Settings → Keys
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LK_URL = Deno.env.get("LIVEKIT_URL") ?? "";
const LK_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LK_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const TOKEN_TTL_SECONDS = 4 * 60 * 60;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? origin || "*" : "";
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const enc = new TextEncoder();
const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function livekitToken(identity: string, name: string, room: string, isHost: boolean): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: LK_KEY, sub: identity, name, nbf: now - 10, exp: now + TOKEN_TTL_SECONDS,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: isHost },
  }));
  const key = await crypto.subtle.importKey("raw", enc.encode(LK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  if (!LK_URL || !LK_KEY || !LK_SECRET) return json(req, 500, { error: "Video is not configured yet: set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET secrets." });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u.user) return json(req, 401, { error: "Invalid session" });

  let body: { meeting_id?: string };
  try { body = await req.json(); } catch { return json(req, 400, { error: "Invalid JSON" }); }
  if (!body.meeting_id || !/^[0-9a-f-]{36}$/i.test(body.meeting_id)) return json(req, 400, { error: "meeting_id required" });

  // The database decides: meeting must be live and the caller the host or someone who accepted.
  const { data, error } = await admin.rpc("meeting_join_check", { p_user: u.user.id, p_meeting: body.meeting_id });
  if (error) return json(req, 500, { error: "Could not check the meeting" });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json(req, 403, { error: "You cannot join this meeting right now (not live, not invited, or declined)." });

  const jwt = await livekitToken(u.user.id, row.display_name, row.room_name, !!row.is_host);
  return json(req, 200, { token: jwt, url: LK_URL });
});
