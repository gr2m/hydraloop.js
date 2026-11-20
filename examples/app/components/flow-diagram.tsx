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
      : filled
        ? "filled"
        : active
          ? "active"
          : open
            ? "open"
            : "idle";
  return (
    <g
      className={`pipe kind-${kind} is-${state}${still ? " is-still" : ""}${square ? " is-square" : ""}`}
    >
      {title && <title>{title}</title>}
      <path d={d} className="pipe-base" />
      {state === "filled" && <path d={d} className="pipe-water" />}
      {active && <path d={d} className="pipe-flow" />}
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

type Branch = {
  /** undefined while the valve state is unknown */
  open: boolean | undefined;
  /** Water is moving through this branch */
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
      className={`distributor kind-${kind}`}
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

/** Drops of water falling inside a tank from `y` onto its surface */
function Drips({
  x,
  y,
  bottom,
  active,
}: {
  x: number;
  y: number;
  /** The water's surface */
  bottom: number | undefined;
  active: boolean;
}) {
  if (!active || bottom === undefined || bottom - y < 4) return null;
  return (
    <g className="drips kind-grey" aria-hidden>
      {[0, 0.3, 0.6].map((delay) => (
        <circle
          key={delay}
          cx={x}
          cy={y}
          r={1.6}
          style={{
            animationDelay: `${delay}s`,
            ["--fall" as string]: `${bottom - y}px`,
          }}
        />
      ))}
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
  pressurized,
  pressureHeld = false,
  venting,
  small,
  square = false,
  base = 0,
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
  /** The air is no longer pumped in, but holds its pressure: the rings stand still */
  pressureHeld?: boolean;
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
  const clipId = `pressure-${label}-${side ?? sub ?? ""}`;
  const ringX = venting ?? x + w / 2;
  // Enough rings to reach the far corners of the space above the water
  const rings =
    Math.ceil(
      Math.hypot(Math.max(ringX - x, x + w - ringX), h - fillHeight) / 14,
    ) + 1;
  // Venting rings vanish where the pipe's dashes start, at its beginning
  const phase =
    venting === undefined && pressurized
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
        rx={square ? 0 : 5}
        className={known ? "tank-shell" : "tank-shell is-unknown"}
      />
      {known && (
        <>
          <rect
            x={x + 1}
            y={y + h - fillHeight}
            width={w - 2}
            height={Math.max(0, fillHeight - 1)}
            rx={!square && fillHeight > 8 ? 4 : 0}
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
          y1={y + h - base - (h - base) * f}
          y2={y + h - base - (h - base) * f}
          className="tank-tick"
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
            className={`pressure${venting !== undefined ? " is-venting" : pressureHeld ? " is-held" : ""}`}
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
                className="pressure-fill"
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
  // The backup valve lines up with the bottom of T3 and T4
  const backupY = 640 - PIPE;
  const backupEnds = distributorEnds(260, backupY, "down");

  const train = (side: Side) => {
    const a = side === "A";
    // Tank areas are to scale: T1 ~24 L, T2 ~200 L, T3 ~280 L (TANK_CAPACITY),
    // except that T1 reaches further down, to fit the transfer pipe on its side
    const t1x = a ? 140 : 839;
    const t2x = a ? 214 : 614;
    const t1c = t1x + 10;
    const t1Bottom = 384;
    const t2c = t2x + 86;
    const transfer = io[sideIo("transfer_path", side)];
    const waste = io[sideIo("waste_clean_tank", side)];
    const air = io[sideIo("air_pump", side)];
    const airTop = 151;
    const addAir = io[sideIo("add_air_valve", side)];
    const addAirY = airTop + 3 * 14;
    // Air only reaches T2 while the add air valve isn't closed
    const addingAir = air?.on && addAir?.on !== false;
    // After air was added, T2 holds the pressure until the release air valve
    // opens. Its pattern stays, standing still
    const holdingAir = !addingAir && state.trains[side].pressurized;
    // The release air pipe leaves T2's top on the inner side and ends level
    // with the air pump's center, open to the room
    const release = io[sideIo("release_air", side)];
    const releaseX = a ? t2x + 172 - 14 : t2x + 14;
    // The air pipe into T1 branches off above the add air valve, runs down
    // between T1 and T2, and enters T1's bottom from below, next to the waste
    // pipe. The waste pipe leaves T1's bottom on the outer side
    const teeY = 166;
    const airX = a ? t1x + 21 - 5 : t1x + 5;
    const wasteX = a ? t1x + 5.5 : t1x + 21 - 5.5;
    const wasteY = t1Bottom + 20;
    // Below T1, the air pipe's lower edge lines up with the waste pipe's
    // (5 px air pipe, 7 px waste pipe)
    const airBelowY = wasteY + PIPE - 2.5;
    const gapX = a ? (t1x + 21 + t2x) / 2 : (t2x + 172 + t1x) / 2;
    const bubbles = io[sideIo("bubbles_block", side)];
    // The bubbles block valve closes while its signal is on, blocking the air
    // into T1. HDM shows it open while the signal is off
    const bubblesValve = bubbles && { ...bubbles, on: !bubbles.on };
    // The valve sits a multiple of 14 px from the tee, as the add air valve
    // does. Air only reaches T1 while it isn't closed
    const bubblesX = a ? t2c - 4 * 14 : t2c + 4 * 14;
    const bubbling = air?.on && bubblesValve?.on !== false;
    const receiving = inlet.receiving.includes(side);
    const drainX = a ? 30 : 970;
    const transferring = transfer?.on;
    const skimming = state.trains[side].skimming;
    const t2Level = tanks[a ? "t2a" : "t2b"];
    const t2Fill = fillOf(t2Level);
    const t1Fill = fillOf(tanks[a ? "t1a" : "t1b"]);
    // T1's percentage starts at T2's bottom, so equal percentages line up.
    // The water below it is always there
    const t1Surface =
      t1Fill === undefined ? undefined : 360 - (360 - 232) * t1Fill;
    // Two pipes connect T1 and T2: one whose upper edge is at T1's 40% water
    // level, so the bubbles circulate water from that level up, and one whose
    // bottom edge meets T2's lower corner (7 px pipe, 5 px corner radius)
    const exchangeYs = [360 - (360 - 232) * 0.4 + PIPE, 360 - 5 - PIPE];
    /** An exchange pipe at `y` holds water */
    const exchangeFilled = (y: number) =>
      (t1Surface !== undefined && t1Surface <= y - PIPE + 1e-6) ||
      (t2Fill !== undefined && 360 - 128 * t2Fill <= y - PIPE);
    const upperFilled = exchangeFilled(exchangeYs[0]);
    // The transfer pipe leaves T1 towards T2, halfway between the lower
    // exchange pipe and T1's bottom. It crosses the air pipe, passes below T2
    // and turns down into UV-C. Its valve is centered between T2's inner edge
    // and UV-C's center
    const transferY = (exchangeYs[1] + PIPE + t1Bottom) / 2;
    const transferValveX = ((a ? t2x + 172 : t2x) + 500) / 2;
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
              ? `M${abEnds.branches[0]} 100 H${t1c} V232`
              : `M${abEnds.branches[1]} 100 H${t1c} V232`
          }
          kind="grey"
          active={receiving}
          open={selected === side}
          square
        />

        {/* Air pump into T2, through the add air valve. The valve sits a
            multiple of 14 px down the pipe, so the dashes of both parts line
            up, see .pipe-flow */}
        <Pipe d={`M${t2c} ${teeY} H${bubblesX}`} kind="air" active={air?.on} />
        <Pipe
          d={`M${bubblesX} ${teeY} H${gapX} V${airBelowY} H${airX} V${t1Bottom}`}
          kind="air"
          active={bubbling}
          open={bubblesValve?.on}
        />
        <Valve
          x={bubblesX}
          y={teeY}
          kind="air"
          io={bubblesValve}
          active={bubbling}
          name={sideIo("bubbles_block", side)}
          label="Bubbles block"
          labelAnchor={a ? "start" : "end"}
          labelDx={gapX + (a ? 10 : -10) - bubblesX}
          labelDy={-14}
        />
        <Pipe d={`M${t2c} ${airTop} V${addAirY}`} kind="air" active={air?.on} />
        <Pipe
          d={`M${t2c} ${addAirY} V232`}
          kind="air"
          active={addingAir || holdingAir}
          still={holdingAir}
          open={addAir?.on}
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
          labelAnchor={a ? "start" : "end"}
          labelDx={a ? 16 : -16}
        />
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
        {release?.on && (
          // The air leaves the pipe's open end as circles that fade out at
          // the size of the air pump. A circle starts where the pipe's dashes
          // leave off, 96 px up the pipe, see the rings in Tank
          <circle
            cx={releaseX}
            cy={136}
            r={14}
            className="vent-ring"
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
          const t1End = a ? t1x + 21 : t1x;
          const t2End = a ? t2x : t2x + 172;
          const filled = exchangeFilled(y);
          return (
            <g key={y}>
              {/* A gap in the air pipe into T1, which passes behind */}
              <path d={`M${gapX - 4} ${y} H${gapX + 4}`} className="pipe-gap" />
              <Pipe
                d={
                  i === 0
                    ? `M${t1End} ${y} H${t2End}`
                    : `M${t2End} ${y} H${t1End}`
                }
                kind="grey"
                active={filled && bubbling === true}
                filled={filled}
              />
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
          pressurized={(addingAir || holdingAir) && 232 - addAirY}
          pressureHeld={holdingAir}
          venting={release?.on ? releaseX : undefined}
        />
        {/* While water circulates and T2's surface is below the upper
            exchange pipe, it drips from the pipe down T2's outer wall */}
        <Drips
          x={a ? t2x + 4 : t2x + 172 - 4}
          y={exchangeYs[0] + PIPE}
          bottom={t2Fill === undefined ? undefined : 360 - 128 * t2Fill}
          active={bubbling === true && upperFilled}
        />

        {/* Skim overflow at the top of T1, down the drain line. It has no
            valve, so it is shown from the FILTH_REMOVAL routine. */}
        <Pipe
          d={
            a
              ? `M140 237 H${drainX} V${wasteY}`
              : `M860 237 H${drainX} V${wasteY}`
          }
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

        {/* Waste valve into the drain line, out of T1's bottom */}
        <Pipe
          d={`M${wasteX} ${t1Bottom} V${wasteY} H${drainX}`}
          kind="waste"
          active={waste?.on}
          open={waste?.on}
        />
        {/* Shared by the skim overflow and the waste valve */}
        <Pipe
          d={`M${drainX} ${wasteY} V470`}
          kind="waste"
          active={skimming || waste?.on}
          open={waste?.on}
          arrow={{ x: drainX, y: 470, dir: "down" }}
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
        <text x={drainX} y={498} textAnchor="middle" className="diagram-label">
          Drain
        </text>

        {/* Transfer from T1 through UV into T3. The air pipe into T1 passes
            behind it */}
        <path
          d={`M${gapX - 4} ${transferY} H${gapX + 4}`}
          className="pipe-gap"
        />
        <Pipe
          d={`M${a ? t1x + 21 : t1x} ${transferY} H${a ? 488 : 512} V440`}
          kind="clean"
          active={transferring}
          open={transferring}
        />
        <Valve
          x={transferValveX}
          y={transferY}
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
  };

  const backup = io[IO.backupWater];
  const recycledToPump = supply.pumping && supply.source !== "backup";
  const backupToPump = supply.pumping && supply.source === "backup";
  const circulatingThroughUv = t3.circulating && supply.pumping;
  const backFlushing = io[IO.backFlush]?.on && supply.pumping;
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
      viewBox="0 -38 1000 863"
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
        d={`M60 24 H${bypassEnds.common}`}
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
        d={`M500 ${bypassEnds.branches[1]} V-22 H935`}
        kind="grey"
        active={inlet.bypass}
        open={bypass?.on}
        square
        arrow={{ x: 935, y: -22, dir: "right" }}
      />
      <Distributor
        x={500}
        y={24}
        tip="left"
        kind="grey"
        io={bypass}
        name={IO.bypass}
        label="Bypass"
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
        square
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

      {/* Circulation: the distribution pump pushes T3 water around the right
          of T3 through UV. The T3 drain passes behind it */}
      <path d="M690 676 V684" className="pipe-gap" />
      <Pipe
        d="M560 740 H690 V465 H540"
        kind="clean"
        active={circulatingThroughUv}
        open={t3.circulating}
      />
      <Valve
        x={690}
        y={590}
        vertical
        kind="clean"
        io={io[IO.circulation]}
        active={circulatingThroughUv}
        name={IO.circulation}
        label="Circulation"
      />

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
      <g className={`outlet${off(device.outlets.toilet)}`}>
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
        <text x={360} y={815} textAnchor="middle" className="diagram-label">
          Toilets
        </text>
      </g>
      <g className={`outlet${off(device.outlets.washingMachine)}`}>
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
        <text x={460} y={815} textAnchor="middle" className="diagram-label">
          Washer
        </text>
      </g>
      <g className={`outlet${off(device.outlets.auxiliary)}`}>
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
        <text x={560} y={815} textAnchor="middle" className="diagram-label">
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
  if (io[IO.backFlush]?.on && supply.pumping) flows.push("Back flush → T3");
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
