"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  caption,
  humanize,
  IO,
  IO_GROUPS,
  isScheduledRestart,
  onIntervals,
  OTHER_BEHAVIORS,
  roomSeries,
  TANK_LABELS,
  TRAIN_FULL_LITERS,
  valueAt,
  valveRoutineSegments,
  type Behavior,
  type Dataset,
  type Point,
  type RoutineSide,
  type TankId,
} from "@/lib/model";

import { formatTime } from "./time";

const LABEL_W = 140;
const RIGHT_PAD = 56;
const CHART_H = 96;
const LANE_H = 18;
const LANE_GAP = 6;
const GROUP_GAP = 26;
const AXIS_H = 26;

const TICK_STEPS = [15, 30, 60, 120, 180, 360, 720, 1440, 2880].map(
  (m) => m * 60_000,
);

type Lane = {
  key: string;
  label: string;
  kind: string;
  /** No data before this time */
  noDataUntil?: number;
  segments: {
    start: number;
    end: number;
    text?: string;
    kind?: string;
    title: string;
  }[];
};

type Row =
  | {
      type: "chart";
      key: string;
      label: string;
      tanks: TankId[];
      kind: string;
      max: number;
      y: number;
      h: number;
    }
  | { type: "room"; key: string; y: number; h: number }
  | {
      type: "heading";
      key: string;
      label: string;
      count: number;
      collapsed: boolean;
      y: number;
    }
  | { type: "lane"; lane: Lane; y: number };

/** Points further apart than this are a gap in the data, not connected */
const MAX_GAP = 30 * 60_000;

function linePath(
  points: Point[],
  x: (t: number) => number,
  y: (v: number) => number,
  maxGap = MAX_GAP,
) {
  let d = "";
  let prev: Point | undefined;
  for (const p of points) {
    const gap = !prev || p.t - prev.t > maxGap;
    d += `${gap ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`;
    prev = p;
  }
  return d;
}

function areaPath(
  points: Point[],
  x: (t: number) => number,
  y: (v: number) => number,
  base: number,
  maxGap = MAX_GAP,
) {
  if (!points.length) return "";
  let d = "";
  let run: Point[] = [];
  const flush = () => {
    if (run.length > 1) {
      d += `M${x(run[0].t).toFixed(1)} ${base}`;
      for (const p of run) d += `L${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`;
      d += `L${x(run[run.length - 1].t).toFixed(1)} ${base}Z`;
    }
    run = [];
  };
  for (const p of points) {
    if (run.length && p.t - run[run.length - 1].t > maxGap) flush();
    run.push(p);
  }
  flush();
  return d;
}

const SIDE_LABEL: Record<RoutineSide, string> = {
  A: "Train A",
  B: "Train B",
  SYSTEM: "System",
};

function buildLanes(ds: Dataset) {
  const { from, until } = ds;
  const ioLane = (name: string, label: string, kind: string): Lane => ({
    key: name,
    label,
    kind,
    noDataUntil: ds.io[name]?.length
      ? Math.max(from, Math.min(until, ds.io[name][0].t))
      : until,
    segments: onIntervals(ds.io[name], from, until).map((i) => ({
      ...i,
      title: `${label}: ${formatTime(i.start, "datetime")} – ${i.open ? "now" : formatTime(i.end, "datetime")}`,
    })),
  });

  const behaviorSegments = (behaviors: Behavior[]) =>
    behaviors.map((b) => ({
      start: Math.max(b.start, from),
      end: b.end,
      text: b.label,
      kind: b.name.startsWith("full") ? "cleaning" : "other",
      title: `${b.label} (${b.name}): ${formatTime(b.start, "datetime")} – ${b.open ? "now" : formatTime(b.end, "datetime")}`,
    }));
  const behaviors = ds.behaviors ?? [];

  // One lane per side, as there are many kinds of behaviors
  const behaviorLanes: Lane[] = (["A", "B", "SYSTEM"] as RoutineSide[])
    .map((side) => ({
      key: `behavior-${side}`,
      label: SIDE_LABEL[side],
      kind: "behavior",
      segments: behaviorSegments(
        behaviors.filter(
          (b) => b.side === side && !OTHER_BEHAVIORS.has(b.name),
        ),
      ),
    }))
    .filter((lane) => lane.segments.length > 0);

  const routineLanes: Lane[] = (["A", "B", "SYSTEM"] as RoutineSide[])
    .map((side) => ({
      key: `routine-${side}`,
      label: SIDE_LABEL[side],
      kind: "routine",
      segments: valveRoutineSegments(ds)
        .filter((s) => s.side === side)
        .map((s) => {
          const text = humanize(s.name);
          const states = [...new Set(s.states.map((x) => humanize(x.state)))];
          return {
            start: s.start,
            end: s.end,
            text,
            // Not selected by the A/B valve, so the train takes no water
            kind: s.valve && s.phase === "idle" ? "inactive" : s.phase,
            title: `${SIDE_LABEL[side]}: ${text}${s.valve ? `, A/B valve set to ${s.valve}` : ""}, ${formatTime(s.start, "datetime")} – ${s.open ? "now" : formatTime(s.end, "datetime")}\n${states.join(", ")}`,
          };
        }),
    }))
    .filter(
      (lane) => lane.segments.length > 0 || lane.key !== "routine-SYSTEM",
    );

  const label = (name: string) => caption(ds.captions, name);
  const ioGroups = IO_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    lanes: group.names
      .filter((name) => name in ds.io)
      .map((name) => ioLane(name, label(name), ioKind(name))),
  }));
  const grouped = new Set(IO_GROUPS.flatMap((group) => group.names));
  const otherBehaviors = behaviors.filter((b) => OTHER_BEHAVIORS.has(b.name));
  const otherLanes: Lane[] = [
    ...Object.keys(ds.io)
      .filter((name) => !grouped.has(name))
      .sort()
      .map((name) => ioLane(name, label(name), "other")),
    ...(otherBehaviors.length > 0
      ? [
          {
            key: "behavior-other",
            label: "Behaviors",
            kind: "behavior",
            segments: behaviorSegments(otherBehaviors),
          },
        ]
      : []),
  ];

  return { routineLanes, behaviorLanes, ioGroups, otherLanes };
}

/** The color of a signal's lane, after the water or air it moves */
function ioKind(name: string) {
  const base = name.replace(/_b$/, "");
  if (base === IO.bypass || base === IO.abSelector) return "grey";
  if (base === "waste_clean_tank" || base === IO.wasteStorageTank) {
    return "waste";
  }
  if (
    base === IO.backupWater ||
    base === IO.preBackupWater ||
    base === IO.t4Min ||
    base === IO.t4Max
  ) {
    return "mains";
  }
  if (base === IO.uvPower) return "uv";
  if (/^(air_pump|add_air_valve|bubbles_block|release_air)$/.test(base)) {
    return "air";
  }
  return "clean";
}

export function Timeline({
  dataset,
  cursor,
  pinned,
  onCursor,
}: {
  dataset: Dataset;
  cursor: number | undefined;
  pinned: boolean;
  onCursor: (t: number | undefined, pin?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(["behaviors", "other"]),
  );
  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(360, entry.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { from, until } = dataset;
  const plotW = width - LABEL_W - RIGHT_PAD;
  const x = (t: number) => LABEL_W + ((t - from) / (until - from)) * plotW;
  const tAt = (px: number) => from + ((px - LABEL_W) / plotW) * (until - from);

  const steps = Math.max(100, Math.round(plotW / 2));
  // The room series is sampled at even steps, so a gap is a missing sample
  const roomGap = ((dataset.until - dataset.from) / steps) * 1.5;
  const { room, next } = useMemo(
    () => roomSeries(dataset, steps),
    [dataset, steps],
  );
  const bypass = useMemo(
    () => onIntervals(dataset.io[IO.bypass], dataset.from, dataset.until),
    [dataset],
  );
  const { routineLanes, behaviorLanes, ioGroups, otherLanes } = useMemo(
    () => buildLanes(dataset),
    [dataset],
  );

  // Vertical layout
  const rows: Row[] = [];
  let y = AXIS_H;
  const trainMax = Math.max(dataset.tankMax.t2a, dataset.tankMax.t2b, 1);
  rows.push({ type: "room", key: "room", y, h: CHART_H });
  y += CHART_H + 18;
  for (const [key, label, tanks, kind, max] of [
    ["train-a", "Train A", ["t2a"], "grey", trainMax],
    ["train-b", "Train B", ["t2b"], "grey", trainMax],
    ["t3", "T3 storage", ["t3"], "clean", Math.max(dataset.tankMax.t3, 1)],
  ] as const) {
    rows.push({
      type: "chart",
      key,
      label,
      tanks: [...tanks],
      kind,
      max,
      y,
      h: CHART_H,
    });
    y += CHART_H + 18;
  }
  y += GROUP_GAP - 18;
  const addGroup = (key: string, label: string, lanes: Lane[]) => {
    if (!lanes.length) return;
    const isCollapsed = collapsed.has(key);
    rows.push({
      type: "heading",
      key,
      label,
      count: lanes.length,
      collapsed: isCollapsed,
      y,
    });
    y += 18;
    for (const lane of isCollapsed ? [] : lanes) {
      rows.push({ type: "lane", lane, y });
      y += LANE_H + LANE_GAP;
    }
    y += GROUP_GAP - LANE_GAP;
  };
  addGroup("routines", "Routines", routineLanes);
  for (const group of ioGroups) addGroup(group.key, group.label, group.lanes);
  addGroup("behaviors", "Behaviors", behaviorLanes);
  addGroup("other", "Other", otherLanes);
  const height = y + AXIS_H - GROUP_GAP + 8;

  // Ticks
  const step =
    TICK_STEPS.find((s) => (until - from) / s <= Math.max(3, plotW / 110)) ??
    TICK_STEPS[TICK_STEPS.length - 1];
  const offset = new Date(from).getTimezoneOffset() * 60_000;
  const ticks: number[] = [];
  for (
    let t = Math.ceil((from - offset) / step) * step + offset;
    t <= until;
    t += step
  )
    ticks.push(t);
  const tickLabel = (t: number) => {
    const d = new Date(t);
    const midnight = d.getHours() === 0 && d.getMinutes() === 0;
    return step >= 24 * 3600_000 || midnight
      ? formatTime(t, "date")
      : formatTime(t, "time");
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (pinned) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    if (px < LABEL_W || px > LABEL_W + plotW) return;
    onCursor(tAt(px));
  };
  const onClick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    if (px < LABEL_W) return;
    if (pinned) onCursor(undefined, false);
    else onCursor(tAt(Math.min(px, LABEL_W + plotW)), true);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const delta = (until - from) / (e.shiftKey ? 10 : 100);
    const current = cursor ?? until;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.min(
        until,
        Math.max(from, current + (e.key === "ArrowLeft" ? -delta : delta)),
      );
      onCursor(next, true);
    } else if (e.key === "Escape") {
      onCursor(undefined, false);
    }
  };

  const cursorX = cursor !== undefined ? x(cursor) : undefined;

  return (
    <div className="timeline" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={pinned ? "timeline-svg is-pinned" : "timeline-svg"}
        tabIndex={0}
        role="group"
        aria-label="Timeline. Move the pointer to inspect a moment, click to pin it, arrow keys to step."
        onPointerMove={onMove}
        onPointerLeave={() => !pinned && onCursor(undefined)}
        onClick={onClick}
        onKeyDown={onKey}
      >
        <defs>
          <pattern
            id="timeline-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
          </pattern>
        </defs>
        {/* Axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={AXIS_H - 6}
              y2={height - AXIS_H + 4}
              className="grid-line"
            />
            <text
              x={x(t)}
              y={AXIS_H - 10}
              textAnchor="middle"
              className="axis-label"
            >
              {tickLabel(t)}
            </text>
            <text
              x={x(t)}
              y={height - 8}
              textAnchor="middle"
              className="axis-label"
            >
              {tickLabel(t)}
            </text>
          </g>
        ))}

        {rows.map((row) => {
          if (row.type === "heading") {
            return (
              <g
                key={row.key}
                className="group-heading"
                role="button"
                tabIndex={0}
                aria-expanded={!row.collapsed}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleGroup(row.key);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  e.stopPropagation();
                  toggleGroup(row.key);
                }}
              >
                <rect
                  x={0}
                  y={row.y - 2}
                  width={LABEL_W - 8}
                  height={18}
                  className="group-hit"
                />
                <path
                  d={
                    row.collapsed
                      ? `M3 ${row.y + 3} l4 4 l-4 4`
                      : `M1 ${row.y + 5} l4 4 l4 -4`
                  }
                  className="group-chevron"
                />
                <text x={14} y={row.y + 11} className="group-label">
                  {row.label}
                  {row.collapsed && (
                    <tspan className="group-count"> {row.count}</tspan>
                  )}
                </text>
              </g>
            );
          }
          if (row.type === "room") {
            const max = TRAIN_FULL_LITERS * 2;
            const yScale = (v: number) =>
              row.y + row.h - (Math.min(v, max) / max) * row.h;
            return (
              <g key={row.key} className="chart room-chart">
                <text x={0} y={row.y + 12} className="row-label is-strong">
                  Room for
                </text>
                <text x={0} y={row.y + 27} className="row-label is-strong">
                  greywater
                </text>
                <text x={0} y={row.y + 43} className="row-label">
                  liters, estimate
                </text>
                {bypass.map((i) => {
                  const restart = isScheduledRestart(dataset, i);
                  return (
                    <rect
                      key={i.start}
                      x={x(i.start)}
                      y={row.y}
                      width={Math.max(1.5, x(i.end) - x(i.start))}
                      height={row.h}
                      className={
                        restart ? "room-bypass is-restart" : "room-bypass"
                      }
                    >
                      <title>{`${restart ? "Scheduled restart, bypass open" : "Bypass open"}: ${formatTime(i.start, "datetime")} – ${i.open ? "now" : formatTime(i.end, "datetime")}`}</title>
                    </rect>
                  );
                })}
                <line
                  x1={LABEL_W}
                  x2={LABEL_W + plotW}
                  y1={row.y + row.h}
                  y2={row.y + row.h}
                  className="baseline"
                />
                <line
                  x1={LABEL_W}
                  x2={LABEL_W + plotW}
                  y1={row.y}
                  y2={row.y}
                  className="grid-line"
                />
                <text
                  x={LABEL_W - 6}
                  y={row.y + 4}
                  textAnchor="end"
                  className="axis-label"
                >
                  {max}
                </text>
                <text
                  x={LABEL_W - 6}
                  y={row.y + row.h}
                  textAnchor="end"
                  className="axis-label"
                >
                  0
                </text>
                <path
                  d={areaPath(room, x, yScale, row.y + row.h, roomGap)}
                  className="chart-area"
                />
                {(
                  [
                    [room, "Total", "Room for greywater, both trains"],
                    [next, "Next", "Greywater until filth removal"],
                  ] as const
                ).map(([points, label, title], i) => {
                  const last = points[points.length - 1];
                  const v =
                    cursor !== undefined ? valueAt(points, cursor) : undefined;
                  return (
                    <g
                      key={label}
                      className={
                        i === 0 ? "series is-primary" : "series is-secondary"
                      }
                    >
                      <title>{title}</title>
                      <path
                        d={linePath(points, x, yScale, roomGap)}
                        className="chart-line"
                      />
                      {last && (
                        <text
                          x={x(last.t) + 6}
                          y={yScale(last.v) + 4}
                          className="series-label"
                        >
                          {label}
                        </text>
                      )}
                      {v !== undefined && (
                        <g className="cursor-value">
                          <circle cx={x(cursor!)} cy={yScale(v)} r={3.5} />
                        </g>
                      )}
                    </g>
                  );
                })}
                {room.length === 0 && next.length === 0 && (
                  <text
                    x={LABEL_W + plotW / 2}
                    y={row.y + row.h / 2}
                    textAnchor="middle"
                    className="axis-label"
                  >
                    No venting with level data in this range
                  </text>
                )}
              </g>
            );
          }
          if (row.type === "chart") {
            const yScale = (v: number) => row.y + row.h - (v / row.max) * row.h;
            return (
              <g key={row.key} className={`chart kind-${row.kind}`}>
                <text x={0} y={row.y + 12} className="row-label is-strong">
                  {row.label}
                </text>
                <text x={0} y={row.y + 28} className="row-label">
                  liters
                </text>
                <line
                  x1={LABEL_W}
                  x2={LABEL_W + plotW}
                  y1={row.y + row.h}
                  y2={row.y + row.h}
                  className="baseline"
                />
                <line
                  x1={LABEL_W}
                  x2={LABEL_W + plotW}
                  y1={row.y}
                  y2={row.y}
                  className="grid-line"
                />
                <text
                  x={LABEL_W - 6}
                  y={row.y + 4}
                  textAnchor="end"
                  className="axis-label"
                >
                  {Math.round(row.max)}
                </text>
                <text
                  x={LABEL_W - 6}
                  y={row.y + row.h}
                  textAnchor="end"
                  className="axis-label"
                >
                  0
                </text>
                {row.tanks.length === 1 && (
                  <path
                    d={areaPath(
                      dataset.tanks[row.tanks[0]],
                      x,
                      yScale,
                      row.y + row.h,
                    )}
                    className="chart-area"
                  />
                )}
                {row.tanks.map((id, i) => {
                  const points = dataset.tanks[id];
                  const last = points[points.length - 1];
                  return (
                    <g
                      key={id}
                      className={
                        i === 0 ? "series is-primary" : "series is-secondary"
                      }
                    >
                      <path
                        d={linePath(points, x, yScale)}
                        className="chart-line"
                      />
                      {last && (
                        <text
                          x={x(last.t) + 6}
                          y={yScale(last.v) + 4}
                          className="series-label"
                        >
                          {TANK_LABELS[id].split(" ")[0]}
                        </text>
                      )}
                      {cursor !== undefined &&
                        (() => {
                          const v = valueAt(points, cursor);
                          if (v === undefined) return null;
                          return (
                            <g className="cursor-value">
                              <circle cx={x(cursor)} cy={yScale(v)} r={3.5} />
                            </g>
                          );
                        })()}
                    </g>
                  );
                })}
                {points(dataset, row.tanks).length === 0 && (
                  <text
                    x={LABEL_W + plotW / 2}
                    y={row.y + row.h / 2}
                    textAnchor="middle"
                    className="axis-label"
                  >
                    No level data
                  </text>
                )}
              </g>
            );
          }
          const { lane } = row;
          return (
            <g key={lane.key} className={`lane kind-${lane.kind}`}>
              <text x={0} y={row.y + 13} className="row-label">
                {lane.label}
              </text>
              <rect
                x={LABEL_W}
                y={row.y}
                width={plotW}
                height={LANE_H}
                className="lane-track"
              />
              {lane.noDataUntil !== undefined && lane.noDataUntil > from && (
                <rect
                  x={LABEL_W}
                  y={row.y}
                  width={x(lane.noDataUntil) - LABEL_W}
                  height={LANE_H}
                  className="lane-nodata"
                >
                  <title>No data</title>
                </rect>
              )}
              {lane.segments.map((s, i) => {
                const sx = x(s.start);
                const w = Math.max(1.5, x(s.end) - sx);
                return (
                  <g
                    key={i}
                    className={`segment${s.kind ? ` kind-${s.kind}` : ""}`}
                  >
                    <title>{s.title}</title>
                    <rect x={sx} y={row.y} width={w} height={LANE_H} rx={2} />
                    {s.text && w > s.text.length * 6.2 + 8 && (
                      <text x={sx + 4} y={row.y + 13} className="segment-label">
                        {s.text}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {cursorX !== undefined && (
          <g className="cursor" pointerEvents="none">
            <line
              x1={cursorX}
              x2={cursorX}
              y1={AXIS_H - 4}
              y2={height - AXIS_H + 4}
            />
            <rect
              x={Math.min(cursorX - 34, width - 70)}
              y={0}
              width={68}
              height={18}
              rx={4}
            />
            <text x={Math.min(cursorX, width - 36)} y={13} textAnchor="middle">
              {formatTime(cursor!, "time")}
            </text>
          </g>
        )}
      </svg>
      <div className="timeline-footer">
        <p className="muted">
          {pinned
            ? "Pinned. Click the timeline or press Escape to release."
            : "Click the timeline to pin a moment."}
        </p>
      </div>
    </div>
  );
}

function points(ds: Dataset, tanks: TankId[]) {
  return tanks.flatMap((id) => ds.tanks[id]);
}
