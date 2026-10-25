import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Deal } from "@/lib/types";

export type DealRow = Deal & { lead: { full_name: string; company: string | null } | null; client: { name: string } | null };

const pickOne = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export function useDeals() {
  return useQuery({
    queryKey: ["deals"], refetchInterval: 60_000,
    queryFn: async (): Promise<DealRow[]> => {
      const { data, error } = await supabase.from("deals")
        .select("*, lead:leads(full_name,company), client:clients(name)").order("created_at", { ascending: false }).limit(3000);
      if (error) throw error;
      return (data ?? []).map((d) => ({ ...(d as unknown as Deal), currency: String((d as { currency: string }).currency).trim(), value: Number((d as { value: number }).value),
        lead: pickOne(d.lead as never), client: pickOne(d.client as never) })) as DealRow[];
    },
  });
}

export const dealParty = (d: DealRow) => d.client?.name ?? d.lead?.company ?? d.lead?.full_name ?? "—";
