import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FileText, Kanban, List, Plus, Search, Trash2, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, Field, ListSkeleton, Modal, errMsg, useToast } from "@/components/ui";
import { CurrencySelect, MissingRates, Stat, useConfirm } from "@/components/extra";
import { convertPartial, formatMoney, missingFor, monthKey, sumConverted } from "@/lib/money";
import { formatInTz } from "@/lib/time";
import { useOrg, useRates, useStages, useTeam } from "@/lib/data";
import type { Activity, Quote, Stage } from "@/lib/types";
import { dealParty, useDeals, type DealRow } from "./api";
import { QuoteForm, QuoteView, quoteStatusLabel, quoteTone } from "@/features/quotes/quotes";

const initials = (n?: string) => (n ?? "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function DealForm({ onClose, fixed }: { onClose: () => void; fixed?: { lead_id?: string; client_id?: string; name: string } }) {
  const { profile, can } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const stages = useStages(); const org = useOrg(); const team = useTeam();
  const [kind, setKind] = useState<"lead" | "client">(fixed?.client_id ? "client" : "lead");
  const [party, setParty] = useState(fixed?.lead_id ?? fixed?.client_id ?? "");
  const [f, setF] = useState({ title: "", value: "", currency: "", stage_id: "", owner_id: profile!.id, expected_close_date: "", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const parties = useQuery({ queryKey: ["deal-parties", kind], enabled: !fixed, queryFn: async () => {
    const { data } = await supabase.from(kind === "lead" ? "leads" : "clients").select(kind === "lead" ? "id,full_name,company" : "id,name").order("created_at", { ascending: false }).limit(200);
    return (data ?? []) as unknown as { id: string; full_name?: string; company?: string; name?: string }[]; } });
  const open = (stages.data ?? []).filter((s) => !s.is_won && !s.is_lost);
  const stageId = f.stage_id || open[0]?.id || ""; const cur = f.currency || org.data?.default_currency?.trim() || "USD";
  const save = useMutation({
    mutationFn: async () => {
      if (!f.title.trim()) throw new Error("Give the deal a title.");
      if (!party) throw new Error("Choose the lead or client.");
      const row = { title: f.title.trim(), stage_id: stageId, value: Number(f.value) || 0, currency: cur, owner_id: f.owner_id, expected_close_date: f.expected_close_date || null, notes: f.notes.trim() || null,
        lead_id: kind === "lead" ? party : null, client_id: kind === "client" ? party : null };
      const { error } = await supabase.from("deals").insert(row); if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["deals"] }); toast("Deal created."); onClose(); }, onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal title="New deal" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Create deal"}</Button></>}>
      <div className="form-grid">
        <Field label="Deal title *" className="span-2">{(id) => <input id={id} className="input" value={f.title} placeholder="Website redesign for Nova Digital" onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        {fixed ? <p className="span-2 muted">For: <strong>{fixed.name}</strong></p> : (<>
          <Field label="Related to">{(id) => <select id={id} className="select" value={kind} onChange={(e) => { setKind(e.target.value as "lead"); setParty(""); }}><option value="lead">Lead</option><option value="client">Client</option></select>}</Field>
          <Field label={kind === "lead" ? "Lead *" : "Client *"}>{(id) => <select id={id} className="select" value={party} onChange={(e) => setParty(e.target.value)}><option value="">Choose…</option>{parties.data?.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.name}{p.company ? ` · ${p.company}` : ""}</option>)}</select>}</Field></>)}
        <Field label="Expected value">{(id) => <input id={id} type="number" min="0" step="0.01" className="input" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>
        <Field label="Currency">{(id) => <CurrencySelect id={id} value={cur} onChange={(v) => setF({ ...f, currency: v })} />}</Field>
        <Field label="Stage">{(id) => <select id={id} className="select" value={stageId} onChange={(e) => setF({ ...f, stage_id: e.target.value })}>{open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</Field>
        <Field label="Expected close date">{(id) => <input id={id} type="date" className="input" value={f.expected_close_date} onChange={(e) => setF({ ...f, expected_close_date: e.target.value })} />}</Field>
        <Field label="Owner" className="span-2">{(id) => <select id={id} className="select" disabled={!can("deals.view_all")} value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}>{team.data?.filter((u) => u.is_active && ["sales_executive", "cso", "super_admin"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>}</Field>
        <Field label="Notes" className="span-2">{(id) => <textarea id={id} className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
      <p className="hint">A deal becomes <strong>Won</strong> only after you submit a quote and Finance approves it.</p>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

function DealDrawer({ deal, stages, onClose }: { deal: DealRow; stages: Stage[]; onClose: () => void }) {
  const { profile, can } = useAuth(); const toast = useToast(); const qc = useQueryClient(); const confirm = useConfirm(); const team = useTeam();
  const [f, setF] = useState({ title: deal.title, value: String(deal.value), currency: deal.currency, stage_id: deal.stage_id, expected_close_date: deal.expected_close_date ?? "", notes: deal.notes ?? "", lost_reason: deal.lost_reason ?? "" });
  const [quoting, setQuoting] = useState(false); const [view, setView] = useState<string | null>(null); const [editQuote, setEditQuote] = useState<Quote | null>(null);
  const won = !!deal.won_confirmed_at; const stage = stages.find((s) => s.id === f.stage_id);
  const quotes = useQuery({ queryKey: ["quotes", "deal", deal.id], queryFn: async () => ((await supabase.from("quotes").select("*").eq("deal_id", deal.id).order("created_at", { ascending: false })).data ?? []) as Quote[] });
  const acts = useQuery({ queryKey: ["activities", "deal", deal.id], queryFn: async () => ((await supabase.from("activities").select("id,kind,summary,created_at,actor_id,metadata").eq("entity_type", "deal").eq("entity_id", deal.id).order("created_at", { ascending: false }).limit(50)).data ?? []) as Activity[] });
  const inv = useQuery({ queryKey: ["deal-invoice", deal.id], enabled: won, queryFn: async () => (await supabase.from("invoice_balances").select("invoice_id,invoice_number,total,amount_paid,currency,payment_state,upfront_amount,upfront_received").eq("deal_id", deal.id).maybeSingle()).data });
  const save = useMutation({
    mutationFn: async () => {
      const row: Record<string, unknown> = { title: f.title.trim(), value: Number(f.value) || 0, currency: f.currency, expected_close_date: f.expected_close_date || null, notes: f.notes.trim() || null };
      if (!won) { row.stage_id = f.stage_id; row.lost_reason = stage?.is_lost ? f.lost_reason.trim() || null : null; }
      const { error } = await supabase.from("deals").update(row).eq("id", deal.id); if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["deals"] }); void qc.invalidateQueries({ queryKey: ["activities"] }); toast("Deal saved."); }, onError: (e) => toast(errMsg(e), "error"),
  });
  const del = useMutation({ mutationFn: async () => { const { error } = await supabase.rpc("delete_deal", { p_id: deal.id }); if (error) throw error; }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["deals"] }); toast("Deal deleted."); onClose(); }, onError: (e) => toast(errMsg(e), "error") });
  const owner = team.data?.find((u) => u.id === deal.owner_id)?.full_name ?? "—";
  const hasOpenQuote = quotes.data?.some((q) => q.status === "submitted");

  return (
    <Modal title={deal.title} side="right" onClose={onClose}
      footer={<><Button variant="danger" onClick={async () => { if (await confirm({ title: "Delete this deal?", body: "Its quotes and history are deleted too. A deal with an invoice must have the invoice removed by Finance first.", danger: true, confirmLabel: "Delete deal" })) del.mutate(); }}><Trash2 size={15} />Delete</Button>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save changes</Button></>}>
      <div className="row"><Badge tone={won ? "ok" : stage?.is_lost ? "danger" : "brand"}>{stage?.name}</Badge>
        <span className="faint">{dealParty(deal)} · owner {owner}</span>
        {deal.lead_id && <Link to={`/leads/${deal.lead_id}`}>Open lead</Link>}{deal.client_id && <Link to={`/clients/${deal.client_id}`}>Open client</Link>}</div>
      {won && (<div className="glass card" style={{ borderColor: "var(--ok)" }}><div className="row"><Trophy size={18} color="var(--ok)" /><strong>Won. Confirmed by Finance on {formatInTz(deal.won_confirmed_at!, profile!.timezone, { hour: undefined, minute: undefined })}</strong></div>
        {inv.data && <p className="muted">Invoice <Link to={`/print/invoice/${inv.data.invoice_id}`}>{inv.data.invoice_number}</Link> · {formatMoney(Number(inv.data.total), String(inv.data.currency).trim())} · paid {formatMoney(Number(inv.data.amount_paid), String(inv.data.currency).trim())}{Number(inv.data.upfront_amount) > 0 ? ` · upfront ${inv.data.upfront_received ? "received" : "awaited"}` : ""}</p>}</div>)}
      <div className="form-grid">
        <Field label="Title" className="span-2">{(id) => <input id={id} className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Value">{(id) => <input id={id} type="number" min="0" step="0.01" className="input" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} disabled={won} />}</Field>
        <Field label="Currency">{(id) => <CurrencySelect id={id} value={f.currency} onChange={(v) => setF({ ...f, currency: v })} disabled={won} />}</Field>
        <Field label="Stage" hint={won ? "Locked while the invoice exists" : "Won is set by Finance approval"}>{(id) => <select id={id} className="select" disabled={won} value={f.stage_id} onChange={(e) => setF({ ...f, stage_id: e.target.value })}>{stages.filter((s) => !s.is_won || won).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}</Field>
        <Field label="Expected close">{(id) => <input id={id} type="date" className="input" value={f.expected_close_date} onChange={(e) => setF({ ...f, expected_close_date: e.target.value })} />}</Field>
        {stage?.is_lost && <Field label="Why was it lost?" className="span-2">{(id) => <input id={id} className="input" value={f.lost_reason} onChange={(e) => setF({ ...f, lost_reason: e.target.value })} />}</Field>}
        <Field label="Notes" className="span-2">{(id) => <textarea id={id} className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
      <div className="card-head" style={{ marginBottom: 0 }}><h3>Quotes</h3>{can("quotes.create") && !won && !hasOpenQuote && <Button size="sm" variant="primary" onClick={() => setQuoting(true)}><Plus size={14} />New quote</Button>}</div>
      {quotes.isLoading ? <ListSkeleton /> : !quotes.data?.length ? <p className="muted">No quote yet. When the client agrees a price, create a quote with the project details and submit it to Finance.</p>
        : <div className="stack">{quotes.data.map((q) => (<button key={q.id} className="kcard" style={{ cursor: "pointer" }} onClick={() => setView(q.id)}>
          <div className="kcard-top"><strong>{q.quote_number}</strong><Badge tone={quoteTone(q.status)}>{quoteStatusLabel(q.status)}</Badge></div><span className="muted">{q.project_title}</span></button>))}</div>}
      <h3>Activity</h3>
      {acts.isLoading ? <ListSkeleton /> : !acts.data?.length ? <p className="muted">No activity yet.</p>
        : <div className="timeline">{acts.data.map((a) => <div className="tl-item" key={a.id}><span className="tl-dot" /><div><div>{a.summary}</div><div className="tl-meta">{formatInTz(a.created_at, profile!.timezone)}</div></div></div>)}</div>}
      {quoting && <QuoteForm deal={deal} onClose={() => setQuoting(false)} />}
      {editQuote && <QuoteForm deal={deal} quote={editQuote} onClose={() => setEditQuote(null)} />}
      {view && <QuoteView quoteId={view} deal={deal} onClose={() => setView(null)} />}
    </Modal>
  );
}

export function DealsPage() {
  const { can, profile } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const deals = useDeals(); const stages = useStages(); const rates = useRates(); const team = useTeam(); const org = useOrg();
  const [view, setView] = useState<"kanban" | "list">(() => (localStorage.getItem("fartech.dealview") as "list") || "kanban");
  const [show, setShow] = useState<"USD" | "PKR">(() => (localStorage.getItem("fartech.showcur") as "PKR") || "USD");
  const [search, setSearch] = useState(""); const [owner, setOwner] = useState(""); const [creating, setCreating] = useState(false); const [over, setOver] = useState<string | null>(null);
  useEffect(() => { localStorage.setItem("fartech.dealview", view); }, [view]);
  useEffect(() => { localStorage.setItem("fartech.showcur", show); }, [show]);
  const tz = profile!.timezone; const thisMonth = monthKey(Date.now(), tz); const r = rates.data ?? [];
  const st = stages.data ?? [];
  const list = useMemo(() => (deals.data ?? []).filter((d) => (!owner || d.owner_id === owner) && (!search || (d.title + dealParty(d)).toLowerCase().includes(search.toLowerCase()))), [deals.data, owner, search]);
  const stageOf = (d: DealRow) => st.find((s) => s.id === d.stage_id);
  const open = list.filter((d) => { const s = stageOf(d); return s && !s.is_won && !s.is_lost; });
  const to = (d: DealRow, amount = d.value) => { const c = convertPartial(r, d.currency, thisMonth, amount); return (show === "USD" ? c.usd : c.pkr) ?? 0; };
  const missing = missingFor(sumConverted(r, open.map((d) => ({ amount: d.value, currency: d.currency, month: thisMonth }))), show);
  const quoteStatus = useQuery({ queryKey: ["quotes", "by-deal"], refetchInterval: 60_000, queryFn: async () => {
    const { data } = await supabase.from("quotes").select("deal_id,status,created_at").order("created_at", { ascending: false }).limit(3000);
    const m = new Map<string, string>(); for (const q of data ?? []) if (!m.has(q.deal_id as string)) m.set(q.deal_id as string, q.status as string); return m; } });
  const pipeline = open.reduce((a, d) => a + to(d), 0);
  const weighted = open.reduce((a, d) => a + to(d, d.value * (stageOf(d)?.probability ?? 0) / 100), 0);
  const closing = open.filter((d) => d.expected_close_date && d.expected_close_date.slice(0, 7) === thisMonth.slice(0, 7));
  const wonMonth = list.filter((d) => d.won_confirmed_at && monthKey(d.won_confirmed_at, tz) === thisMonth);
  const wonSum = sumConverted(r, wonMonth.map((d) => ({ amount: d.value, currency: d.currency, month: thisMonth })));
  const fmt = (n: number) => formatMoney(n, show, { compact: true });
  const selected = deals.data?.find((d) => d.id === params.get("deal")) ?? null;

  const move = useMutation({
    mutationFn: async (a: { id: string; stage: Stage }) => { const { error } = await supabase.from("deals").update({ stage_id: a.stage.id }).eq("id", a.id); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["deals"] }); void qc.invalidateQueries({ queryKey: ["activities"] }); }, onError: (e) => toast(errMsg(e), "error"),
  });
  const tryMove = (d: DealRow, s: Stage) => {
    if (d.stage_id === s.id) return;
    if (d.won_confirmed_at) return toast("A won deal stays Won while its invoice exists.", "info");
    if (s.is_won) {
      const qs = quoteStatus.data?.get(d.id);
      return toast(qs === "submitted" ? "This deal’s quote is with Finance. It becomes Won when Finance approves it."
        : qs === "draft" ? "You have a DRAFT quote that Finance cannot see yet. Open the deal and press “Submit to Finance”."
        : qs === "rejected" ? "Finance returned the quote. Open the deal, fix it and submit it again."
        : "To win this deal, open it, create a quote and submit it to Finance. Finance approval marks it Won.", "info");
    }
    move.mutate({ id: d.id, stage: s });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sales pipeline</h1><p>Track deals, forecast revenue and move opportunities toward closing. Won deals are confirmed by Finance.</p></div>
        <div className="page-actions">
          <div className="seg" role="group" aria-label="Show totals in"><button aria-pressed={show === "USD"} onClick={() => setShow("USD")}>USD</button><button aria-pressed={show === "PKR"} onClick={() => setShow("PKR")}>PKR</button></div>
          <div className="seg" role="group" aria-label="View"><button aria-pressed={view === "kanban"} onClick={() => setView("kanban")}><Kanban size={15} />Kanban</button><button aria-pressed={view === "list"} onClick={() => setView("list")}><List size={15} />List</button></div>
          {can("deals.write") && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} />Create deal</Button>}
        </div>
      </div>

      <div className="grid kpis">
        <Stat label="Total pipeline value" value={fmt(pipeline)} sub={`Across ${open.length} open deals`} />
        <Stat label="Weighted forecast" value={fmt(weighted)} sub="Value × stage probability" />
        <Stat label="Active deals" value={open.length} sub={`${list.filter((d) => stageOf(d)?.is_lost).length} lost · ${list.filter((d) => d.won_confirmed_at).length} won`} />
        <Stat label="Closing this month" value={closing.length} sub={fmt(closing.reduce((a, d) => a + to(d), 0))} icon={<CalendarDays size={16} />} />
        <Stat label="Won this month" value={wonMonth.length} sub={fmt(show === "USD" ? wonSum.usd : wonSum.pkr)} tone="ok" icon={<Trophy size={16} />} />
      </div>
      {missing.length > 0 && <MissingRates missing={missing} />}

      <div className="stage-strip" aria-label="Pipeline by stage">
        {st.filter((s) => !s.is_lost).map((s) => { const ds = list.filter((d) => d.stage_id === s.id); return (
          <div className="stage-chip" key={s.id}><strong>{s.name}</strong><span>{ds.length} deals · {fmt(ds.reduce((a, d) => a + to(d), 0))}</span></div>); })}
      </div>

      <div className="toolbar" style={{ padding: "0 8px" }}>
        <div style={{ position: "relative", flex: "2 1 220px", maxWidth: 360 }}><Search size={16} style={{ position: "absolute", left: 12, top: 13 }} aria-hidden />
          <input className="input" style={{ paddingLeft: 36, maxWidth: "none" }} aria-label="Search deals" placeholder="Search deals or clients" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {can("deals.view_all") && <select className="select" aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">All reps</option>{team.data?.filter((u) => ["sales_executive", "cso", "super_admin"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>}
      </div>

      {deals.isLoading || stages.isLoading ? <div className="glass card"><ListSkeleton /></div>
        : view === "kanban" ? (
          <div className="kanban">
            {st.map((s) => { const ds = list.filter((d) => d.stage_id === s.id); return (
              <div key={s.id} className="glass kcol" data-over={over === s.id}
                onDragOver={(e) => { e.preventDefault(); setOver(s.id); }} onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); const d = deals.data?.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (d) tryMove(d, s); }}>
                <div className="kcol-head"><span>{s.name} <Badge>{ds.length}</Badge></span><span className="kcol-total">{fmt(ds.reduce((a, d) => a + to(d), 0))}</span></div>
                {ds.length === 0 && <p className="faint" style={{ fontSize: "0.82rem", textAlign: "center", padding: "16px 0" }}>{s.is_won ? "Finance-confirmed deals appear here" : "Drop deals here"}</p>}
                {ds.map((d) => (
                  <div key={d.id} role="button" tabIndex={0} className="kcard" data-won={!!d.won_confirmed_at} draggable={!d.won_confirmed_at}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", d.id)} onClick={() => setParams({ deal: d.id })} onKeyDown={(e) => { if (e.key === "Enter") setParams({ deal: d.id }); }}>
                    <div className="kcard-top"><span className="kcard-amt">{formatMoney(d.value, d.currency)}</span>{d.won_confirmed_at ? <Badge tone="ok">Won</Badge> : s.is_lost ? <Badge tone="danger">Lost</Badge> : <Badge tone="brand">{s.probability}%</Badge>}</div>
                    {!d.won_confirmed_at && !s.is_lost && quoteStatus.data?.get(d.id) && (quoteStatus.data.get(d.id) === "submitted" ? <Badge tone="warn">Quote with Finance</Badge> : quoteStatus.data.get(d.id) === "draft" ? <Badge tone="brand">Draft quote (not sent)</Badge> : quoteStatus.data.get(d.id) === "rejected" ? <Badge tone="danger">Quote returned</Badge> : null)}
                    <strong>{d.title}</strong><span className="muted" style={{ fontSize: "0.84rem" }}>{dealParty(d)}</span>
                    {!s.is_won && !s.is_lost && <div className="prob" aria-label={`Probability ${s.probability}%`}><i style={{ width: `${s.probability}%` }} /></div>}
                    <div className="kcard-top"><span className="faint" style={{ fontSize: "0.78rem" }}>{d.expected_close_date ? `Close ${d.expected_close_date}` : "No close date"}</span><span className="avatar" style={{ width: 26, height: 26, fontSize: "0.68rem" }} title={team.data?.find((u) => u.id === d.owner_id)?.full_name}>{initials(team.data?.find((u) => u.id === d.owner_id)?.full_name)}</span></div>
                    {!d.won_confirmed_at && <select className="select move-select" aria-label={`Move ${d.title} to stage`} value={d.stage_id} onClick={(e) => e.stopPropagation()} onChange={(e) => { const ns = st.find((x) => x.id === e.target.value); if (ns) tryMove(d, ns); }}>{st.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
                  </div>))}
              </div>); })}
          </div>)
        : (<div className="glass">{!list.length ? <Empty icon={<FileText size={32} />} title="No deals yet">Create a deal from a lead or with “Create deal”.</Empty> :
          <div className="table-wrap"><table className="table"><thead><tr><th>Deal</th><th>Stage</th><th className="num">Value</th><th>Owner</th><th>Close</th></tr></thead>
            <tbody>{list.map((d) => <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => setParams({ deal: d.id })}>
              <td className="cell-main"><span className="cell-strong">{d.title}</span><div className="cell-sub">{dealParty(d)}</div></td>
              <td data-label="Stage"><Badge tone={d.won_confirmed_at ? "ok" : stageOf(d)?.is_lost ? "danger" : "brand"}>{stageOf(d)?.name}</Badge></td>
              <td className="num" data-label="Value">{formatMoney(d.value, d.currency)}</td><td data-label="Owner">{team.data?.find((u) => u.id === d.owner_id)?.full_name ?? "—"}</td><td data-label="Close">{d.expected_close_date ?? "—"}</td></tr>)}</tbody></table></div>}</div>)}
      <p className="hint" style={{ padding: "0 8px" }}>Totals are converted with the exchange rate for the current month ({org.data?.default_currency ? "" : ""}entered under Targets &amp; rates). Amounts on cards stay in their own currency.</p>
      {creating && <DealForm onClose={() => setCreating(false)} />}
      {selected && stages.data && <DealDrawer key={selected.id} deal={selected} stages={stages.data} onClose={() => setParams({})} />}
    </div>
  );
}
