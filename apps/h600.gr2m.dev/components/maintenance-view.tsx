"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import {
  OUTAGE_GROUPS,
  outageTime,
  type Issue,
  type IssueLevel,
  type Maintenance,
  type OutageGroup,
  type OutageItem,
  type SignalEpisode,
  type VitalSeries,
} from "@/lib/maintenance";
import { formatDuration, type Point } from "@/lib/model";

import { SessionKeepAlive } from "./session-keep-alive";
import { SiteHeader } from "./site-header";
import { formatTime, Time } from "./time";

const DAY = 24 * 3600_000;

/** Like `formatDuration()`, with seconds for durations under a minute */
function duration(ms: number) {
  return ms < 60_000
    ? `${Math.max(1, Math.round(ms / 1000))} s`
    : formatDuration(ms);
}

/** The width of an element, for charts that draw text at its real size */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.floor(entry.contentRect.width))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function Section({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overview-section" aria-labelledby={`${id}-heading`}>
      <div className="overview-head">
        <h2 id={`${id}-heading`}>{title}</h2>
        {aside && <span className="muted overview-aside">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="tile">
      <dt>{label}</dt>
      <dd className="tile-value">{value}</dd>
      {children && <dd className="tile-detail">{children}</dd>}
    </div>
  );
}

// ── Health ─────────────────────────────────────────────────────────────────

const ISSUE_LABELS: Record<IssueLevel, string> = {
  blocking: "Blocking",
  major: "Major issue",
  minor: "Minor issue",
  attention: "Attention",
  notice: "Notice",
};

function months(ms: number) {
  const m = Math.round(ms / (30.44 * DAY));
  return m === 1 ? "1 month" : `${m} months`;
}

function HealthSection({ data }: { data: Maintenance }) {
  const { device, issues, signals, stuck, manual } = data;
  const now = data.fetchedAt;
  const recent = signals.filter((s) => s.active || s.last > now - 30 * DAY);
  return (
    <Section id="health" title="Health">
      <dl className="overview-grid">
        <Tile
          label="Reported by HDM"
          value={issues.length === 0 ? "No issues" : issues.length}
        >
          {issues.length === 0 ? (
            "HDM lists no blocking or major issues, minor issues or notices for the H600."
          ) : (
            <IssueList issues={issues} />
          )}
        </Tile>
        <Tile
          label="Alerts, last 30 days"
          value={recent.length === 0 ? "None" : recent.length}
        >
          {recent.length === 0
            ? "The H600 diagnosed no problems."
            : recent.map((s) => (
                <span
                  key={`${s.key}-${s.side}-${s.start}`}
                  className="tile-line"
                >
                  {s.active && <span className="tag is-active">Active</span>}{" "}
                  {s.title}
                  {s.count > 1 && ` (${s.count}×)`}, {s.end ? "fixed" : "last"}{" "}
                  <Time t={s.end ?? s.last} format="date" />
                </span>
              ))}
        </Tile>
        <Tile
          label="Next maintenance"
          value={
            device.nextMaintenance ? (
              <Time t={device.nextMaintenance.t} format="day" />
            ) : (
              "Unknown"
            )
          }
        >
          {device.maintenanceMonths &&
            `Every ${device.maintenanceMonths} months. `}
          {device.lastMaintenance ? (
            <>
              Last maintenance <Time t={device.lastMaintenance} format="day" />.
            </>
          ) : (
            "No maintenance recorded yet."
          )}
          {device.nextMaintenance?.estimated &&
            " Not scheduled, estimated from the maintenance period."}
        </Tile>
        <Tile
          label="Warranty"
          value={
            device.warrantyUntil === null
              ? "Unknown"
              : device.warrantyUntil > now
                ? months(device.warrantyUntil - now)
                : "Expired"
          }
        >
          {device.warrantyUntil !== null && (
            <>
              {device.warrantyUntil > now ? "Until" : "Ended"}{" "}
              <Time t={device.warrantyUntil} format="day" />
              {device.commissioned !== null && (
                <>
                  , commissioned <Time t={device.commissioned} format="day" />
                </>
              )}
              .
            </>
          )}
        </Tile>
      </dl>
      {(manual.length > 0 || stuck.length > 0) && (
        <div className="notice" role="status">
          {manual.length > 0 && (
            <p>
              Switched manually instead of by the firmware:{" "}
              {manual.map((m, i) => (
                <span key={m.name}>
                  {i > 0 && ", "}
                  {m.label} (last change <Time t={m.since} format="datetime" />)
                </span>
              ))}
              . A technician or a maintenance procedure may be working on the
              H600.
            </p>
          )}
          {stuck.length > 0 && (
            <p>
              HDM reports these outputs as stuck powered: {stuck.join(", ")}.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <>
      {issues.map((issue, i) => (
        <span key={i} className="tile-line">
          <span className={`tag is-issue is-${issue.level}`}>
            {ISSUE_LABELS[issue.level]}
          </span>{" "}
          {issue.text}
        </span>
      ))}
    </>
  );
}

// ── Alerts ─────────────────────────────────────────────────────────────────

function AlertsSection({ data }: { data: Maintenance }) {
  const { signals } = data;
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? signals : signals.slice(0, 12);
  return (
    <Section
      id="alerts"
      title="Alerts"
      aside={
        <>
          Since <Time t={data.signalsFrom} format="day" />
        </>
      }
    >
      <p className="section-lede maintenance-lede">
        Problems the H600&apos;s firmware diagnosed itself, from the first
        report until the H600 reported it fixed. Reports of the same problem
        less than a day apart are one row. Many problems, such as a soap bomb,
        are never reported fixed. They are active while HDM lists them as an
        issue of the H600.
      </p>
      {signals.length === 0 ? (
        <p className="empty">No alerts in the last 12 months.</p>
      ) : (
        <div className="maintenance-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Alert</th>
                <th scope="col">Started</th>
                <th scope="col">Fixed</th>
                <th scope="col" className="numeric">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <SignalRow
                  key={`${s.key}-${s.side}-${s.start}`}
                  signal={s}
                  now={data.fetchedAt}
                />
              ))}
            </tbody>
          </table>
          {signals.length > visible.length && (
            <button
              type="button"
              className="button is-quiet"
              onClick={() => setExpanded(true)}
            >
              Show all {signals.length} alerts
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function SignalRow({ signal, now }: { signal: SignalEpisode; now: number }) {
  return (
    <tr>
      <td>
        <span className="cell-title">
          {signal.title}
          {signal.count > 1 && (
            <span className="muted"> · {signal.count} times</span>
          )}
        </span>
        {signal.description && (
          <span className="cell-detail">{signal.description}</span>
        )}
      </td>
      <td className="nowrap">
        <Time t={signal.start} format="dayTime" />
      </td>
      <td className="nowrap">
        {signal.end !== null ? (
          <Time t={signal.end} format="dayTime" />
        ) : signal.active ? (
          <span className="tag is-active">Active</span>
        ) : (
          <span className="muted">Not reported</span>
        )}
      </td>
      <td className="numeric nowrap">
        {signal.end !== null
          ? duration(signal.end - signal.start)
          : signal.active
            ? duration(now - signal.start)
            : "–"}
      </td>
    </tr>
  );
}

// ── Connectivity ───────────────────────────────────────────────────────────

const GROUP_ORDER: OutageGroup[] = [
  "server",
  "network",
  "power",
  "device",
  "scheduled",
];

function ConnectivitySection({ data }: { data: Maintenance }) {
  const { connectivity } = data;
  if (!connectivity) {
    return (
      <Section id="connectivity" title="Connectivity">
        <p className="empty">The outages could not be loaded.</p>
      </Section>
    );
  }
  const { from, until, outages, restarts } = connectivity;
  const unplanned = outages.filter((o) => o.group !== "scheduled");
  const offline = outageTime(unplanned);
  const scheduled = outages.length - unplanned.length;

  const causes = new Map<
    string,
    { outage: OutageItem; count: number; time: number }
  >();
  for (const o of outages) {
    const entry = causes.get(o.cause) ?? { outage: o, count: 0, time: 0 };
    entry.count++;
    entry.time += o.end - o.start;
    causes.set(o.cause, entry);
  }
  const reasons = new Map<string, number>();
  for (const r of restarts)
    reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);

  return (
    <Section id="connectivity" title="Connectivity" aside="Last 30 days">
      <dl className="overview-grid is-three">
        <Tile
          label="Online"
          value={`${(Math.floor((1 - offline / (until - from)) * 1000) / 10).toLocaleString()} %`}
        >
          Not counting the scheduled restarts.
        </Tile>
        <Tile
          label="Offline"
          value={offline === 0 ? "Never" : formatDuration(offline)}
        >
          {unplanned.length === 0
            ? "The H600 was only offline for its scheduled restarts."
            : `${unplanned.length} times, besides ${scheduled} scheduled restarts. ${
                unplanned.some((o) => o.group === "server")
                  ? `${formatDuration(outageTime(unplanned.filter((o) => o.group === "server")))} of it on HDM's side.`
                  : ""
              }`}
        </Tile>
        <Tile label="Restarts" value={restarts.length}>
          {[...reasons]
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => `${reason} ${count}×`)
            .join(", ") || "None."}
        </Tile>
      </dl>
      <OutageChart
        from={from}
        until={until}
        outages={outages}
        restarts={restarts.map((r) => r.t)}
      />
      <div className="maintenance-table">
        <table>
          <caption>Causes</caption>
          <thead>
            <tr>
              <th scope="col">Cause</th>
              <th scope="col">Side</th>
              <th scope="col" className="numeric">
                Times
              </th>
              <th scope="col" className="numeric">
                Offline
              </th>
            </tr>
          </thead>
          <tbody>
            {[...causes.values()]
              .sort((a, b) => b.time - a.time)
              .map(({ outage, count, time }) => (
                <tr key={outage.cause}>
                  <td>
                    <span className="cell-title">{outage.title}</span>
                    {outage.description && (
                      <span className="cell-detail">{outage.description}</span>
                    )}
                  </td>
                  <td className="nowrap">{OUTAGE_GROUPS[outage.group]}</td>
                  <td className="numeric">{count}</td>
                  <td className="numeric nowrap">{duration(time)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {unplanned.length > 0 && (
        <details className="disclosure">
          <summary>
            All {unplanned.length} outages besides the scheduled restarts
          </summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col" className="numeric">
                  Duration
                </th>
                <th scope="col">Cause</th>
              </tr>
            </thead>
            <tbody>
              {[...unplanned].reverse().map((o) => (
                <tr key={o.start}>
                  <td className="nowrap">
                    <Time t={o.start} format="datetime" />
                  </td>
                  <td className="numeric nowrap">
                    {duration(o.end - o.start)}
                  </td>
                  <td>{o.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Section>
  );
}

const CHART_LABEL_W = 120;
const CHART_LANE_H = 18;
const CHART_LANE_GAP = 8;

/** Day ticks at local midnight, at least `minGap` pixels apart */
function dayTicks(from: number, until: number, plotW: number, minGap: number) {
  const days = Math.max(1, Math.ceil((until - from) / DAY));
  const every = [1, 2, 7, 14].find((n) => (plotW / days) * n >= minGap) ?? 14;
  const ticks: number[] = [];
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  for (let i = 0; d.getTime() <= until; i++) {
    if (i % every === 0) ticks.push(d.getTime());
    d.setDate(d.getDate() + 1);
  }
  return ticks;
}

function OutageChart({
  from,
  until,
  outages,
  restarts,
}: {
  from: number;
  until: number;
  outages: OutageItem[];
  restarts: number[];
}) {
  const { ref, width } = useWidth(900);
  const groups = GROUP_ORDER.filter((g) => outages.some((o) => o.group === g));
  const lanes = [
    ...groups.map((g) => ({ key: g, label: OUTAGE_GROUPS[g] })),
    { key: "restarts", label: "Restarts" },
  ];
  const plotW = width - CHART_LABEL_W - 8;
  const x = (t: number) =>
    CHART_LABEL_W + ((t - from) / (until - from)) * plotW;
  const top = 8;
  const height = top + lanes.length * (CHART_LANE_H + CHART_LANE_GAP) + 22;
  // Leave out the labels that would be cut off at the right
  const ticks = dayTicks(from, until, plotW, 72).filter(
    (t) => x(t) + 36 <= width,
  );
  const laneY = (i: number) => top + i * (CHART_LANE_H + CHART_LANE_GAP);

  return (
    <figure className="maintenance-chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Outages and restarts from ${formatTime(from, "date")} to ${formatTime(until, "date")}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={top - 4}
              y2={height - 18}
              className="grid-line"
            />
            <text
              x={x(t)}
              y={height - 4}
              textAnchor="middle"
              className="axis-label"
            >
              {formatTime(t, "date")}
            </text>
          </g>
        ))}
        {lanes.map((lane, i) => (
          <g key={lane.key}>
            <text x={0} y={laneY(i) + 13} className="row-label">
              {lane.label}
            </text>
            <rect
              x={CHART_LABEL_W}
              y={laneY(i)}
              width={plotW}
              height={CHART_LANE_H}
              className="lane-track"
            />
          </g>
        ))}
        {outages.map((o) => {
          const i = groups.indexOf(o.group);
          const ox = x(Math.max(from, o.start));
          return (
            <rect
              key={`${o.start}-${o.cause}`}
              x={ox}
              y={laneY(i)}
              width={Math.max(2, x(Math.min(until, o.end)) - ox)}
              height={CHART_LANE_H}
              className={`outage is-${o.group}`}
            >
              <title>{`${o.title}: ${formatTime(o.start, "datetime")}, ${duration(o.end - o.start)}`}</title>
            </rect>
          );
        })}
        {restarts.map((t) => (
          <line
            key={t}
            x1={x(t)}
            x2={x(t)}
            y1={laneY(lanes.length - 1) + 3}
            y2={laneY(lanes.length - 1) + CHART_LANE_H - 3}
            className="restart-tick"
          >
            <title>{`Restart ${formatTime(t, "datetime")}`}</title>
          </line>
        ))}
      </svg>
      <figcaption className="muted">
        Each bar is a time the H600 was offline, by where the cause was. Hover a
        bar for details.
      </figcaption>
    </figure>
  );
}

// ── Vitals ─────────────────────────────────────────────────────────────────

function VitalsSection({ data }: { data: Maintenance }) {
  const { vitals } = data;
  return (
    <Section id="vitals" title="Device vitals" aside="Last 30 days">
      {!vitals || vitals.series.length === 0 ? (
        <p className="empty">The vitals could not be loaded.</p>
      ) : (
        <div className="vitals-grid">
          {vitals.series.map((series) => (
            <Vital
              key={series.key}
              series={series}
              from={vitals.from}
              until={vitals.until}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function Vital({
  series,
  from,
  until,
}: {
  series: VitalSeries;
  from: number;
  until: number;
}) {
  const { ref, width } = useWidth(320);
  const { points, unit, digits, low } = series;
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const last = points[points.length - 1];
  const format = (v: number) =>
    `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
  const lows = low ? points.filter((p) => p.v < low.below) : [];
  // Consecutive low samples are one episode
  const lowEpisodes = lows.filter(
    (p, i) => i === 0 || points.indexOf(p) - points.indexOf(lows[i - 1]) > 1,
  ).length;

  const height = 64;
  const pad = 4;
  const span = max - min || 1;
  const x = (t: number) => ((t - from) / (until - from)) * width;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  // Points further apart than 3 samples are a gap in the data
  const step = points.length > 1 ? (until - from) / points.length : DAY;
  const path = sparkPath(points, x, y, step * 3);

  return (
    <div className="vital">
      <div className="vital-head">
        <span className="vital-label">{series.label}</span>
        <span className="vital-value">{last ? format(last.v) : "–"}</span>
      </div>
      <div ref={ref}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="vital-chart"
          role="img"
          aria-label={`${series.label} from ${format(min)} to ${format(max)}`}
        >
          {lows.map((p) => (
            <line
              key={p.t}
              x1={x(p.t)}
              x2={x(p.t)}
              y1={0}
              y2={height}
              className="vital-low"
            >
              <title>{`${low!.label}: ${formatTime(p.t, "datetime")}, ${format(p.v)}`}</title>
            </line>
          ))}
          <path d={path} className="vital-line" />
        </svg>
      </div>
      <p className="vital-range muted">
        {format(min)} – {format(max)}
        {lows.length > 0 && (
          <span className="vital-low-text">
            {" "}
            · {low!.label} {lowEpisodes === 1 ? "once" : `${lowEpisodes} times`}
          </span>
        )}
      </p>
      {series.note && <p className="vital-note muted">{series.note}</p>}
    </div>
  );
}

function sparkPath(
  points: Point[],
  x: (t: number) => number,
  y: (v: number) => number,
  maxGap: number,
) {
  let d = "";
  let prev: Point | undefined;
  for (const p of points) {
    d += `${!prev || p.t - prev.t > maxGap ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`;
    prev = p;
  }
  return d;
}

// ── Service ────────────────────────────────────────────────────────────────

function ServiceSection({ data }: { data: Maintenance }) {
  const { device, tickets, serviceLog, professionals } = data;
  const open = tickets.filter((t) => !t.closed).length;
  const [expanded, setExpanded] = useState(false);
  const entries = expanded ? serviceLog : serviceLog.slice(0, 12);
  return (
    <Section id="service" title="Service">
      <dl className="service-facts">
        <dt>Commissioned</dt>
        <dd>
          {device.commissioned ? (
            <Time t={device.commissioned} format="day" />
          ) : (
            "–"
          )}
        </dd>
        <dt>Warranty until</dt>
        <dd>
          {device.warrantyUntil ? (
            <Time t={device.warrantyUntil} format="day" />
          ) : (
            "–"
          )}
        </dd>
        <dt>Maintenance</dt>
        <dd>
          {device.maintenanceMonths
            ? `Every ${device.maintenanceMonths} months`
            : "–"}
          {device.lastMaintenance && (
            <>
              , last <Time t={device.lastMaintenance} format="day" />
            </>
          )}
        </dd>
        <dt>Firmware</dt>
        <dd>
          {[
            device.firmware,
            device.firmwareCore && `core ${device.firmwareCore}`,
            device.hardware && `hardware ${device.hardware}`,
          ]
            .filter(Boolean)
            .join(" · ") || "–"}
        </dd>
        <dt>Time zone</dt>
        <dd>{device.timeZone ?? "–"}</dd>
        {professionals.map((p, i) => (
          <Fragment key={i}>
            <dt>{p.role}</dt>
            <dd>
              {p.organisation ?? "–"}
              {p.note && <span className="muted"> · {p.note}</span>}
            </dd>
          </Fragment>
        ))}
      </dl>

      <div className="maintenance-table">
        <table>
          <caption>
            Tickets{" "}
            <span className="muted">
              {tickets.length === 0
                ? "· none"
                : `· ${open === 0 ? "none" : open} open, ${tickets.length - open} closed`}
            </span>
          </caption>
          {tickets.length > 0 && (
            <thead>
              <tr>
                <th scope="col">Opened</th>
                <th scope="col">Ticket</th>
                <th scope="col">Status</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
          )}
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td className="nowrap">
                  <Time t={t.created} format="day" />
                </td>
                <td>
                  <span className="cell-title">{t.title}</span>
                  <span className="cell-detail">
                    {[
                      t.subject,
                      t.priority && `${t.priority} priority`,
                      t.automatic && "Opened by HDM",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {t.note && <span className="cell-detail">“{t.note}”</span>}
                </td>
                <td className="nowrap">
                  <span className={t.closed ? "tag" : "tag is-active"}>
                    {t.status}
                  </span>
                  {t.closedAt && (
                    <span className="cell-detail">
                      <Time t={t.closedAt} format="day" />
                    </span>
                  )}
                </td>
                <td>
                  {t.cause && <span className="cell-title">{t.cause}</span>}
                  {t.solution && (
                    <span className="cell-detail">{t.solution}</span>
                  )}
                  {!t.cause && !t.solution && <span className="muted">–</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="maintenance-table">
        <table>
          <caption>
            Service log{" "}
            <span className="muted">· {serviceLog.length} entries</span>
          </caption>
          {serviceLog.length > 0 && (
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Entry</th>
                <th scope="col">By</th>
              </tr>
            </thead>
          )}
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">
                  <Time t={e.t} format="dayTime" />
                </td>
                <td>
                  <span className="cell-title">{e.title || e.type}</span>
                  <span className="cell-detail">
                    {e.type}
                    {e.text && ` · ${e.text}`}
                  </span>
                </td>
                <td>{e.person ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {serviceLog.length > entries.length && (
          <button
            type="button"
            className="button is-quiet"
            onClick={() => setExpanded(true)}
          >
            Show all {serviceLog.length} entries
          </button>
        )}
      </div>
    </Section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function MaintenanceView({ data }: { data: Maintenance }) {
  const { device } = data;
  return (
    <>
      <SiteHeader device={device} demo={data.demo} />
      <SessionKeepAlive />
      <main id="main" className="page">
        <div className="page-title">
          <h1>Maintenance and health</h1>
          <p className="page-status">
            {device.online === false ? (
              <span className="status-dot is-offline">Offline</span>
            ) : (
              <span className="status-dot is-online">Online</span>
            )}
            {device.online === false && device.lastOnline && (
              <span>
                Last online <Time t={device.lastOnline} format="datetime" />
              </span>
            )}
            <span className="muted">
              Loaded <Time t={data.fetchedAt} format="seconds" />
            </span>
          </p>
        </div>
        {data.warnings.length > 0 && (
          <div className="notice" role="status">
            {data.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}
        <HealthSection data={data} />
        <AlertsSection data={data} />
        <ConnectivitySection data={data} />
        <VitalsSection data={data} />
        <ServiceSection data={data} />
      </main>
    </>
  );
}
