export type Role = "super_admin" | "cso" | "sales_executive" | "project_manager" | "team_lead" | "developer" | "finance";
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin", cso: "Chief Sales Officer", sales_executive: "Sales Executive",
  project_manager: "Project Manager", team_lead: "Team Lead", developer: "Developer", finance: "Finance / Accounts",
};
export const ROLES = Object.keys(ROLE_LABEL) as Role[];

export type Profile = {
  id: string; username: string; full_name: string; role: Role; is_active: boolean;
  must_change_password: boolean; timezone: string; phone: string | null;
};

export type LeadStatus = "new" | "contacting" | "connected" | "in_conversation" | "no_response" | "qualified" | "converted" | "lost" | "archived";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacting", "connected", "in_conversation", "no_response", "qualified", "converted", "lost", "archived"];
export type LeadSource = "linkedin" | "instagram" | "facebook" | "x" | "whatsapp" | "referral" | "website" | "other";
export const LEAD_SOURCES: LeadSource[] = ["linkedin", "instagram", "facebook", "x", "whatsapp", "referral", "website", "other"];

export type Lead = {
  id: string; full_name: string; company: string | null; job_title: string | null; email: string | null; phone: string | null;
  linkedin_url: string | null; website: string | null; country: string | null; industry: string | null;
  source: LeadSource; status: LeadStatus; temperature: "cold" | "warm" | "hot"; owner_id: string | null;
  notes: string | null; converted_client_id: string | null; created_at: string; updated_at: string;
};
export type Client = {
  id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null;
  industry: string | null; address: string | null; country: string | null; notes: string | null; is_active: boolean;
  owner_id: string | null; created_at: string;
};

export type FollowUpType = "call" | "email" | "meeting" | "message" | "whatsapp" | "linkedin" | "other";
export const FOLLOW_UP_TYPES: FollowUpType[] = ["call", "email", "meeting", "message", "whatsapp", "linkedin", "other"];
export type Priority = "low" | "medium" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

export type FollowUp = {
  id: string; lead_id: string | null; client_id: string | null; title: string; follow_up_type: FollowUpType;
  priority: Priority; due_at: string; timezone: string; assigned_to: string; notes: string | null;
  status: "pending" | "completed" | "cancelled"; reminder_offsets: number[]; completed_at: string | null;
  entity_type: "lead" | "client"; entity_id: string; entity_name: string | null; assigned_to_name: string | null; is_overdue: boolean;
};

export type AppNotification = {
  id: string; type: string; title: string; body: string | null; link: string | null; follow_up_id: string | null;
  entity_type: string | null; entity_id: string | null; read_at: string | null; created_at: string;
};
export type Activity = { id: number; kind: string; summary: string; created_at: string; actor_id: string | null; metadata: Record<string, unknown> };

export const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "At the scheduled time" }, { value: 5, label: "5 minutes before" }, { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" }, { value: 60, label: "1 hour before" }, { value: 1440, label: "1 day before" },
];

export const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
