import { useEffect, useState } from "react";
import type { Metric, MetricPoint } from "./api";

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function formatValue(value: number, unit?: string) {
  if (!unit) return nf.format(value);
  return unit === "%" ? `${nf.format(value)}%` : `${nf.format(value)} ${unit}`;
}

function tone(good: boolean | null | undefined) {
  return good == null ? "neutral" : good ? "good" : "bad";
}

export function MetricsStrip({ metrics, flash }: { metrics: Metric[]; flash: Set<string> }) {
  const [open, setOpen] = useState<Metric | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("snext.metricsCollapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("snext.metricsCollapsed", collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  if (!metrics.length) return null;
  const current = open && metrics.find((m) => m.id === open.id);

  return (
    <section className="metrics" aria-label="Team metrics">
      <div className="section-head">
        <h2>Team metrics</h2>
        <button className="link muted" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          {collapsed ? "show" : "hide"}
        </button>
      </div>
      {!collapsed && (
        <div className="metric-row">
          {metrics.map((m) => (
            <MetricCard key={m.id} metric={m} flash={flash.has(m.id)} onOpen={() => setOpen(m)} />
          ))}
        </div>
      )}
      {current && <MetricDetail metric={current} onClose={() => setOpen(null)} />}
    </section>
  );
}

function MetricCard({ metric, flash, onOpen }: { metric: Metric; flash: boolean; onOpen: () => void }) {
  const { latest, mom, trend, trendGood, targetMet } = metric.summary;
  return (
    <button className={`card metric-card${flash ? " flash" : ""}`} onClick={onOpen} title={metric.description || metric.name}>
      <div className="metric-name">{metric.name}</div>
      <div className="metric-value">
        {latest ? formatValue(latest.value, metric.unit) : <span className="muted">no data</span>}
      </div>
      <div className="metric-indicators">
        {mom ? (
          <span className={`delta ${tone(mom.good)}`} title={`vs ${metric.summary.previousMonth!.date}`}>
            {mom.delta > 0 ? "▲" : mom.delta < 0 ? "▼" : "■"}{" "}
            {mom.pct == null ? formatValue(Math.abs(mom.delta), metric.unit) : `${nf.format(Math.abs(mom.pct * 100))}%`}
            <span className="muted"> MoM</span>
          </span>
        ) : (
          <span className="delta neutral muted">no prior month</span>
        )}
        {trend && (
          <span className={`trend ${tone(trendGood)}`} title="trend over the last 6 values">
            {trend === "up" ? "↗" : trend === "down" ? "↘" : "→"} {trend}
          </span>
        )}
      </div>
      <Sparkline points={metric.history} target={metric.target} good={tone(trendGood)} />
      {metric.target != null && (
        <div className={`metric-target ${targetMet == null ? "" : targetMet ? "good" : "bad"}`}>
          target {metric.direction === "down" ? "≤" : metric.direction === "up" ? "≥" : ""} {formatValue(metric.target, metric.unit)}
        </div>
      )}
    </button>
  );
}

export function Sparkline({
  points,
  target,
  good,
  width = 200,
  height = 40,
  showDots = false,
}: {
  points: MetricPoint[];
  target?: number;
  good: string;
  width?: number;
  height?: number;
  showDots?: boolean;
}) {
  if (points.length < 2) return <div className="spark-empty muted small">{points.length ? "1 value" : ""}</div>;
  const xs = points.map((p) => Date.parse(p.date));
  const ys = points.map((p) => p.value);
  const lo = Math.min(...ys, target ?? Infinity);
  const hi = Math.max(...ys, target ?? -Infinity);
  const pad = 4;
  const x = (t: number) => pad + ((t - xs[0]!) / (xs.at(-1)! - xs[0]! || 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - lo) / (hi - lo || 1)) * (height - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(xs[i]!).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points.at(-1)!;
  return (
    <svg className={`spark ${good}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`history of ${points.length} values`}>
      {target != null && <line className="spark-target" x1={pad} x2={width - pad} y1={y(target)} y2={y(target)} />}
      <path d={d} className="spark-line" vectorEffect="non-scaling-stroke" />
      {(showDots ? points : [last]).map((p) => (
        <circle key={p.date} cx={x(Date.parse(p.date))} cy={y(p.value)} r={showDots ? 3 : 2.5} className="spark-dot">
          <title>
            {p.date}: {p.value}
            {p.note ? ` (${p.note})` : ""}
          </title>
        </circle>
      ))}
    </svg>
  );
}

function MetricDetail({ metric, onClose }: { metric: Metric; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rows = [...metric.history].reverse();
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={metric.name}>
        <div className="modal-head">
          <span className="muted">metric · {metric.id}</span>
          <button className="icon" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <h2 className="metric-detail-title">{metric.name}</h2>
        {metric.description && <p className="desc">{metric.description}</p>}
        <Sparkline points={metric.history} target={metric.target} good={tone(metric.summary.trendGood)} width={600} height={140} showDots />
        <table className="history">
          <thead>
            <tr><th>Date</th><th>Value</th><th>Change</th><th>Note</th></tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const prev = rows[i + 1];
              const delta = prev ? p.value - prev.value : null;
              const good = delta == null || delta === 0 || metric.direction === "neutral" ? null : metric.direction === "up" ? delta > 0 : delta < 0;
              return (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{formatValue(p.value, metric.unit)}</td>
                  <td className={`delta ${tone(good)}`}>{delta == null ? "" : `${delta > 0 ? "+" : ""}${nf.format(delta)}`}</td>
                  <td className="muted">{p.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">Record values with <code>snext metric record {metric.id} VALUE [--date YYYY-MM-DD]</code></p>
      </div>
    </div>
  );
}
