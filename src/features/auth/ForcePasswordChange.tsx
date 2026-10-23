import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Button, Field } from "@/components/ui";

export const passwordProblem = (p: string) =>
  p.length < 12 ? "Use at least 12 characters." : !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p) ? "Include upper-case, lower-case and a number." : null;

/** Shown after an administrator created or reset the account: the temporary password must be replaced. */
export function ForcePasswordChange() {
  const { refreshProfile, signOut } = useAuth();
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const bad = passwordProblem(pw); if (bad) return setErr(bad);
    if (pw !== pw2) return setErr("Passwords do not match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setBusy(false); return setErr(error.message); }
    await supabase.rpc("clear_must_change_password");
    await refreshProfile(); setBusy(false);
  }
  return (
    <div className="login-wrap">
      <form className="glass-strong login-card" onSubmit={submit}>
        <div><h1>Choose a new password</h1><p className="muted" style={{ marginTop: 6 }}>Your administrator set a temporary password. Pick your own to continue.</p></div>
        <Field label="New password">{(id) => <input id={id} type="password" className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        <Field label="Repeat new password" error={err}>{(id) => <input id={id} type="password" className="input" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save and continue"}</Button>
        <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
      </form>
    </div>
  );
}
