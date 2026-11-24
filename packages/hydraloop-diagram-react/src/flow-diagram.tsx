// Schematic of the H600: inlet, two treatment trains, UV, storage, backup
// and outlets. Pipes are colored and animated only while a routine, valve,
// pump or sensor signal shows water moving through them. Pipes that their
// valves leave open, but without water moving, are drawn with more contrast.
//
// Plain React without hooks, so it also renders as a server component. The
// class names are prefixed with `hl-`, see `styles.css`.

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
} from "./model.js";

type Kind = "grey" | "clean" | "mains" | "waste" | "air";

/**
 * Times in tooltips, in the runtime's locale and time zone. They can differ
 * between server and browser, so the `<title>` elements that show them have
 * `suppressHydrationWarning`.
 */
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
  filled = false,
  still = false,
  square = false,
  arrow,
  title,
}: {
  d: string;
  kind: Kind;
  active: boolean | undefined;
  /** The valves on this pipe are open, so water can move through it */
  open?: boolean;
  /**
   * Water fills the pipe, drawn like the water in a tank. If it is also
   * active, the water moves in the same subtle color
   */
  filled?: boolean;
  /** An active pipe's pattern stands still, for air held under pressure */
  still?: boolean;
  /** Square ends, for pipes that end at a distributor, tank or UV-C */
  square?: boolean;
  /** Draw an outlet arrow at this point, pointing in this direction */
  arrow?: { x: number; y: number; dir: "down" | "right" | "left" };
  /** Tooltip, for pipes without a valve or pump */
  title?: string;
}) {
  const state =
    active === undefined
      ? "unknown"
      : filled
        ? "filled"
        : active
          ? "active"
          : open
            ? "open"
            : "idle";
  return (
    <g
      className={`hl-pipe hl-kind-${kind} is-${state}${still ? " is-still" : ""}${square ? " is-square" : ""}`}
    >
      {title && <title>{title}</title>}
      <path d={d} className="hl-pipe-base" />
      {state === "filled" && <path d={d} className="hl-pipe-water" />}
      {active && <path d={d} className="hl-pipe-flow" />}
      {arrow && (
        <path
          className="hl-pipe-arrow"
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
  const manual = io.manual ? ", switched manually" : "";
  return `${label}: ${io.on ? words[0] : words[1]}${since}${manual} (${name} = ${io.value})`;
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
      className={`hl-valve hl-kind-${kind} is-${state}${state === "open" && active ? " is-flowing" : ""}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title suppressHydrationWarning>{title}</title>
      <rect x={x - 14} y={y - 14} width={28} height={28} className="hl-hit" />
      <g
        className="hl-valve-body"
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
          className="hl-diagram-label"
        >
          {label}
        </text>
      )}
    </g>
  );
}

type Branch = {
  /** undefined while the valve state is unknown */
  open: boolean | undefined;
  /** Water is moving through this branch */
  active: boolean;
};

/**
 * The pipe between the backwash valves, level with the waste pipes below T1
 */
const RUN_Y = 404;
/** The vertical center of UV-C */
const UV_Y = 466;
/** Half the width of a pipe */
const PIPE = 3.5;
/**
 * The x of each train's T2, which leaves 30 px between the release air labels.
 * Each train's other parts are placed relative to it
 */
const T2_X: Record<Side, number> = { A: 288, B: 540 };
/**
 * Where the pipes to the sewer end, in an arrow pointing at their label: on
 * the right, mirrored on the left
 */
const SEWER_END = { left: 1000 - 935, right: 935 };
/** The space between a sewer arrow's tip and its label */
const SEWER_LABEL_DX = 13;
/** T4's left edge */
const T4_X = 60;
/** The width of a "Sewer" label */
const SEWER_LABEL_W = 38;
/**
 * The outer edge of each train's sewer label, lined up with T4's left edge,
 * mirrored on the right
 */
const TRAIN_SEWER_LABEL_X: Record<Side, number> = { A: T4_X, B: 1000 - T4_X };
/** The mains pipe into T4, level with the transfer pipes into UV-C */
const MAINS_Y = UV_Y;
/** Where the mains pipe enters T4's top */
const T4_INLET_X = 167;
/** The center of each T2, where its backwash pipe enters from below */
const T2_CENTER: Record<Side, number> = { A: T2_X.A + 86, B: T2_X.B + 86 };
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
function distributorEnds(x: number, y: number, tip: "up" | "down" | "left") {
  const d = DISTRIBUTOR - 2 * PIPE;
  return tip === "left"
    ? { common: x - d, branches: [y + d, y - d] }
    : { common: tip === "up" ? y - d : y + d, branches: [x - d, x + d] };
}

/**
 * A valve that connects one common pipe to one of two branches, drawn as a
 * triangle with its tip at the common pipe and its other tips at the
 * branches. Its pipes cross at (x, y). The common pipe is an inlet from above
 * or from the left, or an outlet below that the branches join into. The
 * water flows through the part of the triangle between the outer borders of
 * the common pipe and the open branch's pipe, so it lines up with both. The
 * rest is an outline.
 */
function Distributor({
  x,
  y,
  tip = "up",
  kind,
  io,
  name,
  label,
  words,
  branches,
  labelAnchor = "middle",
  labelDx = 0,
  labelDy = 4,
  strong = false,
}: {
  x: number;
  y: number;
  /** Where the common pipe is */
  tip?: "up" | "down" | "left";
  kind: Kind;
  io: IoValue | undefined;
  name: string;
  label: string;
  /** What the valve does while on and off */
  words: [string, string];
  /** Left and right, or bottom and top with the tip on the left */
  branches: [Branch, Branch];
  labelAnchor?: "start" | "middle" | "end";
  labelDx?: number;
  labelDy?: number;
  /** Bold label, e.g. for a user override */
  strong?: boolean;
}) {
  const p = PIPE;
  const w = DISTRIBUTOR;
  // Drawn with the tip above, then turned for a tip on the left or flipped
  // for a tip below
  const up = tip !== "left";
  const at = ([dx, dy]: [number, number]) =>
    tip === "up"
      ? `${x + dx},${y + dy}`
      : tip === "down"
        ? `${x + dx},${y - dy}`
        : `${x + dy},${y - dx}`;
  const shape = (points: [number, number][]) => points.map(at).join(" ");
  // Outlined parts, with the outline inside so it lines up with the pipes
  const outline = (points: [number, number][], width = OUTLINE) =>
    shape(inset(points, width / 2));
  // With the tip on the left, the left branch turns to the bottom
  const [left, right] = up ? branches : [branches[1], branches[0]];
  const state = (branch: Branch) =>
    branch.open === undefined
      ? "unknown"
      : !branch.open
        ? "closed"
        : branch.active
          ? "flowing"
          : "open";
  const open = left.open ? -1 : right.open ? 1 : 0;
  const title = ioTitle(label, name, io, words);
  return (
    <g
      className={`hl-distributor hl-kind-${kind}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title suppressHydrationWarning>{title}</title>
      <rect
        x={up ? x - w - 4 : x + p - w - 4}
        y={
          tip === "up" ? y + p - w - 4 : tip === "down" ? y - p - 4 : y - w - 4
        }
        width={up ? 2 * w + 8 : w + 8}
        height={up ? w + 8 : 2 * w + 8}
        className="hl-hit"
      />
      <g className="hl-valve-body">
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
            {/* The open side, from the far border of the common pipe */}
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
        className={strong ? "hl-diagram-label is-bold" : "hl-diagram-label"}
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
      className={`hl-pump hl-kind-${kind} is-${state}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title suppressHydrationWarning>{title}</title>
      <circle cx={x} cy={y} r={r} className="hl-pump-casing" />
      <g transform={`translate(${x} ${y})`}>
        <g className="hl-impeller">
          {/* Centers the box the impeller spins around */}
          <circle r={blades + 1} className="hl-impeller-box" />
          <path d={impellerPath(blades)} className="hl-impeller-blades" />
          <circle r={r * 0.22} className="hl-impeller-hub" />
        </g>
      </g>
      <text
        x={x + (labelAnchor === "end" ? -labelDx : labelDx)}
        y={y + labelDy}
        textAnchor={labelAnchor}
        className="hl-diagram-label"
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
      className={`hl-sensor hl-kind-${kind} is-${state}`}
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
        className="hl-diagram-label"
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
    <g className="hl-bubbles" aria-hidden>
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
              ["--hl-rise" as string]: `${-(h - 24)}px`,
            }}
          />
        );
      })}
    </g>
  );
}

/** Drops of water falling inside a tank from `y` onto its surface */
function Drips({
  x,
  y,
  bottom,
  active,
  kind = "grey",
}: {
  x: number;
  y: number;
  /** The water's surface */
  bottom: number | undefined;
  active: boolean;
  kind?: Kind;
}) {
  if (!active || bottom === undefined || bottom - y < 4) return null;
  return (
    <g className={`hl-drips hl-kind-${kind}`} aria-hidden>
      {[0, 0.3, 0.6].map((delay) => (
        <circle
          key={delay}
          cx={x}
          cy={y}
          r={1.6}
          style={{
            animationDelay: `${delay}s`,
            ["--hl-fall" as string]: `${bottom - y}px`,
          }}
        />
      ))}
    </g>
  );
}

/**
 * The animation delay of a pattern that continues a pipe's flow pattern
 * `length` px down the pipe: a step of 14 px takes 0.9 s, see .pipe-flow
 */
function flowDelay(length: number) {
  return (-((14 - (length % 14)) % 14) / 14) * 0.9;
}

/**
 * Rings in the water around where a pipe enters the tank, each growing from
 * the pipe a step of 14 px behind the next, or shrinking towards it with
 * `out`. They fade out towards the tank's center
 */
function WaterRings({
  id,
  x,
  y,
  center,
  radius,
  delay,
  out = false,
}: {
  id: string;
  x: number;
  y: number;
  /** The tank's center, where the rings have faded out */
  center: number;
  /** How far the rings reach */
  radius: number;
  /** See flowDelay */
  delay: number;
  out?: boolean;
}) {
  const rings = Math.ceil(radius / 14) + 1;
  return (
    <g className={`hl-water-rings${out ? " is-out" : ""}`}>
      <linearGradient
        id={`${id}-fade`}
        gradientUnits="userSpaceOnUse"
        x1={x}
        y1={0}
        x2={center}
        y2={0}
      >
        <stop offset={0} stopColor="#fff" />
        <stop offset={1} stopColor="#000" />
      </linearGradient>
      <mask id={`${id}-mask`}>
        <rect
          x={Math.min(x, center)}
          y={y - radius}
          width={Math.abs(center - x)}
          height={2 * radius}
          fill={`url(#${id}-fade)`}
        />
      </mask>
      <g mask={`url(#${id}-mask)`}>
        {Array.from({ length: rings }, (_, i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={rings * 14}
            className="hl-pressure-ring"
            style={{
              transform: `scale(${i / rings})`,
              animationDuration: `${rings * 0.9}s`,
              animationDelay: `${delay - i * 0.9}s`,
            }}
          />
        ))}
      </g>
    </g>
  );
}

/** How full the tank's shell is, 0 to 1, or undefined without a reading */
function fillOf(level: TankLevel | undefined) {
  if (level?.liters === undefined || level.max <= 0) return undefined;
  // The shell stands for the tank's capacity, which can be more than the
  // sensor's range
  const size = level.capacity ?? level.max;
  return Math.max(0, Math.min(1, level.liters / size));
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
  circulation,
  pressurized,
  pressureHeld = false,
  airX,
  venting,
  small,
  square = false,
  base = 0,
  inlinePercent = false,
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
   * Water moves through the tank, in through a pipe at the bottom of one side
   * and out through one on the other: the x where it enters and leaves, the
   * pipes' y, and the length of the pipe it enters through
   */
  circulation?: { from: number; to: number; y: number; length: number };
  /**
   * Air is pumped into the space above the water, pressing on its surface:
   * the length of the air pipe that ends at the top of the tank
   */
  pressurized?: number | false;
  /** The air is no longer pumped in, but holds its pressure: the rings stand still */
  pressureHeld?: boolean;
  /** The x where the air pipe enters the top of the tank, its center by default */
  airX?: number;
  /**
   * Air leaves through a pipe at this x on the top of the tank: the rings
   * move in towards it, the reverse of `pressurized`
   */
  venting?: number;
  /**
   * A tank too narrow for its text: the label and the level in percent go
   * next to it, before (`start`) or after (`end`) it
   */
  small?: "start" | "end";
  /** Square corners */
  square?: boolean;
  /**
   * Water at the bottom of the tank, in px, that is always there: 0% starts
   * on top of it
   */
  base?: number;
  /**
   * The level in percent goes after the liters, in place of the line with
   * the tank's size below them
   */
  inlinePercent?: boolean;
}) {
  const known = fillOf(level) !== undefined;
  const size = level?.capacity ?? level?.max ?? 0;
  const fill = fillOf(level) ?? 0;
  const percent = `${Math.round(fill * 100)}%`;
  const trend = level?.trend;
  const arrow =
    trend === undefined || Math.abs(trend) < 0.3 ? "" : trend > 0 ? "↑" : "↓";
  const fillHeight = base + (h - base) * fill;
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
  const clipId = `hl-pressure-${label}-${side ?? sub ?? ""}`;
  const ringX = venting ?? airX ?? x + w / 2;
  // Enough rings to reach the far corners of the space above the water
  const rings =
    Math.ceil(
      Math.hypot(Math.max(ringX - x, x + w - ringX), h - fillHeight) / 14,
    ) + 1;
  // Venting rings vanish where the pipe's dashes start, at its beginning
  const phase =
    venting === undefined && pressurized ? flowDelay(pressurized) : 0;
  const textX = small === "end" ? x + w + 10 : small ? x - 10 : x + 12;
  const anchor = small === "start" ? "end" : "start";
  return (
    <g
      className={`hl-tank hl-kind-${kind}`}
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
        rx={square ? 0 : 5}
        className={known ? "hl-tank-shell" : "hl-tank-shell is-unknown"}
      />
      {known && (
        <>
          <rect
            x={x + 1}
            y={y + h - fillHeight}
            width={w - 2}
            height={Math.max(0, fillHeight - 1)}
            rx={!square && fillHeight > 8 ? 4 : 0}
            className="hl-tank-fill"
          />
          <line
            x1={x + 1}
            x2={x + w - 1}
            y1={y + h - fillHeight}
            y2={y + h - fillHeight}
            className="hl-tank-surface"
          />
        </>
      )}
      {known && circulation && fillHeight > 4 && (
        // The water spreads into the tank as rings, as the air does when
        // pressurized, and gathers towards the pipe it leaves through. Rings
        // start where the entering pipe's dashes leave off, and vanish where
        // the leaving pipe's dashes start
        <g className="hl-circulation" aria-hidden>
          <clipPath id={`${clipId}-water`}>
            <rect
              x={x + 1}
              y={y + h - fillHeight}
              width={w - 2}
              height={fillHeight - 1}
              rx={!square && fillHeight > 8 ? 4 : 0}
            />
          </clipPath>
          <g clipPath={`url(#${clipId}-water)`}>
            {[circulation.from, circulation.to].map((end, i) => (
              <WaterRings
                key={i}
                id={`${clipId}-${i ? "out" : "in"}`}
                x={end}
                y={circulation.y}
                center={x + w / 2}
                radius={Math.hypot(w / 2, circulation.y - (y + h - fillHeight))}
                delay={i ? 0 : flowDelay(circulation.length)}
                out={i === 1}
              />
            ))}
          </g>
        </g>
      )}
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={x + w - (small ? 5 : 8)}
          x2={x + w}
          y1={y + h - base - (h - base) * f}
          y2={y + h - base - (h - base) * f}
          className="hl-tank-tick"
        />
      ))}
      <Bubbles x={x} y={y} w={w} h={h} active={aeration} />
      {known &&
        (pressurized || venting !== undefined) &&
        h - fillHeight > 4 && (
          // The air pipe's flow continues into the space above the water, as
          // half circles spreading from where the pipe enters onto the surface.
          // They start where the pipe's dashes left off, `pressurized` pixels
          // down the pipe: a step of 14 px takes 0.9 s, see .pipe-flow. While
          // venting, they move in towards the release air pipe instead
          <g
            className={`hl-pressure${venting !== undefined ? " is-venting" : pressureHeld ? " is-held" : ""}`}
            aria-hidden
          >
            <clipPath id={clipId}>
              <rect
                x={x + 1}
                y={y + 1}
                width={w - 2}
                height={h - fillHeight - 1}
                rx={square ? 0 : 4}
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
                className="hl-pressure-fill"
              />
              <g mask={`url(#${clipId}-mask)`}>
                {Array.from({ length: rings }, (_, i) => (
                  // Each ring grows from the pipe to the outermost one's
                  // radius, a step of 14 px behind the next
                  <circle
                    key={i}
                    cx={ringX}
                    cy={y}
                    r={rings * 14}
                    className="hl-pressure-ring"
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
        className="hl-tank-label"
      >
        {label}
        {sub && (
          <tspan className="hl-tank-sub" dx={6}>
            {sub}
          </tspan>
        )}
      </text>
      {pressureHeld && (
        // Air pumped in before holds its pressure, in the top right corner,
        // level with the label
        <text
          x={x + w - 12}
          y={y + 22}
          textAnchor="end"
          className="hl-tank-meta"
        >
          pressurized
        </text>
      )}
      {known && small && (
        <text
          x={textX}
          y={y + h / 2 + 20}
          textAnchor={anchor}
          className="hl-tank-value"
        >
          {percent}
        </text>
      )}
      {known && !small && inlinePercent && (
        <text x={x + 12} y={y + h - 14} className="hl-tank-value">
          {Math.round(level!.liters!)} L{" "}
          {arrow && <tspan className="hl-tank-trend">{arrow} </tspan>}
          <tspan className="hl-tank-meta">{percent}</tspan>
        </text>
      )}
      {known && !small && !inlinePercent && (
        <>
          <text
            x={x + 12}
            y={y + h - (h > 100 ? 30 : 26)}
            className="hl-tank-value"
          >
            {Math.round(level!.liters!)} L{" "}
            {arrow && <tspan className="hl-tank-trend">{arrow}</tspan>}
          </text>
          <text x={x + 12} y={y + h - 12} className="hl-tank-meta">
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
  inletX,
  filling = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  state: DeviceState;
  /** Where the mains pipe enters the top of the tank */
  inletX: number;
  /** Mains water drips in from the inlet */
  filling?: boolean;
}) {
  const { t4, io } = state;
  const maxY = y + h * 0.55;
  const minY = y + h * 0.82;
  // The water is at least as high as the highest wet float
  const fillTop = t4.max ? maxY : t4.min ? minY : undefined;
  return (
    <g className="hl-tank hl-kind-mains">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        className={
          t4.max === undefined && t4.min === undefined
            ? "hl-tank-shell is-unknown"
            : "hl-tank-shell"
        }
      />
      {fillTop !== undefined && (
        <>
          <rect
            x={x + 1}
            y={fillTop}
            width={w - 2}
            height={y + h - fillTop - 1}
            className="hl-tank-fill"
          />
          <line
            x1={x + 1}
            x2={x + w - 1}
            y1={fillTop}
            y2={fillTop}
            className="hl-tank-surface is-dashed"
          />
        </>
      )}
      <text x={x + 12} y={y + 22} className="hl-tank-label">
        T4
        <tspan className="hl-tank-sub" dx={6}>
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
      <text x={x + 12} y={y + 40} className="hl-tank-meta">
        {t4.label}
      </text>
      {/* Below the min float, the water's surface is unknown: the drops fall
          to the bottom */}
      <Drips
        x={inletX}
        y={y}
        bottom={fillTop ?? y + h}
        active={filling}
        kind="mains"
      />
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
  // Switched on in the app
  const bypassOverride = state.systemBehaviors.some(
    (b) => b.name === "bypassByAppBypassValve",
  );
  // The greywater inlet runs evenly spaced between the sewer pipe above it
  // and the pipes to the trains below it, far enough apart to leave 5 px
  // between the bypass and A/B valves
  const abY = 100;
  const inletY = abY - 49.5;
  const sewerY = inletY - 49.5;
  const bypassEnds = distributorEnds(500, inletY, "left");
  const abEnds = distributorEnds(500, abY, "up");
  // The backup valve lines up with the bottom of T3 and T4
  const backupY = 640 - PIPE;
  const backupEnds = distributorEnds(260, backupY, "down");

  const train = (side: Side) => {
    const a = side === "A";
    // Tank areas are to scale: T1 ~24 L, T2 ~200 L, T3 ~280 L (TANK_CAPACITY),
    // except that T1 reaches further down, to fit the transfer pipe on its side
    const t2x = T2_X[side];
    // The train's offset from its first layout, for the parts outside its tanks
    const dx = a ? t2x - 214 : t2x - 614;
    const t1x = t2x + (a ? -74 : 225);
    const t1c = t1x + 10;
    const t1Bottom = 384;
    // The add air and release air pipes enter T2's top evenly spread across
    // it, the release air pipe on the inner side
    const t2c = a ? t2x + 57 : t2x + 172 - 57;
    const transfer = io[sideIo("transfer_path", side)];
    const waste = io[sideIo("waste_clean_tank", side)];
    const air = io[sideIo("air_pump", side)];
    const pumpY = 136;
    const pumpR = 13;
    const addAir = io[sideIo("add_air_valve", side)];
    // The top run of the pipe into T1 and the add air valve are evenly spread
    // between the air pump's bottom and T2's top
    const airStep = (232 - (pumpY + pumpR)) / 3;
    const teeY = pumpY + pumpR + airStep;
    const addAirY = pumpY + pumpR + 2 * airStep;
    // The pipe starts behind the pump, a multiple of 14 px above the valve,
    // so the dashes of both parts line up, see .pipe-flow
    const airTop = addAirY - 5 * 14;
    // Air only reaches T2 while the add air valve isn't closed
    const addingAir = air?.on && addAir?.on !== false;
    // After air was added, T2 holds the pressure until the release air valve
    // opens. Its pattern stays, standing still
    const holdingAir = !addingAir && state.trains[side].pressurized;
    // The release air pipe leaves T2's top on the inner side and ends level
    // with the air pump's center, open to the room
    const release = io[sideIo("release_air", side)];
    const releaseX = a ? t2x + 172 - 57 : t2x + 57;
    // The air pipe into T1 branches off above the add air valve, runs down
    // between T1 and T2, and enters T1's bottom from below, next to the waste
    // pipe. The waste pipe leaves T1's bottom on the outer side
    const airX = a ? t1x + 21 - 5 : t1x + 5;
    const wasteX = a ? t1x + 5.5 : t1x + 21 - 5.5;
    const wasteY = t1Bottom + 20;
    // Below T1, the air pipe's lower edge lines up with the waste pipe's
    // (5 px air pipe, 7 px waste pipe)
    const airBelowY = wasteY + PIPE - 2.5;
    // The air pipe into T1 and the transfer pipe run down between T1 and T2,
    // evenly spread across the space between them, the air pipe closer to T1
    const t1Edge = a ? t1x + 21 : t1x;
    const t2Edge = a ? t2x : t2x + 172;
    const gapX = t1Edge + (t2Edge - t1Edge) / 3;
    const transferX = t1Edge + ((t2Edge - t1Edge) * 2) / 3;
    // The upper exchange pipe runs down past T2's far side
    const t2FarEdge = a ? t2x + 172 : t2x;
    const exchangeX = t2FarEdge + (a ? 14 : -14);
    const bubbles = io[sideIo("bubbles_block", side)];
    // The bubbles block valve closes while its signal is on, blocking the air
    // into T1. HDM shows it open while the signal is off
    const bubblesValve = bubbles && { ...bubbles, on: !bubbles.on };
    // The valve sits a multiple of 14 px from the tee, as the add air valve
    // does. Air only reaches T1 while it isn't closed
    const bubblesX = a ? t2c - 4 * 14 : t2c + 4 * 14;
    const bubbling = air?.on && bubblesValve?.on !== false;
    const receiving = inlet.receiving.includes(side);
    // The drain leaves to the outside, its arrow pointing at its label
    const drainEnd =
      TRAIN_SEWER_LABEL_X[side] +
      (a ? 1 : -1) * (SEWER_LABEL_W + SEWER_LABEL_DX);
    // The skim overflow joins the drain 23 px before its end, which keeps it
    // clear of T1's level in percent ("100%") next to T1
    const drainX = drainEnd + (a ? 23 : -23);
    const transferring = transfer?.on;
    const skimming = state.trains[side].skimming;
    const t2Level = tanks[a ? "t2a" : "t2b"];
    const t2Fill = fillOf(t2Level);
    const t1Fill = fillOf(tanks[a ? "t1a" : "t1b"]);
    // T1's percentage starts at T2's bottom, so equal percentages line up.
    // The water below it is always there
    const t1Surface =
      t1Fill === undefined ? undefined : 360 - (360 - 232) * t1Fill;
    // Two pipes connect T1 and T2, both entering T2 at the same height, at
    // its lower corners (7 px pipe, 5 px corner radius). The upper one leaves
    // T1 with its upper edge at T1's 40% water level, so the bubbles
    // circulate water from that level up. It passes behind T2, runs down past
    // its far side and enters it there
    const exchangeYs = [360 - (360 - 232) * 0.4 + PIPE, 360 - 5 - PIPE];
    /** An exchange pipe whose highest part is at `y` holds water */
    const exchangeFilled = (y: number) =>
      (t1Surface !== undefined && t1Surface <= y - PIPE + 1e-6) ||
      (t2Fill !== undefined && 360 - 128 * t2Fill <= y - PIPE);
    // While the bubbles circulate water, it moves through T2 from the upper
    // pipe into the lower one
    const circulating = bubbling === true && exchangeFilled(exchangeYs[0]);
    // Otherwise, the upper pipe's way down holds water up to T2's surface, as
    // its lower end is always below it
    const exchangeSurface =
      t2Fill === undefined
        ? undefined
        : Math.max(exchangeYs[0], 360 - 128 * t2Fill);
    // The transfer pipe leaves T1 towards T2, halfway between the lower
    // exchange pipe and T1's bottom. It crosses the air pipe, turns down
    // between T1 and T2, passes below T2 and enters UV-C from the side
    const transferY = (exchangeYs[1] + PIPE + t1Bottom) / 2;
    const body = (
      <g key={side}>
        <text
          x={(a ? 20 : 980) + dx}
          y={146}
          textAnchor={a ? "start" : "end"}
          className="hl-train-label"
        >
          Train {side}
        </text>

        {/* Inlet, active during INCOMING_WATER into the A/B valve's train */}
        <Pipe
          d={
            a
              ? `M${abEnds.branches[0]} ${abY} H${t1c} V232`
              : `M${abEnds.branches[1]} ${abY} H${t1c} V232`
          }
          kind="grey"
          active={receiving}
          open={selected === side}
          square
        />

        {/* Air pump into T2, through the add air valve */}
        <Pipe d={`M${t2c} ${teeY} H${bubblesX}`} kind="air" active={air?.on} />
        <Pipe
          d={`M${bubblesX} ${teeY} H${gapX} V${airBelowY} H${airX} V${t1Bottom}`}
          kind="air"
          active={bubbling}
          open={bubblesValve?.on}
          square
        />
        <Valve
          x={bubblesX}
          y={teeY}
          kind="air"
          io={bubblesValve}
          active={bubbling}
          name={sideIo("bubbles_block", side)}
          label="Bubbles block"
          // Above the pipe, ending short of the air pump
          labelAnchor={a ? "end" : "start"}
          labelDx={t2c + (a ? -21 : 21) - bubblesX}
          labelDy={-14}
        />
        <Pipe d={`M${t2c} ${airTop} V${addAirY}`} kind="air" active={air?.on} />
        <Pipe
          d={`M${t2c} ${addAirY} V232`}
          kind="air"
          active={addingAir || holdingAir}
          still={holdingAir}
          open={addAir?.on}
          square
        />
        <Valve
          x={t2c}
          y={addAirY}
          vertical
          kind="air"
          io={addAir}
          active={addingAir}
          name={sideIo("add_air_valve", side)}
          label="Add air"
          labelAnchor={a ? "end" : "start"}
          labelDx={a ? -16 : 16}
        />
        <Pump
          x={t2c}
          y={pumpY}
          r={pumpR}
          kind="air"
          io={air}
          name={sideIo("air_pump", side)}
          label="Air"
          labelAnchor={a ? "start" : "end"}
          labelDx={20}
        />
        {release?.on && (
          // The air leaves the pipe's open end as circles that fade out at
          // the size of the air pump. A circle starts where the pipe's dashes
          // leave off, 96 px up the pipe, see the rings in Tank
          <circle
            cx={releaseX}
            cy={136}
            r={14}
            className="hl-vent-ring"
            style={{
              animationDelay: `${(-((14 - (96 % 14)) % 14) / 14) * 0.9}s`,
            }}
            aria-hidden
          />
        )}
        <Pipe
          d={`M${releaseX} 232 V136`}
          kind="air"
          active={release?.on}
          open={release?.on}
          square
        />
        <Valve
          x={releaseX}
          y={162}
          vertical
          kind="air"
          io={release}
          active={release?.on}
          name={sideIo("release_air", side)}
          label="Release air"
          labelAnchor={a ? "start" : "end"}
          labelDx={a ? 16 : -16}
        />

        {/* Exchange between T1 and T2, open connections: each holds water
        while T1's or T2's surface is at or above the pipe's upper edge. The
        bubbles in T1 lift its water through the upper pipe into T2, which
        flows back through the lower one. A transfer from T2 into T1 is not
        animated */}
        {exchangeYs.map((y, i) => {
          const filled = exchangeFilled(y);
          return (
            <g key={y}>
              {/* A gap in the air pipe into T1, which passes behind */}
              <path
                d={`M${gapX - 4} ${y} H${gapX + 4}`}
                className="hl-pipe-gap"
              />
              <Pipe
                d={
                  i === 0
                    ? `M${t1Edge} ${y} H${exchangeX} V${exchangeYs[1]} H${t2FarEdge}`
                    : `M${t2Edge} ${y} H${t1Edge}`
                }
                kind="grey"
                active={filled && bubbling === true}
                filled={filled}
                square
              />
              {i === 0 &&
                !filled &&
                exchangeSurface !== undefined &&
                exchangeSurface < exchangeYs[1] && (
                  <Pipe
                    d={`M${exchangeX} ${exchangeYs[1]} V${exchangeSurface}`}
                    kind="grey"
                    active={false}
                    filled
                    square
                  />
                )}
              {i === 0 && (
                // Gaps where the upper pipe passes behind T2's walls
                <path
                  d={`M${t2Edge + (a ? -3 : 3)} ${y} H${t2Edge} M${t2FarEdge} ${y} H${t2FarEdge + (a ? 3 : -3)}`}
                  className="hl-pipe-gap"
                />
              )}
            </g>
          );
        })}

        <Tank
          x={t1x}
          y={232}
          w={21}
          h={t1Bottom - 232}
          level={tanks[a ? "t1a" : "t1b"]}
          kind="grey"
          label="T1"
          side={side}
          aeration={bubbling}
          small={a ? "start" : "end"}
          square
          base={t1Bottom - 360}
        />
        {/* Incoming greywater drips from the inlet's end onto T1's surface */}
        <Drips x={t1c} y={232} bottom={t1Surface} active={receiving} />
        <Tank
          x={t2x}
          y={232}
          w={172}
          h={128}
          level={t2Level}
          kind="grey"
          label="T2"
          side={side}
          circulation={
            circulating
              ? {
                  from: t2FarEdge,
                  to: t2Edge,
                  y: exchangeYs[1],
                  length:
                    Math.abs(exchangeX - t1Edge) +
                    exchangeYs[1] -
                    exchangeYs[0] +
                    Math.abs(exchangeX - t2FarEdge),
                }
              : undefined
          }
          pressurized={(addingAir || holdingAir) && 232 - addAirY}
          pressureHeld={holdingAir}
          airX={t2c}
          venting={release?.on ? releaseX : undefined}
          inlinePercent
        />

        {/* Skim overflow at the top of T1, down the drain line. It has no
            valve, so it is shown from the FILTH_REMOVAL routine. */}
        <Pipe
          d={
            a
              ? `M${t1x} 237 H${drainX} V${wasteY}`
              : `M${t1x + 21} 237 H${drainX} V${wasteY}`
          }
          kind="waste"
          active={skimming}
          title={`Skim overflow of T1 ${side}${skimming ? ": filth spilling over to the drain (inferred from the FILTH_REMOVAL routine)" : ""}`}
          square
        />
        <text
          x={drainX + (a ? 27 : -27)}
          y={228}
          textAnchor="middle"
          className="hl-diagram-label"
        >
          Skim
        </text>

        {/* Waste valve into the drain line, out of T1's bottom */}
        <Pipe
          d={`M${wasteX} ${t1Bottom} V${wasteY} H${drainX}`}
          kind="waste"
          active={waste?.on}
          open={waste?.on}
          square
        />
        {/* Shared by the skim overflow and the waste valve */}
        <Pipe
          d={`M${drainX} ${wasteY} H${drainEnd}`}
          kind="waste"
          active={skimming || waste?.on}
          open={waste?.on}
          arrow={{ x: drainEnd, y: wasteY, dir: a ? "left" : "right" }}
        />
        <Valve
          x={(wasteX + drainX) / 2}
          y={wasteY}
          kind="waste"
          io={waste}
          active={waste?.on}
          name={sideIo("waste_clean_tank", side)}
          label="Waste"
          labelAnchor="middle"
          labelDx={0}
          labelDy={24}
        />
        <text
          x={TRAIN_SEWER_LABEL_X[side]}
          y={wasteY + 4}
          textAnchor={a ? "start" : "end"}
          className="hl-diagram-label"
        >
          Sewer
        </text>
      </g>
    );

    // Drawn after the circulation pipes, so the transfer pipe passes in
    // front of them
    const transferPipe = (
      <g key={side}>
        {/* Transfer from T1 through UV into T3. The air pipe into T1 passes
            behind it */}
        <path
          d={`M${gapX - 4} ${transferY} H${gapX + 4}`}
          className="hl-pipe-gap"
        />
        <Pipe
          d={`M${t1Edge} ${transferY} H${transferX} V${UV_Y} H${a ? 460 : 540}`}
          kind="clean"
          active={transferring}
          open={transferring}
          square
        />
        <Valve
          x={T2_CENTER[side]}
          y={UV_Y}
          kind="clean"
          io={transfer}
          active={transferring}
          name={sideIo("transfer_path", side)}
          label="Transfer"
          labelAnchor="middle"
          labelDx={0}
          labelDy={24}
        />
      </g>
    );
    return { body, transferPipe };
  };
  const trains = { A: train("A"), B: train("B") };

  const backup = io[IO.backupWater];
  const preBackup = io[IO.preBackupWater];
  const recycledToPump = supply.pumping && supply.source !== "backup";
  const backupToPump = supply.pumping && supply.source === "backup";
  const circulatingThroughUv = t3.circulating && supply.pumping;
  const backFlushing = io[IO.backFlush]?.on && supply.pumping;
  const backwash = {
    A: io[sideIo("diffuser_backwash", "A")],
    B: io[sideIo("diffuser_backwash", "B")],
  };
  const backwashing = {
    A: backwash.A?.on && supply.pumping,
    B: backwash.B?.on && supply.pumping,
  };
  // Water only leaves UV-C for T3 while something feeds the chamber and the
  // UV valve isn't closed.
  const t3ReceivingFromUv =
    (t3.receivingFrom.length > 0 || circulatingThroughUv) &&
    io[IO.uvValve]?.on !== false;
  const t3Fill = fillOf(tanks.t3);
  const outletKind: Kind = supply.source === "backup" ? "mains" : "clean";
  // UV-C passes on mains water only when circulation from T4 is its sole feed
  const uvOutletKind: Kind =
    t3.receivingFrom.length === 0 && circulatingThroughUv
      ? outletKind
      : "clean";
  const off = (connected: boolean | null) =>
    connected === false ? " is-disconnected" : "";

  return (
    <svg
      viewBox="0 -15 1000 840"
      className="hl-flow-diagram"
      role="group"
      aria-label="Water flow through the H600"
    >
      <defs>
        <pattern
          id="hl-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="6" className="hl-hatch-line" />
        </pattern>
      </defs>

      {/* Inlet and bypass */}
      <text x={60} y={inletY - 14} className="hl-diagram-label is-strong">
        Greywater from showers and baths
      </text>
      <Pipe
        d={`M60 ${inletY} H${bypassEnds.common}`}
        kind="grey"
        active={inlet.receiving.length > 0 || inlet.bypass}
        open={bypass?.on || (bypass?.on === false && selected !== undefined)}
        square
      />
      <Pipe
        d={`M500 ${bypassEnds.branches[0]} V${abEnds.common}`}
        kind="grey"
        active={inlet.receiving.length > 0}
        open={bypass?.on === false && selected !== undefined}
        square
      />
      <Pipe
        d={`M500 ${bypassEnds.branches[1]} V${sewerY} H${SEWER_END.right}`}
        kind="grey"
        active={inlet.bypass}
        open={bypass?.on}
        square
        arrow={{ x: SEWER_END.right, y: sewerY, dir: "right" }}
      />
      <Distributor
        x={500}
        y={inletY}
        tip="left"
        kind="grey"
        io={bypass}
        name={IO.bypass}
        label={bypassOverride ? "Bypass (user override)" : "Bypass"}
        strong={bypassOverride}
        words={["to the sewer", "to the trains"]}
        branches={[
          { open: bypass?.on, active: inlet.bypass === true },
          {
            open: bypass && !bypass.on,
            active: inlet.receiving.length > 0,
          },
        ]}
        labelAnchor="start"
        labelDx={14}
      />
      <text
        x={SEWER_END.right + SEWER_LABEL_DX}
        y={sewerY + 4}
        className="hl-diagram-label"
      >
        Sewer
      </text>

      {trains.A.body}
      {trains.B.body}

      <Distributor
        x={500}
        y={abY}
        kind="grey"
        io={ab}
        name={IO.abSelector}
        label="A/B valve"
        words={["to train B", "to train A"]}
        branches={[
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
        d={`M500 ${UV_Y + 17} V540`}
        kind={uvOutletKind}
        active={t3ReceivingFromUv}
        open={io[IO.uvValve]?.on}
        square
      />
      <g
        className={`hl-uv is-${t3.uv === undefined ? "unknown" : t3.uv ? "on" : "off"}`}
        tabIndex={0}
        role="img"
        aria-label={ioTitle("UV-C", IO.uvPower, io[IO.uvPower], ["on", "off"])}
      >
        <title suppressHydrationWarning>
          {ioTitle("UV-C", IO.uvPower, io[IO.uvPower], ["on", "off"])}
        </title>
        <rect x={460} y={UV_Y - 17} width={80} height={34} rx={6} />
        <text x={500} y={UV_Y + 5} textAnchor="middle">
          UV-C
        </text>
      </g>
      <Valve
        x={500}
        y={(UV_Y + 17 + 540) / 2}
        vertical
        kind={uvOutletKind}
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
        square
      />
      {/* Water from UV-C drips onto T3's surface */}
      <Drips
        x={500}
        y={540}
        bottom={t3Fill === undefined ? undefined : 640 - 100 * t3Fill}
        active={!!t3ReceivingFromUv}
        kind={uvOutletKind}
      />

      {/* T3 drain, out of T3's right side at its bottom, across from the
          pipe to the backup valve, straight out to the right like the T1
          drains */}
      <Pipe
        d={`M655 ${backupY} H${SEWER_END.right}`}
        kind="waste"
        active={t3.draining}
        open={io[IO.wasteStorageTank]?.on}
        square
        arrow={{ x: SEWER_END.right, y: backupY, dir: "right" }}
      />
      <Valve
        x={790}
        y={backupY}
        kind="waste"
        io={io[IO.wasteStorageTank]}
        active={t3.draining}
        name={IO.wasteStorageTank}
        label="T3 drain"
        labelAnchor="middle"
        labelDx={0}
        labelDy={-16}
      />
      <text
        x={SEWER_END.right + SEWER_LABEL_DX}
        y={backupY + 4}
        className="hl-diagram-label"
      >
        Sewer
      </text>

      {/* T4 backup */}
      {/* Mains water into T4, through the pre backup water valve. The pipe
          enters T4's top between the labels and the floats */}
      <Pipe
        d={`M${T4_X} ${MAINS_Y} H${T4_INLET_X} V540`}
        kind="mains"
        active={preBackup?.on}
        open={preBackup?.on}
        square
      />
      <Valve
        x={(T4_X + T4_INLET_X) / 2}
        y={MAINS_Y}
        kind="mains"
        io={preBackup}
        active={preBackup?.on}
        name={IO.preBackupWater}
        label="Mains"
        labelAnchor="middle"
        labelDx={0}
        labelDy={-16}
      />
      <BackupTank
        x={T4_X}
        y={540}
        w={130}
        h={100}
        state={state}
        inletX={T4_INLET_X}
        filling={preBackup?.on}
      />

      {/* Circulation: the distribution pump pushes T3 water (T4 water while
          the backup valve is set to T4) around the right of T3 into the top
          of UV. The T3 drain passes behind it, train B's transfer pipe in
          front of it. Along its top run, the backwash pipes branch off up
          into the center of each T2's bottom */}
      <path d={`M700 ${backupY - 4} V${backupY + 4}`} className="hl-pipe-gap" />
      <Pipe
        d={`M560 740 H700 V${RUN_Y} H${T2_CENTER.B}`}
        kind={outletKind}
        active={circulatingThroughUv || backwashing.A || backwashing.B}
        open={t3.circulating || backwash.A?.on || backwash.B?.on}
      />
      <Pipe
        d={`M${T2_CENTER.B} ${RUN_Y} H500`}
        kind={outletKind}
        active={circulatingThroughUv || backwashing.A}
        open={t3.circulating || backwash.A?.on}
      />
      <Pipe
        d={`M500 ${RUN_Y} V${UV_Y - 17}`}
        kind={outletKind}
        active={circulatingThroughUv}
        open={t3.circulating}
        square
      />
      {(["A", "B"] as Side[]).map((side) => {
        const a = side === "A";
        return (
          <g key={side}>
            <Pipe
              d={
                a
                  ? `M500 ${RUN_Y} H${T2_CENTER.A} V360`
                  : `M${T2_CENTER.B} ${RUN_Y} V360`
              }
              kind={outletKind}
              active={backwashing[side]}
              open={backwash[side]?.on}
              square
            />
            <Valve
              x={T2_CENTER[side]}
              y={(RUN_Y + 360) / 2}
              vertical
              kind={outletKind}
              io={backwash[side]}
              active={backwashing[side]}
              name={sideIo("diffuser_backwash", side)}
              label="Backwash"
              labelAnchor={a ? "end" : "start"}
              labelDx={a ? -16 : 16}
            />
          </g>
        );
      })}
      <Valve
        x={500}
        y={(RUN_Y + UV_Y - 17) / 2}
        vertical
        kind={outletKind}
        io={io[IO.circulation]}
        active={circulatingThroughUv}
        name={IO.circulation}
        label="Circulation"
        labelAnchor="end"
        labelDx={-14}
      />

      {/* Train B's transfer pipe passes in front of the circulation pipe */}
      <path d={`M696 ${UV_Y} H704`} className="hl-pipe-gap" />
      {trains.A.transferPipe}
      {trains.B.transferPipe}

      {/* T4 and T3 join in the backup valve, which feeds the distribution
          pump from one of them. The pipes leave the tanks' sides at their
          bottom */}
      <Pipe
        d={`M190 ${backupY} H${backupEnds.branches[0]}`}
        kind="mains"
        active={backupToPump}
        open={backup?.on}
        square
      />
      <Pipe
        d={`M346 ${backupY} H${backupEnds.branches[1]}`}
        kind="clean"
        active={recycledToPump}
        open={backup?.on === false}
        square
      />
      <Pipe
        d={`M260 ${backupEnds.common} V724`}
        kind={outletKind}
        active={supply.pumping}
        open={backup !== undefined}
        square
      />
      <Distributor
        x={260}
        y={backupY}
        tip="down"
        kind={outletKind}
        io={backup}
        name={IO.backupWater}
        label="Backup valve"
        words={["from T4", "from T3"]}
        branches={[
          { open: backup?.on, active: backupToPump === true },
          { open: backup && !backup.on, active: recycledToPump === true },
        ]}
        labelDy={-14}
      />

      <Pump
        x={260}
        y={740}
        r={16}
        kind={outletKind}
        io={io[IO.distributionPump]}
        name={IO.distributionPump}
        label="Distribution pump"
        labelAnchor="end"
      />

      {/* Back flush: the distribution pump pushes water back up into the
          center of T3's bottom */}
      <Pipe
        d="M500 740 V640"
        kind={outletKind}
        active={backFlushing}
        open={io[IO.backFlush]?.on}
        square
      />
      <Valve
        x={500}
        y={690}
        vertical
        kind={outletKind}
        io={io[IO.backFlush]}
        active={backFlushing}
        name={IO.backFlush}
        label="Back flush"
      />

      {/* Outlets, active by their demand sensor. The pipes to them are always
          pressurized, from T3 or T4, so they are open even without a reading */}
      <Pipe
        d="M276 740 H560"
        kind={outletKind}
        active={supply.toOutlets ?? false}
        open
      />
      <g className={`hl-outlet${off(device.outlets.toilet)}`}>
        <Pipe
          d="M360 740 V790"
          kind={outletKind}
          active={supply.toilet ?? false}
          open
          arrow={{ x: 360, y: 790, dir: "down" }}
        />
        <Sensor
          x={360}
          y={765}
          kind={outletKind}
          io={io[IO.toilet]}
          name={IO.toilet}
          label=""
        />
        <text x={360} y={815} textAnchor="middle" className="hl-diagram-label">
          Toilets
        </text>
      </g>
      <g className={`hl-outlet${off(device.outlets.washingMachine)}`}>
        <Pipe
          d="M460 740 V790"
          kind={outletKind}
          active={supply.wash ?? false}
          open
          arrow={{ x: 460, y: 790, dir: "down" }}
        />
        <Sensor
          x={460}
          y={765}
          kind={outletKind}
          io={io[IO.wash]}
          name={IO.wash}
          label=""
        />
        <text x={460} y={815} textAnchor="middle" className="hl-diagram-label">
          Washer
        </text>
      </g>
      <g className={`hl-outlet${off(device.outlets.auxiliary)}`}>
        <Pipe
          d="M560 740 V790"
          kind={outletKind}
          active={supply.auxiliary}
          open={io[IO.auxiliary]?.on}
          arrow={{ x: 560, y: 790, dir: "down" }}
        />
        <Valve
          x={560}
          y={765}
          vertical
          kind={outletKind}
          io={io[IO.auxiliary]}
          active={supply.auxiliary}
          name={IO.auxiliary}
          label=""
        />
        <text x={560} y={815} textAnchor="middle" className="hl-diagram-label">
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
    <ul className="hl-legend" aria-label="Legend">
      {items.map(([kind, text]) => (
        <li key={kind}>
          <span className={`hl-legend-swatch hl-kind-${kind}`} />
          {text}
        </li>
      ))}
      <li>
        <span className="hl-legend-swatch is-open" />
        Open, no flow
      </li>
      <li>
        <span className="hl-legend-swatch is-idle" />
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
    if (io[sideIo("diffuser_backwash", side)]?.on && supply.pumping) {
      flows.push(`Backwash → T2 ${side}`);
    }
  }
  if (t3.circulating && supply.pumping) flows.push("T3 → UV → T3");
  if (io[IO.backFlush]?.on && supply.pumping) flows.push("Back flush → T3");
  if (t3.draining) flows.push("T3 → drain");
  if (io[IO.preBackupWater]?.on) flows.push("Mains → T4");
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
    <p className="hl-flow-summary">
      <span className="hl-flow-summary-label">Water moving: </span>
      {flows.length ? flows.join(" · ") : "None"}
    </p>
  );
}
