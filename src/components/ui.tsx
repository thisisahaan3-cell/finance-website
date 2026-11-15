import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { currencySymbol, dateTime, parseNum } from '../lib/format';

/* ---------- tooltip ---------- */

/** A small "i" that explains a term on hover, focus or tap. */
export function Tip({ text }: { text: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.top > 160;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: above ? r.top - 6 : r.bottom + 6, above });
  };
  const hide = () => setPos(null);
  return (
    <>
      <button
        type="button"
        ref={ref}
        className="tipmark"
        aria-label="Explain"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          pos ? hide() : show();
        }}
      >
        i
      </button>
      {pos &&
        createPortal(
          <div className="tip-pop" role="tooltip" style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.above ? '-100%' : '0'})` }}>
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ---------- fields ---------- */

interface FieldShell {
  label?: ReactNode;
  tip?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
}

function Shell({ label, tip, hint, error, className, id, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={'field ' + (className ?? '')}>
      {label !== undefined && (
        <label htmlFor={id}>
          {label}
          {tip && <Tip text={tip} />}
        </label>
      )}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

interface NumberFieldProps extends FieldShell {
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  /** multiply the stored value for display (100 for percentages stored as decimals) */
  scale?: number;
  min?: number;
  max?: number;
  decimals?: number;
  /** group digits the Indian way while not editing */
  grouping?: 'IN' | 'US' | false;
  placeholder?: string;
  disabled?: boolean;
}

const fmt = (v: number, decimals: number, grouping: NumberFieldProps['grouping']) => {
  if (!Number.isFinite(v)) return '';
  const rounded = Number(v.toFixed(decimals));
  if (!grouping) return String(rounded);
  return rounded.toLocaleString(grouping === 'IN' ? 'en-IN' : 'en-US', { maximumFractionDigits: decimals });
};

/** Numeric input that tolerates commas and currency signs, validates range, and never emits NaN silently. */
export function NumberField(p: NumberFieldProps) {
  const id = useId();
  const scale = p.scale ?? 1;
  const decimals = p.decimals ?? (scale === 100 ? 2 : 2);
  const shown = Number.isFinite(p.value) ? p.value * scale : NaN;
  const [text, setText] = useState(fmt(shown, decimals, p.grouping));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState<string | null>(null);
  useEffect(() => {
    if (!focused) {
      setText(fmt(shown, decimals, p.grouping));
      setBad(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, focused, decimals, p.grouping]);

  const commit = (raw: string) => {
    setText(raw);
    if (raw.trim() === '') {
      setBad('Enter a number');
      return;
    }
    const n = parseNum(raw);
    if (!Number.isFinite(n)) {
      setBad('Not a number');
      return;
    }
    if (p.min !== undefined && n < p.min * scale - 1e-12) {
      setBad(`Minimum ${fmt(p.min * scale, decimals, p.grouping)}${p.suffix ?? ''}`);
      return;
    }
    if (p.max !== undefined && n > p.max * scale + 1e-12) {
      setBad(`Maximum ${fmt(p.max * scale, decimals, p.grouping)}${p.suffix ?? ''}`);
      return;
    }
    setBad(null);
    p.onChange(n / scale);
  };

  return (
    <Shell {...p} id={id} error={p.error ?? bad}>
      <div className={'input-wrap' + (p.prefix ? ' has-pre' : '') + (p.suffix ? ' has-suf' : '')}>
        {p.prefix && <span className="affix pre">{p.prefix}</span>}
        <input
          id={id}
          className={'input num' + (bad || p.error ? ' bad' : '')}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder={p.placeholder}
          disabled={p.disabled}
          onFocus={(e) => {
            setFocused(true);
            setText(Number.isFinite(shown) ? String(Number(shown.toFixed(Math.max(decimals, 4)))) : '');
            requestAnimationFrame(() => e.target.select());
          }}
          onBlur={() => setFocused(false)}
          onChange={(e) => commit(e.target.value)}
        />
        {p.suffix && <span className="affix suf">{p.suffix}</span>}
      </div>
    </Shell>
  );
}

export const PercentField = (p: Omit<NumberFieldProps, 'scale' | 'suffix'>) => <NumberField {...p} scale={100} suffix="%" />;

export const MoneyField = (p: Omit<NumberFieldProps, 'prefix' | 'grouping'> & { currency?: string }) => (
  <NumberField {...p} prefix={currencySymbol(p.currency ?? 'INR').trim()} grouping={(p.currency ?? 'INR') === 'INR' ? 'IN' : 'US'} decimals={p.decimals ?? 2} />
);

export function TextField(p: FieldShell & { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; max?: string; min?: string }) {
  const id = useId();
  return (
    <Shell {...p} id={id}>
      <input id={id} className={'input' + (p.error ? ' bad' : '')} type={p.type ?? 'text'} value={p.value} placeholder={p.placeholder} max={p.max} min={p.min} onChange={(e) => p.onChange(e.target.value)} />
    </Shell>
  );
}

export function SelectField<T extends string>(p: FieldShell & { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const id = useId();
  return (
    <Shell {...p} id={id}>
      <select id={id} className="select" value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function Check({ label, checked, onChange, tip }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; tip?: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      {tip && <Tip text={tip} />}
    </label>
  );
}

export function Seg<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} className={t.value === value ? 'on' : ''} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- containers ---------- */

export function Card({ title, sub, right, children, flush, className }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={'card ' + (className ?? '')}>
      {(title || right) && (
        <div className="card-h">
          {title && <h3>{title}</h3>}
          {sub && <span className="sub">{sub}</span>}
          {right && <div className="right">{right}</div>}
        </div>
      )}
      <div className={'card-b' + (flush ? ' flush' : '')}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone, tip, big }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; tip?: ReactNode; big?: boolean }) {
  return (
    <div className={'stat' + (big ? ' big' : '')}>
      <div className="k">
        {label}
        {tip && <Tip text={tip} />}
      </div>
      <div className={'v ' + (tone ?? '')}>{value}</div>
      {sub && <div className="d">{sub}</div>}
    </div>
  );
}

export const Stats = ({ children }: { children: ReactNode }) => <div className="stats">{children}</div>;

/** Label/value rows. */
export function KV({ rows }: { rows: ([ReactNode, ReactNode] | [ReactNode, ReactNode, { tip?: ReactNode; total?: boolean; tone?: string }] | null | false)[] }) {
  return (
    <dl className="kv">
      {rows.filter(Boolean).map((r, i) => {
        const [k, v, o] = r as [ReactNode, ReactNode, { tip?: ReactNode; total?: boolean; tone?: string } | undefined];
        return (
          <FragmentRow key={i} k={k} v={v} tip={o?.tip} total={o?.total} tone={o?.tone} />
        );
      })}
    </dl>
  );
}
function FragmentRow({ k, v, tip, total, tone }: { k: ReactNode; v: ReactNode; tip?: ReactNode; total?: boolean; tone?: string }) {
  return (
    <>
      <dt className={total ? 'total' : ''}>
        {k}
        {tip && <Tip text={tip} />}
      </dt>
      <dd className={(total ? 'total ' : '') + (tone ?? '')}>{v}</dd>
    </>
  );
}

export function Note({ kind, children, className }: { kind?: 'info' | 'warn' | 'err' | 'ok'; children: ReactNode; className?: string }) {
  return <div className={`note ${kind && kind !== 'info' ? kind : ''} ${className ?? ''}`} role={kind === 'err' ? 'alert' : undefined}>{children}</div>;
}

export function ErrorNote({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <Note kind="err">
      <div className="row between">
        <span>{error}</span>
        {retry && (
          <button className="btn sm" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </Note>
  );
}

export function Loading({ label, height }: { label?: string; height?: number }) {
  return (
    <div className="muted small" style={{ padding: 16, minHeight: height, display: 'flex', alignItems: 'center', gap: 8 }} aria-live="polite">
      <span className="spinner" /> {label ?? 'Loading…'}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Where a number came from and when. Shown under anything built on market data. */
export function Source({ at, children }: { at?: number | null; children?: ReactNode }) {
  return (
    <div className="source">
      <span>Source: Yahoo Finance (prices delayed about 15 minutes for India).</span>
      {at ? <span>Fetched {dateTime(at)}.</span> : null}
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- toast ---------- */

let pushToast: ((msg: string) => void) | null = null;
export const toast = (msg: string) => pushToast?.(msg);

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    pushToast = (m) => {
      setMsg(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 3200);
    };
    return () => {
      pushToast = null;
      clearTimeout(timer);
    };
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

/** Sortable table header helper. */
export function useSort<K extends string>(initial: K, initialDir: 'asc' | 'desc' = 'desc') {
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir);
  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setKey(k);
      setDir('desc');
    }
  };
  const mark = (k: K) => (k === key ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  const sort = <T,>(rows: T[], get: (row: T, k: K) => number | string | null | undefined): T[] =>
    [...rows].sort((a, b) => {
      const va = get(a, key);
      const vb = get(b, key);
      const na = va === null || va === undefined || (typeof va === 'number' && !Number.isFinite(va));
      const nb = vb === null || vb === undefined || (typeof vb === 'number' && !Number.isFinite(vb));
      if (na && nb) return 0;
      if (na) return 1; // missing values always sink to the bottom
      if (nb) return -1;
      const c = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return dir === 'asc' ? c : -c;
    });
  return { key, dir, toggle, mark, sort };
}
