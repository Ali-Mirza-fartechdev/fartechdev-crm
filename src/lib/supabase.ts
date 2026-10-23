import { createClient } from "@supabase/supabase-js";
import { env, envReady } from "./env";

// Only the public anon key is ever used here. Every table is protected by Row Level Security.
export const supabase = createClient(
  envReady ? env.url : "https://not-configured.invalid",
  envReady ? env.anonKey : "not-configured",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
);

export const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@${env.emailDomain}`;
