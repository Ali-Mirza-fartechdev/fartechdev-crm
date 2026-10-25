import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "./ui";
import { useCurrencies } from "@/lib/data";

// ───────────── confirm dialog (replaces window.confirm) ─────────────
type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [o, setO] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => {});
  const ask = useCallback((opts: ConfirmOpts) => new Promise<boolean>((res) => { resolver.current = res; setO(opts); }), []);
  const done = (v: boolean) => { setO(null); resolver.current(v); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {o && <Modal title={o.title} onClose={() => done(false)}
        footer={<><Button onClick={() => done(false)}>Cancel</Button><Button variant={o.danger ? "danger" : "primary"} onClick={() => done(true)}>{o.confirmLabel ?? "Confirm"}</Button></>}>
        <div className="muted">{o.body}</div></Modal>}
    </ConfirmCtx.Provider>
  );
}

// ───────────── currency picker: every ISO currency ─────────────
const COMMON = ["USD", "PKR", "EUR", "GBP", "AED", "SAR", "CAD", "AUD", "INR", "QAR", "KWD", "OMR", "BHD", "SGD", "CHF", "TRY"];
export function CurrencySelect({ value, onChange, id, disabled }: { value: string; onChange: (v: string) => void; id?: string; disabled?: boolean }) {
  const q = useCurrencies();
  const list = q.data ?? [];
  const byCode = useMemo(() => new Map(list.map((c) => [c.code.trim(), c.name])), [list]);
  return (
    <select id={id} className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label="Currency">
      {!list.length && <option value={value}>{value}</option>}
      <optgroup label="Common">{COMMON.filter((c) => byCode.has(c)).map((c) => <option key={c} value={c}>{c} — {byCode.get(c)}</option>)}</optgroup>
      <optgroup label="All currencies">{list.filter((c) => !COMMON.includes(c.code.trim())).map((c) => <option key={c.code} value={c.code.trim()}>{c.code} — {c.name}</option>)}</optgroup>
    </select>
  );
}

// ───────────── SVG charts (no dependency) ─────────────
export const PALETTE = ["#08A9EF", "#80D5F5", "#a78bfa", "#34d399", "#fbbf24", "#fb7185"];

export function LineChart({ labels, series, height = 220, format = (n: number) => String(Math.round(n)) }:
  { labels: string[]; series: { name: string; color?: string; dashed?: boolean; values: number[] }[]; height?: number; format?: (n: number) => string }) {
  const W = 640, H = height, pad = { l: 46, r: 12, t: 12, b: 26 };
  const all = series.flatMap((s) => s.values), max = Math.max(1, ...all) * 1.1;
  const x = (i: number) => pad.l + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const step = Math.max(1, Math.ceil(labels.length / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart" style={{ width: "100%", height: "auto" }}>
      <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#08A9EF" stopOpacity=".35" /><stop offset="1" stopColor="#08A9EF" stopOpacity="0" /></linearGradient></defs>
      {ticks.map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" opacity=".12" /><text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity=".6">{format(t)}</text></g>)}
      {labels.map((l, i) => i % step === 0 && <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor" opacity=".6">{l}</text>)}
      {series[0] && labels.length > 1 && <path d={`M${x(0)},${y(0)} ${series[0].values.map((v, i) => `L${x(i)},${y(v)}`).join(" ")} L${x(labels.length - 1)},${y(0)} Z`} fill="url(#area)" />}
      {series.map((s, si) => (
        <g key={s.name}>
          <polyline fill="none" stroke={s.color ?? PALETTE[si]} strokeWidth="2.5" strokeDasharray={s.dashed ? "6 5" : undefined} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
          {!s.dashed && s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={s.color ?? PALETTE[si]}><title>{`${s.name} · ${labels[i]}: ${format(v)}`}</title></circle>)}
        </g>))}
    </svg>
  );
}

export function Donut({ slices, center, sub }: { slices: { label: string; value: number; color?: string }[]; center?: string; sub?: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R; let acc = 0;
  return (
    <svg viewBox="0 0 140 140" role="img" aria-label="Donut chart" style={{ width: "100%", maxWidth: 180, height: "auto" }}>
      <circle cx="70" cy="70" r={R} fill="none" stroke="currentColor" opacity=".1" strokeWidth="16" />
      {slices.map((s, i) => { const len = (s.value / total) * C; const el = (
        <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 2)} ${C - len + 2}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)"><title>{`${s.label}: ${s.value}`}</title></circle>); acc += len; return el; })}
      <text x="70" y="68" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">{center ?? total}</text>
      {sub && <text x="70" y="86" textAnchor="middle" fontSize="9" fill="currentColor" opacity=".6">{sub}</text>}
    </svg>
  );
}

export function Bars({ rows }: { rows: { label: string; value: number; display: string; color?: string; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">{rows.map((r, i) => (
      <div className="bar-row" key={r.label}><span>{r.label}{r.sub && <span className="faint"> {r.sub}</span>}</span>
        <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? undefined }} data-i={i} /></div><strong>{r.display}</strong></div>))}</div>
  );
}

export function PairedColumns({ labels, a, b, aName, bName, format }: { labels: string[]; a: number[]; b: number[]; aName: string; bName: string; format: (n: number) => string }) {
  const max = Math.max(1, ...a, ...b);
  return (
    <div>
      <div className="row faint" style={{ fontSize: "0.78rem", gap: 16 }}><span><span className="dot" style={{ color: PALETTE[1] }} /> {aName}</span><span><span className="dot" style={{ color: PALETTE[3] }} /> {bName}</span></div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${labels.length}, minmax(0,1fr))`, gap: 14, alignItems: "end", height: 170, marginTop: 10 }}>
        {labels.map((l, i) => (
          <div key={l} style={{ display: "grid", gap: 6, justifyItems: "center", alignContent: "end", height: "100%" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "end", height: 130 }}>
              <div title={`${aName}: ${format(a[i])}`} style={{ width: 22, height: `${(a[i] / max) * 100}%`, minHeight: a[i] ? 3 : 0, background: PALETTE[1], borderRadius: "6px 6px 0 0" }} />
              <div title={`${bName}: ${format(b[i])}`} style={{ width: 22, height: `${(b[i] / max) * 100}%`, minHeight: b[i] ? 3 : 0, background: PALETTE[3], borderRadius: "6px 6px 0 0" }} />
            </div>
            <span className="faint" style={{ fontSize: "0.74rem" }}>{l}</span>
          </div>))}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "danger" | "ok"; icon?: ReactNode }) {
  return <div className="glass kpi" data-tone={tone}><span className="kpi-label">{icon}{label}</span><span className="kpi-value">{value}</span>{sub && <span className="kpi-sub">{sub}</span>}</div>;
}

export function MissingRates({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return <p className="hint" role="status" style={{ color: "var(--warn)" }}>Exchange rate needed for: {missing.join(", ")}. Those amounts are left out of the converted totals until a rate is entered under Targets &amp; rates.</p>;
}
