import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Lock, ShieldCheck, User } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { Button, Field } from "@/components/ui";
import { envProblems, envReady } from "@/lib/env";

export function SetupNotice() {
  return (
    <div className="login-wrap"><div className="glass-strong login-card">
      <div className="brand"><div className="brand-mark">F</div><div className="brand-name">FAR Tech CRM<small>Not configured yet</small></div></div>
      <p>This build is not connected to a Supabase project, so sign-in is disabled. Create the <strong>new</strong> project and set:</p>
      <ul className="stack mono">{envProblems.map((p) => <li key={p}>{p}</li>)}</ul>
      <p className="hint">Copy <code>.env.example</code> to <code>.env.local</code>, fill the values from your new project, and restart. See docs/SETUP.md.</p>
    </div></div>
  );
}

export function LoginPage() {
  const { session, profile, signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!envReady) return <SetupNotice />;
  if (session && profile) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    const msg = await signIn(username, password);
    setBusy(false); if (msg) setErr(msg);
  }
  return (
    <div className="login-wrap">
      <form className="glass-strong login-card" onSubmit={submit} noValidate>
        <div className="brand" style={{ padding: 0 }}><div className="brand-mark">F</div><div className="brand-name">FAR Tech &amp; Developers<small>Customer relationship management</small></div></div>
        <div><h1>Sign in</h1><p className="muted" style={{ marginTop: 6 }}>Use the username your administrator gave you.</p></div>
        <Field label="Username">{(id) => <input id={id} className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required />}</Field>
        <Field label="Password" error={err}>{(id) => <input id={id} type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!err} required />}</Field>
        <Button type="submit" variant="primary" disabled={busy || !username || !password}>{busy ? "Signing in…" : <><Lock size={16} />Sign in</>}</Button>
        <p className="hint row"><ShieldCheck size={14} /><User size={14} />Accounts are created by a Super Admin. Forgot your password? Ask your administrator to reset it.</p>
      </form>
    </div>
  );
}
