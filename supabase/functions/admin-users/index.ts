// Privileged user administration. Runs on the server with the service-role key, which Supabase injects
// into Edge Functions automatically. It is never present in the browser bundle.
//
// Every request is authorised here: the caller's JWT is verified with Supabase Auth, the caller's profile is
// loaded with the service client, and the caller must be an ACTIVE Super Admin. Nothing the browser says about
// "who I am" is trusted.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EMAIL_DOMAIN = Deno.env.get("AUTH_EMAIL_DOMAIN") ?? "crm.invalid";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const ROLES = ["super_admin", "cso", "sales_executive", "project_manager", "team_lead", "developer", "finance"] as const;
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const MAX_ADMIN_ACTIONS_PER_MINUTE = 20;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? origin || "*" : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

function validPassword(p: unknown): p is string {
  return typeof p === "string" && p.length >= 12 && p.length <= 128 &&
    /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);
}
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return out.slice(0, 14) + "aZ7"; // guarantees lower/upper/digit
}
async function audit(actor: string, action: string, entityId: string, meta: Record<string, unknown> = {}) {
  await admin.from("audit_events").insert({ actor_id: actor, action, entity_type: "profile", entity_id: entityId, metadata: meta });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  // 1. Authenticate the caller
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(req, 401, { error: "Not signed in" });
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json(req, 401, { error: "Invalid session" });
  const callerId = userData.user.id;

  // 2. Authorise: active Super Admin only
  const { data: caller } = await admin.from("profiles").select("role,is_active").eq("id", callerId).single();
  if (!caller?.is_active || caller.role !== "super_admin") return json(req, 403, { error: "Not permitted" });

  // 3. Rate limit privileged actions per caller (counted from the audit log)
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("audit_events").select("id", { count: "exact", head: true })
    .eq("actor_id", callerId).like("action", "admin.%").gte("created_at", since);
  if ((count ?? 0) >= MAX_ADMIN_ACTIONS_PER_MINUTE) return json(req, 429, { error: "Too many admin actions; try again in a minute" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, 400, { error: "Invalid JSON" }); }

  switch (body.action) {
    case "create_user": {
      const username = String(body.username ?? "").trim().toLowerCase();
      const fullName = String(body.full_name ?? "").trim();
      const role = String(body.role ?? "");
      const timezone = String(body.timezone ?? "Asia/Karachi");
      const generated = !body.password;
      const password = generated ? generatePassword() : body.password;
      if (!USERNAME_RE.test(username)) return json(req, 400, { error: "Username must be 3–32 characters: a–z, 0–9, dot, dash, underscore" });
      if (!fullName || fullName.length > 120) return json(req, 400, { error: "Full name is required (max 120 characters)" });
      if (!(ROLES as readonly string[]).includes(role)) return json(req, 400, { error: "Unknown role" });
      if (!validPassword(password)) return json(req, 400, { error: "Password needs 12+ characters with upper-case, lower-case and a digit" });

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: `${username}@${EMAIL_DOMAIN}`, password: password as string, email_confirm: true,
        user_metadata: { username },
      });
      if (createErr || !created.user) return json(req, 400, { error: createErr?.message?.includes("already") ? "That username is taken" : "Could not create the account" });

      const { error: profErr } = await admin.from("profiles").insert({
        id: created.user.id, username, full_name: fullName, role, timezone, must_change_password: true, created_by: callerId,
      });
      if (profErr) {                       // roll back the auth identity so nothing half-exists
        await admin.auth.admin.deleteUser(created.user.id);
        return json(req, 400, { error: profErr.message.includes("username") ? "That username is taken" : "Could not create the profile" });
      }
      await audit(callerId, "admin.user_created", created.user.id, { username, role });
      // The generated password is returned exactly once, to the administrator, over TLS. It is never stored.
      return json(req, 200, { id: created.user.id, username, temporary_password: generated ? password : undefined });
    }

    case "reset_password": {
      const userId = String(body.user_id ?? "");
      const generated = !body.password;
      const password = generated ? generatePassword() : body.password;
      if (!validPassword(password)) return json(req, 400, { error: "Password needs 12+ characters with upper-case, lower-case and a digit" });
      const { error } = await admin.auth.admin.updateUserById(userId, { password: password as string });
      if (error) return json(req, 400, { error: "Could not reset the password" });
      await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
      await audit(callerId, "admin.password_reset", userId);
      return json(req, 200, { temporary_password: generated ? password : undefined });
    }

    case "set_active": {
      const userId = String(body.user_id ?? "");
      const active = body.active === true;
      if (userId === callerId && !active) return json(req, 400, { error: "You cannot deactivate your own account" });
      const { error: e1 } = await admin.from("profiles").update({ is_active: active }).eq("id", userId);
      if (e1) return json(req, 400, { error: "Could not update the account" });
      // Ban at the auth layer too, so refresh tokens stop working
      await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
      await audit(callerId, "admin.user_" + (active ? "activated" : "deactivated"), userId);
      return json(req, 200, { ok: true });
    }

    case "set_role": {
      const userId = String(body.user_id ?? "");
      const role = String(body.role ?? "");
      if (!(ROLES as readonly string[]).includes(role)) return json(req, 400, { error: "Unknown role" });
      if (userId === callerId) return json(req, 400, { error: "You cannot change your own role" });
      const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
      if (error) return json(req, 400, { error: "Could not update the role" });
      await audit(callerId, "admin.role_set", userId, { role });
      return json(req, 200, { ok: true });
    }

    default:
      return json(req, 400, { error: "Unknown action" });
  }
});
