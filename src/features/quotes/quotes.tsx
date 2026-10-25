import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Plus, Printer, Send, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, Field, ListSkeleton, Modal, Pager, errMsg, useToast } from "@/components/ui";
import { CurrencySelect, useConfirm } from "@/components/extra";
import { formatMoney } from "@/lib/money";
import { formatInTz } from "@/lib/time";
import { useOrg } from "@/lib/data";
import { label, type Quote, type QuoteItem, type QuoteStatus } from "@/lib/types";
import type { DealRow } from "@/features/deals/api";

export const quoteTone = (s: QuoteStatus) => (s === "approved" ? "ok" : s === "rejected" ? "danger" : s === "submitted" ? "warn" : s === "draft" ? "brand" : undefined) as "ok" | "danger" | "warn" | "brand" | undefined;
export const quoteStatusLabel = (s: QuoteStatus) => (s === "submitted" ? "With Finance" : s === "rejected" ? "Returned" : label(s));

export function useQuoteItems(id: string | null) {
  return useQuery({
    queryKey: ["quote-items", id], enabled: !!id,
    queryFn: async () => ((await supabase.from("quote_items").select("*").eq("quote_id", id!).order("position")).data ?? []).map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })) as QuoteItem[],
  });
}
export const totals = (items: { quantity: number; unit_price: number }[], tax: number) => {
  const subtotal = items.reduce((a, i) => a + Number(i.quantity) * Number(i.unit_price), 0);
  const taxAmt = Math.round(subtotal * tax) / 100;
  return { subtotal, tax: taxAmt, total: Math.round((subtotal + taxAmt) * 100) / 100 };
};

type Draft = { description: string; quantity: string; unit_price: string };

export function QuoteForm({ deal, quote, onClose, onSaved }: { deal: DealRow; quote?: Quote; onClose: () => void; onSaved?: (id: string) => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const existing = useQuoteItems(quote?.id ?? null);
  const party = useQuery({
    queryKey: ["quote-party", deal.lead_id, deal.client_id], enabled: !quote,
    queryFn: async () => {
      if (deal.client_id) { const { data } = await supabase.from("clients").select("name,contact_name,email,country").eq("id", deal.client_id).maybeSingle(); return data ? { name: data.contact_name ?? data.name, company: data.name, email: data.email, country: data.country } : null; }
      if (deal.lead_id) { const { data } = await supabase.from("leads").select("full_name,company,email,country").eq("id", deal.lead_id).maybeSingle(); return data ? { name: data.full_name, company: data.company, email: data.email, country: data.country } : null; }
      return null;
    },
  });
  const [f, setF] = useState({
    currency: quote?.currency ?? deal.currency, customer_name: quote?.customer_name ?? "", customer_company: quote?.customer_company ?? "", customer_email: quote?.customer_email ?? "",
    customer_country: quote?.customer_country ?? "", project_title: quote?.project_title ?? deal.title, project_description: quote?.project_description ?? "",
    delivery_date: quote?.delivery_date ?? "", payment_terms: quote?.payment_terms ?? "", tax_rate: String(quote?.tax_rate ?? 0), notes: quote?.notes ?? "",
  });
  const [items, setItems] = useState<Draft[] | null>(null);
  const [prefilled, setPrefilled] = useState(!!quote);
  const [err, setErr] = useState<string | null>(null);
  if (!prefilled && party.data) { setPrefilled(true); setF((x) => ({ ...x, customer_name: party.data!.name ?? "", customer_company: party.data!.company ?? "", customer_email: party.data!.email ?? "", customer_country: party.data!.country ?? "" })); }
  const rows: Draft[] = items ?? (existing.data?.length ? existing.data.map((i) => ({ description: i.description, quantity: String(i.quantity), unit_price: String(i.unit_price) })) : [{ description: "", quantity: "1", unit_price: "" }]);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (i: number, k: keyof Draft, v: string) => setItems(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const t = totals(rows.map((r) => ({ quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0 })), Number(f.tax_rate) || 0);

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const valid = rows.filter((r) => r.description.trim() && Number(r.quantity) > 0 && r.unit_price !== "" && Number(r.unit_price) >= 0);
      if (!f.customer_name.trim()) throw new Error("Customer name is required.");
      if (!f.project_title.trim()) throw new Error("Project title is required.");
      if (submit && !f.project_description.trim()) throw new Error("Describe the project so Finance knows what is being sold.");
      if (submit && t.total <= 0) throw new Error("Add at least one priced line item.");
      const row = { currency: f.currency, customer_name: f.customer_name.trim(), customer_company: f.customer_company.trim() || null, customer_email: f.customer_email.trim() || null,
        customer_country: f.customer_country.trim() || null, project_title: f.project_title.trim(), project_description: f.project_description.trim() || null,
        delivery_date: f.delivery_date || null, payment_terms: f.payment_terms.trim() || null, tax_rate: Number(f.tax_rate) || 0, notes: f.notes.trim() || null };
      let id = quote?.id;
      if (id) { const { error } = await supabase.from("quotes").update(row).eq("id", id); if (error) throw error; const d = await supabase.from("quote_items").delete().eq("quote_id", id); if (d.error) throw d.error; }
      else { const { data, error } = await supabase.from("quotes").insert({ ...row, deal_id: deal.id }).select("id").single(); if (error) throw error; id = data.id as string; }
      if (valid.length) { const { error } = await supabase.from("quote_items").insert(valid.map((r, i) => ({ quote_id: id, position: i, description: r.description.trim(), quantity: Number(r.quantity), unit_price: Number(r.unit_price) }))); if (error) throw error; }
      if (submit) { const { error } = await supabase.rpc("submit_quote", { p_id: id }); if (error) throw error; }
      return { id: id!, submit };
    },
    onSuccess: ({ id, submit }) => {
      void qc.invalidateQueries({ queryKey: ["quotes"] }); void qc.invalidateQueries({ queryKey: ["quote-items"] }); void qc.invalidateQueries({ queryKey: ["deals"] }); void qc.invalidateQueries({ queryKey: ["activities"] });
      toast(submit ? "Quote sent to Finance for approval." : "Quote saved as a draft."); onSaved?.(id); onClose();
    },
    onError: (e) => setErr(errMsg(e)),
  });

  const inp = (k: keyof typeof f, lab: string, o: { span?: boolean; type?: string } = {}) => <Field label={lab} className={o.span ? "span-2" : ""}>{(id) => <input id={id} type={o.type ?? "text"} className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} />}</Field>;
  return (
    <Modal title={quote ? `Edit quote ${quote.quote_number}` : "New quote"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate(false)}>Save draft</Button>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(true)}><Send size={15} />Submit to Finance</Button></>}>
      {quote?.status === "rejected" && quote.rejection_reason && <div className="glass card" style={{ borderColor: "var(--danger)" }}><strong>Returned by Finance</strong><p className="muted">{quote.rejection_reason}</p></div>}
      <h3>Customer</h3>
      <div className="form-grid">{inp("customer_name", "Contact name *")}{inp("customer_company", "Company")}{inp("customer_email", "Email", { type: "email" })}{inp("customer_country", "Country")}</div>
      <h3>Project</h3>
      <div className="form-grid">
        {inp("project_title", "Project title *", { span: true })}
        <Field label="Project details (scope, deliverables) *" className="span-2">{(id) => <textarea id={id} className="textarea" value={f.project_description} onChange={(e) => set("project_description", e.target.value)} />}</Field>
        {inp("delivery_date", "Expected delivery", { type: "date" })}
        <Field label="Currency">{(id) => <CurrencySelect id={id} value={f.currency} onChange={(v) => set("currency", v)} />}</Field>
      </div>
      <h3>Pricing</h3>
      <div className="items-edit">
        {rows.map((r, i) => (
          <div className="item-row" key={i}>
            <input className="input" aria-label="Description" placeholder="Item / service" value={r.description} onChange={(e) => setRow(i, "description", e.target.value)} />
            <input className="input" aria-label="Quantity" type="number" min="0" step="0.01" value={r.quantity} onChange={(e) => setRow(i, "quantity", e.target.value)} />
            <input className="input" aria-label="Unit price" type="number" min="0" step="0.01" placeholder="Unit price" value={r.unit_price} onChange={(e) => setRow(i, "unit_price", e.target.value)} />
            <strong style={{ textAlign: "right" }}>{formatMoney((Number(r.quantity) || 0) * (Number(r.unit_price) || 0), f.currency)}</strong>
            <Button variant="ghost" size="sm" aria-label="Remove item" disabled={rows.length === 1} onClick={() => setItems(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></Button>
          </div>))}
        <div className="row"><Button size="sm" onClick={() => setItems([...rows, { description: "", quantity: "1", unit_price: "" }])}><Plus size={14} />Add line</Button>
          <label className="row" style={{ marginLeft: "auto", gap: 6 }}>Tax %<input className="input" style={{ width: 90 }} type="number" min="0" max="100" step="0.01" value={f.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} /></label></div>
        <div style={{ textAlign: "right" }}><div className="muted">Subtotal {formatMoney(t.subtotal, f.currency)} · Tax {formatMoney(t.tax, f.currency)}</div><h2>Total {formatMoney(t.total, f.currency)}</h2></div>
      </div>
      <div className="form-grid">
        <Field label="Payment terms / upfront proposal" className="span-2" hint="Finance makes the final decision on whether an upfront payment is required.">{(id) => <textarea id={id} className="textarea" style={{ minHeight: 70 }} value={f.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} placeholder="e.g. 50% upfront, balance on delivery" />}</Field>
        <Field label="Internal notes for Finance" className="span-2">{(id) => <textarea id={id} className="textarea" style={{ minHeight: 70 }} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

/** Read-only quote with the actions the viewer is allowed to take. */
export function QuoteView({ quoteId, deal, onClose }: { quoteId: string; deal?: DealRow | null; onClose: () => void }) {
  const { profile } = useAuth(); const toast = useToast(); const qc = useQueryClient(); const confirm = useConfirm(); const nav = useNavigate();
  const q = useQuery({ queryKey: ["quotes", "one", quoteId], queryFn: async () => (await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle()).data as Quote | null });
  const items = useQuoteItems(quoteId);
  const [editing, setEditing] = useState(false);
  const dealQ = useQuery({ queryKey: ["deal-for-quote", q.data?.deal_id], enabled: !!q.data && !deal, queryFn: async () => {
    const { data } = await supabase.from("deals").select("*, lead:leads(full_name,company), client:clients(name)").eq("id", q.data!.deal_id).maybeSingle();
    return data ? ({ ...data, lead: Array.isArray(data.lead) ? data.lead[0] : data.lead, client: Array.isArray(data.client) ? data.client[0] : data.client } as unknown as DealRow) : null; } });
  const d = deal ?? dealQ.data ?? null;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["quotes"] }); void qc.invalidateQueries({ queryKey: ["deals"] }); };
  const submit = useMutation({ mutationFn: async () => { const { error } = await supabase.rpc("submit_quote", { p_id: quoteId }); if (error) throw error; }, onSuccess: () => { toast("Sent to Finance."); refresh(); }, onError: (e) => toast(errMsg(e), "error") });
  const del = useMutation({ mutationFn: async () => { const { error } = await supabase.from("quotes").delete().eq("id", quoteId); if (error) throw error; }, onSuccess: () => { toast("Quote deleted."); refresh(); onClose(); }, onError: (e) => toast(errMsg(e), "error") });
  if (q.isLoading) return <Modal title="Quote" onClose={onClose}><ListSkeleton /></Modal>;
  const x = q.data;
  if (!x) return <Modal title="Quote" onClose={onClose}><Empty title="Quote not found" /></Modal>;
  const t = totals(items.data ?? [], Number(x.tax_rate));
  const editable = x.status === "draft" || x.status === "rejected";
  return (
    <Modal title={`${x.quote_number} · ${x.project_title}`} onClose={onClose}
      footer={<>
        {(editable || x.status === "cancelled") && <Button variant="danger" onClick={async () => { if (await confirm({ title: "Delete this quote?", body: "This cannot be undone.", danger: true, confirmLabel: "Delete" })) del.mutate(); }}><Trash2 size={15} />Delete</Button>}
        <Button onClick={() => { onClose(); nav(`/print/quote/${x.id}`); }}><Printer size={15} />Print / PDF</Button>
        {x.invoice_id && <Button onClick={() => { onClose(); nav(`/print/invoice/${x.invoice_id}`); }}><FileText size={15} />Invoice</Button>}
        {editable && d && <Button onClick={() => setEditing(true)}>Edit</Button>}
        {editable && <Button variant="primary" disabled={submit.isPending} onClick={() => submit.mutate()}><Send size={15} />Submit to Finance</Button>}
      </>}>
      <div className="row"><Badge tone={quoteTone(x.status)}>{quoteStatusLabel(x.status)}</Badge><span className="faint">Created {formatInTz(x.created_at, profile!.timezone)}</span></div>
      {x.status === "rejected" && x.rejection_reason && <div className="glass card" style={{ borderColor: "var(--danger)" }}><strong>Returned by Finance</strong><p className="muted">{x.rejection_reason}</p></div>}
      {x.status === "approved" && <div className="glass card" style={{ borderColor: "var(--ok)" }}><strong>Approved by Finance. Deal won.</strong>
        <p className="muted">{x.upfront_type && x.upfront_type !== "none" ? `Upfront required: ${x.upfront_type === "percent" ? `${x.upfront_value}%` : formatMoney(Number(x.upfront_value), x.currency)}.` : "No upfront payment required."} {x.finance_notes}</p></div>}
      <dl className="kv"><dt>Customer</dt><dd>{x.customer_name}{x.customer_company ? ` · ${x.customer_company}` : ""}</dd>
        {x.customer_email && <><dt>Email</dt><dd>{x.customer_email}</dd></>}{x.customer_country && <><dt>Country</dt><dd>{x.customer_country}</dd></>}
        <dt>Project</dt><dd style={{ whiteSpace: "pre-wrap" }}>{x.project_description ?? "—"}</dd>
        {x.delivery_date && <><dt>Delivery</dt><dd>{x.delivery_date}</dd></>}{x.payment_terms && <><dt>Terms</dt><dd>{x.payment_terms}</dd></>}</dl>
      <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th></tr></thead>
        <tbody>{items.data?.map((i) => <tr key={i.id}><td className="cell-main">{i.description}</td><td className="num" data-label="Qty">{i.quantity}</td><td className="num" data-label="Unit">{formatMoney(i.unit_price, x.currency)}</td><td className="num" data-label="Amount">{formatMoney(i.quantity * i.unit_price, x.currency)}</td></tr>)}</tbody></table></div>
      <div style={{ textAlign: "right" }}><div className="muted">Subtotal {formatMoney(t.subtotal, x.currency)} · Tax ({x.tax_rate}%) {formatMoney(t.tax, x.currency)}</div><h2>Total {formatMoney(t.total, x.currency)}</h2></div>
      {editing && d && <QuoteForm deal={d} quote={x} onClose={() => setEditing(false)} onSaved={refresh} />}
    </Modal>
  );
}

const PAGE = 25;
export function QuotesPage() {
  const { profile } = useAuth(); const [status, setStatus] = useState(""); const [page, setPage] = useState(0); const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["quotes", "list", status, page], placeholderData: (p) => p, queryFn: async () => {
    let r = supabase.from("quotes").select("id,quote_number,status,currency,project_title,customer_name,customer_company,created_at,deal_id", { count: "exact" }).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (status) r = r.eq("status", status);
    const { data, count, error } = await r; if (error) throw error;
    const ids = (data ?? []).map((x) => x.id as string);
    const tot = ids.length ? (await supabase.from("quote_totals").select("quote_id,total").in("quote_id", ids)).data ?? [] : [];
    const m = new Map(tot.map((t) => [t.quote_id as string, Number(t.total)]));
    return { rows: (data ?? []).map((x) => ({ ...x, total: m.get(x.id as string) ?? 0 })), total: count ?? 0 };
  } });
  return (
    <div className="page">
      <div className="page-head"><div><h1>Quotes</h1><p>Quotes go to Finance for approval. An approved quote wins the deal and issues the invoice. Start a quote from a deal in the Sales pipeline.</p></div>
        <div className="page-actions"><Link className="btn btn-primary" to="/deals"><Plus size={16} />Open pipeline</Link></div></div>
      <div className="glass">
        <div className="card" style={{ paddingBottom: 0 }}><div className="toolbar"><select className="select" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="">All statuses</option>{(["draft", "submitted", "approved", "rejected", "cancelled"] as QuoteStatus[]).map((s) => <option key={s} value={s}>{quoteStatusLabel(s)}</option>)}</select></div></div>
        {q.isLoading ? <div className="card"><ListSkeleton /></div> : !q.data?.rows.length ? <Empty icon={<FileText size={32} />} title="No quotes yet">Open a deal and choose “New quote”.</Empty>
          : <><div className="table-wrap"><table className="table"><thead><tr><th>Quote</th><th>Customer</th><th>Status</th><th className="num">Total</th><th>Created</th></tr></thead>
            <tbody>{q.data.rows.map((x) => <tr key={x.id} style={{ cursor: "pointer" }} onClick={() => setOpen(x.id as string)}>
              <td className="cell-main"><button className="btn btn-ghost btn-sm" style={{ padding: 0, minHeight: 0, fontWeight: 700 }} onClick={() => setOpen(x.id as string)}>{x.quote_number}</button><div className="cell-sub">{x.project_title}</div></td>
              <td data-label="Customer">{x.customer_company ?? x.customer_name}</td><td data-label="Status"><Badge tone={quoteTone(x.status as QuoteStatus)}>{quoteStatusLabel(x.status as QuoteStatus)}</Badge></td>
              <td className="num" data-label="Total">{formatMoney(x.total, String(x.currency).trim())}</td><td data-label="Created">{formatInTz(x.created_at as string, profile!.timezone, { hour: undefined, minute: undefined })}</td></tr>)}</tbody></table></div>
            <Pager page={page} pageSize={PAGE} total={q.data.total} onPage={setPage} /></>}
      </div>
      {open && <QuoteView quoteId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Customer-facing printable quote: Print → "Save as PDF". */
export function QuoteDocPage() {
  const { id = "" } = useParams(); const nav = useNavigate(); const org = useOrg();
  const q = useQuery({ queryKey: ["quotes", "one", id], queryFn: async () => (await supabase.from("quotes").select("*").eq("id", id).maybeSingle()).data as Quote | null });
  const items = useQuoteItems(id);
  if (q.isLoading) return <div className="page"><ListSkeleton /></div>;
  const x = q.data; if (!x) return <div className="page"><Empty title="Quote not found" /></div>;
  const t = totals(items.data ?? [], Number(x.tax_rate));
  return (
    <div className="page">
      <div className="row no-print"><Button onClick={() => nav(-1)}><ArrowLeft size={15} />Back</Button><Button variant="primary" onClick={() => window.print()}><Printer size={15} />Print / Save as PDF</Button>
        {x.status !== "approved" && <Badge tone="warn">Not yet approved by Finance. Do not send to the client</Badge>}</div>
      <div className="doc">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}><div><h1>Quotation</h1><div className="muted">{x.quote_number} · {new Date(x.created_at).toLocaleDateString()}</div></div>
          <div style={{ textAlign: "right" }}><img src="/logo.png" alt="" width={48} height={48} style={{ borderRadius: 10 }} /><div><strong>{org.data?.company_name ?? "FAR Tech & Developers"}</strong></div></div></div>
        <p style={{ marginTop: 20 }}><strong>Prepared for</strong><br />{x.customer_name}{x.customer_company ? `, ${x.customer_company}` : ""}<br />{x.customer_email}{x.customer_country ? ` · ${x.customer_country}` : ""}</p>
        <h3>{x.project_title}</h3><p style={{ whiteSpace: "pre-wrap" }}>{x.project_description}</p>
        {x.delivery_date && <p className="muted">Expected delivery: {x.delivery_date}</p>}
        <table><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
          <tbody>{items.data?.map((i) => <tr key={i.id}><td>{i.description}</td><td className="num">{i.quantity}</td><td className="num">{formatMoney(i.unit_price, x.currency)}</td><td className="num">{formatMoney(i.quantity * i.unit_price, x.currency)}</td></tr>)}</tbody></table>
        <div style={{ textAlign: "right" }}><div className="muted">Subtotal {formatMoney(t.subtotal, x.currency)}</div>{Number(x.tax_rate) > 0 && <div className="muted">Tax ({x.tax_rate}%) {formatMoney(t.tax, x.currency)}</div>}<h2>Total {formatMoney(t.total, x.currency)}</h2></div>
        {x.upfront_type && x.upfront_type !== "none" && <p><strong>Upfront payment:</strong> {x.upfront_type === "percent" ? `${x.upfront_value}% of the total` : formatMoney(Number(x.upfront_value), x.currency)}</p>}
        {x.payment_terms && <p><strong>Payment terms:</strong> {x.payment_terms}</p>}
      </div>
    </div>
  );
}
