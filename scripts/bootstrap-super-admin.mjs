#!/usr/bin/env node
/**
 * One-time provisioning of the FIRST Super Admin on the NEW Supabase project.
 *
 *   SUPABASE_URL=https://<new-project-ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<new project's service_role key> \
 *   AUTH_EMAIL_DOMAIN=<same value you set for the Edge Function> \
 *   node scripts/bootstrap-super-admin.mjs
 *
 * • The password is typed at a hidden prompt. There is no default password and nothing is written to disk.
 * • The service-role key lives only in your shell for the duration of this command. Never commit it.
 * • Refuses to run if any Super Admin already exists, so it cannot be used as a back door later.
 */
import { createClient } from "@supabase/supabase-js";
import readline from "node:readline";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_EMAIL_DOMAIN } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !AUTH_EMAIL_DOMAIN) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and AUTH_EMAIL_DOMAIN first."); process.exit(1);
}
if (/placeholder|your-project|<.*>/i.test(SUPABASE_URL)) { console.error("SUPABASE_URL still looks like a placeholder."); process.exit(1); }

const host = new URL(SUPABASE_URL).host;
console.log(`Target project: ${host}`);

const ask = (q, hidden = false) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) { rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); }; }
  rl.question(q, (a) => { rl.close(); if (hidden) console.log(); res(a); });
});

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { count, error: cErr } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "super_admin");
if (cErr) { console.error("Cannot read profiles — have the migrations been applied?", cErr.message); process.exit(1); }
if (count > 0) { console.error("A Super Admin already exists. Use the app's Team page to create further users."); process.exit(1); }

if ((await ask(`Create the first Super Admin on ${host}? type "yes": `)).trim() !== "yes") process.exit(0);
const username = (await ask("Username (3–32 of a-z 0-9 . _ -): ")).trim().toLowerCase();
const fullName = (await ask("Full name: ")).trim();
const pw = await ask("Password (12+ chars, upper, lower, digit): ", true);
const pw2 = await ask("Repeat password: ", true);

if (!/^[a-z0-9._-]{3,32}$/.test(username)) { console.error("Invalid username."); process.exit(1); }
if (!fullName) { console.error("Full name required."); process.exit(1); }
if (pw !== pw2) { console.error("Passwords do not match."); process.exit(1); }
if (pw.length < 12 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) { console.error("Password too weak."); process.exit(1); }

const { data, error } = await admin.auth.admin.createUser({
  email: `${username}@${AUTH_EMAIL_DOMAIN}`, password: pw, email_confirm: true, user_metadata: { username },
});
if (error) { console.error("Auth error:", error.message); process.exit(1); }

const { error: pErr } = await admin.from("profiles").insert({
  id: data.user.id, username, full_name: fullName, role: "super_admin", must_change_password: false,
});
if (pErr) { await admin.auth.admin.deleteUser(data.user.id); console.error("Profile error (auth user rolled back):", pErr.message); process.exit(1); }

await admin.from("audit_events").insert({ actor_id: data.user.id, action: "bootstrap.super_admin_created", entity_type: "profile", entity_id: data.user.id });
console.log(`\nSuper Admin "${username}" created on ${host}. Sign in with that username and the password you just set.`);
