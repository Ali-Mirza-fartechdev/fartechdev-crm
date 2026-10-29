import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Rate } from "./money";
import type { Stage } from "./types";

export type Currency = { code: string; name: string };
export const useCurrencies = () => useQuery({
  queryKey: ["currencies"], staleTime: Infinity,
  queryFn: async () => ((await supabase.from("currencies").select("code,name").eq("is_active", true).order("code")).data ?? []) as Currency[],
});
export const useRates = () => useQuery({
  queryKey: ["rates"], staleTime: 30_000,
  queryFn: async (): Promise<Rate[]> => ((await supabase.from("exchange_rates").select("month,currency,usd_per_unit,pkr_per_unit")).data ?? [])
    .map((r) => ({ month: r.month as string, currency: (r.currency as string).trim(), usd_per_unit: Number(r.usd_per_unit), pkr_per_unit: Number(r.pkr_per_unit) })),
});
export const useStages = () => useQuery({
  queryKey: ["stages"], staleTime: 300_000,
  queryFn: async () => {
    const { data, error } = await supabase.from("pipeline_stages").select("id,name,position,is_won,is_lost,probability").order("position");
    if (error) throw error; // never present a failed load as "no stages"
    return (data ?? []) as Stage[];
  },
});
export const useOrg = () => useQuery({
  queryKey: ["org"],
  queryFn: async () => (await supabase.from("organization_settings").select("*").maybeSingle()).data as
    { company_name: string; default_timezone: string; default_currency: string; overdue_notice_minutes: number } | null,
});
export const useTeam = () => useQuery({
  queryKey: ["owners"], staleTime: 60_000,
  queryFn: async () => ((await supabase.from("profiles").select("id,full_name,role,is_active").order("full_name")).data ?? []) as
    { id: string; full_name: string; role: import("./types").Role; is_active: boolean }[],
});
