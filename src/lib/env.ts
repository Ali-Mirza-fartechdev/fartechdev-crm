const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
const emailDomain = (import.meta.env.VITE_AUTH_EMAIL_DOMAIN ?? "").trim().toLowerCase();

const looksPlaceholder = (v: string) => !v || /your-|placeholder|<.*>|example/i.test(v);

export const env = { url, anonKey, emailDomain };
export const envProblems: string[] = [
  ...(looksPlaceholder(url) || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ? ["VITE_SUPABASE_URL"] : []),
  ...(looksPlaceholder(anonKey) ? ["VITE_SUPABASE_ANON_KEY"] : []),
  ...(looksPlaceholder(emailDomain) ? ["VITE_AUTH_EMAIL_DOMAIN"] : []),
];
export const envReady = envProblems.length === 0;
