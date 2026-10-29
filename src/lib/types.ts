export type Role = "super_admin" | "cso" | "sales_executive" | "project_manager" | "team_lead" | "developer" | "ai_developer" | "finance";
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin", cso: "Chief Sales Officer", sales_executive: "Sales Executive",
  project_manager: "Project Manager", team_lead: "Team Lead", developer: "Developer", ai_developer: "AI Developer", finance: "Finance / Accounts",
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

export type Stage = { id: string; name: string; position: number; is_won: boolean; is_lost: boolean; probability: number };
export type Deal = {
  id: string; title: string; lead_id: string | null; client_id: string | null; stage_id: string; value: number; currency: string;
  owner_id: string; expected_close_date: string | null; closed_at: string | null; won_confirmed_at: string | null; lost_reason: string | null;
  notes: string | null; created_at: string;
};
export type QuoteStatus = "draft" | "submitted" | "approved" | "rejected" | "cancelled";
export type Quote = {
  id: string; quote_number: string; deal_id: string; status: QuoteStatus; currency: string; customer_name: string; customer_company: string | null;
  customer_email: string | null; customer_country: string | null; project_title: string; project_description: string | null;
  delivery_date: string | null; payment_terms: string | null; tax_rate: number; notes: string | null; upfront_type: string | null;
  upfront_value: number | null; finance_notes: string | null; rejection_reason: string | null; submitted_at: string | null;
  invoice_id: string | null; created_by: string | null; created_at: string;
};
export type QuoteItem = { id: string; quote_id: string; position: number; description: string; quantity: number; unit_price: number };
export type InvoiceBalance = {
  invoice_id: string; invoice_number: string; client_id: string; deal_id: string | null; quote_id: string | null; status: "draft" | "sent" | "void";
  currency: string; issue_date: string; due_date: string; subtotal: number; tax_amount: number; total: number; amount_paid: number;
  balance_due: number; payment_state: string; is_overdue: boolean; upfront_amount: number; upfront_received: boolean; last_paid_at: string | null;
};
export type Payment = { id: string; invoice_id: string; amount: number; paid_at: string; method: string; reference: string | null; notes: string | null };
export type Project = {
  id: string; name: string; description: string | null; client_id: string | null; status: "planning" | "active" | "on_hold" | "completed" | "cancelled";
  project_manager_id: string | null; team_lead_id: string | null; start_date: string | null; due_date: string | null; created_at: string;
};
export type TaskStatus = "todo" | "in_progress" | "in_review" | "blocked" | "done" | "cancelled";
export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
export type Task = {
  id: string; project_id: string; title: string; description: string | null; status: TaskStatus; priority: Priority;
  assigned_to: string | null; due_date: string | null; completed_at: string | null; created_at: string;
};
export type Message = { id: string; sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null };
export type Contact = { id: string; full_name: string; role: Role; can_start: boolean; last_body: string | null; last_at: string | null; last_from_me: boolean | null; unread: number };
