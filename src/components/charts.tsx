/**
 * Hand-built SVG charts: line/area with crosshair, bars, scatter, bar lists and a
 * correlation heatmap. One y-axis per chart, thin marks, recessive grid, and a hover
 * layer on every plot. Colours come from CSS variables so light and dark themes both work.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useWidth } from '../lib/hooks';
import { date as fmtDate } from '../lib/format';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
export const seriesColor = (i: number) => SERIES[i % SERIES.length];

/** Round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.999; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return ticks;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

/** Choose x-axis tick positions and labels for dates (year / month / day boundaries) or plain values. */
function xTicks(x: (string | number)[], maxTicks: number, fmt?: (v: string | number) => string): { i: number; label: string }[] {
  const n = x.length;
  if (!n) return [];
  if (isIso(x[0])) {
    const xs = x as string[];
    const days = (Date.parse(xs[n - 1].slice(0, 10)) - Date.parse(xs[0].slice(0, 10))) / 86_400_000;
    let cand: { i: number; label: string }[] = [];
    if (days > 800) {
      for (let i = 1; i < n; i++) if (xs[i].slice(0, 4) !== xs[i - 1].slice(0, 4)) cand.push({ i, label: xs[i].slice(0, 4) });
    } else if (days > 100) {
      for (let i = 1; i < n; i++)
        if (xs[i].slice(0, 7) !== xs[i - 1].slice(0, 7)) cand.push({ i, label: `${MONTHS[+xs[i].slice(5, 7) - 1]} ${xs[i].slice(2, 4)}` });
    } else if (xs[0].length > 10) {
      const step = Math.max(1, Math.floor(n / maxTicks));
      for (let i = 0; i < n; i += step) cand.push({ i, label: xs[i].slice(11, 16) });
    } else {
      const step = Math.max(1, Math.floor(n / maxTicks));
      for (let i = 0; i < n; i += step) cand.push({ i, label: `${+xs[i].slice(8, 10)} ${MONTHS[+xs[i].slice(5, 7) - 1]}` });
    }
    if (cand.length > maxTicks) {
      const k = Math.ceil(cand.length / maxTicks);
      cand = cand.filter((_, j) => j % k === 0);
    }
    return cand;
  }
  const step = Math.max(1, Math.ceil(n / maxTicks));
  const out: { i: number; label: string }[] = [];
  for (let i = 0; i < n; i += step) out.push({ i, label: fmt ? fmt(x[i]) : String(x[i]) });
  return out;
}

/** Default axis format: one unit for the whole axis (crore, lakh or plain), chosen from its largest tick. */
function axisFormat(ticks: number[]): (v: number) => string {
  const top = Math.max(...ticks.map(Math.abs), 0);
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : top;
  const dec = (unit: number) => (step / unit >= 1 ? 0 : step / unit >= 0.1 ? 1 : 2);
  if (top >= 1e7) return (v) => (v / 1e7).toLocaleString('en-IN', { minimumFractionDigits: dec(1e7), maximumFractionDigits: dec(1e7) }) + ' Cr';
  if (top >= 1e5) return (v) => (v / 1e5).toLocaleString('en-IN', { minimumFractionDigits: dec(1e5), maximumFractionDigits: dec(1e5) }) + ' L';
  return (v) => v.toLocaleString('en-IN', { maximumFractionDigits: step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 4 });
}

export function Legend({ items }: { items: { name: string; color: string; line?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.name}>
          <i className={'swatch' + (it.line === false ? '' : ' line')} style={{ background: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

export interface LineSeries {
  name: string;
  values: (number | null)[];
  color?: string;
  dashed?: boolean;
  width?: number;
}

export interface Band {
  name: string;
  lo: number[];
  hi: number[];
  color?: string;
  opacity?: number;
}

interface LineChartProps {
  x: (string | number)[];
  series: LineSeries[];
  bands?: Band[];
  height?: number;
  yFormat?: (v: number) => string;
  /** label for the x value in the tooltip */
  xFormat?: (v: string | number) => string;
  /** soft fill under the first series */
  area?: boolean;
  zeroLine?: boolean;
  log?: boolean;
  yMin?: number;
  yMax?: number;
  hideLegend?: boolean;
  ariaLabel?: string;
}

export function LineChart(p: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = p.height ?? 280;
  const n = p.x.length;
  const pad = { l: 8, r: 54, t: 8, b: 22 };
  const w = Math.max(10, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;

  const scale = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    const see = (v: number | null | undefined) => {
      if (typeof v === 'number' && Number.isFinite(v) && (!p.log || v > 0)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    };
    for (const s of p.series) s.values.forEach(see);
    for (const b of p.bands ?? []) {
      b.lo.forEach(see);
      b.hi.forEach(see);
    }
    if (p.zeroLine) see(0);
    if (p.yMin !== undefined) lo = p.yMin;
    if (p.yMax !== undefined) hi = p.yMax;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (p.log) {
      const a = Math.log10(lo);
      const b = Math.log10(hi === lo ? lo * 1.1 : hi);
      const ticks: number[] = [];
      for (let e = Math.floor(a); e <= Math.ceil(b); e++) for (const m of [1, 2, 5]) if (m * 10 ** e >= lo * 0.999 && m * 10 ** e <= hi * 1.001) ticks.push(m * 10 ** e);
      return { ticks: ticks.length > 8 ? ticks.filter((_, i) => i % 2 === 0) : ticks, y: (v: number) => pad.t + h - ((Math.log10(Math.max(v, lo)) - a) / (b - a || 1)) * h };
    }
    const ticks = niceTicks(lo, hi, Math.max(3, Math.floor(h / 48)));
    const t0 = p.yMin ?? ticks[0];
    const t1 = p.yMax ?? ticks[ticks.length - 1];
    return { ticks: ticks.filter((t) => t >= t0 - 1e-12 && t <= t1 + 1e-12), y: (v: number) => pad.t + h - ((v - t0) / (t1 - t0 || 1)) * h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.series, p.bands, p.zeroLine, p.log, p.yMin, p.yMax, h]);

  const yf = p.yFormat ?? axisFormat(scale?.ticks ?? [0]);
  const xPos = (i: number) => pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const stride = Math.max(1, Math.ceil(n / 900));

  const paths = useMemo(() => {
    if (!scale || width === 0) return [];
    return p.series.map((s) => {
      let d = '';
      let pen = false;
      for (let i = 0; i < n; i++) {
        if (i % stride !== 0 && i !== n - 1) continue;
        const v = s.values[i];
        if (typeof v !== 'number' || !Number.isFinite(v) || (p.log && v <= 0)) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${xPos(i).toFixed(1)},${scale.y(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.series, scale, width, n, stride]);

  const bandPaths = useMemo(() => {
    if (!scale || width === 0) return [];
    return (p.bands ?? []).map((b) => {
      const top: string[] = [];
      const bottom: string[] = [];
      for (let i = 0; i < n; i++) {
        if (i % stride !== 0 && i !== n - 1) continue;
        if (!Number.isFinite(b.hi[i]) || !Number.isFinite(b.lo[i])) continue;
        top.push(`${xPos(i).toFixed(1)},${scale.y(b.hi[i]).toFixed(1)}`);
        bottom.unshift(`${xPos(i).toFixed(1)},${scale.y(b.lo[i]).toFixed(1)}`);
      }
      return top.length ? `M${top.join('L')}L${bottom.join('L')}Z` : '';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.bands, scale, width, n, stride]);

  const ticksX = useMemo(() => xTicks(p.x, Math.max(2, Math.floor(w / 80)), p.xFormat), [p.x, w, p.xFormat]);
  const colors = p.series.map((s, i) => s.color ?? seriesColor(i));
  const showLegend = !p.hideLegend && (p.series.length > 1 || (p.bands?.length ?? 0) > 0);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.l;
    setHover(Math.min(n - 1, Math.max(0, Math.round((px / w) * (n - 1)))));
  };

  const areaPath =
    p.area && paths[0] && scale
      ? (() => {
          const s = p.series[0];
          let first = -1;
          let last = -1;
          for (let i = 0; i < n; i++)
            if (typeof s.values[i] === 'number' && Number.isFinite(s.values[i] as number)) {
              if (first < 0) first = i;
              last = i;
            }
          if (first < 0) return '';
          const base = pad.t + h;
          return `${paths[0]}L${xPos(last).toFixed(1)},${base}L${xPos(first).toFixed(1)},${base}Z`;
        })()
      : '';

  const xLabel = (v: string | number) => (p.xFormat ? p.xFormat(v) : isIso(v) ? fmtDate(v) + (v.length > 10 ? ' ' + v.slice(11, 16) : '') : String(v));

  return (
    <div>
      {showLegend && (
        <Legend
          items={[
            ...p.series.map((s, i) => ({ name: s.name, color: colors[i] })),
            ...(p.bands ?? []).map((b) => ({ name: b.name, color: `color-mix(in srgb, ${b.color ?? 'var(--s1)'} ${Math.round((b.opacity ?? 0.15) * 250)}%, transparent)`, line: false })),
          ]}
        />
      )}
      <div className="chart" ref={ref} style={{ height }}>
        {width > 0 && !scale && <div className="muted small" style={{ padding: 20 }}>No data to plot.</div>}
        {width > 0 && scale && (
          <svg width={width} height={height} role="img" aria-label={p.ariaLabel ?? 'Line chart'} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: 'pan-y' }}>
            {scale.ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 && p.zeroLine ? 'zero' : 'gridline'} x1={pad.l} x2={pad.l + w} y1={scale.y(t)} y2={scale.y(t)} />
                <text x={pad.l + w + 6} y={scale.y(t) + 3.5}>
                  {yf(t)}
                </text>
              </g>
            ))}
            {ticksX.map((t) => (
              <text key={t.i} x={xPos(t.i)} y={height - 6} textAnchor={t.i === 0 ? 'start' : 'middle'}>
                {t.label}
              </text>
            ))}
            {bandPaths.map((d, i) => (
              <path key={i} d={d} fill={p.bands![i].color ?? 'var(--s1)'} opacity={p.bands![i].opacity ?? 0.15} />
            ))}
            {areaPath && <path d={areaPath} fill={colors[0]} opacity={0.1} />}
            {paths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={colors[i]}
                strokeWidth={p.series[i].width ?? 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={p.series[i].dashed ? '5 4' : undefined}
              />
            ))}
            {hover !== null && (
              <g>
                <line className="cross" x1={xPos(hover)} x2={xPos(hover)} y1={pad.t} y2={pad.t + h} />
                {p.series.map((s, i) => {
                  const v = s.values[hover];
                  return typeof v === 'number' && Number.isFinite(v) && (!p.log || v > 0) ? (
                    <circle key={i} cx={xPos(hover)} cy={scale.y(v)} r={4} fill={colors[i]} stroke="var(--surface)" strokeWidth={2} />
                  ) : null;
                })}
              </g>
            )}
          </svg>
        )}
        {hover !== null && scale && (
          <div className="chart-tip" style={xPos(hover) > width * 0.6 ? { right: width - xPos(hover) + 12, top: 8 } : { left: xPos(hover) + 12, top: 8 }}>
            <div className="t">{xLabel(p.x[hover])}</div>
            {p.series.map((s, i) => {
              const v = s.values[hover];
              return (
                <div className="l" key={i}>
                  <span>
                    <i className="swatch line" style={{ background: colors[i] }} />
                    {s.name}
                  </span>
                  <b>{typeof v === 'number' && Number.isFinite(v) ? yf(v) : '—'}</b>
                </div>
              );
            })}
            {(p.bands ?? []).map((b, i) => (
              <div className="l" key={'b' + i}>
                <span>{b.name}</span>
                <b>
                  {yf(b.lo[hover])} – {yf(b.hi[hover])}
                </b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- bars ---------- */

export interface Bar {
  label: string;
  value: number;
  color?: string;
  /** extra line for the tooltip */
  note?: string;
}

interface BarChartProps {
  data: Bar[];
  height?: number;
  yFormat?: (v: number) => string;
  /** colour bars green / red by sign (for returns) */
  signed?: boolean;
  color?: string;
  ariaLabel?: string;
  /** bars touch, for histograms */
  dense?: boolean;
}

export function BarChart(p: BarChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = p.height ?? 240;
  const pad = { l: 8, r: 54, t: 10, b: 22 };
  const w = Math.max(10, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const n = p.data.length;
  const values = p.data.map((d) => d.value).filter(Number.isFinite);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), Math.max(3, Math.floor(h / 48)));
  const yf = p.yFormat ?? axisFormat(ticks);
  const t0 = ticks[0];
  const t1 = ticks[ticks.length - 1];
  const y = (v: number) => pad.t + h - ((v - t0) / (t1 - t0 || 1)) * h;
  const band = n ? w / n : w;
  const bw = p.dense ? Math.max(1, band - 1) : Math.max(2, Math.min(24, band * 0.7));
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(w / 46))));
  const hovered = hover !== null ? p.data[hover] : null;
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && n === 0 && <div className="muted small" style={{ padding: 20 }}>No data to plot.</div>}
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label={p.ariaLabel ?? 'Bar chart'} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'zero' : 'gridline'} x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} />
              <text x={pad.l + w + 6} y={y(t) + 3.5}>
                {yf(t)}
              </text>
            </g>
          ))}
          {p.data.map((d, i) => {
            if (!Number.isFinite(d.value)) return null;
            const cx = pad.l + band * (i + 0.5);
            const top = Math.min(y(d.value), y(0));
            const hh = Math.max(1, Math.abs(y(d.value) - y(0)));
            const fill = d.color ?? (p.signed ? (d.value >= 0 ? 'var(--pos)' : 'var(--neg)') : p.color ?? 'var(--s1)');
            const r = p.dense ? 0 : Math.min(3, bw / 2, hh);
            const x0 = cx - bw / 2;
            const up = d.value >= 0;
            // rounded data-end, square at the baseline
            const path = up
              ? `M${x0},${top + hh}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${top + hh}Z`
              : `M${x0},${top}V${top + hh - r}Q${x0},${top + hh} ${x0 + r},${top + hh}H${x0 + bw - r}Q${x0 + bw},${top + hh} ${x0 + bw},${top + hh - r}V${top}Z`;
            return (
              <g key={i}>
                <path d={path} fill={fill} opacity={hover === null || hover === i ? 1 : 0.55} />
                <rect x={pad.l + band * i} y={pad.t} width={band} height={h} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
                {i % every === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hovered && hover !== null && (
        <div className="chart-tip" style={pad.l + band * (hover + 0.5) > width * 0.6 ? { right: width - (pad.l + band * (hover + 0.5)) + 10, top: 6 } : { left: pad.l + band * (hover + 0.5) + 10, top: 6 }}>
          <div className="t">{hovered.label}</div>
          <div className="l">
            <span>{hovered.note ?? 'Value'}</span>
            <b>{yf(hovered.value)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

/** Stacked columns (for example, money invested + growth per year). */
export function StackedColumns({ categories, series, height = 240, yFormat }: { categories: string[]; series: { name: string; values: number[]; color?: string }[]; height?: number; yFormat?: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 8, r: 54, t: 10, b: 22 };
  const w = Math.max(10, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const n = categories.length;
  const totals = categories.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0));
  const ticks = niceTicks(0, Math.max(1, ...totals), Math.max(3, Math.floor(h / 48)));
  const yf = yFormat ?? axisFormat(ticks);
  const t1 = ticks[ticks.length - 1];
  const y = (v: number) => pad.t + h - (v / (t1 || 1)) * h;
  const band = n ? w / n : w;
  const bw = Math.max(2, Math.min(24, band * 0.7));
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(w / 46))));
  const colors = series.map((s, i) => s.color ?? seriesColor(i));
  return (
    <div>
      <Legend items={series.map((s, i) => ({ name: s.name, color: colors[i], line: false }))} />
      <div className="chart" ref={ref} style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Stacked column chart" onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'zero' : 'gridline'} x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} />
                <text x={pad.l + w + 6} y={y(t) + 3.5}>
                  {yf(t)}
                </text>
              </g>
            ))}
            {categories.map((c, i) => {
              let acc = 0;
              const cx = pad.l + band * (i + 0.5);
              return (
                <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {series.map((s, k) => {
                    const v = Math.max(0, s.values[i] ?? 0);
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    const hh = y0 - y1;
                    return hh > 0.5 ? <rect key={k} x={cx - bw / 2} y={y1 + (k > 0 ? 0 : 0)} width={bw} height={Math.max(0.5, hh - (k < series.length - 1 ? 2 : 0))} fill={colors[k]} rx={1} /> : null;
                  })}
                  <rect x={pad.l + band * i} y={pad.t} width={band} height={h} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
                  {i % every === 0 && (
                    <text x={cx} y={height - 6} textAnchor="middle">
                      {c}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && (
          <div className="chart-tip" style={pad.l + band * (hover + 0.5) > width * 0.6 ? { right: width - (pad.l + band * (hover + 0.5)) + 10, top: 6 } : { left: pad.l + band * (hover + 0.5) + 10, top: 6 }}>
            <div className="t">{categories[hover]}</div>
            {series.map((s, k) => (
              <div className="l" key={k}>
                <span>
                  <i className="swatch" style={{ background: colors[k] }} />
                  {s.name}
                </span>
                <b>{yf(s.values[hover] ?? 0)}</b>
              </div>
            ))}
            <div className="l">
              <span>Total</span>
              <b>{yf(totals[hover])}</b>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- scatter ---------- */

export interface Dot {
  x: number;
  y: number;
  label: string;
  color?: string;
  /** draw larger and label directly */
  key?: boolean;
  detail?: string;
}

export function Scatter({
  points,
  line,
  height = 340,
  xFormat,
  yFormat,
  xLabel,
  yLabel,
}: {
  points: Dot[];
  line?: { x: number; y: number }[];
  height?: number;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  xLabel: string;
  yLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 52, r: 16, t: 14, b: 38 };
  const w = Math.max(10, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const xs = [...points.map((d) => d.x), ...(line ?? []).map((d) => d.x)].filter(Number.isFinite);
  const ys = [...points.map((d) => d.y), ...(line ?? []).map((d) => d.y)].filter(Number.isFinite);
  if (!xs.length) return <div className="muted small">No data to plot.</div>;
  const tx = niceTicks(Math.min(...xs, 0), Math.max(...xs), Math.max(3, Math.floor(w / 90)));
  const ty = niceTicks(Math.min(...ys, 0), Math.max(...ys), Math.max(3, Math.floor(h / 46)));
  const X = (v: number) => pad.l + ((v - tx[0]) / (tx[tx.length - 1] - tx[0] || 1)) * w;
  const Y = (v: number) => pad.t + h - ((v - ty[0]) / (ty[ty.length - 1] - ty[0] || 1)) * h;
  const hov = hover !== null ? points[hover] : null;
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${yLabel} against ${xLabel}`} onPointerLeave={() => setHover(null)}>
          {ty.map((t) => (
            <g key={'y' + t}>
              <line className={t === 0 ? 'zero' : 'gridline'} x1={pad.l} x2={pad.l + w} y1={Y(t)} y2={Y(t)} />
              <text x={pad.l - 6} y={Y(t) + 3.5} textAnchor="end">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {tx.map((t) => (
            <g key={'x' + t}>
              <line className="gridline" x1={X(t)} x2={X(t)} y1={pad.t} y2={pad.t + h} />
              <text x={X(t)} y={pad.t + h + 14} textAnchor="middle">
                {xFormat(t)}
              </text>
            </g>
          ))}
          <text x={pad.l + w / 2} y={height - 4} textAnchor="middle">
            {xLabel}
          </text>
          <text transform={`translate(11 ${pad.t + h / 2}) rotate(-90)`} textAnchor="middle">
            {yLabel}
          </text>
          {line && line.length > 1 && <path d={'M' + line.map((d) => `${X(d.x).toFixed(1)},${Y(d.y).toFixed(1)}`).join('L')} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" />}
          {points.map((d, i) => (
            <g key={i}>
              <circle cx={X(d.x)} cy={Y(d.y)} r={d.key ? 6 : 4.5} fill={d.color ?? 'var(--text-3)'} stroke="var(--surface)" strokeWidth={2} />
              <circle cx={X(d.x)} cy={Y(d.y)} r={14} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
              {d.key && (
                <text x={X(d.x) + 9} y={Y(d.y) - 8} style={{ fill: 'var(--text)', fontWeight: 600 }}>
                  {d.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      {hov && (
        <div className="chart-tip" style={X(hov.x) > width * 0.6 ? { right: width - X(hov.x) + 12, top: Math.max(0, Y(hov.y) - 30) } : { left: X(hov.x) + 12, top: Math.max(0, Y(hov.y) - 30) }}>
          <div className="t">{hov.label}</div>
          <div className="l">
            <span>{yLabel}</span>
            <b>{yFormat(hov.y)}</b>
          </div>
          <div className="l">
            <span>{xLabel}</span>
            <b>{xFormat(hov.x)}</b>
          </div>
          {hov.detail && <div className="t" style={{ marginTop: 3 }}>{hov.detail}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- bar list ---------- */

export interface BarListItem {
  label: ReactNode;
  /** share of the track, 0–1 */
  share: number;
  display: string;
  color?: string;
  /** optional target marker, 0–1 */
  mark?: number;
  title?: string;
}

/** Horizontal bars with labels and exact values: the precise alternative to a pie chart. */
export function BarList({ items, max }: { items: BarListItem[]; max?: number }) {
  const top = max ?? Math.max(0.0001, ...items.map((i) => Math.max(i.share, i.mark ?? 0)));
  return (
    <div className="barlist">
      {items.map((it, i) => (
        <div className="item" key={i} title={it.title}>
          <span className="name">{it.label}</span>
          <span className="track">
            <span className="fill" style={{ width: `${Math.min(100, (Math.max(0, it.share) / top) * 100)}%`, background: it.color }} />
            {it.mark !== undefined && <span className="mark" style={{ left: `${Math.min(100, (it.mark / top) * 100)}%` }} />}
          </span>
          <span className="val">{it.display}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- correlation heatmap ---------- */

/** Diverging colour for values in [−1, 1]: red (negative) – neutral – blue (positive). */
export function divergingColor(v: number): string {
  const k = Math.round(Math.min(1, Math.abs(v)) * 100);
  return `color-mix(in oklab, ${v >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${k}%, var(--div-mid))`;
}

export function Heatmap({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  return (
    <div className="tbl-wrap">
      <table className="heat" aria-label="Correlation matrix">
        <thead>
          <tr>
            <th />
            {labels.map((l) => (
              <th key={l} title={l}>
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <th title={labels[i]}>{labels[i]}</th>
              {row.map((v, j) => (
                <td key={j} title={`${labels[i]} and ${labels[j]}: ${Number.isFinite(v) ? v.toFixed(2) : 'n/a'}`} style={{ background: Number.isFinite(v) ? divergingColor(v) : 'var(--surface-3)', color: Math.abs(v) > 0.55 ? '#fff' : 'var(--text)' }}>
                  {Number.isFinite(v) ? v.toFixed(2) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- sparkline ---------- */

export function Sparkline({ values, width = 84, height = 26 }: { values: number[]; width?: number; height?: number }) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return <svg width={width} height={height} aria-hidden />;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const step = Math.max(1, Math.ceil(v.length / 60));
  const pts = v.filter((_, i) => i % step === 0 || i === v.length - 1);
  const d = pts.map((y, i) => `${((i / (pts.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((y - lo) / (hi - lo || 1)) * (height - 4)).toFixed(1)}`).join('L');
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={'M' + d} fill="none" stroke={v[v.length - 1] >= v[0] ? 'var(--pos)' : 'var(--neg)'} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** Where today's price sits between two extremes (52-week low and high, for example). */
export function RangeBar({ low, high, value }: { low: number; high: number; value: number }) {
  const k = high > low ? Math.min(1, Math.max(0, (value - low) / (high - low))) : 0.5;
  return (
    <div className="range-bar" role="img" aria-label={`${Math.round(k * 100)}% of the way from low to high`}>
      <i style={{ left: `${k * 100}%` }} />
    </div>
  );
}
