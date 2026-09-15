/** Minimal, consistent UI kit for MERQO (light theme, Bangla-first). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { formatBdt, type Paise } from '@shared/money';
import { formatDateBn, formatDateTimeBn, toBanglaDigits } from '@shared/dates';

/* ---------------- Money ---------------- */

export function Money({
  paise,
  sign = false,
  className = 'money'
}: {
  paise: number;
  sign?: boolean;
  className?: string;
}) {
  return <span className={className}>{formatBdt(paise as Paise, { sign })}</span>;
}

export function Bn({ children }: { children: React.ReactNode }) {
  return <>{toBanglaDigits(String(children))}</>;
}

/* ---------------- Button ---------------- */

type BtnVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'danger-soft';

export function Button({
  variant = 'outline',
  size,
  icon,
  loading,
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: 'sm' | 'lg';
  icon?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" style={{ width: 15, height: 15, borderWidth: 2 }} /> : icon}
      {children}
    </button>
  );
}

/* ---------------- Inputs ---------------- */

export function Field({
  label,
  hint,
  error,
  children
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="hint" style={{ color: 'var(--c-danger)' }}>{error}</span>}
    </div>
  );
}

export function TextInput({ error, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return <input className={`input${error ? ' input-error' : ''}`} {...rest} />;
}

export function MoneyInput({
  value,
  onValue,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number;
  onValue: (taka: number) => void;
}) {
  const [text, setText] = useState(() => (value ? String(value) : ''));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value ? String(value) : '');
  }, [value]);
  return (
    <input
      className="input input-money"
      inputMode="decimal"
      value={text}
      placeholder="০"
      onFocus={(e) => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t.replace(/[^0-9.]/g, ''));
        onValue(Number.isFinite(n) ? n : 0);
      }}
      {...rest}
    />
  );
}

export function SelectInput({
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className="select" {...rest}>
      {children}
    </select>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({
  title,
  children,
  footer,
  size,
  onClose
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${size ? ` modal-${size}` : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="বন্ধ করুন">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ---------------- Table ---------------- */

export interface Col<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  render?: (row: T) => React.ReactNode;
}

export function DataTable<T extends { id?: string }>({
  cols,
  rows,
  onRow,
  emptyTitle = 'এখনো কিছু নেই',
  emptySub,
  emptyIcon
}: {
  cols: Col<T>[];
  rows: T[];
  onRow?: (row: T) => void;
  emptyTitle?: string;
  emptySub?: string;
  emptyIcon?: React.ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? 'left', width: c.width }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length}>
                <Empty
                  title={emptyTitle}
                  sub={emptySub}
                  icon={emptyIcon}
                  compact
                />
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={(row.id as string) ?? i}
                className={onRow ? 'clickable' : undefined}
                onClick={onRow ? () => onRow(row) : undefined}
              >
                {cols.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Empty state ---------------- */

export function Empty({
  title,
  sub,
  icon,
  action,
  compact = false
}: {
  title: string;
  sub?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="empty" style={compact ? { padding: '30px 16px' } : undefined}>
      <div className="empty-icon" style={compact ? { width: 42, height: 42 } : undefined}>
        {icon ?? <Info size={compact ? 18 : 24} />}
      </div>
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

/* ---------------- StatCard ---------------- */

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'green' | 'red' | 'amber';
}) {
  const color =
    tone === 'green' ? 'var(--c-success)' : tone === 'red' ? 'var(--c-danger)' : tone === 'amber' ? 'var(--c-warn)' : 'var(--c-ink)';
  return (
    <div className="stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value" style={{ color }}>
        {value}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* ---------------- Tabs ---------------- */

export function Tabs({
  tabs,
  active,
  onChange
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          className={`tab${active === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Toasts ---------------- */

export interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'warn';
  title: string;
  message?: string;
}

const ToastCtx = React.createContext<(kind: ToastItem['kind'], title: string, message?: string) => void>(() => {});

export function useToast() {
  return useContextSafe(ToastCtx);
}

function useContextSafe<T>(ctx: React.Context<T>): T {
  return React.useContext(ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(1);

  const push = useCallback((kind: ToastItem['kind'], title: string, message?: string) => {
    const id = idRef.current++;
    setToasts((t) => [...t, { id, kind, title, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4200);
  }, []);

  const icons = useMemo(
    () => ({
      success: <CheckCircle2 size={17} style={{ color: 'var(--c-success)', marginTop: 1 }} />,
      error: <AlertTriangle size={17} style={{ color: 'var(--c-danger)', marginTop: 1 }} />,
      warn: <AlertTriangle size={17} style={{ color: 'var(--c-warn)', marginTop: 1 }} />
    }),
    []
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              {icons[t.kind]}
              <div>
                <div className="toast-title">{t.title}</div>
                {t.message && <div className="toast-msg">{t.message}</div>}
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastCtx.Provider>
  );
}

/* ---------------- confirm dialog ---------------- */

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'নিশ্চিত করুন',
  danger,
  onConfirm,
  onClose
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            বাতিল
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ color: 'var(--c-ink-2)', lineHeight: 1.6 }}>{message}</div>
    </Modal>
  );
}

/* ---------------- datetime helpers for UI ---------------- */

export function fmtDate(ms?: number | null) {
  return ms ? formatDateBn(ms) : '—';
}

export function fmtDateTime(ms?: number | null) {
  return ms ? formatDateTimeBn(ms) : '—';
}
