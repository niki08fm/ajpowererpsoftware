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
                background: `var(--${v < 0 ? 'ok' : tone})`,
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
              background: `var(--${p.tone || 'brand'})`,
            }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
        {parts.map((p) => (
          <span key={p.label} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <i style={{
              width: 9, height: 9, borderRadius: 3, background: `var(--${p.tone || 'brand'})`,
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
const TONES = ['brand', 'warn', 'ok', 'navy', 'bad'];

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
              stroke={`var(--${a.tone})`}
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
              width: 10, height: 10, borderRadius: 3, background: `var(--${a.tone})`,
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
              <stop offset="0%" stopColor={`var(--${l.tone})`} stopOpacity="0.28" />
              <stop offset="100%" stopColor={`var(--${l.tone})`} stopOpacity="0.02" />
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
            ? <path key={l.key} d={path(l.key)} fill="none" stroke={`var(--${l.tone})`}
              strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            : <circle key={l.key} cx={x(0)} cy={y(Number(series[0][l.key]) || 0)} r="4"
              fill={`var(--${l.tone})`} />
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
                    fill={`var(--${l.tone})`} />
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
            <i style={{ width: 14, height: 3, borderRadius: 2, background: `var(--${l.tone})` }} />
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

export { shortNum, shortMoney };
