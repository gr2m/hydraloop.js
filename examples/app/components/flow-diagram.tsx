// Schematic of the H600: inlet, two treatment trains, UV, storage, backup
// and outlets. Pipes are colored and animated only while a routine, valve,
// pump or sensor signal shows water moving through them. Pipes that their
// valves leave open, but without water moving, are drawn with more contrast.

import {
  capacityNote,
  caption,
  IO,
  sideIo,
  type DeviceInfo,
  type DeviceState,
  type IoValue,
  type Side,
  type TankLevel,
} from "@/lib/model";

type Kind = "grey" | "clean" | "mains" | "waste" | "air";

function formatTime(t: number | undefined) {
  if (t === undefined) return "";
  return new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Pipe({
  d,
  kind,
  active,
  open = false,
  square = false,
  arrow,
  title,
}: {
  d: string;
  kind: Kind;
  active: boolean | undefined;
  /** The valves on this pipe are open, so water can move through it */
  open?: boolean;
  /** Square ends, for pipes that end at a distributor */
  square?: boolean;
  /** Draw an outlet arrow at this point, pointing in this direction */
  arrow?: { x: number; y: number; dir: "down" | "right" | "left" };
  /** Tooltip, for pipes without a valve or pump */
  title?: string;
}) {
  const state =
    active === undefined
      ? "unknown"
      : active
        ? "active"
        : open
          ? "open"
          : "idle";
  return (
    <g className={`pipe kind-${kind} is-${state}${square ? " is-square" : ""}`}>
      {title && <title>{title}</title>}
      <path d={d} className="pipe-base" />
      {state === "active" && <path d={d} className="pipe-flow" />}
      {arrow && (
        <path
          className="pipe-arrow"
          d={
            arrow.dir === "down"
              ? `M${arrow.x - 7} ${arrow.y} L${arrow.x + 7} ${arrow.y} L${arrow.x} ${arrow.y + 9} Z`
              : arrow.dir === "right"
                ? `M${arrow.x} ${arrow.y - 7} L${arrow.x} ${arrow.y + 7} L${arrow.x + 9} ${arrow.y} Z`
                : `M${arrow.x} ${arrow.y - 7} L${arrow.x} ${arrow.y + 7} L${arrow.x - 9} ${arrow.y} Z`
          }
        />
      )}
    </g>
  );
}

function ioTitle(
  label: string,
  name: string,
  io: IoValue | undefined,
  words: [string, string],
) {
  if (!io) return `${label}: no data (${name})`;
  const since = io.since ? ` since ${formatTime(io.since)}` : "";
  return `${label}: ${io.on ? words[0] : words[1]}${since} (${name} = ${io.value})`;
}

/** An on/off valve. Parallel to the pipe while open, across it while closed */
function Valve({
  x,
  y,
  vertical = false,
  kind,
  io,
  active = false,
  name,
  label,
  labelAnchor = "start",
  labelDx = 16,
  labelDy = 4,
}: {
  x: number;
  y: number;
  vertical?: boolean;
  kind: Kind;
  io: IoValue | undefined;
  /** Water is moving through the valve */
  active?: boolean;
  name: string;
  label: string;
  labelAnchor?: "start" | "middle" | "end";
  labelDx?: number;
  labelDy?: number;
}) {
  const state = io === undefined ? "unknown" : io.on ? "open" : "closed";
  const s = 10;
  // Unknown valves are drawn half-way, neither open nor closed
  const angle =
    (vertical ? 90 : 0) + (state === "open" ? 0 : state === "closed" ? 90 : 45);
  const title = ioTitle(label || caption({}, name), name, io, [
    "open",
    "closed",
  ]);
  return (
    <g
      className={`valve kind-${kind} is-${state}${state === "open" && active ? " is-flowing" : ""}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title suppressHydrationWarning>{title}</title>
      <rect x={x - 14} y={y - 14} width={28} height={28} className="hit" />
      <g
        className="valve-body"
        style={{
          transform: `rotate(${angle}deg)`,
          transformOrigin: `${x}px ${y}px`,
        }}
      >
        <polygon points={`${x - s},${y - 8} ${x - s},${y + 8} ${x},${y}`} />
        <polygon points={`${x + s},${y - 8} ${x + s},${y + 8} ${x},${y}`} />
      </g>
      {label && (
        <text
          x={x + labelDx}
          y={y + labelDy}
          textAnchor={labelAnchor}
          className="diagram-label"
        >
          {label}
        </text>
      )}
    </g>
  );
}

type Outlet = {
  /** undefined while the valve state is unknown */
  open: boolean | undefined;
  /** Water is moving through this outlet */
  active: boolean;
};

/** Half the width of a pipe */
const PIPE = 3.5;
/** Height of a distributor triangle, from its tip to its base */
const DISTRIBUTOR = 24;
/** Stroke width of a distributor's outline, as in .distributor polygon */
const OUTLINE = 1.5;
/** Stroke width of a closed side's outline, as in its .is-closed polygon */
const CLOSED_OUTLINE = 3;

/**
 * Moves each edge of a convex polygon inwards by d, so a stroke of width 2d
 * stays inside the original shape
 */
function inset(points: [number, number][], d: number): [number, number][] {
  const n = points.length;
  const area = points.reduce((sum, [x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % n];
    return sum + x1 * y2 - x2 * y1;
  }, 0);
  const sign = area > 0 ? 1 : -1;
  // Each edge as a point on its moved line and its direction
  const edges = points.map(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % n];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const [dx, dy] = [(x2 - x1) / len, (y2 - y1) / len];
    return { x: x1 - sign * dy * d, y: y1 + sign * dx * d, dx, dy };
  });
  return edges.map((b, i) => {
    const a = edges[(i + n - 1) % n];
    const t =
      ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / (a.dx * b.dy - a.dy * b.dx);
    return [a.x + t * a.dx, a.y + t * a.dy];
  });
}

/**
 * Where the pipes of a distributor at (x, y) end: the pipes cross at (x, y)
 * and end where the triangle is as wide as a pipe
 */
function distributorEnds(x: number, y: number, inlet: "up" | "left") {
  const d = DISTRIBUTOR - 2 * PIPE;
  return inlet === "up"
    ? { inlet: y - d, outlets: [x - d, x + d] }
    : { inlet: x - d, outlets: [y + d, y - d] };
}

/**
 * A valve with one inlet and two outlets, drawn as a triangle with its tip
 * at the inlet and its other tips at the outlets. Its pipes cross at (x, y),
 * the inlet comes from above or from the left. The water flows through the
 * part of the triangle between the outer borders of the inlet pipe and the
 * open outlet's pipe, so it lines up with both. The rest is an outline.
 */
function Distributor({
  x,
  y,
  inlet = "up",
  kind,
  io,
  name,
  label,
  words,
  outlets,
  labelAnchor = "middle",
  labelDx = 0,
  labelDy = 4,
}: {
  x: number;
  y: number;
  inlet?: "up" | "left";
  kind: Kind;
  io: IoValue | undefined;
  name: string;
  label: string;
  /** What the valve does while on and off */
  words: [string, string];
  /** Left and right, or top and bottom with the inlet on the left */
  outlets: [Outlet, Outlet];
  labelAnchor?: "start" | "middle" | "end";
  labelDx?: number;
  labelDy?: number;
}) {
  const p = PIPE;
  const w = DISTRIBUTOR;
  // Drawn with the inlet above, then turned for an inlet on the left
  const up = inlet === "up";
  const at = ([dx, dy]: [number, number]) =>
    up ? `${x + dx},${y + dy}` : `${x + dy},${y - dx}`;
  const shape = (points: [number, number][]) => points.map(at).join(" ");
  // Outlined parts, with the outline inside so it lines up with the pipes
  const outline = (points: [number, number][], width = OUTLINE) =>
    shape(inset(points, width / 2));
  // With the inlet on the left, the left outlet turns to the bottom
  const [left, right] = up ? outlets : [outlets[1], outlets[0]];
  const state = (outlet: Outlet) =>
    outlet.open === undefined
      ? "unknown"
      : !outlet.open
        ? "closed"
        : outlet.active
          ? "flowing"
          : "open";
  const open = left.open ? -1 : right.open ? 1 : 0;
  const title = ioTitle(label, name, io, words);
  return (
    <g
      className={`distributor kind-${kind}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title suppressHydrationWarning>{title}</title>
      <rect
        x={up ? x - w - 4 : x + p - w - 4}
        y={up ? y + p - w - 4 : y - w - 4}
        width={up ? 2 * w + 8 : w + 8}
        height={up ? w + 8 : 2 * w + 8}
        className="hit"
      />
      <g className="valve-body">
        {open === 0 || left.open === undefined ? (
          <polygon
            points={outline(
              [
                [0, p - w],
                [-w, p],
                [w, p],
              ],
              state(left) === "closed" ? CLOSED_OUTLINE : OUTLINE,
            )}
            className={`is-${state(left)}`}
          />
        ) : (
          <>
            {/* The open side, from the far border of the inlet pipe */}
            <polygon
              points={shape([
                [open * w, p],
                [0, p - w],
                [-open * p, 2 * p - w],
                [-open * p, p],
              ])}
              className={`is-${state(open < 0 ? left : right)}`}
            />
            {/* What is left on the closed side */}
            <polygon
              points={outline(
                [
                  [-open * p, 2 * p - w],
                  [-open * w, p],
                  [-open * p, p],
                ],
                CLOSED_OUTLINE,
              )}
              className="is-closed"
            />
          </>
        )}
      </g>
      <text
        x={x + labelDx}
        y={y + labelDy}
        textAnchor={labelAnchor}
        className="diagram-label"
      >
        {label}
      </text>
    </g>
  );
}

/** Curved impeller blades around (0, 0), from the hub out to radius r */
function impellerPath(r: number) {
  const hub = r * 0.3;
  const point = (a: number, d: number) =>
    `${(d * Math.cos(a)).toFixed(2)} ${(d * Math.sin(a)).toFixed(2)}`;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3;
    return `M${point(a, hub)} Q${point(a + 0.2, r * 0.7)} ${point(a + 0.75, r)}`;
  }).join(" ");
}

/** A pump: an impeller in its casing, spinning while the pump runs */
function Pump({
  x,
  y,
  r = 15,
  kind,
  io,
  name,
  label,
  labelAnchor = "start",
  labelDx = 22,
  labelDy = 4,
}: {
  x: number;
  y: number;
  r?: number;
  kind: Kind;
  io: IoValue | undefined;
  name: string;
  label: string;
  labelAnchor?: "start" | "end";
  labelDx?: number;
  labelDy?: number;
}) {
  const state = io === undefined ? "unknown" : io.on ? "on" : "off";
  const blades = r * 0.72;
  const title = ioTitle(label, name, io, ["running", "off"]);
  return (
    <g
      className={`pump kind-${kind} is-${state}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title suppressHydrationWarning>{title}</title>
      <circle cx={x} cy={y} r={r} className="pump-casing" />
      <g transform={`translate(${x} ${y})`}>
        <g className="impeller">
          {/* Centers the box the impeller spins around */}
          <circle r={blades + 1} className="impeller-box" />
          <path d={impellerPath(blades)} className="impeller-blades" />
          <circle r={r * 0.22} className="impeller-hub" />
        </g>
      </g>
      <text
        x={x + (labelAnchor === "end" ? -labelDx : labelDx)}
        y={y + labelDy}
        textAnchor={labelAnchor}
        className="diagram-label"
      >
        {label}
      </text>
    </g>
  );
}

/** A demand or float sensor */
function Sensor({
  x,
  y,
  kind,
  io,
  name,
  label,
  labelAnchor = "start",
  labelDx = 12,
}: {
  x: number;
  y: number;
  kind: Kind;
  io: IoValue | undefined;
  name: string;
  label: string;
  labelAnchor?: "start" | "end" | "middle";
  labelDx?: number;
}) {
  const state = io === undefined ? "unknown" : io.on ? "on" : "off";
  const title = ioTitle(label, name, io, ["on", "off"]);
  return (
    <g
      className={`sensor kind-${kind} is-${state}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title suppressHydrationWarning>{title}</title>
      <circle cx={x} cy={y} r={6} />
      <text
        x={x + labelDx}
        y={y + 4}
        textAnchor={labelAnchor}
        className="diagram-label"
      >
        {label}
      </text>
    </g>
  );
}

function Bubbles({
  x,
  y,
  w,
  h,
  active,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean | undefined;
}) {
  if (!active) return null;
  const columns = 5;
  return (
    <g className="bubbles" aria-hidden>
      {Array.from({ length: columns * 2 }, (_, i) => {
        const cx = x + ((i % columns) + 0.5) * (w / columns);
        const delay = (i * 0.37) % 1.6;
        return (
          <circle
            key={i}
            cx={cx}
            cy={y + h - 8}
            r={i % 3 === 0 ? 2.5 : 1.8}
            style={{
              animationDelay: `${delay}s`,
              ["--rise" as string]: `${-(h - 24)}px`,
            }}
          />
        );
      })}
    </g>
  );
}

function Tank({
  x,
  y,
  w,
  h,
  level,
  kind,
  label,
  sub,
  side,
  aeration,
  pressurized,
  small,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  level: TankLevel | undefined;
  kind: Kind;
  label: string;
  sub?: string;
  /** The train, named in the tooltip only */
  side?: Side;
  aeration?: boolean;
  /**
   * Air is pumped into the space above the water, pressing on its surface:
   * the length of the air pipe that ends at the top of the tank
   */
  pressurized?: number | false;
  /**
   * A tank too narrow for its text: the label and the level in percent go
   * next to it, before (`start`) or after (`end`) it
   */
  small?: "start" | "end";
}) {
  const known = level?.liters !== undefined && level.max > 0;
  // The shell stands for the tank's capacity, which can be more than the
  // sensor's range
  const size = level?.capacity ?? level?.max ?? 0;
  const fill = known ? Math.max(0, Math.min(1, level!.liters! / size)) : 0;
  const percent = `${Math.round(fill * 100)}%`;
  const trend = level?.trend;
  const arrow =
    trend === undefined || Math.abs(trend) < 0.3 ? "" : trend > 0 ? "↑" : "↓";
  const fillHeight = h * fill;
  const name = [label, side ?? sub].filter(Boolean).join(" ");
  const title = !known
    ? `${name}: no level data`
    : small
      ? `${name}: ${percent} full. ${capacityNote(level!)}`.trimEnd()
      : `${name}: ${Math.round(level!.liters!)} L (${percent})${
          trend !== undefined
            ? `, ${trend >= 0 ? "+" : ""}${trend.toFixed(1)} L/min`
            : ""
        }. ${capacityNote(level!)}`.trimEnd();
  const clipId = `pressure-${label}-${side ?? sub ?? ""}`;
  // Enough rings to reach the far corners of the space above the water
  const rings = Math.ceil(Math.hypot(w / 2, h - fillHeight) / 14) + 1;
  const phase = pressurized
    ? (-((14 - (pressurized % 14)) % 14) / 14) * 0.9
    : 0;
  const textX = small === "end" ? x + w + 10 : small ? x - 10 : x + 12;
  const anchor = small === "start" ? "end" : "start";
  return (
    <g
      className={`tank kind-${kind}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={small ? 5 : 8}
        className={known ? "tank-shell" : "tank-shell is-unknown"}
      />
      {known && (
        <>
          <rect
            x={x + 1}
            y={y + h - fillHeight}
            width={w - 2}
            height={Math.max(0, fillHeight - 1)}
            rx={fillHeight > 8 ? (small ? 4 : 7) : 0}
            className="tank-fill"
          />
          <line
            x1={x + 1}
            x2={x + w - 1}
            y1={y + h - fillHeight}
            y2={y + h - fillHeight}
            className="tank-surface"
          />
        </>
      )}
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={x + w - (small ? 5 : 8)}
          x2={x + w}
          y1={y + h - h * f}
          y2={y + h - h * f}
          className="tank-tick"
        />
      ))}
      <Bubbles x={x} y={y} w={w} h={h} active={aeration} />
      {known && pressurized && h - fillHeight > 4 && (
        // The air pipe's flow continues into the space above the water, as
        // half circles spreading from where the pipe enters onto the surface.
        // They start where the pipe's dashes left off, `pressurized` pixels
        // down the pipe: a step of 14 px takes 0.9 s, see .pipe-flow
        <g className="pressure" aria-hidden>
          <clipPath id={clipId}>
            <rect
              x={x + 1}
              y={y + 1}
              width={w - 2}
              height={h - fillHeight - 1}
              rx={small ? 4 : 7}
            />
          </clipPath>
          {/* Fades from the top of the tank to its bottom */}
          <linearGradient
            id={`${clipId}-fade`}
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={y}
            x2={0}
            y2={y + h}
          >
            <stop offset={0} stopColor="#fff" />
            <stop offset={1} stopColor="#000" />
          </linearGradient>
          <mask id={`${clipId}-mask`}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={`url(#${clipId}-fade)`}
            />
          </mask>
          <g clipPath={`url(#${clipId})`}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h - fillHeight}
              className="pressure-fill"
            />
            <g mask={`url(#${clipId}-mask)`}>
              {Array.from({ length: rings }, (_, i) => (
                // Each ring grows from the pipe to the outermost one's
                // radius, a step of 14 px behind the next
                <circle
                  key={i}
                  cx={x + w / 2}
                  cy={y}
                  r={rings * 14}
                  className="pressure-ring"
                  style={{
                    transform: `scale(${i / rings})`,
                    animationDuration: `${rings * 0.9}s`,
                    animationDelay: `${phase - i * 0.9}s`,
                  }}
                />
              ))}
            </g>
          </g>
        </g>
      )}
      <text
        x={textX}
        y={small ? y + h / 2 - 6 : y + 22}
        textAnchor={anchor}
        className="tank-label"
      >
        {label}
        {sub && (
          <tspan className="tank-sub" dx={6}>
            {sub}
          </tspan>
        )}
      </text>
      {known && small && (
        <text
          x={textX}
          y={y + h / 2 + 20}
          textAnchor={anchor}
          className="tank-value"
        >
          {percent}
        </text>
      )}
      {known && !small && (
        <>
          <text
            x={x + 12}
            y={y + h - (h > 100 ? 30 : 26)}
            className="tank-value"
          >
            {Math.round(level!.liters!)} L{" "}
            {arrow && <tspan className="tank-trend">{arrow}</tspan>}
          </text>
          <text x={x + 12} y={y + h - 12} className="tank-meta">
            {percent} of {level!.capacity ? "~" : ""}
            {Math.round(size)} L
          </text>
        </>
      )}
    </g>
  );
}

/** T4 has float sensors instead of a level reading */
function BackupTank({
  x,
  y,
  w,
  h,
  state,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  state: DeviceState;
}) {
  const { t4, io } = state;
  const maxY = y + h * 0.55;
  const minY = y + h * 0.82;
  // The water is at least as high as the highest wet float
  const fillTop = t4.max ? maxY : t4.min ? minY : undefined;
  return (
    <g className="tank kind-mains">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        className={
          t4.max === undefined && t4.min === undefined
            ? "tank-shell is-unknown"
            : "tank-shell"
        }
      />
      {fillTop !== undefined && (
        <>
          <rect
            x={x + 1}
            y={fillTop}
            width={w - 2}
            height={y + h - fillTop - 1}
            rx={7}
            className="tank-fill"
          />
          <line
            x1={x + 1}
            x2={x + w - 1}
            y1={fillTop}
            y2={fillTop}
            className="tank-surface is-dashed"
          />
        </>
      )}
      <text x={x + 12} y={y + 22} className="tank-label">
        T4
        <tspan className="tank-sub" dx={6}>
          Backup
        </tspan>
      </text>
      <Sensor
        x={x + w - 14}
        y={maxY}
        kind="mains"
        io={io[IO.t4Max]}
        name={IO.t4Max}
        label="Max"
        labelAnchor="end"
        labelDx={-12}
      />
      <Sensor
        x={x + w - 14}
        y={minY}
        kind="mains"
        io={io[IO.t4Min]}
        name={IO.t4Min}
        label="Min"
        labelAnchor="end"
        labelDx={-12}
      />
      <text x={x + 12} y={y + 40} className="tank-meta">
        {t4.label}
      </text>
    </g>
  );
}

export function FlowDiagram({
  state,
  device,
}: {
  state: DeviceState;
  device: DeviceInfo;
}) {
  const { io, tanks, inlet, supply, t3 } = state;
  const ab = io[IO.abSelector];
  const selected: Side | undefined = ab ? (ab.on ? "B" : "A") : undefined;
  const bypass = io[IO.bypass];
  const bypassEnds = distributorEnds(500, 24, "left");
  const abEnds = distributorEnds(500, 100, "up");

  const train = (side: Side) => {
    const a = side === "A";
    // Tank areas are to scale: T1 ~24 L, T2 ~200 L, T3 ~280 L (TANK_CAPACITY)
    const t1x = a ? 140 : 839;
    const t2x = a ? 214 : 614;
    const t1c = t1x + 10;
    const t2c = t2x + 86;
    const transfer = io[sideIo("transfer_path", side)];
    const waste = io[sideIo("waste_clean_tank", side)];
    const air = io[sideIo("air_pump", side)];
    const airTop = 151;
    const bubbles = io[sideIo("bubbles_block", side)];
    const receiving = inlet.receiving.includes(side);
    const drainX = a ? 30 : 970;
    const transferring = transfer?.on;
    const skimming = state.trains[side].skimming;
    return (
      <g key={side}>
        <text
          x={a ? 20 : 980}
          y={146}
          textAnchor={a ? "start" : "end"}
          className="train-label"
        >
          Train {side}
        </text>

        {/* Inlet, active during INCOMING_WATER into the A/B valve's train */}
        <Pipe
          d={
            a
              ? `M${abEnds.outlets[0]} 100 H${t1c} V232`
              : `M${abEnds.outlets[1]} 100 H${t1c} V232`
          }
          kind="grey"
          active={receiving}
          open={selected === side}
          square
        />

        {/* Air pump into T2 */}
        <Pipe d={`M${t2c} ${airTop} V232`} kind="air" active={air?.on} />
        <Pump
          x={t2c}
          y={136}
          r={13}
          kind="air"
          io={air}
          name={sideIo("air_pump", side)}
          label="Air"
          labelAnchor={a ? "start" : "end"}
          labelDx={20}
        />

        {/* Exchange from T2 into T1 */}
        <Pipe
          d={a ? "M214 340 H161" : "M786 340 H839"}
          kind="grey"
          active={state.trains[side].t2ToT1}
        />

        <Tank
          x={t1x}
          y={232}
          w={21}
          h={128}
          level={tanks[a ? "t1a" : "t1b"]}
          kind="grey"
          label="T1"
          side={side}
          aeration={bubbles?.on}
          small={a ? "start" : "end"}
        />
        <Tank
          x={t2x}
          y={232}
          w={172}
          h={128}
          level={tanks[a ? "t2a" : "t2b"]}
          kind="grey"
          label="T2"
          side={side}
          pressurized={air?.on && 232 - airTop}
        />

        {/* Skim overflow at the top of T1, down the drain line. It has no
            valve, so it is shown from the FILTH_REMOVAL routine. */}
        <Pipe
          d={a ? `M140 237 H${drainX} V410` : `M860 237 H${drainX} V410`}
          kind="waste"
          active={skimming}
          title={`Skim overflow of T1 ${side}${skimming ? ": filth spilling over to the drain (inferred from the FILTH_REMOVAL routine)" : ""}`}
        />
        <text
          x={a ? 57 : 943}
          y={228}
          textAnchor="middle"
          className="diagram-label"
        >
          Skim
        </text>

        {/* Waste valve into the drain line */}
        <Pipe
          d={`M${t1c} 360 V410 H${drainX}`}
          kind="waste"
          active={waste?.on}
          open={waste?.on}
        />
        {/* Shared by the skim overflow and the waste valve */}
        <Pipe
          d={`M${drainX} 410 V470`}
          kind="waste"
          active={skimming || waste?.on}
          open={waste?.on}
          arrow={{ x: drainX, y: 470, dir: "down" }}
        />
        <Valve
          x={t1c}
          y={385}
          vertical
          kind="waste"
          io={waste}
          active={waste?.on}
          name={sideIo("waste_clean_tank", side)}
          label="Waste"
          labelAnchor={a ? "end" : "start"}
          labelDx={a ? -16 : 16}
        />
        <text x={drainX} y={498} textAnchor="middle" className="diagram-label">
          Drain
        </text>

        {/* Transfer through UV into T3 */}
        <Pipe
          d={a ? `M${t2c} 360 V420 H488 V440` : `M${t2c} 360 V420 H512 V440`}
          kind="clean"
          active={transferring}
          open={transferring}
        />
        <Valve
          x={t2c}
          y={390}
          vertical
          kind="clean"
          io={transfer}
          active={transferring}
          name={sideIo("transfer_path", side)}
          label="Transfer"
          labelAnchor={a ? "start" : "end"}
          labelDx={a ? 16 : -16}
        />
      </g>
    );
  };

  const backup = io[IO.backupWater];
  const recycledToPump = supply.pumping && supply.source !== "backup";
  const backupToPump = supply.pumping && supply.source === "backup";
  const circulatingThroughUv = t3.circulating && supply.pumping;
  // Water only leaves UV-C for T3 while something feeds the chamber and the
  // UV valve isn't closed.
  const t3ReceivingFromUv =
    (t3.receivingFrom.length > 0 || circulatingThroughUv) &&
    io[IO.uvValve]?.on !== false;
  const outletKind: Kind = supply.source === "backup" ? "mains" : "clean";
  const off = (connected: boolean | null) =>
    connected === false ? " is-disconnected" : "";

  return (
    <svg
      viewBox="0 -38 1000 853"
      className="flow-diagram"
      role="group"
      aria-label="Water flow through the H600"
    >
      <defs>
        <pattern
          id="hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
        </pattern>
      </defs>

      {/* Inlet and bypass */}
      <text x={60} y={10} className="diagram-label is-strong">
        Greywater from showers and baths
      </text>
      <Pipe
        d={`M60 24 H${bypassEnds.inlet}`}
        kind="grey"
        active={inlet.receiving.length > 0 || inlet.bypass}
        open={bypass?.on || (bypass?.on === false && selected !== undefined)}
        square
      />
      <Pipe
        d={`M500 ${bypassEnds.outlets[0]} V${abEnds.inlet}`}
        kind="grey"
        active={inlet.receiving.length > 0}
        open={bypass?.on === false && selected !== undefined}
        square
      />
      <Pipe
        d={`M500 ${bypassEnds.outlets[1]} V-22 H935`}
        kind="grey"
        active={inlet.bypass}
        open={bypass?.on}
        square
        arrow={{ x: 935, y: -22, dir: "right" }}
      />
      <Distributor
        x={500}
        y={24}
        inlet="left"
        kind="grey"
        io={bypass}
        name={IO.bypass}
        label="Bypass"
        words={["to the sewer", "to the trains"]}
        outlets={[
          { open: bypass?.on, active: inlet.bypass === true },
          {
            open: bypass && !bypass.on,
            active: inlet.receiving.length > 0,
          },
        ]}
        labelAnchor="start"
        labelDx={14}
      />
      <text x={948} y={-18} className="diagram-label">
        Sewer
      </text>

      {train("A")}
      {train("B")}

      <Distributor
        x={500}
        y={100}
        kind="grey"
        io={ab}
        name={IO.abSelector}
        label="A/B valve"
        words={["to train B", "to train A"]}
        outlets={[
          {
            open: selected && selected === "A",
            active: inlet.receiving.includes("A"),
          },
          {
            open: selected && selected === "B",
            active: inlet.receiving.includes("B"),
          },
        ]}
        labelDy={24}
      />

      {/* UV and into T3 */}
      <Pipe
        d="M500 474 V540"
        kind="clean"
        active={t3ReceivingFromUv}
        open={io[IO.uvValve]?.on}
      />
      <g
        className={`uv is-${t3.uv === undefined ? "unknown" : t3.uv ? "on" : "off"}`}
        tabIndex={0}
        role="img"
        aria-label={ioTitle("UV-C", IO.uvPower, io[IO.uvPower], ["on", "off"])}
      >
        <title suppressHydrationWarning>
          {ioTitle("UV-C", IO.uvPower, io[IO.uvPower], ["on", "off"])}
        </title>
        <rect x={460} y={440} width={80} height={34} rx={6} />
        <text x={500} y={462} textAnchor="middle">
          UV-C
        </text>
      </g>
      <Valve
        x={500}
        y={502}
        vertical
        kind="clean"
        io={io[IO.uvValve]}
        active={t3ReceivingFromUv}
        name={IO.uvValve}
        label="UV valve"
      />

      <Tank
        x={346}
        y={540}
        w={309}
        h={100}
        level={tanks.t3}
        kind="clean"
        label="T3"
        sub="Recycled water"
      />

      {/* T3 drain */}
      <Pipe
        d="M640 640 V680 H970 V735"
        kind="waste"
        active={t3.draining}
        open={io[IO.wasteStorageTank]?.on}
        arrow={{ x: 970, y: 735, dir: "down" }}
      />
      <Valve
        x={790}
        y={680}
        kind="waste"
        io={io[IO.wasteStorageTank]}
        active={t3.draining}
        name={IO.wasteStorageTank}
        label="T3 drain"
        labelAnchor="middle"
        labelDx={0}
        labelDy={-16}
      />
      <text x={970} y={763} textAnchor="middle" className="diagram-label">
        Drain
      </text>

      {/* T4 backup */}
      <BackupTank x={60} y={540} w={130} h={100} state={state} />
      <Pipe
        d="M115 640 V680 H244"
        kind="mains"
        active={backupToPump}
        open={backup?.on}
      />
      <Valve
        x={185}
        y={680}
        kind="mains"
        io={backup}
        active={backupToPump}
        name={IO.backupWater}
        label="Backup"
        labelAnchor="middle"
        labelDx={0}
        labelDy={-16}
      />

      {/* T3 to the distribution pump, unless the outlets get backup water */}
      <Pipe
        d="M360 640 V680 H276"
        kind="clean"
        active={recycledToPump}
        open={backup?.on === false}
      />

      {/* Circulation: the distribution pump pushes T3 water through UV */}
      <Pipe
        d="M260 664 V465 H460"
        kind="clean"
        active={circulatingThroughUv}
        open={t3.circulating}
      />
      <Valve
        x={260}
        y={500}
        vertical
        kind="clean"
        io={io[IO.circulation]}
        active={circulatingThroughUv}
        name={IO.circulation}
        label="Circulation"
        labelAnchor="end"
        labelDx={-14}
      />

      <Pump
        x={260}
        y={680}
        r={16}
        kind={outletKind}
        io={io[IO.distributionPump]}
        name={IO.distributionPump}
        label="Distribution"
        labelDx={20}
        labelDy={26}
      />

      {/* Outlets, active by their demand sensor. The pipes to them are always
          pressurized, from T3 or T4, so they are open even without a reading */}
      <Pipe
        d="M260 696 V760"
        kind={outletKind}
        active={supply.toOutlets ?? false}
        open
      />
      <Pipe
        d="M150 760 H360"
        kind={outletKind}
        active={supply.toOutlets ?? false}
        open
      />
      <g className={`outlet${off(device.outlets.toilet)}`}>
        <Pipe
          d="M150 760 V782"
          kind={outletKind}
          active={supply.toilet ?? false}
          open
          arrow={{ x: 150, y: 782, dir: "down" }}
        />
        <Sensor
          x={150}
          y={771}
          kind={outletKind}
          io={io[IO.toilet]}
          name={IO.toilet}
          label=""
        />
        <text x={150} y={807} textAnchor="middle" className="diagram-label">
          Toilets
        </text>
      </g>
      <g className={`outlet${off(device.outlets.washingMachine)}`}>
        <Pipe
          d="M260 760 V782"
          kind={outletKind}
          active={supply.wash ?? false}
          open
          arrow={{ x: 260, y: 782, dir: "down" }}
        />
        <Sensor
          x={260}
          y={771}
          kind={outletKind}
          io={io[IO.wash]}
          name={IO.wash}
          label=""
        />
        <text x={260} y={807} textAnchor="middle" className="diagram-label">
          Washer
        </text>
      </g>
      <g className={`outlet${off(device.outlets.auxiliary)}`}>
        <Pipe
          d="M360 760 H440 V782"
          kind={outletKind}
          active={supply.auxiliary}
          open={io[IO.auxiliary]?.on}
          arrow={{ x: 440, y: 782, dir: "down" }}
        />
        <Valve
          x={395}
          y={760}
          kind={outletKind}
          io={io[IO.auxiliary]}
          active={supply.auxiliary}
          name={IO.auxiliary}
          label=""
        />
        <text x={440} y={807} textAnchor="middle" className="diagram-label">
          Auxiliary
        </text>
      </g>
    </svg>
  );
}

export function DiagramLegend() {
  const items: [Kind, string][] = [
    ["grey", "Greywater"],
    ["clean", "Treated water"],
    ["mains", "Mains backup"],
    ["waste", "Filth removal"],
  ];
  return (
    <ul className="legend" aria-label="Legend">
      {items.map(([kind, text]) => (
        <li key={kind}>
          <span className={`legend-swatch kind-${kind}`} />
          {text}
        </li>
      ))}
      <li>
        <span className="legend-swatch is-open" />
        Open, no flow
      </li>
      <li>
        <span className="legend-swatch is-idle" />
        No flow
      </li>
    </ul>
  );
}

/** The flows the diagram animates, as text */
export function activeFlows(state: DeviceState) {
  const { inlet, trains, io, t3, supply } = state;
  const flows: string[] = [];
  for (const side of inlet.receiving) flows.push(`Greywater → train ${side}`);
  if (inlet.bypass) flows.push("Greywater → sewer (bypass)");
  for (const side of ["A", "B"] as Side[]) {
    if (trains[side].t2ToT1) flows.push(`T2 ${side} → T1 ${side}`);
    if (trains[side].skimming) {
      flows.push(`T1 ${side} → skim overflow → drain (inferred)`);
    }
    if (io[sideIo("waste_clean_tank", side)]?.on) {
      flows.push(`T1 ${side} → drain`);
    }
    if (io[sideIo("transfer_path", side)]?.on) {
      flows.push(`Train ${side} → UV → T3`);
    }
  }
  if (t3.circulating && supply.pumping) flows.push("T3 → UV → T3");
  if (t3.draining) flows.push("T3 → drain");
  if (supply.toOutlets) {
    const to = [
      supply.toilet && "toilets",
      supply.wash && "washer",
      supply.auxiliary && "auxiliary",
    ].filter(Boolean);
    flows.push(
      `${supply.source === "backup" ? "T4" : "T3"} → ${to.length ? to.join(", ") : "outlets"}`,
    );
  }
  return flows;
}

export function FlowSummary({ state }: { state: DeviceState }) {
  const flows = activeFlows(state);
  return (
    <p className="flow-summary">
      <span className="muted">Water moving: </span>
      {flows.length ? flows.join(" · ") : "None"}
    </p>
  );
}
