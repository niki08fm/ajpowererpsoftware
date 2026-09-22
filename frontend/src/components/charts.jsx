import { useId, useState } from 'react';
import { money, qty as fmtQty } from '../api';

/**
 * Charts, drawn by hand.
 *
 * This project carries no UI dependencies and there is no reason for
 * four charts to be the thing that changes that. These are inline SVG,
 * a few hundred lines, and they take their colours from the same CSS
 * variables as everything else — so they stay right when the palette
 * moves, which a charting library's defaults would not.
 *
 * Two rules they follow. Bars always start at zero, because a
 * truncated axis is a lie people act on. And every chart sits beside
 * its own numbers rather than replacing them: the picture is for
 * spotting the shape, the table is for the answer.
 *
 * They plot money or quantity without caring which. Site screens are
 * shown quantities and the expense report is shown money, so the axis
 * formatter is a prop rather than a decision baked into the drawing.
 */

const PAD = { t: 14, r: 52, b: 26, l: 56 };

const shortNum = (n) => {
  const v = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `${sign}${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L`;
  if (v >= 1e3) return `${sign}${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return `${sign}${Math.round(v * 100) / 100}`;
};

const shortMoney = (n) => {
  const v = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L`;
  if (v >= 1e3) return `${sign}₹${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return `${sign}₹${Math.round(v)}`;
};

/** 2026-09-01 → Sep 26, or 01 Sep for a day bucket. */
const bucketLabel = (b, bucket) => {
  const [y, m, d] = String(b).slice(0, 10).split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  if (bucket === 'month') return `${mon} ${y.slice(2)}`;
  return `${d} ${mon}`;
};

/** A sensible top-of-axis: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}


/**
 * Series colour.
 *
 * Tones are written by name at the call site ('brand', 'navy', 'ok' …)
 * and resolved here, because two of those names are furniture rather
 * than data: --navy is the sidebar and would disappear against a dark
 * background. The categorical ramp --chart-1..5 is the one that was
 * checked for contrast in both themes, so names land on it, while a
 * genuine status tone (bad) stays the status colour it means.
 */
const HUE = {
  brand: '--chart-1', ok: '--chart-2', cat3: '--chart-3',
  warn: '--chart-4', navy: '--chart-5', cat4: '--chart-4',
  bad: '--bad',
};
const hue = (tone) => `var(${HUE[tone] || `--${tone}`})`;

/** The ramp, in order, for anything that colours a list it is handed. */
const RAMP = ['brand', 'ok', 'cat3', 'warn', 'navy'];

/* ===================================================================
   Columns for each period, with the running total laid over them.
   =================================================================== */
export function TrendChart({
  series, bucket = 'month', height = 220,
  valueKey = 'consumed_value', runningKey = 'running_value',
  label = 'consumed', showRunning = true,
  // money or quantity — the chart does not care which
  format = money, axis = shortMoney,
}) {
  const id = useId();
  const [hover, setHover] = useState(null);
  const w = 720;
  const h = height;

  if (!series || series.length === 0) {
    return (
      <div className="empty" style={{ padding: '34px 0' }}>
        <b>Nothing in this window</b>
        <div style={{ fontSize: 12 }}>Widen the dates, or clear a filter.</div>
      </div>
    );
  }

  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const vals = series.map((s) => Number(s[valueKey]) || 0);
  const runs = series.map((s) => Number(s[runningKey]) || 0);
  const hasNeg = vals.some((v) => v < 0);
  const top = niceMax(Math.max(...vals, 0));
  const bottom = hasNeg ? -niceMax(Math.abs(Math.min(...vals))) : 0;
  const span = top - bottom || 1;
  const runTop = niceMax(Math.max(...runs, 0)) || 1;

  const bw = Math.max(3, Math.min(52, (iw / series.length) * 0.62));
  const x = (i) => PAD.l + (iw / series.length) * (i + 0.5);
  const y = (v) => PAD.t + ih - ((v - bottom) / span) * ih;
  const yRun = (v) => PAD.t + ih - (v / runTop) * ih;
  const zero = y(0);

  const runPath = runs
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yRun(v).toFixed(1)}`)
    .join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => bottom + span * f);

  return (
    <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}
        role="img" aria-label={`${label} by ${bucket}`}
        style={{ display: 'block', minWidth: 420 }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)}
              stroke="var(--line)" strokeWidth="1"
              strokeDasharray={Math.abs(t) < 0.0001 ? '' : '3 4'} />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end"
              fontSize="10" fill="var(--muted)">{axis(t)}</text>
          </g>
        ))}

        {showRunning && (
          <text x={w - PAD.r + 8} y={PAD.t + 4} fontSize="10" fill="var(--ok)">
            {axis(runTop)}
          </text>
        )}

        {series.map((s, i) => {
          const v = Number(s[valueKey]) || 0;
          const top0 = v >= 0 ? y(v) : zero;
          const bh = Math.max(1, Math.abs(y(v) - zero));
          const on = hover === i;
          return (
            <g key={s.bucket}
              onMouseEnter={() => setHover(i)}>
              <rect x={x(i) - (iw / series.length) / 2} y={PAD.t}
                width={iw / series.length} height={ih} fill="transparent" />
              <rect x={x(i) - bw / 2} y={top0} width={bw} height={bh}
                rx="3"
                fill={v < 0 ? 'var(--ok)' : `url(#${id}-bar)`}
                opacity={hover === null || on ? 1 : 0.45} />
            </g>
          );
        })}

        {showRunning && runs.some((v) => v !== 0) && (
          <path d={runPath} fill="none" stroke="var(--ok)" strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
        )}
        {showRunning && hover !== null && (
          <circle cx={x(hover)} cy={yRun(runs[hover])} r="3.5" fill="var(--ok)" />
        )}

        {series.map((s, i) => {
          // thin out labels when the run is long
          const every = Math.ceil(series.length / 12);
          if (i % every !== 0 && i !== series.length - 1) return null;
          return (
            <text key={s.bucket} x={x(i)} y={h - 8} textAnchor="middle"
              fontSize="10" fill="var(--muted)">
              {bucketLabel(s.bucket, bucket)}
            </text>
          );
        })}
      </svg>

      {hover !== null && (
        <div style={{
          position: 'absolute', top: 6, left: 0, right: 0, textAlign: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{
            background: 'var(--card)', border: '1px solid var(--line)',
            borderRadius: 'var(--r)', padding: '4px 10px', fontSize: 12,
            boxShadow: 'var(--sh)',
          }}>
            <b>{bucketLabel(series[hover].bucket, bucket)}</b>
            {' · '}{format(series[hover][valueKey])} {label}
            {showRunning && <>{' · '}<span style={{ color: 'var(--ok)' }}>
              {format(series[hover][runningKey])} to date</span></>}
          </span>
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   A ranked list as bars. For "which items cost the most".
   =================================================================== */
export function RankBars({
  rows, labelKey, valueKey, subKey, unit, max = 10, tone = 'brand', format = money,
}) {
  if (!rows || !rows.length) {
    return <div className="empty" style={{ padding: '26px 0' }}><b>Nothing to rank</b></div>;
  }
  const top = rows.slice(0, max);
  const peak = Math.max(...top.map((r) => Math.abs(Number(r[valueKey]) || 0)), 1);

  return (
    <div style={{ display: 'grid', gap: 7, padding: '4px 0' }}>
      {top.map((r) => {
        const v = Number(r[valueKey]) || 0;
        return (
          <div key={r[labelKey]} style={{ display: 'grid', gap: 3 }}>
            <div style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'baseline' }}>
              <span style={{
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <b>{r[labelKey]}</b>
                {subKey && r[subKey] != null && (
                  <span style={{ color: 'var(--muted)' }}>
                    {' · '}{fmtQty(r[subKey])}{unit ? ` ${unit}` : ''}
                  </span>
                )}
              </span>
              <span className="mono" style={{ fontWeight: 700 }}>{format(v)}</span>
            </div>
            <div style={{
              height: 7, borderRadius: 4, background: 'var(--faint)', overflow: 'hidden',
            }}>
              <i style={{
                display: 'block', height: '100%',
                width: `${(Math.abs(v) / peak) * 100}%`,
                background: hue(v < 0 ? 'ok' : tone),
                borderRadius: 4,
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===================================================================
   One number's makeup, as a single stacked strip.
   =================================================================== */
export function SplitBar({ parts, total }) {
  const sum = total ?? parts.reduce((t, p) => t + Math.abs(Number(p.value) || 0), 0);
  if (!sum) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{
        display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden',
        background: 'var(--faint)',
      }}>
        {parts.map((p) => (
          <i key={p.label} title={`${p.label} — ${money(p.value)}`}
            style={{
              width: `${(Math.abs(Number(p.value)) / sum) * 100}%`,
              background: hue(p.tone || 'brand'),
            }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
        {parts.map((p) => (
          <span key={p.label} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <i style={{
              width: 9, height: 9, borderRadius: 3, background: hue(p.tone || 'brand'),
            }} />
            {p.label}
            <b className="mono">{money(p.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}


/* ===================================================================
   A donut. For the makeup of one total, and nothing else.

   Pie charts are bad at comparing slices and worse at more than a
   handful of them, so this one is used only where the question is
   "what is this made of" — and it says the total in the middle,
   prints the figure beside every label, and folds the tail into
   "other" rather than drawing twenty slivers nobody can read.
   =================================================================== */
const TONES = RAMP;

export function DonutChart({
  parts, size = 190, thickness = 30, centreLabel = 'total', format = money, max = 6,
}) {
  const [hover, setHover] = useState(null);
  const clean = (parts || [])
    .map((p) => ({ ...p, value: Math.abs(Number(p.value) || 0) }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);

  if (!clean.length) {
    return <div className="empty" style={{ padding: '30px 0' }}><b>Nothing to show</b></div>;
  }

  // a long tail is one slice called "other", not twenty slivers
  const shown = clean.length > max
    ? [...clean.slice(0, max - 1), {
      label: `${clean.length - max + 1} others`,
      value: clean.slice(max - 1).reduce((t, p) => t + p.value, 0),
    }]
    : clean;

  const total = shown.reduce((t, p) => t + p.value, 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs = shown.map((p, i) => {
    const frac = p.value / total;
    const arc = {
      ...p,
      tone: p.tone || TONES[i % TONES.length],
      pct: frac * 100,
      dash: frac * circ,
      gap: circ - frac * circ,
      offset,
    };
    offset += frac * circ;
    return arc;
  });

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`${centreLabel} by share`} style={{ flex: '0 0 auto' }}
        onMouseLeave={() => setHover(null)}>
        <g transform={`rotate(-90 ${c} ${c})`}>
          {arcs.map((a, i) => (
            <circle key={a.label} cx={c} cy={c} r={r}
              fill="none"
              stroke={hue(a.tone)}
              strokeWidth={hover === i ? thickness + 5 : thickness}
              strokeDasharray={`${a.dash} ${a.gap}`}
              strokeDashoffset={-a.offset}
              opacity={hover === null || hover === i ? 1 : 0.4}
              onMouseEnter={() => setHover(i)}
              style={{ transition: 'stroke-width .12s, opacity .12s' }} />
          ))}
        </g>
        <text x={c} y={c - 4} textAnchor="middle" fontSize="15" fontWeight="700"
          fill="var(--ink)">
          {hover === null ? format(total) : format(arcs[hover].value)}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" fontSize="10" fill="var(--muted)">
          {hover === null ? centreLabel : `${arcs[hover].pct.toFixed(1)}%`}
        </text>
      </svg>

      <div style={{ display: 'grid', gap: 6, minWidth: 190, flex: 1 }}>
        {arcs.map((a, i) => (
          <div key={a.label}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{
              display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12,
              opacity: hover === null || hover === i ? 1 : 0.5,
            }}>
            <i style={{
              width: 10, height: 10, borderRadius: 3, background: hue(a.tone),
              flex: '0 0 auto',
            }} />
            <span style={{
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{a.label}</span>
            <span style={{ color: 'var(--muted)' }}>{a.pct.toFixed(0)}%</span>
            <span className="mono" style={{ fontWeight: 700 }}>{format(a.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================================================================
   Lines. For two or three things moving against each other over time.
   =================================================================== */
export function LineChart({
  series, lines, bucket = 'month', height = 230, format = money, axis = shortMoney,
  area = true,
}) {
  const id = useId();
  const [hover, setHover] = useState(null);
  const w = 720;
  const h = height;

  if (!series || series.length === 0) {
    return (
      <div className="empty" style={{ padding: '34px 0' }}>
        <b>Nothing in this window</b>
        <div style={{ fontSize: 12 }}>Widen the dates, or clear a filter.</div>
      </div>
    );
  }

  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const all = series.flatMap((s) => lines.map((l) => Number(s[l.key]) || 0));
  const top = niceMax(Math.max(...all, 0));
  const low = Math.min(...all, 0);
  const bottom = low < 0 ? -niceMax(Math.abs(low)) : 0;
  const span = top - bottom || 1;

  // one point still needs to be visible, so it sits in the middle
  const x = (i) => (series.length === 1
    ? PAD.l + iw / 2
    : PAD.l + (iw / (series.length - 1)) * i);
  const y = (v) => PAD.t + ih - ((v - bottom) / span) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => bottom + span * f);

  const path = (key) => series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(Number(s[key]) || 0).toFixed(1)}`)
    .join(' ');
  const fill = (key) => `${path(key)} L ${x(series.length - 1).toFixed(1)} ${y(bottom)} `
    + `L ${x(0).toFixed(1)} ${y(bottom)} Z`;

  return (
    <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img"
        style={{ display: 'block', minWidth: 420 }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          {lines.map((l) => (
            <linearGradient key={l.key} id={`${id}-${l.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hue(l.tone)} stopOpacity="0.28" />
              <stop offset="100%" stopColor={hue(l.tone)} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)"
              strokeDasharray={Math.abs(t) < 0.0001 ? '' : '3 4'} />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10"
              fill="var(--muted)">{axis(t)}</text>
          </g>
        ))}

        {area && series.length > 1 && lines.map((l) => (
          <path key={`a-${l.key}`} d={fill(l.key)} fill={`url(#${id}-${l.key})`} />
        ))}
        {lines.map((l) => (
          series.length > 1
            ? <path key={l.key} d={path(l.key)} fill="none" stroke={hue(l.tone)}
              strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            : <circle key={l.key} cx={x(0)} cy={y(Number(series[0][l.key]) || 0)} r="4"
              fill={hue(l.tone)} />
        ))}

        {series.map((s, i) => (
          <g key={s.bucket} onMouseEnter={() => setHover(i)}>
            <rect x={x(i) - iw / Math.max(series.length, 1) / 2} y={PAD.t}
              width={iw / Math.max(series.length, 1)} height={ih} fill="transparent" />
            {hover === i && (
              <>
                <line x1={x(i)} x2={x(i)} y1={PAD.t} y2={PAD.t + ih}
                  stroke="var(--muted)" strokeDasharray="3 3" />
                {lines.map((l) => (
                  <circle key={l.key} cx={x(i)} cy={y(Number(s[l.key]) || 0)} r="3.5"
                    fill={hue(l.tone)} />
                ))}
              </>
            )}
          </g>
        ))}

        {series.map((s, i) => {
          const every = Math.ceil(series.length / 12);
          if (i % every !== 0 && i !== series.length - 1) return null;
          return (
            <text key={s.bucket} x={x(i)} y={h - 8} textAnchor="middle" fontSize="10"
              fill="var(--muted)">{bucketLabel(s.bucket, bucket)}</text>
          );
        })}
      </svg>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, paddingLeft: PAD.l }}>
        {lines.map((l) => (
          <span key={l.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <i style={{ width: 14, height: 3, borderRadius: 2, background: hue(l.tone) }} />
            {l.label}
            {hover !== null && (
              <b className="mono">{format(series[hover][l.key])}</b>
            )}
          </span>
        ))}
        {hover !== null && (
          <span style={{ color: 'var(--muted)' }}>
            {bucketLabel(series[hover].bucket, bucket)}
          </span>
        )}
      </div>
    </div>
  );
}


/* ===================================================================
   Beyond the line chart.

   A line is right for one quantity moving through time and wrong for
   most other questions, which is why the overview screens were hard
   to read: everything looked the same. The shapes below each answer
   one kind of question, and the overview picks the shape to fit:

     how much of a whole        Waffle, DonutChart
     how far along             Gauge, RadialBars
     this against its target   Bullet
     which are the big ones    Treemap, RankBars
     when did it happen        HeatStrip
     how is it spread          Histogram
     how many made it through  Funnel
     the shape, in a tile      Sparkline
   =================================================================== */

/* ---------------------------------------------- a trend inside a tile */
export function Sparkline({
  values, tone = 'brand', width = 120, height = 34, area = true, showLast = true,
}) {
  const id = useId();
  const vs = (values || []).map((v) => Number(v) || 0);
  if (vs.length < 2) return <div style={{ height }} />;

  const top = Math.max(...vs);
  const low = Math.min(...vs, 0);
  const span = top - low || 1;
  const x = (i) => (width / (vs.length - 1)) * i;
  const y = (v) => height - 3 - ((v - low) / span) * (height - 6);
  const line = vs.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={hue(tone)} stopOpacity="0.30" />
          <stop offset="100%" stopColor={hue(tone)} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={`${line} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${id}-f)`} />}
      <path d={line} fill="none" stroke={hue(tone)} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
      {showLast && (
        <circle cx={x(vs.length - 1)} cy={y(vs[vs.length - 1])} r="2.6" fill={hue(tone)} />
      )}
    </svg>
  );
}

/* ------------------------------------------------ how far along, as an arc
   A 240° dial, because a reader judges an angle far better than they
   judge the length of a bar against a faint target line. The figure is
   printed in the middle; the arc is only there to be read at a glance.
   =================================================================== */
export function Gauge({
  value, max = 100, label, sub, tone = 'brand', size = 168, thickness = 14, format,
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const c = size / 2;
  const r = c - thickness / 2 - 4;
  const SWEEP = 260; // degrees of dial
  const start = 90 + (360 - SWEEP) / 2;

  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const arc = (fromDeg, toDeg) => {
    const [x1, y1] = pt(fromDeg);
    const [x2, y2] = pt(toDeg);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const shown = format ? format(value) : Math.round(pct * 100) + '%';

  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
      <svg width={size} height={size * 0.78} viewBox={`0 0 ${size} ${size * 0.86}`}
        role="img" aria-label={`${label}: ${shown}`}>
        <path d={arc(start, start + SWEEP - 0.01)} fill="none" stroke="var(--line)"
          strokeWidth={thickness} strokeLinecap="round" />
        {pct > 0 && (
          <path d={arc(start, start + SWEEP * pct)} fill="none" stroke={hue(tone)}
            strokeWidth={thickness} strokeLinecap="round"
            style={{ transition: 'd .3s' }} />
        )}
        <text x={c} y={c + 4} textAnchor="middle" fontSize={size / 6.2} fontWeight="700"
          fontFamily="var(--font-display)" fill="var(--ink)">{shown}</text>
        {label && (
          <text x={c} y={c + size / 5.6} textAnchor="middle" fontSize="11" fill="var(--muted)">
            {label}
          </text>
        )}
      </svg>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------------------- several things, as rings
   Concentric rings compare three or four fractions of their own wholes
   — "how much of each is done" — which stacked bars cannot do without
   pretending the wholes are the same size.
   =================================================================== */
export function RadialBars({ parts, size = 178, thickness = 13, gap = 5 }) {
  const rows = (parts || []).slice(0, 4);
  if (!rows.length) return <div className="empty"><b>Nothing to show</b></div>;
  const c = size / 2;

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label="progress rings" style={{ flex: '0 0 auto' }}>
        <g transform={`rotate(-90 ${c} ${c})`}>
          {rows.map((p, i) => {
            const r = c - thickness / 2 - i * (thickness + gap) - 2;
            const circ = 2 * Math.PI * r;
            const frac = p.max > 0 ? Math.max(0, Math.min(1, p.value / p.max)) : 0;
            return (
              <g key={p.label}>
                <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line-2)"
                  strokeWidth={thickness} />
                {/* a round cap on a zero-length arc draws a dot, which
                    reads as "a little" when the answer is none */}
                {frac > 0 && (
                  <circle cx={c} cy={c} r={r} fill="none"
                    stroke={hue(p.tone || RAMP[i % RAMP.length])}
                    strokeWidth={thickness} strokeLinecap="round"
                    strokeDasharray={`${frac * circ} ${circ}`} />
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div style={{ display: 'grid', gap: 9, flex: 1, minWidth: 170 }}>
        {rows.map((p, i) => {
          const frac = p.max > 0 ? p.value / p.max : 0;
          return (
            <div key={p.label} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5 }}>
              <i style={{
                width: 10, height: 10, borderRadius: 3, flex: '0 0 auto',
                background: hue(p.tone || RAMP[i % RAMP.length]),
              }} />
              <span style={{ flex: 1 }}>{p.label}</span>
              <b className="mono">{p.value}</b>
              <span style={{ color: 'var(--muted)' }}>/ {p.max} · {Math.round(frac * 100)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------- columns over time
   Stacked when the parts add up to something meaningful, grouped when
   the question is "which of these two is bigger this week". Both start
   at zero and both say the total on hover.
   =================================================================== */
export function StackedBars({
  series, lines, bucket = 'week', height = 240, stacked = true,
  format = money, axis = shortMoney,
}) {
  const [hover, setHover] = useState(null);
  const w = 720;
  const h = height;

  if (!series || !series.length) {
    return (
      <div className="empty" style={{ padding: '34px 0' }}>
        <b>Nothing in this window</b>
        <div style={{ fontSize: 12 }}>Widen the dates, or clear a filter.</div>
      </div>
    );
  }

  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const totals = series.map((s) => lines.reduce((a, l) => a + (Number(s[l.key]) || 0), 0));
  const peak = stacked
    ? Math.max(...totals, 0)
    : Math.max(...series.flatMap((s) => lines.map((l) => Number(s[l.key]) || 0)), 0);
  const top = niceMax(peak);
  const slot = iw / series.length;
  const bw = Math.min(46, slot * 0.6);
  const sub = stacked ? bw : bw / lines.length;
  const x = (i) => PAD.l + slot * (i + 0.5);
  const y = (v) => PAD.t + ih - (v / top) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);

  return (
    <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img"
        style={{ display: 'block', minWidth: 420 }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)"
              strokeDasharray={t === 0 ? '' : '3 4'} />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10"
              fill="var(--muted)">{axis(t)}</text>
          </g>
        ))}

        {series.map((s, i) => {
          let stackTop = 0;
          return (
            <g key={s.bucket} onMouseEnter={() => setHover(i)}
              opacity={hover === null || hover === i ? 1 : 0.5}>
              <rect x={x(i) - slot / 2} y={PAD.t} width={slot} height={ih} fill="transparent" />
              {lines.map((l, li) => {
                const v = Number(s[l.key]) || 0;
                if (stacked) {
                  const y0 = y(stackTop + v);
                  const bh = Math.max(v > 0 ? 2 : 0, y(stackTop) - y(stackTop + v));
                  stackTop += v;
                  return v > 0 ? (
                    <rect key={l.key} x={x(i) - bw / 2} y={y0} width={bw} height={bh}
                      fill={hue(l.tone)} rx="2" />
                  ) : null;
                }
                const gx = x(i) - bw / 2 + li * sub;
                return v > 0 ? (
                  <rect key={l.key} x={gx} y={y(v)} width={Math.max(2, sub - 2)}
                    height={Math.max(2, ih + PAD.t - y(v))} fill={hue(l.tone)} rx="2" />
                ) : null;
              })}
            </g>
          );
        })}

        {series.map((s, i) => {
          const every = Math.ceil(series.length / 12);
          if (i % every !== 0 && i !== series.length - 1) return null;
          return (
            <text key={s.bucket} x={x(i)} y={h - 8} textAnchor="middle" fontSize="10"
              fill="var(--muted)">{bucketLabel(s.bucket, bucket)}</text>
          );
        })}
      </svg>

      <div className="legend" style={{ paddingLeft: PAD.l, marginTop: 2 }}>
        {lines.map((l) => (
          <span key={l.key}>
            <i style={{ background: hue(l.tone) }} />
            {l.label}
            {hover !== null && <b className="mono">{format(series[hover][l.key] || 0)}</b>}
          </span>
        ))}
        {hover !== null && (
          <span style={{ color: 'var(--muted)' }}>
            {bucketLabel(series[hover].bucket, bucket)} · total {format(totals[hover])}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ waffle
   A hundred squares. It answers "how much of the pile is this" in
   counts people can actually verify by eye — which a pie slice of
   seven percent does not.
   =================================================================== */
export function Waffle({ parts, cols = 10, rows = 10, gap = 3, cell = 15 }) {
  const [hover, setHover] = useState(null);
  const clean = (parts || [])
    .map((p, i) => ({ ...p, value: Math.max(0, Number(p.value) || 0), tone: p.tone || RAMP[i % RAMP.length] }))
    .filter((p) => p.value > 0);
  const total = clean.reduce((t, p) => t + p.value, 0);
  if (!total) return <div className="empty"><b>Nothing to show</b></div>;

  // largest-remainder, so the squares always add to exactly 100
  const n = cols * rows;
  const raw = clean.map((p) => (p.value / total) * n);
  const base = raw.map(Math.floor);
  let left = n - base.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - base[i], i]).sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => { if (left > 0) { base[i] += 1; left -= 1; } });

  const squares = [];
  base.forEach((k, i) => { for (let j = 0; j < k; j += 1) squares.push(i); });

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={cols * (cell + gap)} height={rows * (cell + gap)} role="img"
        aria-label="composition, one square per percent" style={{ flex: '0 0 auto' }}
        onMouseLeave={() => setHover(null)}>
        {squares.map((pi, k) => (
          <rect key={k} x={(k % cols) * (cell + gap)} y={Math.floor(k / cols) * (cell + gap)}
            width={cell} height={cell} rx="3" fill={hue(clean[pi].tone)}
            opacity={hover === null || hover === pi ? 1 : 0.3}
            onMouseEnter={() => setHover(pi)} />
        ))}
      </svg>
      <div style={{ display: 'grid', gap: 7, flex: 1, minWidth: 170 }}>
        {clean.map((p, i) => (
          <div key={p.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{
              display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5,
              opacity: hover === null || hover === i ? 1 : 0.5,
            }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: hue(p.tone), flex: '0 0 auto' }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.label}
            </span>
            <b className="mono">{p.value}</b>
            <span style={{ color: 'var(--muted)' }}>{base[i]}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------- this against its target */
export function Bullet({ rows, format = (v) => v, height = 22 }) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return <div className="empty"><b>Nothing to measure</b></div>;

  return (
    <div style={{ display: 'grid', gap: 13 }}>
      {list.map((r) => {
        const target = Number(r.target) || 0;
        const value = Number(r.value) || 0;
        const scale = Math.max(target, value) * 1.12 || 1;
        const over = target > 0 && value > target;
        return (
          <div key={r.label} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', fontSize: 12.5, alignItems: 'baseline', gap: 8 }}>
              <span style={{ flex: 1 }}>{r.label}</span>
              <b className="mono" style={{ color: over ? 'var(--bad)' : 'var(--ink)' }}>
                {format(value)}
              </b>
              {target > 0 && (
                <span style={{ color: 'var(--muted)' }}>of {format(target)}</span>
              )}
            </div>
            <div style={{
              position: 'relative', height, background: 'var(--line-2)',
              borderRadius: 5, overflow: 'hidden',
            }}>
              <i style={{
                display: 'block', height: '100%', width: `${(value / scale) * 100}%`,
                background: over ? 'var(--bad)' : hue(r.tone || 'brand'), borderRadius: 5,
                transition: 'width .3s',
              }} />
              {target > 0 && (
                <span style={{
                  position: 'absolute', top: 2, bottom: 2, left: `${(target / scale) * 100}%`,
                  width: 2, background: 'var(--ink)', opacity: .65,
                }} title={`target ${format(target)}`} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------- when it happened
   A row per metric, a cell per period, darker where there was more.
   Six weeks of three metrics in the space one line chart would take,
   and the eye finds the busy week without reading an axis.
   =================================================================== */
export function HeatStrip({ series, lines, bucket = 'week', format = (v) => v }) {
  const [hover, setHover] = useState(null);
  if (!series || !series.length) return <div className="empty"><b>Nothing in this window</b></div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: '3px' }}>
        <tbody>
          {lines.map((l) => {
            const vals = series.map((s) => Number(s[l.key]) || 0);
            const peak = Math.max(...vals, 1);
            return (
              <tr key={l.key}>
                <th style={{
                  position: 'static', background: 'none', border: 0, padding: '0 10px 0 0',
                  textAlign: 'right', fontSize: 11.5, textTransform: 'none', letterSpacing: 0,
                  color: 'var(--ink-2)', fontWeight: 500, whiteSpace: 'nowrap',
                }}>{l.label}</th>
                {series.map((s, i) => {
                  const v = Number(s[l.key]) || 0;
                  const on = hover && hover.i === i;
                  return (
                    <td key={s.bucket} style={{ padding: 0, border: 0 }}
                      onMouseEnter={() => setHover({ i, key: l.key })}
                      onMouseLeave={() => setHover(null)}
                      title={`${bucketLabel(s.bucket, bucket)} · ${l.label}: ${format(v)}`}>
                      <div style={{
                        width: 34, height: 28, borderRadius: 5,
                        background: v ? hue(l.tone) : 'var(--line-2)',
                        opacity: v ? 0.22 + 0.78 * (v / peak) : 1,
                        outline: on ? '2px solid var(--ink)' : 'none',
                        display: 'grid', placeItems: 'center',
                        fontSize: 11, fontWeight: 700,
                        color: v / peak > 0.55 ? '#fff' : 'var(--ink-2)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>{v || ''}</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
          <tr>
            <th />
            {series.map((s) => (
              <td key={s.bucket} style={{ border: 0, padding: '4px 0 0' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                  {bucketLabel(s.bucket, bucket).replace(' ', ' ')}
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------- treemap
   Which are the big ones, when there are twenty of them and a bar
   chart would need a screen of its own. Squarified enough to compare
   areas; the figure is printed on any tile with room for it.
   =================================================================== */
export function Treemap({ rows, labelKey = 'label', valueKey = 'value', height = 230, format = money }) {
  const [hover, setHover] = useState(null);
  const clean = (rows || [])
    .map((r) => ({ label: r[labelKey], value: Math.abs(Number(r[valueKey]) || 0) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  if (!clean.length) return <div className="empty"><b>Nothing to rank</b></div>;

  const W = 720;
  const H = height;
  const total = clean.reduce((t, r) => t + r.value, 0);

  // slice-and-dice in rows: take items until the row is roughly square
  const tiles = [];
  let idx = 0;
  let y = 0;
  while (idx < clean.length && y < H - 1) {
    const remaining = clean.slice(idx);
    const remTotal = remaining.reduce((t, r) => t + r.value, 0);
    const remH = H - y;
    // how many go in this row: enough that the row is about as tall as
    // the tiles in it are wide
    let take = 1;
    let rowVal = remaining[0].value;
    while (idx + take < clean.length) {
      const nextVal = rowVal + remaining[take].value;
      const rowH = (nextVal / remTotal) * remH;
      const avgW = W / (take + 1);
      if (Math.abs(rowH - avgW) > Math.abs((rowVal / remTotal) * remH - W / take)) break;
      rowVal = nextVal;
      take += 1;
    }
    const rowH = Math.min(remH, (rowVal / remTotal) * remH);
    let x = 0;
    remaining.slice(0, take).forEach((r, i) => {
      const tw = (r.value / rowVal) * W;
      tiles.push({ ...r, x, y, w: tw, h: rowH, tone: RAMP[(tiles.length) % RAMP.length] });
      x += tw;
    });
    y += rowH;
    idx += take;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
      style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
      {tiles.map((t, i) => (
        <g key={t.label} onMouseEnter={() => setHover(i)}
          opacity={hover === null || hover === i ? 1 : 0.55}>
          <rect x={t.x + 1.5} y={t.y + 1.5} width={Math.max(0, t.w - 3)} height={Math.max(0, t.h - 3)}
            rx="6" fill={hue(t.tone)} />
          {t.w > 76 && t.h > 34 && (
            <>
              <text x={t.x + 11} y={t.y + 21} fontSize="12" fill="#fff" fontWeight="600">
                {t.label.length > t.w / 7.2 ? `${t.label.slice(0, Math.floor(t.w / 7.2))}…` : t.label}
              </text>
              <text x={t.x + 11} y={t.y + 38} fontSize="12" fill="#fff" opacity=".85"
                fontFamily="var(--font-display)">
                {format(t.value)} · {Math.round((t.value / total) * 100)}%
              </text>
            </>
          )}
        </g>
      ))}
      {hover !== null && tiles[hover].w <= 76 && (
        <text x={8} y={H - 8} fontSize="12" fill="var(--ink)">
          {tiles[hover].label} · {format(tiles[hover].value)}
        </text>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------ funnel
   How many of what started here made it to the end, and where they
   fell out. Each stage is drawn as a share of the first, and the drop
   is printed rather than left to be inferred from the taper.
   =================================================================== */
export function Funnel({ steps, format = (v) => v, height = 44 }) {
  const list = (steps || []).filter((s) => s);
  if (!list.length) return <div className="empty"><b>Nothing to trace</b></div>;
  const first = Math.max(...list.map((s) => Number(s.value) || 0), 1);

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {list.map((s, i) => {
        const v = Number(s.value) || 0;
        const prev = i ? Number(list[i - 1].value) || 0 : v;
        const drop = prev - v;
        const wpc = (v / first) * 100;
        return (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 132, fontSize: 12.5, color: 'var(--ink-2)', flex: '0 0 auto' }}>
              {s.label}
            </span>
            <div style={{ flex: 1, position: 'relative', height }}>
              <div style={{
                width: `${Math.max(wpc, 1.5)}%`, height: '100%',
                background: hue(s.tone || RAMP[i % RAMP.length]),
                borderRadius: 7, display: 'flex', alignItems: 'center', paddingLeft: 12,
                color: '#fff', fontWeight: 700, fontSize: 13,
                fontFamily: 'var(--font-display)', transition: 'width .3s',
              }}>{format(v)}</div>
            </div>
            <span style={{
              width: 116, fontSize: 12, textAlign: 'right', flex: '0 0 auto',
              color: drop > 0 ? 'var(--bad)' : 'var(--muted)',
            }}>
              {i === 0 ? `${Math.round(wpc)}%`
                : drop > 0 ? `−${format(drop)} dropped` : 'all carried through'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- histogram
   How a set of numbers is spread — "most are two days late, one is
   thirty" — which an average hides and a list buries.
   =================================================================== */
export function Histogram({ values, bins = 8, height = 150, tone = 'bad', unit = '' }) {
  const vs = (values || []).map((v) => Number(v) || 0).filter((v) => Number.isFinite(v));
  if (!vs.length) return <div className="empty"><b>Nothing to spread</b></div>;

  const top = Math.max(...vs);
  const width = Math.max(1, Math.ceil((top + 1) / bins));
  const counts = new Array(bins).fill(0);
  vs.forEach((v) => { counts[Math.min(bins - 1, Math.floor(v / width))] += 1; });
  const peak = Math.max(...counts, 1);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height, padding: '4px 0' }}>
      {counts.map((n, i) => (
        <div key={i} style={{ flex: 1, display: 'grid', gap: 4, alignContent: 'end', height: '100%' }}
          title={`${n} between ${i * width} and ${(i + 1) * width - 1} ${unit}`}>
          <span style={{
            fontSize: 11, textAlign: 'center', color: 'var(--ink-2)', fontWeight: 600,
            visibility: n ? 'visible' : 'hidden',
          }}>{n}</span>
          <i style={{
            display: 'block', height: `${(n / peak) * (height - 46)}px`, minHeight: n ? 3 : 1,
            background: n ? hue(tone) : 'var(--line)', borderRadius: '4px 4px 0 0',
            opacity: n ? 0.35 + 0.65 * (i / bins) : 1,
          }} />
          <span style={{ fontSize: 10, textAlign: 'center', color: 'var(--muted)' }}>
            {i * width}{i === bins - 1 ? '+' : `–${(i + 1) * width - 1}`}
          </span>
        </div>
      ))}
    </div>
  );
}

export { shortNum, shortMoney, hue, RAMP };
