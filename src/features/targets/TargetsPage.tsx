import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Target as TargetIcon, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, Button, Empty, Field, ListSkeleton, Modal, errMsg, useToast } from "@/components/ui";
import { CurrencySelect, MissingRates, useConfirm } from "@/components/extra";
import { addMonths, convertWithBase, effectiveTarget, formatMoney, monthKey, monthLabel, sumConverted, targetProgress, type Target } from "@/lib/money";
import { useCurrencies, useRates, useTeam } from "@/lib/data";
import { useDeals } from "@/features/deals/api";

export function useTargets() {
  return useQuery({ queryKey: ["targets"], queryFn: async () => ((await supabase.from("sales_targets").select("user_id,month,target_usd,target_pkr")).data ?? []).map((t) => ({ user_id: t.user_id as string, month: t.month as string, target_usd: t.target_usd == null ? null : Number(t.target_usd), target_pkr: t.target_pkr == null ? null : Number(t.target_pkr) })) as Target[] });
}

export function TargetDialog({ userId, name, month, current, onClose }: { userId: string; name: string; month: string; current: Target | null; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const [usd, setUsd] = useState(current?.target_usd != null ? String(current.target_usd) : ""); const [pkr, setPkr] = useState(current?.target_pkr != null ? String(current.target_pkr) : ""); const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!usd && !pkr) throw new Error("Enter a target in USD, PKR or both.");
      const { error } = await supabase.from("sales_targets").upsert({ user_id: userId, month, target_usd: usd ? Number(usd) : null, target_pkr: pkr ? Number(pkr) : null }, { onConflict: "user_id,month" }); if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["targets"] }); toast("Target saved."); onClose(); }, onError: (e) => setErr(errMsg(e)),
  });
  return (
    <Modal title={`Target for ${name} · ${monthLabel(month)}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save target</Button></>}>
      <div className="form-grid">
        <Field label="Target (USD)">{(id) => <input id={id} type="number" min="0" step="1" className="input" value={usd} onChange={(e) => setUsd(e.target.value)} />}</Field>
        <Field label="Target (PKR)">{(id) => <input id={id} type="number" min="0" step="1" className="input" value={pkr} onChange={(e) => setPkr(e.target.value)} />}</Field>
      </div>
      <p className="hint">Won deals in any currency are converted with this month’s exchange rates and checked against both numbers. If you do not set a new target next month, this one continues.</p>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Modal>
  );
}

export function TargetsPage() {
  const { profile, can } = useAuth(); const toast = useToast(); const qc = useQueryClient(); const confirm = useConfirm();
  const tz = profile!.timezone; const manage = can("targets.manage"); const ratesManage = can("rates.manage");
  const [month, setMonth] = useState(() => monthKey(Date.now(), tz)); const [tab, setTab] = useState<"targets" | "rates">("targets");
  const [setting, setSetting] = useState<{ id: string; name: string } | null>(null);
  const deals = useDeals(); const targets = useTargets(); const rates = useRates(); const team = useTeam(); const currencies = useCurrencies();
  const r = rates.data ?? [];
  const assignCso = can("targets.assign_cso");
  // Super Admin: Sales Executives + CSO. CSO: Sales Executives (and sees their own target, read-only). Sales Executive: themselves.
  const people = (team.data ?? []).filter((u) => u.is_active && (
    manage ? (u.role === "sales_executive" || (u.role === "cso" && (assignCso || u.id === profile!.id))) : (u.role === "sales_executive" || u.role === "cso") && u.id === profile!.id));
  const canSetFor = (u: { role: string }) => u.role === "sales_executive" ? manage : u.role === "cso" && assignCso;
  const reps = people;
  const wonIn = useMemo(() => (deals.data ?? []).filter((d) => d.won_confirmed_at && monthKey(d.won_confirmed_at, tz) === month), [deals.data, month, tz]);
  const thisMonth = monthKey(Date.now(), tz);

  const byCurrency = useMemo(() => {
    const m = new Map<string, { n: number; amount: number }>();
    for (const d of wonIn) { const e = m.get(d.currency) ?? { n: 0, amount: 0 }; e.n += 1; e.amount += d.value; m.set(d.currency, e); }
    return [...m.entries()].map(([currency, v]) => ({ currency, ...v, rate: r.find((x) => x.month === month && x.currency === currency) ?? null }));
  }, [wonIn, r, month]);
  const [edit, setEdit] = useState<Record<string, { usd: string; pkr: string }>>({}); const [extra, setExtra] = useState("EUR");
  const saveRate = useMutation({
    mutationFn: async (a: { currency: string; usd: number; pkr: number }) => { const { error } = await supabase.from("exchange_rates").upsert({ month, currency: a.currency, usd_per_unit: a.usd, pkr_per_unit: a.pkr }, { onConflict: "month,currency" }); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["rates"] }); toast("Rate saved."); }, onError: (e) => toast(errMsg(e), "error"),
  });
  const delRate = async (id: string, currency: string) => { if (!(await confirm({ title: `Remove the ${currency} rate for ${monthLabel(month)}?`, danger: true, confirmLabel: "Remove" }))) return; const { error } = await supabase.from("exchange_rates").delete().eq("month", month).eq("currency", id); if (error) return toast(errMsg(error), "error"); void qc.invalidateQueries({ queryKey: ["rates"] }); };
  const listed = new Set(byCurrency.map((b) => b.currency));
  const monthRates = r.filter((x) => x.month === month && !listed.has(x.currency));
  const base = [...byCurrency.map((b) => ({ currency: b.currency, n: b.n, amount: b.amount, rate: b.rate })), ...monthRates.map((x) => ({ currency: x.currency, n: 0, amount: 0, rate: x }))];
  const rows = [...base, ...Object.keys(edit).filter((k) => !base.some((b) => b.currency === k)).map((k) => ({ currency: k, n: 0, amount: 0, rate: null as (typeof base)[number]["rate"] }))];

  return (
    <div className="page">
      <div className="page-head"><div><h1>Targets &amp; rates</h1><p>Monthly sales targets, and the month-end exchange rates used to turn every currency into USD and PKR.</p></div>
        <div className="page-actions"><div className="row"><Button size="sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={16} /></Button><strong style={{ minWidth: 150, textAlign: "center" }}>{monthLabel(month)}</strong>
          <Button size="sm" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={16} /></Button></div></div></div>
      <div className="glass card">
        <div className="tabs" role="tablist"><button role="tab" aria-selected={tab === "targets"} className="tab" onClick={() => setTab("targets")}>{manage ? "Targets" : "My target"}</button>
          {(ratesManage) && <button role="tab" aria-selected={tab === "rates"} className="tab" onClick={() => setTab("rates")}>Month-end exchange rates</button>}</div>
        <div style={{ paddingTop: 16 }}>
          {tab === "targets" && (deals.isLoading || targets.isLoading ? <ListSkeleton /> : !reps.length ? <Empty icon={<TargetIcon size={32} />} title="No one to set targets for yet">Add users with the Sales Executive role under Team.</Empty>
            : <div className="stack">{reps.map((u) => {
              const eff = effectiveTarget(targets.data ?? [], u.id, month);
              const mine = wonIn.filter((d) => d.owner_id === u.id);
              const won = sumConverted(r, mine.map((d) => ({ amount: d.value, currency: d.currency, month })));
              const p = targetProgress(eff, won);
              const tone = (pc: number | null) => (pc == null ? undefined : pc >= 100 ? "ok" : pc < 40 ? "warn" : undefined);
              return (
                <div key={u.id} className="glass card">
                  <div className="card-head"><div><h3>{u.full_name} <Badge>{u.role === "cso" ? "CSO" : "Sales Executive"}</Badge></h3><span className="faint">{mine.length} deal{mine.length === 1 ? "" : "s"} won in {monthLabel(month)}</span></div>
                    <div className="row">{eff?.carried && <Badge tone="warn">Carried from {monthLabel(eff.month)}</Badge>}{!eff && <Badge>No target set</Badge>}{canSetFor(u) && <Button size="sm" variant="primary" onClick={() => setSetting({ id: u.id, name: u.full_name })}>{eff && !eff.carried ? "Edit target" : "Set target"}</Button>}</div></div>
                  <div className="grid cols-2">
                    {([["USD", p.achievedUsd, p.usd, p.pctUsd], ["PKR", p.achievedPkr, p.pkr, p.pctPkr]] as const).map(([c, a, t, pc]) => (
                      <div key={c}><div className="row" style={{ justifyContent: "space-between" }}><strong>{formatMoney(a, c, { compact: true })}</strong><span className="muted">{t != null ? `of ${formatMoney(t, c, { compact: true })}` : "no target"}</span></div>
                        <div className="meter" data-tone={tone(pc)} role="progressbar" aria-valuenow={Math.round(pc ?? 0)} aria-valuemin={0} aria-valuemax={100} aria-label={`${u.full_name} ${c} progress`}><i style={{ width: `${Math.min(100, pc ?? 0)}%` }} /></div>
                        <span className="faint" style={{ fontSize: "0.8rem" }}>{pc != null ? `${pc.toFixed(1)}% achieved` : "—"}{t != null && a < t ? ` · ${formatMoney(t - a, c, { compact: true })} to go` : ""}</span></div>))}
                  </div>
                  {p.estimated && <p className="hint" style={{ color: "var(--warn)" }}>Some conversions use an earlier month’s rate. Enter this month’s rates to make the result exact.</p>}
                  <MissingRates missing={p.missing} />
                </div>); })}</div>)}

          {tab === "rates" && ratesManage && (<div className="stack">
            <p className="muted">Enter, at month end, how much <strong>1 unit</strong> of each currency was worth in USD and in PKR. Currencies with deals won in {monthLabel(month)} are listed automatically. For USD itself, enter only the PKR value of 1 USD.</p>
            {rows.length === 0 && <Empty title="No deals won this month yet">Add a currency below to enter its rate in advance.</Empty>}
            {rows.length > 0 && <div className="table-wrap"><table className="table"><thead><tr><th>Currency</th><th className="num">Deals won</th><th className="num">Won (native)</th><th>1 unit = USD</th><th>1 unit = PKR</th><th>Status</th><th></th></tr></thead><tbody>{rows.map((x) => {
              const key = x.currency; const e = edit[key] ?? { usd: x.rate ? String(x.rate.usd_per_unit) : key === "USD" ? "1" : "", pkr: x.rate ? String(x.rate.pkr_per_unit) : "" };
              const conv = x.amount ? convertWithBase(r, key, month, x.amount) : null;
              return (<tr key={key}><td className="cell-main"><strong>{key}</strong></td><td className="num" data-label="Deals won">{x.n}</td><td className="num" data-label="Won">{x.amount ? formatMoney(x.amount, key) : "—"}</td>
                <td data-label="USD"><input className="input" style={{ minWidth: 110 }} type="number" min="0" step="0.00000001" aria-label={`${key} in USD`} disabled={key === "USD"} value={e.usd} onChange={(ev) => setEdit({ ...edit, [key]: { ...e, usd: ev.target.value } })} /></td>
                <td data-label="PKR"><input className="input" style={{ minWidth: 110 }} type="number" min="0" step="0.0001" aria-label={`${key} in PKR`} value={e.pkr} onChange={(ev) => setEdit({ ...edit, [key]: { ...e, pkr: ev.target.value } })} /></td>
                <td data-label="Status">{x.rate ? <Badge tone="ok">Entered</Badge> : conv ? <Badge tone="warn">Using earlier rate</Badge> : x.n ? <Badge tone="danger">Rate needed</Badge> : <Badge>Optional</Badge>}</td>
                <td className="cell-actions"><div className="row" style={{ justifyContent: "flex-end" }}><Button size="sm" variant="primary" disabled={saveRate.isPending || !(Number(e.usd) > 0 && Number(e.pkr) > 0)} onClick={() => saveRate.mutate({ currency: key, usd: Number(e.usd), pkr: Number(e.pkr) })}>Save</Button>
                  {x.rate && <Button size="sm" variant="danger" aria-label={`Remove ${key} rate`} onClick={() => void delRate(key, key)}><Trash2 size={14} /></Button>}</div></td></tr>); })}</tbody></table></div>}
            <div className="row"><div style={{ minWidth: 260 }}><CurrencySelect value={extra} onChange={setExtra} /></div>
              <Button disabled={listed.has(extra) || !!monthRates.find((x) => x.currency === extra)} onClick={() => setEdit({ ...edit, [extra]: { usd: "", pkr: "" } })}>Add {extra}</Button>
              <span className="hint">{currencies.data?.length ?? 0} currencies available.</span></div>
          </div>)}
        </div>
      </div>
      {setting && <TargetDialog userId={setting.id} name={setting.name} month={month} current={effectiveTarget(targets.data ?? [], setting.id, month)} onClose={() => setSetting(null)} />}
    </div>
  );
}
