// All scheduling is based on absolute instants (ISO / epoch). A timezone is only used to DISPLAY an instant or to
// bucket it into a calendar day. Authoritative local→UTC conversion happens on the server (create_follow_up RPC).

export function formatInTz(iso: string, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, ...opts,
  }).format(new Date(iso));
}

export function formatTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso));
}

/** 'YYYY-MM-DD' of an instant on the calendar of `tz`. */
export function dayKey(isoOrMs: string | number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoOrMs));
}

export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Inclusive Mon–Sun week containing `key`. */
export function weekRange(key: string): { start: string; end: string } {
  const [y, m, d] = key.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return { start: addDaysToKey(key, -dow), end: addDaysToKey(key, 6 - dow) };
}

/** Split an instant into the {date,time} strings an <input type=date/time> expects, in `tz`. */
export function splitLocal(iso: string, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  return { date: dayKey(iso, tz), time: parts.replace(/^24:/, "00:") };
}

export type FuBucket = "overdue" | "due_soon" | "today" | "upcoming" | "completed" | "cancelled";

/** Bucket a follow-up using real timestamps (never formatted strings). */
export function bucketOf(f: { status: string; due_at: string }, tz: string, nowMs = Date.now()): FuBucket {
  if (f.status === "completed") return "completed";
  if (f.status === "cancelled") return "cancelled";
  const due = new Date(f.due_at).getTime();
  if (due < nowMs) return "overdue";
  if (due - nowMs <= 60 * 60 * 1000) return "due_soon";
  return dayKey(due, tz) === dayKey(nowMs, tz) ? "today" : "upcoming";
}

export function relative(iso: string, nowMs = Date.now()): string {
  const diff = new Date(iso).getTime() - nowMs;
  const abs = Math.abs(diff), mins = Math.round(abs / 60000);
  const txt = mins < 1 ? "now" : mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
  if (mins < 1) return "now";
  return diff < 0 ? `${txt} ago` : `in ${txt}`;
}
