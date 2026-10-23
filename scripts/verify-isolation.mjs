#!/usr/bin/env node
/**
 * Proves the repository has no dependency on any other Supabase project or any credential.
 *   node scripts/verify-isolation.mjs [--legacy-ref <old-project-ref>]
 * Fails if it finds: a *.supabase.co URL, a JWT-looking token, a service-role key reference in client code,
 * a postgres:// connection string with a password, or (optionally) the legacy project's ref.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const legacyIdx = process.argv.indexOf("--legacy-ref");
const legacy = legacyIdx > -1 ? process.argv[legacyIdx + 1] : null;
const SKIP = new Set(["node_modules", "dist", ".git"]);
const rules = [
  ["Supabase project URL", /https?:\/\/[a-z0-9-]+\.supabase\.(co|in)/i],
  ["JWT / API key", /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./],
  ["Postgres URL with password", /postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/i],
  ["Service-role key in client code", /VITE_[A-Z_]*SERVICE[A-Z_]*/],
];
const hits = [];
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n); const s = statSync(p);
    if (s.isDirectory()) { walk(p); continue; }
    if (s.size > 2_000_000 || /\.(woff2?|png|jpg|ico|lock)$|package-lock/.test(n)) continue;
    const rel = relative(root, p);
    if (rel === "scripts/verify-isolation.mjs") continue;
    const text = readFileSync(p, "utf8");
    for (const [name, re] of rules) if (re.test(text)) hits.push(`${rel}: ${name}`);
    if (legacy && text.includes(legacy)) hits.push(`${rel}: references the legacy project`);
  }
})(root);
if (hits.length) { console.error("ISOLATION CHECK FAILED\n" + hits.join("\n")); process.exit(1); }
console.log("Isolation check passed: no Supabase URLs, keys, connection strings or legacy-project references found.");
