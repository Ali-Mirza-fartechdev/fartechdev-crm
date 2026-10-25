import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme, type ThemeMode } from "@/theme/ThemeProvider";
import { Badge, Button, Field, ListSkeleton, errMsg, useToast } from "@/components/ui";
import { CurrencySelect } from "@/components/extra";
import { REMINDER_OPTIONS, ROLES, ROLE_LABEL, ROLE_LABEL as RL } from "@/lib/types";
import { formatInTz, relative } from "@/lib/time";
import { passwordProblem } from "@/features/auth/ForcePasswordChange";

const zones = (): string[] => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC", "Asia/Karachi"]; } };

function ProfileTab() {
  const { profile, refreshProfile } = useAuth(); const toast = useToast();
  const [name, setName] = useState(profile!.full_name); const [phone, setPhone] = useState(profile!.phone ?? ""); const [tz, setTz] = useState(profile!.timezone);
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("profiles").update({ full_name: name.trim(), phone: phone.trim() || null, timezone: tz }).eq("id", profile!.id); if (error) throw error; },
    onSuccess: async () => { await refreshProfile(); toast("Profile saved."); }, onError: (e) => toast(errMsg(e), "error"),
  });
  return (<div className="stack"><div className="form-grid">
    <Field label="Full name">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
    <Field label="Username" hint="Set by an administrator">{(id) => <input id={id} className="input" value={profile!.username} disabled />}</Field>
    <Field label="Role">{(id) => <input id={id} className="input" value={RL[profile!.role]} disabled />}</Field>
    <Field label="Phone">{(id) => <input id={id} className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
    <Field label="Timezone" hint="Follow-up times and reminders are shown in this zone." className="span-2">{(id) => <select id={id} className="select" value={tz} onChange={(e) => setTz(e.target.value)}>{zones().map((z) => <option key={z}>{z}</option>)}</select>}</Field></div>
    <div><Button variant="primary" disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>Save profile</Button></div></div>);
}

function AppearanceTab() {
  const { mode, setMode } = useTheme(); const { profile } = useAuth();
  const choose = (m: ThemeMode) => { setMode(m); void supabase.from("user_preferences").update({ theme: m }).eq("user_id", profile!.id); };
  const opts: [ThemeMode, string, typeof Sun][] = [["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "System", Monitor]];
  return (<div className="stack"><p className="muted">Applies to this account. “System” follows your device setting.</p>
    <div className="seg" role="radiogroup" aria-label="Theme">{opts.map(([m, l, I]) => <button key={m} role="radio" aria-checked={mode === m} aria-pressed={mode === m} onClick={() => choose(m)}><I size={16} />{l}</button>)}</div></div>);
}

function NotificationsTab() {
  const toast = useToast(); const { profile } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["prefs-offsets"], queryFn: async () => (await supabase.from("user_preferences").select("default_reminder_offsets").maybeSingle()).data?.default_reminder_offsets as number[] | undefined });
  const [local, setLocal] = useState<number[] | null>(null);
  const cur = local ?? q.data ?? [15, 0];
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("user_preferences").update({ default_reminder_offsets: cur }).eq("user_id", profile!.id); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["prefs-offsets"] }); toast("Defaults saved."); }, onError: (e) => toast(errMsg(e), "error"),
  });
  return (<div className="stack"><div className="field"><span className="label">Default reminder timing for new follow-ups</span>
    <div className="chips">{REMINDER_OPTIONS.map((o) => <label key={o.value} className="chip-toggle"><input type="checkbox" checked={cur.includes(o.value)} onChange={() => setLocal(cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value])} /><span>{o.label}</span></label>)}</div></div>
    <p className="hint">Channel: <strong>in-app</strong>. Email, push, SMS and WhatsApp are not enabled because no provider is configured.</p>
    <div><Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>Save defaults</Button></div></div>);
}

function SecurityTab() {
  const toast = useToast(); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [err, setErr] = useState<string | null>(null);
  async function change() {
    setErr(null); const bad = passwordProblem(pw); if (bad) return setErr(bad); if (pw !== pw2) return setErr("Passwords do not match.");
    const { error } = await supabase.auth.updateUser({ password: pw }); if (error) return setErr(error.message);
    setPw(""); setPw2(""); toast("Password changed.");
  }
  return (<div className="stack" style={{ maxWidth: 420 }}>
    <Field label="New password">{(id) => <input id={id} type="password" className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
    <Field label="Repeat new password" error={err}>{(id) => <input id={id} type="password" className="input" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}</Field>
    <div><Button variant="primary" onClick={() => void change()}>Change password</Button></div>
    <p className="hint">There is no self-service reset. If you forget your password, ask a Super Admin.</p></div>);
}

function RolesTab() {
  const q = useQuery({ queryKey: ["matrix"], queryFn: async () => (await supabase.from("role_permissions").select("role,permission")).data ?? [] });
  if (q.isLoading) return <ListSkeleton />;
  const perms = [...new Set((q.data ?? []).map((r) => r.permission as string))].sort();
  const has = new Set((q.data ?? []).map((r) => `${r.role}:${r.permission}`));
  return (<div className="table-wrap"><table className="table matrix"><thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
    <tbody>{perms.map((p) => <tr key={p}><td className="mono">{p}</td>{ROLES.map((r) => <td key={r}>{has.has(`${r}:${p}`) ? "●" : ""}</td>)}</tr>)}</tbody></table>
    <p className="hint" style={{ padding: 12 }}>Read-only: the matrix lives in version-controlled migrations. Records are further scoped by ownership and assignment rules in the database.</p></div>);
}

function OrgTab() {
  const { can } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["org"], queryFn: async () => (await supabase.from("organization_settings").select("*").maybeSingle()).data });
  const [f, setF] = useState<{ company_name: string; default_timezone: string; default_currency: string; overdue_notice_minutes: number } | null>(null);
  const cur = f ?? (q.data ? { company_name: q.data.company_name, default_timezone: q.data.default_timezone, default_currency: String(q.data.default_currency).trim(), overdue_notice_minutes: q.data.overdue_notice_minutes } : null);
  const save = useMutation({ mutationFn: async () => { const { error } = await supabase.from("organization_settings").update(cur!).eq("id", true); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["org"] }); toast("Organization settings saved."); }, onError: (e) => toast(errMsg(e), "error") });
  if (!cur) return <ListSkeleton />;
  const ro = !can("settings.manage");
  return (<div className="stack"><div className="form-grid">
    <Field label="Company name">{(id) => <input id={id} className="input" disabled={ro} value={cur.company_name} onChange={(e) => setF({ ...cur, company_name: e.target.value })} />}</Field>
    <Field label="Default timezone">{(id) => <select id={id} className="select" disabled={ro} value={cur.default_timezone} onChange={(e) => setF({ ...cur, default_timezone: e.target.value })}>{zones().map((z) => <option key={z}>{z}</option>)}</select>}</Field>
    <Field label="Default currency" hint="Pre-selected for new deals and invoices. Each record can use any currency.">{(id) => <CurrencySelect id={id} disabled={ro} value={cur.default_currency} onChange={(v) => setF({ ...cur, default_currency: v })} />}</Field>
    <Field label="Overdue alert after (minutes)" hint="Sent once if a follow-up is still open this long after its due time. Applies to newly scheduled follow-ups.">{(id) => <input id={id} type="number" min={1} max={10080} className="input" disabled={ro} value={cur.overdue_notice_minutes} onChange={(e) => setF({ ...cur, overdue_notice_minutes: Number(e.target.value) })} />}</Field></div>
    {!ro && <div><Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></div>}</div>);
}

function AuditTab() {
  const { profile } = useAuth();
  const q = useQuery({ queryKey: ["audit"], queryFn: async () => (await supabase.from("audit_events").select("id,actor_id,action,entity_type,entity_id,metadata,created_at").order("created_at", { ascending: false }).limit(100)).data ?? [] });
  const sched = useQuery({ queryKey: ["scheduler-runs"], refetchInterval: 30_000, queryFn: async () => (await supabase.from("scheduler_runs").select("id,ran_at,fired,cancelled,skipped,max_lag_seconds").order("id", { ascending: false }).limit(5)).data ?? [] });
  const tz = profile!.timezone;
  return (<div className="stack">
    <div><h3>Reminder scheduler</h3>{sched.data?.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Ran</th><th className="num">Fired</th><th className="num">Cancelled</th><th className="num">Skipped</th><th className="num">Lag (s)</th></tr></thead>
      <tbody>{sched.data.map((r) => <tr key={r.id}><td data-label="Ran">{formatInTz(r.ran_at, tz)} <span className="faint">({relative(r.ran_at)})</span></td><td className="num" data-label="Fired">{r.fired}</td><td className="num" data-label="Cancelled">{r.cancelled}</td><td className="num" data-label="Skipped">{r.skipped}</td><td className="num" data-label="Lag (s)">{Math.round(Number(r.max_lag_seconds))}</td></tr>)}</tbody></table></div>
      : <p className="muted">No scheduler runs recorded yet. Enable pg_cron (docs/SETUP.md §6).</p>}</div>
    <div><h3>Audit log</h3>{q.isLoading ? <ListSkeleton /> : <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
      <tbody>{q.data?.map((e) => <tr key={e.id}><td data-label="When">{formatInTz(e.created_at, tz)}</td><td data-label="Action"><Badge tone="brand">{e.action}</Badge></td><td data-label="Entity" className="mono">{e.entity_type}</td><td data-label="Details" className="mono" style={{ wordBreak: "break-all" }}>{JSON.stringify(e.metadata)}</td></tr>)}</tbody></table></div>}</div></div>);
}

export function SettingsPage() {
  const { can } = useAuth();
  const tabs = [["profile", "Profile"], ["appearance", "Appearance"], ["notifications", "Notifications"], ["security", "Security"], ["roles", "Roles & permissions"], ["org", "Organization"], ...(can("audit.view") ? [["audit", "Audit & system"]] : [])] as [string, string][];
  const [tab, setTab] = useState("profile");
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1></div></div>
      <div className="glass card">
        <div className="tabs" role="tablist">{tabs.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>{l}</button>)}</div>
        <div style={{ paddingTop: 20 }} role="tabpanel">
          {tab === "profile" && <ProfileTab />}{tab === "appearance" && <AppearanceTab />}{tab === "notifications" && <NotificationsTab />}
          {tab === "security" && <SecurityTab />}{tab === "roles" && <RolesTab />}{tab === "org" && <OrgTab />}{tab === "audit" && <AuditTab />}
        </div>
      </div>
    </div>
  );
}
