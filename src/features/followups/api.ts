import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FollowUp } from "@/lib/types";

export const FU_KEY = ["follow-ups"] as const;

/** Pending follow-ups plus anything completed in the last 7 days (for "completed recently"). */
export function useFollowUps() {
  return useQuery({
    queryKey: FU_KEY,
    refetchInterval: 60_000, // safety net alongside Realtime; the server scheduler does the actual notifying
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<FollowUp[]> => {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const { data, error } = await supabase.from("follow_up_details").select("*")
        .or(`status.eq.pending,and(status.eq.completed,completed_at.gte.${since})`)
        .order("due_at", { ascending: true }).limit(1000);
      if (error) throw error;
      return data as FollowUp[];
    },
  });
}

export function useEntityFollowUps(type: "lead" | "client", id: string) {
  return useQuery({
    queryKey: [...FU_KEY, type, id],
    queryFn: async (): Promise<FollowUp[]> => {
      const { data, error } = await supabase.from("follow_up_details").select("*")
        .eq(type === "lead" ? "lead_id" : "client_id", id).order("due_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as FollowUp[];
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: FU_KEY }), qc.invalidateQueries({ queryKey: ["notifications"] }),
    qc.invalidateQueries({ queryKey: ["activities"] }), qc.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}

export type CreateInput = {
  lead_id: string | null; client_id: string | null; title: string; type: string; date: string; time: string; timezone: string;
  assigned_to: string | null; notes: string | null; priority: string; offsets: number[];
};
export function useCreateFollowUp() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (i: CreateInput) => {
      const { data, error } = await supabase.rpc("create_follow_up", {
        p_lead_id: i.lead_id, p_client_id: i.client_id, p_title: i.title, p_type: i.type, p_local_date: i.date, p_local_time: i.time,
        p_timezone: i.timezone, p_assigned_to: i.assigned_to, p_notes: i.notes, p_priority: i.priority, p_reminder_offsets: i.offsets,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: inv,
  });
}
export function useReschedule() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (i: { id: string; date: string; time: string; timezone: string; offsets: number[]; reason: string | null }) => {
      const { error } = await supabase.rpc("reschedule_follow_up", {
        p_id: i.id, p_local_date: i.date, p_local_time: i.time, p_timezone: i.timezone, p_reminder_offsets: i.offsets, p_reason: i.reason,
      });
      if (error) throw error;
    },
    onSuccess: inv,
  });
}
export function useComplete() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (i: { id: string; note: string | null }) => {
      const { error } = await supabase.rpc("complete_follow_up", { p_id: i.id, p_note: i.note });
      if (error) throw error;
    },
    onSuccess: inv,
  });
}
export function useCancel() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (i: { id: string; reason: string | null }) => {
      const { error } = await supabase.rpc("cancel_follow_up", { p_id: i.id, p_reason: i.reason });
      if (error) throw error;
    },
    onSuccess: inv,
  });
}
export function useAddFollowUpNote() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: async (i: { id: string; text: string }) => {
      const { error } = await supabase.rpc("add_follow_up_note", { p_id: i.id, p_text: i.text });
      if (error) throw error;
    },
    onSuccess: inv,
  });
}
