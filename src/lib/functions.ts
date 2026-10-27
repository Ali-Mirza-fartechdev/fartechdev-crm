import { supabase } from "./supabase";

/** Calls a Supabase Edge Function and turns every failure into a message a person can act on. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data as T;
  if ((error as { name?: string }).name === "FunctionsFetchError")
    throw new Error(`Could not reach the “${name}” function. Check it is deployed with that exact name and that this site is allowed in its ALLOWED_ORIGINS secret.`);
  const res = (error as { context?: Response }).context;
  if (res instanceof Response) {
    let detail = ""; try { const j = await res.clone().json(); detail = j.error ?? j.message ?? j.msg ?? ""; } catch { /* not JSON */ }
    if (res.status === 401) throw new Error(detail && detail !== "Invalid JWT" ? detail : `The “${name}” function rejected the session. In Supabase → Edge Functions → ${name} → Details, turn OFF “Verify JWT with legacy secret”.`);
    throw new Error(detail || `The “${name}” function returned an error (${res.status}).`);
  }
  throw new Error((error as { message?: string }).message ?? "Request failed");
}
