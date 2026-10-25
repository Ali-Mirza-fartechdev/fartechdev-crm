import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CreditCard, Plus, Printer, Receipt, Trash2, Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, Field, ListSkeleton, Modal, errMsg, useToast } from "@/components/ui";
import { CurrencySelect, MissingRates, Stat, useConfirm } from "@/components/extra";
import { formatMoney, monthKey, sumConverted } from "@/lib/money";
import { formatInTz } from "@/lib/time";
import { useOrg, useRates } from "@/lib/data";
import { label, type InvoiceBalance, type Payment, type Quote } from "@/lib/types";
import { totals, useQuoteItems, quoteStatusLabel, quoteTone } from "@/features/quotes/quotes";

const cur = (s: string) => String(s).trim();
const num = (v: unknown) => Number(v);
const invTone = (i: InvoiceBalance) => (i.status === "void" ? undefined : i.payment_state === "paid" ? "ok" : i.is_overdue ? "danger" : i.payment_state === "partially_paid" ? "warn" : "brand") as "ok" | "danger" | "warn" | "brand" | undefined;
const invLabel = (i: InvoiceBalance) => (i.status === "draft" ? "Draft" : i.is_overdue ? "Overdue" : label(i.payment_state));

function useInvoices() {
  return useQuery({
    queryKey: ["invoices"], refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_balances").select("*").order("issue_date", { ascending: false }).limit(1000);
      if (error) throw error;
      const rows = (data ?? []).map((d) => ({ ...d, currency: cur(d.currency), subtotal: num(d.subtotal), tax_amount: num(d.tax_amount), total: num(d.total), amount_paid: num(d.amount_paid), balance_due: num(d.balance_due), upfront_amount: num(d.upfront_amount) })) as InvoiceBalance[];
      const ids = [...new Set(rows.map((r) => r.client_id))];
      const cl = ids.length ? (await supabase.from("clients").select("id,name").in("id", ids)).data ?? [] : [];
      const names = new Map(cl.map((c) => [c.id as string, c.name as string]));
      return rows.map((r) => ({ ...r, client_name: names.get(r.client_id) ?? "—" }));
    },
  });
}
function usePayments() {
  return useQuery({ queryKey: ["payments"], queryFn: async () => ((await supabase.from("payments").select("*").order("paid_at", { ascending: false }).limit(1000)).data ?? []).map((p) => ({ ...p, amount: num(p.amount) })) as Payment[] });
}

function ReviewDialog({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient(); const items = useQuoteItems(quote.id); const org = useOrg();
  const t = totals(items.data ?? [], num(quote.tax_rate));
  const [up, setUp] = useState<"none" | "percent" | "fixed">("none"); const [val, setVal] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10)); const [notes, setNotes] = useState(""); const [reason, setReason] = useState(""); const [mode, setMode] = useState<"approve" | "return">("approve");
  const [err, setErr] = useState<string | null>(null);
  const upAmount = up === "percent" ? Math.round(t.total * (Number(val) || 0)) / 100 : up === "fixed" ? Number(val) || 0 : 0;
  const done = () => { void qc.invalidateQueries({ queryKey: ["quotes"] }); void qc.invalidateQueries({ queryKey: ["invoices"] }); void qc.invalidateQueries({ queryKey: ["deals"] }); onClose(); };
  const approve = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("approve_quote", { p_id: quote.id, p_upfront_type: up, p_upfront_value: up === "none" ? 0 : Number(val), p_due_date: due, p_notes: notes.trim() || null }); if (error) throw error; },
    onSuccess: () => { toast("Approved. Invoice issued and the deal is now Won."); done(); }, onError: (e) => setErr(errMsg(e)),
  });
  const reject = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("reject_quote", { p_id: quote.id, p_reason: reason }); if (error) throw error; },
    onSuccess: () => { toast("Quote returned to the sales owner."); done(); }, onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal title={`Review ${quote.quote_number}`} onClose={onClose}
      footer={mode === "approve" ? <><Button onClick={() => setMode("return")}><Undo2 size={15} />Return to sales</Button><Button variant="primary" disabled={approve.isPending} onClick={() => approve.mutate()}><Check size={15} />Approve &amp; issue invoice</Button></>
        : <><Button onClick={() => setMode("approve")}>Back</Button><Button variant="danger" disabled={reject.isPending || reason.trim().length < 3} onClick={() => reject.mutate()}>Return quote</Button></>}>
      <div className="row"><Badge tone={quoteTone(quote.status)}>{quoteStatusLabel(quote.status)}</Badge><strong>{quote.project_title}</strong></div>
      <dl className="kv"><dt>Customer</dt><dd>{quote.customer_name}{quote.customer_company ? ` · ${quote.customer_company}` : ""}{quote.customer_country ? ` · ${quote.customer_country}` : ""}</dd>
        <dt>Project</dt><dd style={{ whiteSpace: "pre-wrap" }}>{quote.project_description}</dd>{quote.delivery_date && <><dt>Delivery</dt><dd>{quote.delivery_date}</dd></>}
        {quote.payment_terms && <><dt>Sales proposal</dt><dd>{quote.payment_terms}</dd></>}{quote.notes && <><dt>Sales notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{quote.notes}</dd></>}</dl>
      <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th></tr></thead>
        <tbody>{items.data?.map((i) => <tr key={i.id}><td className="cell-main">{i.description}</td><td className="num" data-label="Qty">{i.quantity}</td><td className="num" data-label="Unit">{formatMoney(i.unit_price, cur(quote.currency))}</td><td className="num" data-label="Amount">{formatMoney(i.quantity * i.unit_price, cur(quote.currency))}</td></tr>)}</tbody></table></div>
      <div style={{ textAlign: "right" }}><h2>Total {formatMoney(t.total, cur(quote.currency))}</h2></div>
      {mode === "approve" ? (<>
        <h3>Finance decision</h3>
        <div className="form-grid">
          <Field label="Upfront payment">{(id) => <select id={id} className="select" value={up} onChange={(e) => setUp(e.target.value as "none")}><option value="none">No upfront required</option><option value="percent">Percentage of total</option><option value="fixed">Fixed amount</option></select>}</Field>
          {up !== "none" && <Field label={up === "percent" ? "Percent (%)" : `Amount (${cur(quote.currency)})`} hint={upAmount ? `= ${formatMoney(upAmount, cur(quote.currency))}` : undefined}>{(id) => <input id={id} type="number" min="0" step="0.01" className="input" value={val} onChange={(e) => setVal(e.target.value)} />}</Field>}
          <Field label="Invoice due date">{(id) => <input id={id} type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
          <Field label="Note on the invoice (optional)" className="span-2">{(id) => <input id={id} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={org.data ? `Bank details, reference…` : ""} />}</Field>
        </div>
        <p className="hint">Approving confirms the deal as <strong>Won</strong>, creates the client if needed, and issues the invoice for the sales owner to share with the customer.</p>
      </>) : (
        <Field label="Reason for returning the quote *">{(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What should sales fix before resubmitting?" />}</Field>)}
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

function PaymentDialog({ inv, onClose }: { inv: InvoiceBalance; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ amount: String(inv.balance_due), method: "bank_transfer", paid_at: new Date().toISOString().slice(0, 10), reference: "", notes: "" }); const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => { const a = Number(f.amount); if (!(a > 0)) throw new Error("Enter the amount received."); const { error } = await supabase.from("payments").insert({ invoice_id: inv.invoice_id, amount: a, method: f.method, paid_at: new Date(f.paid_at + "T12:00:00").toISOString(), reference: f.reference.trim() || null, notes: f.notes.trim() || null }); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["invoices"] }); void qc.invalidateQueries({ queryKey: ["payments"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] }); toast("Payment recorded."); onClose(); }, onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal title={`Record payment · ${inv.invoice_number}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Record payment</Button></>}>
      <p className="muted">Balance due {formatMoney(inv.balance_due, inv.currency)}{inv.upfront_amount > 0 ? ` · upfront ${formatMoney(inv.upfront_amount, inv.currency)} ${inv.upfront_received ? "(received)" : "(awaited)"}` : ""}</p>
      <div className="form-grid">
        <Field label={`Amount received (${inv.currency})`}>{(id) => <input id={id} type="number" min="0" step="0.01" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Date received">{(id) => <input id={id} type="date" className="input" value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} />}</Field>
        <Field label="Method">{(id) => <select id={id} className="select" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{["bank_transfer", "cash", "card", "cheque", "online", "other"].map((m) => <option key={m} value={m}>{label(m)}</option>)}</select>}</Field>
        <Field label="Reference">{(id) => <input id={id} className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />}</Field>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

function InvoiceForm({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient(); const org = useOrg();
  const clients = useQuery({ queryKey: ["clients-pick"], queryFn: async () => (await supabase.from("clients").select("id,name").order("name").limit(500)).data ?? [] });
  const [f, setF] = useState({ client_id: "", currency: "", due_date: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10), tax_rate: "0", notes: "" });
  const [rows, setRows] = useState([{ description: "", quantity: "1", unit_price: "" }]); const [err, setErr] = useState<string | null>(null);
  const c = f.currency || org.data?.default_currency?.trim() || "USD";
  const t = totals(rows.map((r) => ({ quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0 })), Number(f.tax_rate) || 0);
  const save = useMutation({
    mutationFn: async () => {
      if (!f.client_id) throw new Error("Choose the client.");
      const valid = rows.filter((r) => r.description.trim() && Number(r.quantity) > 0 && Number(r.unit_price) >= 0 && r.unit_price !== "");
      if (!valid.length) throw new Error("Add at least one priced line.");
      const { data, error } = await supabase.from("invoices").insert({ client_id: f.client_id, currency: c, due_date: f.due_date, tax_rate: Number(f.tax_rate) || 0, notes: f.notes.trim() || null }).select("id").single(); if (error) throw error;
      const it = await supabase.from("invoice_items").insert(valid.map((r, i) => ({ invoice_id: data.id, position: i, description: r.description.trim(), quantity: Number(r.quantity), unit_price: Number(r.unit_price) }))); if (it.error) throw it.error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["invoices"] }); toast("Draft invoice created. Issue it when ready."); onClose(); }, onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal title="New invoice" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Create draft</Button></>}>
      <p className="hint">Invoices for won deals are created automatically when you approve a quote. Use this for work that did not come through a quote.</p>
      <div className="form-grid">
        <Field label="Client *">{(id) => <select id={id} className="select" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}><option value="">Choose…</option>{clients.data?.map((x) => <option key={x.id as string} value={x.id as string}>{x.name as string}</option>)}</select>}</Field>
        <Field label="Currency">{(id) => <CurrencySelect id={id} value={c} onChange={(v) => setF({ ...f, currency: v })} />}</Field>
        <Field label="Due date">{(id) => <input id={id} type="date" className="input" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />}</Field>
        <Field label="Tax %">{(id) => <input id={id} type="number" min="0" max="100" step="0.01" className="input" value={f.tax_rate} onChange={(e) => setF({ ...f, tax_rate: e.target.value })} />}</Field>
      </div>
      <div className="items-edit">{rows.map((r, i) => (
        <div className="item-row" key={i}>
          <input className="input" aria-label="Description" placeholder="Item / service" value={r.description} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
          <input className="input" aria-label="Quantity" type="number" min="0" step="0.01" value={r.quantity} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
          <input className="input" aria-label="Unit price" type="number" min="0" step="0.01" value={r.unit_price} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))} />
          <strong style={{ textAlign: "right" }}>{formatMoney((Number(r.quantity) || 0) * (Number(r.unit_price) || 0), c)}</strong>
          <Button variant="ghost" size="sm" aria-label="Remove" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></Button></div>))}
        <div className="row"><Button size="sm" onClick={() => setRows([...rows, { description: "", quantity: "1", unit_price: "" }])}><Plus size={14} />Add line</Button><h3 style={{ marginLeft: "auto" }}>Total {formatMoney(t.total, c)}</h3></div></div>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

export function FinancePage() {
  const { profile, can } = useAuth(); const toast = useToast(); const qc = useQueryClient(); const confirm = useConfirm();
  const [params, setParams] = useSearchParams(); const tab = params.get("tab") ?? "quotes";
  const tz = profile!.timezone; const manage = can("finance.manage"); const review = can("quotes.review"); const rates = useRates();
  const inv = useInvoices(); const pay = usePayments();
  const quotes = useQuery({ queryKey: ["quotes", "finance"], refetchInterval: 60_000, queryFn: async () => ((await supabase.from("quotes").select("*").in("status", ["submitted", "approved", "rejected"]).order("submitted_at", { ascending: false, nullsFirst: false }).limit(200)).data ?? []) as Quote[] });
  const [reviewing, setReviewing] = useState<Quote | null>(null); const [paying, setPaying] = useState<InvoiceBalance | null>(null); const [creating, setCreating] = useState(false);
  const submitted = quotes.data?.filter((q) => q.status === "submitted") ?? [];
  const invoices = inv.data ?? []; const r = rates.data ?? []; const thisMonth = monthKey(Date.now(), tz);
  const open = invoices.filter((i) => i.status === "sent" && i.balance_due > 0);
  const out = useMemo(() => sumConverted(r, open.map((i) => ({ amount: i.balance_due, currency: i.currency, month: thisMonth }))), [open, r, thisMonth]);
  const collected = useMemo(() => {
    const byInv = new Map(invoices.map((i) => [i.invoice_id, i.currency]));
    return sumConverted(r, (pay.data ?? []).filter((p) => monthKey(p.paid_at, tz) === thisMonth && byInv.has(p.invoice_id)).map((p) => ({ amount: p.amount, currency: byInv.get(p.invoice_id)!, month: thisMonth })));
  }, [pay.data, invoices, r, tz, thisMonth]);
  const overdue = open.filter((i) => i.is_overdue);
  const issue = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("invoices").update({ status: "sent" }).eq("id", id); if (error) throw error; }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["invoices"] }); toast("Invoice issued."); }, onError: (e) => toast(errMsg(e), "error") });
  const delInv = async (i: InvoiceBalance) => {
    const hasPay = i.amount_paid > 0;
    if (!(await confirm({ title: `Delete invoice ${i.invoice_number}?`, danger: true, confirmLabel: hasPay ? "Delete invoice and payments" : "Delete invoice", body: <>{hasPay && <p><strong>{formatMoney(i.amount_paid, i.currency)}</strong> of recorded payments will be deleted with it.</p>}{i.deal_id && <p>The linked deal will be reopened (no longer Won) and the sales owner will be told.</p>}<p>This is recorded in the audit log.</p></> }))) return;
    const { error } = await supabase.rpc("delete_invoice", { p_id: i.invoice_id, p_with_payments: hasPay });
    if (error) return toast(errMsg(error), "error");
    toast("Invoice deleted."); void qc.invalidateQueries(); };
  const delPay = async (p: Payment) => {
    if (!(await confirm({ title: "Delete this payment record?", danger: true, confirmLabel: "Delete payment", body: "Use this only to correct a mistake. It is recorded in the audit log." }))) return;
    const { error } = await supabase.from("payments").delete().eq("id", p.id); if (error) return toast(errMsg(error), "error");
    toast("Payment deleted."); void qc.invalidateQueries({ queryKey: ["payments"] }); void qc.invalidateQueries({ queryKey: ["invoices"] }); };
  const setTab = (t: string) => setParams({ tab: t });
  const invNo = new Map(invoices.map((i) => [i.invoice_id, i]));

  return (
    <div className="page">
      <div className="page-head"><div><h1>Finance</h1><p>Approve quotes, issue invoices and record payments. Invoiced money is never counted as received.</p></div>
        {manage && <div className="page-actions"><Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} />New invoice</Button></div>}</div>
      <div className="grid kpis">
        <Stat label="Quotes awaiting approval" value={submitted.length} tone={submitted.length ? "danger" : undefined} />
        <Stat label="Outstanding (USD)" value={formatMoney(out.usd, "USD", { compact: true })} sub={`≈ ${formatMoney(out.pkr, "PKR", { compact: true })} · ${open.length} open invoices`} />
        <Stat label="Collected this month (USD)" value={formatMoney(collected.usd, "USD", { compact: true })} sub={`≈ ${formatMoney(collected.pkr, "PKR", { compact: true })}`} tone="ok" />
        <Stat label="Overdue invoices" value={overdue.length} tone={overdue.length ? "danger" : undefined} />
      </div>
      <MissingRates missing={[...new Set([...out.missing, ...collected.missing])]} />
      <div className="glass card">
        <div className="tabs" role="tablist">{[["quotes", `Quotes${submitted.length ? ` (${submitted.length})` : ""}`], ["invoices", "Invoices"], ["payments", "Payments"]].map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>{l}</button>)}</div>
        <div style={{ paddingTop: 16 }}>
          {tab === "quotes" && (quotes.isLoading ? <ListSkeleton /> : !quotes.data?.length ? <Empty icon={<Receipt size={32} />} title="No quotes yet">Quotes submitted by sales appear here for your approval.</Empty>
            : <div className="table-wrap"><table className="table"><thead><tr><th>Quote</th><th>Customer</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>{quotes.data.map((q) => (
              <tr key={q.id} data-highlight={params.get("quote") === q.id}><td className="cell-main"><span className="cell-strong">{q.quote_number}</span><div className="cell-sub">{q.project_title}</div></td><td data-label="Customer">{q.customer_company ?? q.customer_name}</td>
                <td data-label="Status"><Badge tone={quoteTone(q.status)}>{quoteStatusLabel(q.status)}</Badge></td><td data-label="Submitted">{q.submitted_at ? formatInTz(q.submitted_at, tz) : "—"}</td>
                <td className="cell-actions">{q.status === "submitted" && review ? <Button size="sm" variant="primary" onClick={() => setReviewing(q)}>Review</Button> : q.invoice_id ? <Button size="sm" onClick={() => setTab("invoices")}>Invoice</Button> : null}</td></tr>))}</tbody></table></div>)}
          {tab === "invoices" && (inv.isLoading ? <ListSkeleton /> : !invoices.length ? <Empty icon={<Receipt size={32} />} title="No invoices yet" />
            : <div className="table-wrap"><table className="table"><thead><tr><th>Invoice</th><th>Client</th><th>Status</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Due</th><th></th></tr></thead><tbody>{invoices.map((i) => (
              <tr key={i.invoice_id}><td className="cell-main"><span className="cell-strong">{i.invoice_number}</span>{i.upfront_amount > 0 && <div className="cell-sub">Upfront {formatMoney(i.upfront_amount, i.currency)} {i.upfront_received ? "✓" : "awaited"}</div>}</td>
                <td data-label="Client">{(i as typeof i & { client_name: string }).client_name}</td><td data-label="Status"><Badge tone={invTone(i)}>{invLabel(i)}</Badge></td>
                <td className="num" data-label="Total">{formatMoney(i.total, i.currency)}</td><td className="num" data-label="Paid">{formatMoney(i.amount_paid, i.currency)}</td><td className="num" data-label="Balance">{formatMoney(i.balance_due, i.currency)}</td><td data-label="Due">{i.due_date}</td>
                <td className="cell-actions"><div className="row" style={{ justifyContent: "flex-end" }}>
                  {manage && i.status === "draft" && <Button size="sm" variant="primary" onClick={() => issue.mutate(i.invoice_id)}>Issue</Button>}
                  {manage && i.status === "sent" && i.balance_due > 0 && <Button size="sm" onClick={() => setPaying(i)}><CreditCard size={14} />Payment</Button>}
                  <Button size="sm" onClick={() => window.open(`/print/invoice/${i.invoice_id}`, "_self")}><Printer size={14} /></Button>
                  {manage && <Button size="sm" variant="danger" aria-label={`Delete ${i.invoice_number}`} onClick={() => void delInv(i)}><Trash2 size={14} /></Button>}</div></td></tr>))}</tbody></table></div>)}
          {tab === "payments" && (pay.isLoading ? <ListSkeleton /> : !pay.data?.length ? <Empty icon={<CreditCard size={32} />} title="No payments recorded yet" />
            : <div className="table-wrap"><table className="table"><thead><tr><th>Received</th><th>Invoice</th><th>Method</th><th className="num">Amount</th><th>Reference</th><th></th></tr></thead><tbody>{pay.data.map((p) => { const i = invNo.get(p.invoice_id); return (
              <tr key={p.id}><td className="cell-main">{formatInTz(p.paid_at, tz, { hour: undefined, minute: undefined })}</td><td data-label="Invoice">{i?.invoice_number ?? "—"}</td><td data-label="Method">{label(p.method)}</td><td className="num" data-label="Amount">{formatMoney(p.amount, i?.currency ?? "USD")}</td><td data-label="Reference">{p.reference ?? "—"}</td>
                <td className="cell-actions">{manage && <Button size="sm" variant="danger" aria-label="Delete payment" onClick={() => void delPay(p)}><Trash2 size={14} /></Button>}</td></tr>); })}</tbody></table></div>)}
        </div>
      </div>
      {reviewing && <ReviewDialog quote={reviewing} onClose={() => setReviewing(null)} />}
      {paying && <PaymentDialog inv={paying} onClose={() => setPaying(null)} />}
      {creating && <InvoiceForm onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Customer-facing printable invoice. */
export function InvoiceDocPage() {
  const { id = "" } = useParams(); const nav = useNavigate(); const org = useOrg(); const { profile } = useAuth();
  const q = useQuery({ queryKey: ["invoice-doc", id], queryFn: async () => {
    const { data: b } = await supabase.from("invoice_balances").select("*").eq("invoice_id", id).maybeSingle(); if (!b) return null;
    const [items, client, pays, inv] = await Promise.all([
      supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position"), supabase.from("clients").select("name,contact_name,email,address,country").eq("id", b.client_id).maybeSingle(),
      supabase.from("payments").select("*").eq("invoice_id", id).order("paid_at"), supabase.from("invoices").select("notes,tax_rate").eq("id", id).maybeSingle()]);
    return { b, items: items.data ?? [], client: client.data, pays: pays.data ?? [], notes: inv.data?.notes as string | null, tax: num(inv.data?.tax_rate ?? 0) };
  } });
  if (q.isLoading) return <div className="page"><ListSkeleton /></div>;
  if (!q.data) return <div className="page"><Empty title="Invoice not found" /></div>;
  const { b, items, client, pays, notes, tax } = q.data; const c = cur(b.currency);
  return (
    <div className="page">
      <div className="row no-print"><Button onClick={() => nav(-1)}><ArrowLeft size={15} />Back</Button><Button variant="primary" onClick={() => window.print()}><Printer size={15} />Print / Save as PDF</Button>{b.status === "draft" && <Badge tone="warn">Draft. Not yet issued</Badge>}</div>
      <div className="doc">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}><div><h1>Invoice</h1><div className="muted">{b.invoice_number}</div><div className="muted">Issued {b.issue_date} · Due {b.due_date}</div></div>
          <div style={{ textAlign: "right" }}><img src="/logo.png" alt="" width={48} height={48} style={{ borderRadius: 10 }} /><div><strong>{org.data?.company_name ?? "FAR Tech & Developers"}</strong></div></div></div>
        <p style={{ marginTop: 20 }}><strong>Bill to</strong><br />{client?.name}<br />{client?.contact_name}{client?.email ? ` · ${client.email}` : ""}<br />{client?.address}{client?.country ? ` ${client.country}` : ""}</p>
        <table><thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
          <tbody>{items.map((i) => <tr key={i.id as string}><td>{i.description as string}</td><td className="num">{num(i.quantity)}</td><td className="num">{formatMoney(num(i.unit_price), c)}</td><td className="num">{formatMoney(num(i.quantity) * num(i.unit_price), c)}</td></tr>)}</tbody></table>
        <div style={{ textAlign: "right" }}><div className="muted">Subtotal {formatMoney(num(b.subtotal), c)}</div>{tax > 0 && <div className="muted">Tax ({tax}%) {formatMoney(num(b.tax_amount), c)}</div>}<h2>Total {formatMoney(num(b.total), c)}</h2>
          {pays.length > 0 && <div className="muted">Paid {formatMoney(num(b.amount_paid), c)}</div>}<h3>Balance due {formatMoney(num(b.balance_due), c)}</h3></div>
        {num(b.upfront_amount) > 0 && <p><strong>Upfront payment required:</strong> {formatMoney(num(b.upfront_amount), c)} {b.upfront_received ? "(received, thank you)" : ""}</p>}
        {notes && <p style={{ whiteSpace: "pre-wrap" }}>{notes}</p>}
        {pays.length > 0 && <><h3>Payments received</h3><table><tbody>{pays.map((p) => <tr key={p.id as string}><td>{formatInTz(p.paid_at as string, profile!.timezone, { hour: undefined, minute: undefined })}</td><td>{label(p.method as string)}</td><td className="num">{formatMoney(num(p.amount), c)}</td></tr>)}</tbody></table></>}
      </div>
    </div>
  );
}
