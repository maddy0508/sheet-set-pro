import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import { useEffect } from 'react';
import { IconClose } from './icons';
import type { JobStatus } from '@/data/types';

/* ---------- Card ---------- */

export function Card({
  title,
  subtitle,
  action,
  children,
  footer,
  tight,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tight?: boolean;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <div className="small faint" style={{ marginTop: 2 }}>{subtitle}</div>}
          </div>
          {action}
        </header>
      )}
      <div className={tight ? 'card-body tight' : 'card-body'}>{children}</div>
      {footer && <footer className="card-foot">{footer}</footer>}
    </section>
  );
}

/* ---------- Stat ---------- */

export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={accent ? 'stat accent' : 'stat'}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/* ---------- Badge ---------- */

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'cyan';

export function Badge({ tone = 'neutral', title, children }: { tone?: BadgeTone; title?: string; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<JobStatus, BadgeTone> = {
  draft: 'neutral',
  measured: 'info',
  geometry_validated: 'info',
  calculated: 'cyan',
  quoted: 'cyan',
  won: 'ok',
  invoiced: 'warn',
  paid: 'ok',
  lost: 'danger',
};

const STATUS_LABEL: Record<JobStatus, string> = {
  draft: 'Draft',
  measured: 'Measured',
  geometry_validated: 'Validated',
  calculated: 'Calculated',
  quoted: 'Quoted',
  won: 'Won',
  invoiced: 'Invoiced',
  paid: 'Paid',
  lost: 'Lost',
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function SourceBadge({ source }: { source: 'SYNTHETIC' | 'TEST' | 'REAL' }) {
  if (source === 'REAL') return <Badge tone="neutral">Real</Badge>;
  return <Badge tone="warn">{source === 'SYNTHETIC' ? 'Synthetic' : 'Test'}</Badge>;
}

/* ---------- Notice ---------- */

export function Notice({
  tone = 'info',
  children,
  icon,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'ok' | 'neutral';
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className={`notice${tone === 'neutral' ? '' : ` notice-${tone}`}`}>
      {icon && <span style={{ display: 'flex' }}>{icon}</span>}
      <div>{children}</div>
    </div>
  );
}

/* ---------- Empty ---------- */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

/* ---------- Page head ---------- */

export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="small faint" style={{ marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- Tabs ---------- */

export function Tabs<T extends string>({
  items,
  active,
  onChange,
}: {
  items: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          className={active === item.id ? 'tab active' : 'tab'}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {typeof item.count === 'number' && <span className="faint" style={{ fontWeight: 600 }}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Form primitives ---------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, ...rest } = props;
  return <input {...rest} className="input" aria-invalid={invalid || undefined} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className="textarea" />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className="select" />;
}

export function UnitInput({
  unit,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { unit: string }) {
  return (
    <div className="input-unit">
      <input {...props} className="input" inputMode="numeric" />
      <span>{unit}</span>
    </div>
  );
}
