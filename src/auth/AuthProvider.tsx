import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, usernameToEmail } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

type Ctx = {
  loading: boolean; session: Session | null; profile: Profile | null; perms: Set<string>;
  can: (p: string) => boolean;
  signIn: (username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>; refreshProfile: () => Promise<void>;
};
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());

  // The profile is fetched with the user's own JWT. RLS only returns it for an ACTIVE user, so a
  // deactivated account simply has no profile and is signed out.
  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); setPerms(new Set()); return; }
    const { data: p } = await supabase.from("profiles")
      .select("id,username,full_name,role,is_active,must_change_password,timezone,phone").eq("id", s.user.id).maybeSingle();
    if (!p) { await supabase.auth.signOut(); setProfile(null); setPerms(new Set()); return; }
    const { data: rp } = await supabase.from("role_permissions").select("permission").eq("role", p.role);
    setProfile(p as Profile);
    // Permissions come from the database's matrix (single source of truth); the UI only uses them to hide controls.
    setPerms(new Set((rp ?? []).map((r) => r.permission as string)));
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session); await loadProfile(data.session); if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // never await supabase calls inside this callback (deadlock risk); defer
      setTimeout(() => { void loadProfile(s); }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const signIn = useCallback(async (username: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    return error ? "Incorrect username or password." : null; // deliberately generic
  }, []);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); qc.clear(); }, [qc]);
  const refreshProfile = useCallback(async () => { const { data } = await supabase.auth.getSession(); await loadProfile(data.session); }, [loadProfile]);

  const value = useMemo<Ctx>(() => ({
    loading, session, profile, perms, can: (p) => perms.has(p), signIn, signOut, refreshProfile,
  }), [loading, session, profile, perms, signIn, signOut, refreshProfile]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => { const c = useContext(AuthCtx); if (!c) throw new Error("AuthProvider missing"); return c; };
