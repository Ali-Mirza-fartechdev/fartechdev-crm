import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Inbox, X } from "lucide-react";

export function Button({ variant = "default", size, className = "", ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "ghost"; size?: "sm" }) {
  const v = variant === "default" ? "" : `btn-${variant}`;
  return <button type="button" {...p} className={`btn ${v} ${size ? "btn-sm" : ""} ${className}`} />;
}

export function Badge({ tone, children }: { tone?: "brand" | "ok" | "warn" | "danger"; children: ReactNode }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{children}</span>;
}

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="error-text" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="empty">{icon ?? <Inbox size={32} />}<strong>{title}</strong>{children && <p className="faint">{children}</p>}</div>;
}
export const Skeleton = ({ h = 18, w = "100%" }: { h?: number; w?: string }) => <div className="skeleton" style={{ height: h, width: w }} />;
export const ListSkeleton = () => <div className="stack" aria-busy="true" aria-label="Loading"><Skeleton h={64} /><Skeleton h={64} /><Skeleton h={64} /></div>;

/** Accessible modal / right-side drawer: focus trap, Esc to close, scroll lock, returns focus. */
export function Modal({ title, onClose, children, footer, side }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; side?: "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const el = ref.current!;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'));
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
  }, [onClose]);
  return createPortal(
    <div className="overlay" data-side={side} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog glass-strong" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="dialog-head"><h2 id={titleId}>{title}</h2><Button variant="ghost" size="sm" className="btn-icon" aria-label="Close" onClick={onClose}><X size={18} /></Button></div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>, document.body);
}

type Toast = { id: number; tone: "ok" | "error" | "info"; msg: string };
const ToastCtx = createContext<(msg: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, msg }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "error" ? 7000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className="toast glass-strong" data-tone={t.tone}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1, to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="pager">
      <span>{from}–{to} of {total}</span>
      <div className="row"><Button size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {page + 1} of {pages}</span>
        <Button size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</Button></div>
    </div>
  );
}

export const errMsg = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong");
