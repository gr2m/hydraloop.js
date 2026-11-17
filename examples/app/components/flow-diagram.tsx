// Schematic of the H600: inlet, two treatment trains, UV, storage, backup
// and outlets. Pipes are colored and animated only while a routine, valve,
// pump or sensor signal shows water moving through them.

import {
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
  unknown = false,
  bridge = false,
  arrow,
  title,
}: {
  d: string;
  kind: Kind;
  active: boolean | undefined;
  unknown?: boolean;
  /** Draw a gap where this pipe crosses pipes drawn before it */
  bridge?: boolean;
  /** Draw an outlet arrow at this point, pointing in this direction */
  arrow?: { x: number; y: number; dir: "down" | "right" | "left" };
  /** Tooltip, for pipes without a valve or pump */
  title?: string;
}) {
  const state =
    unknown || active === undefined ? "unknown" : active ? "active" : "idle";
  return (
    <g className={`pipe kind-${kind} is-${state}`}>
      {title && <title>{title}</title>}
      {bridge && <path d={d} className="pipe-bridge" />}
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

function Valve({
  x,
  y,
  vertical = false,
  kind,
  io,
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
  name: string;
  label: string;
  labelAnchor?: "start" | "middle" | "end";
  labelDx?: number;
  labelDy?: number;
}) {
  const state = io === undefined ? "unknown" : io.on ? "open" : "closed";
  const s = 10;
  const points = vertical
    ? [
        `${x - 8},${y - s} ${x + 8},${y - s} ${x},${y}`,
        `${x - 8},${y + s} ${x + 8},${y + s} ${x},${y}`,
      ]
    : [
        `${x - s},${y - 8} ${x - s},${y + 8} ${x},${y}`,
        `${x + s},${y - 8} ${x + s},${y + 8} ${x},${y}`,
      ];
  const title = ioTitle(label || caption({}, name), name, io, [
    "open",
    "closed",
  ]);
  return (
    <g
      className={`valve kind-${kind} is-${state}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title suppressHydrationWarning>{title}</title>
      <rect x={x - 14} y={y - 14} width={28} height={28} className="hit" />
      <polygon points={points[0]} />
      <polygon points={points[1]} />
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

function Pump({
  x,
  y,
  r = 15,
  dir,
  kind,
  io,
  name,
  label,
  labelAnchor = "start",
  labelDx = 22,
}: {
  x: number;
  y: number;
  r?: number;
  dir: "up" | "down" | "right";
  kind: Kind;
  io: IoValue | undefined;
  name: string;
  label: string;
  labelAnchor?: "start" | "end";
  labelDx?: number;
}) {
  const state = io === undefined ? "unknown" : io.on ? "on" : "off";
  const t = r * 0.55;
  const triangle =
    dir === "up"
      ? `${x - t},${y + t * 0.6} ${x + t},${y + t * 0.6} ${x},${y - t}`
      : dir === "down"
        ? `${x - t},${y - t * 0.6} ${x + t},${y - t * 0.6} ${x},${y + t}`
        : `${x - t * 0.6},${y - t} ${x - t * 0.6},${y + t} ${x + t},${y}`;
  const title = ioTitle(label, name, io, ["running", "off"]);
  return (
    <g
      className={`pump kind-${kind} is-${state}`}
      tabIndex={0}
      role="img"
      aria-label={title}
    >
      <title suppressHydrationWarning>{title}</title>
      <circle cx={x} cy={y} r={r} />
      <polygon points={triangle} />
      <text
        x={x + (labelAnchor === "end" ? -labelDx : labelDx)}
        y={y + 4}
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
  aeration,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  level: TankLevel | undefined;
  kind: Kind;
  label: string;
  sub?: string;
  aeration?: boolean;
}) {
  const known = level?.pct !== undefined;
  const pct = level?.pct ?? 0;
  const trend = level?.trend;
  const arrow =
    trend === undefined || Math.abs(trend) < 0.3 ? "" : trend > 0 ? "↑" : "↓";
  const fillHeight = h * pct;
  const pressurized = level?.pressurized === true;
  const title = !known
    ? `${label}: no level data`
    : pressurized
      ? `${label} ${sub ?? ""}: reads ${Math.round(level!.liters!)} L, but the tank holds air pressure, which adds to the reading. The water is at most that.`
      : `${label} ${sub ?? ""}: ${Math.round(level!.liters!)} of ${Math.round(level!.max)} L (${Math.round(pct * 100)}%)${
          trend !== undefined
            ? `, ${trend >= 0 ? "+" : ""}${trend.toFixed(1)} L/min`
            : ""
        }`;
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
        rx={8}
        className={known ? "tank-shell" : "tank-shell is-unknown"}
      />
      {known && (
        <>
          <rect
            x={x + 1}
            y={y + h - fillHeight}
            width={w - 2}
            height={Math.max(0, fillHeight - 1)}
            rx={fillHeight > 8 ? 7 : 0}
            className="tank-fill"
          />
          <line
            x1={x + 1}
            x2={x + w - 1}
            y1={y + h - fillHeight}
            y2={y + h - fillHeight}
            className={pressurized ? "tank-surface is-dashed" : "tank-surface"}
          />
        </>
      )}
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={x + w - 8}
          x2={x + w}
          y1={y + h - h * f}
          y2={y + h - h * f}
          className="tank-tick"
        />
      ))}
      <Bubbles x={x} y={y} w={w} h={h} active={aeration} />
      <text x={x + 12} y={y + 22} className="tank-label">
        {label}
        {sub && (
          <tspan className="tank-sub" dx={6}>
            {sub}
          </tspan>
        )}
      </text>
      {known && (
        <>
          <text
            x={x + 12}
            y={y + h - (h > 100 ? 30 : 26)}
            className={pressurized ? "tank-value is-pressurized" : "tank-value"}
          >
            {pressurized && "≤ "}
            {Math.round(level!.liters!)} L{" "}
            {arrow && !pressurized && (
              <tspan className="tank-trend">{arrow}</tspan>
            )}
          </text>
          <text x={x + 12} y={y + h - 12} className="tank-meta">
            {pressurized
              ? "Pressurized"
              : `${Math.round(pct * 100)}% of ${Math.round(level!.max)} L`}
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

  const train = (side: Side) => {
    const a = side === "A";
    const t1x = a ? 85 : 785;
    const t2x = a ? 235 : 635;
    const t1c = t1x + 65;
    const t2c = t2x + 65;
    const transfer = io[sideIo("transfer_path", side)];
    const waste = io[sideIo("waste_clean_tank", side)];
    const air = io[sideIo("air_pump", side)];
    const bubbles = io[sideIo("bubbles_block", side)];
    const receiving = inlet.receiving.includes(side);
    const drainX = a ? 30 : 970;
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

        {/* Inlet, active during the INCOMING_WATER routine */}
        <Pipe
          d={a ? "M486 100 H150 V190" : "M514 100 H850 V190"}
          kind="grey"
          active={receiving}
        />

        {/* Air pump into T2 */}
        <Pipe d={`M${t2c} 151 V190`} kind="air" active={air?.on} />
        <Pump
          x={t2c}
          y={136}
          r={13}
          dir="down"
          kind="air"
          io={air}
          name={sideIo("air_pump", side)}
          label="Air"
          labelAnchor={a ? "start" : "end"}
          labelDx={20}
        />

        {/* Exchange from T2 into T1 */}
        <Pipe
          d={a ? "M235 340 H215" : "M765 340 H785"}
          kind="grey"
          active={state.trains[side].t2ToT1}
        />

        <Tank
          x={t1x}
          y={190}
          w={130}
          h={170}
          level={tanks[a ? "t1a" : "t1b"]}
          kind="grey"
          label="T1"
          sub={side}
          aeration={bubbles?.on}
        />
        <Tank
          x={t2x}
          y={190}
          w={130}
          h={170}
          level={tanks[a ? "t2a" : "t2b"]}
          kind="grey"
          label="T2"
          sub={side}
          aeration={air?.on}
        />

        {/* Skim overflow at the top of T1, down the drain line. It has no
            valve, so it is shown from the FILTH_REMOVAL routine. */}
        <Pipe
          d={a ? `M85 205 H${drainX} V410` : `M915 205 H${drainX} V410`}
          kind="waste"
          active={skimming}
          title={`Skim overflow of T1 ${side}${skimming ? ": filth spilling over to the drain (inferred from the FILTH_REMOVAL routine)" : ""}`}
        />
        <text
          x={a ? 57 : 943}
          y={300}
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
        />
        {/* Shared by the skim overflow and the waste valve */}
        <Pipe
          d={`M${drainX} 410 V470`}
          kind="waste"
          active={skimming || waste?.on}
          arrow={{ x: drainX, y: 470, dir: "down" }}
        />
        <Valve
          x={t1c}
          y={385}
          vertical
          kind="waste"
          io={waste}
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
          active={transfer?.on}
        />
        <Valve
          x={t2c}
          y={390}
          vertical
          kind="clean"
          io={transfer}
          name={sideIo("transfer_path", side)}
          label="Transfer"
          labelAnchor={a ? "start" : "end"}
          labelDx={a ? 16 : -16}
        />
      </g>
    );
  };

  const recycledToPump = supply.pumping && supply.source !== "backup";
  const backupToPump = supply.pumping && supply.source === "backup";
  const outletKind: Kind = supply.source === "backup" ? "mains" : "clean";
  const off = (connected: boolean | null) =>
    connected === false ? " is-disconnected" : "";

  return (
    <svg
      viewBox="0 0 1000 815"
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
      <text
        x={500}
        y={16}
        textAnchor="middle"
        className="diagram-label is-strong"
      >
        Greywater from showers and baths
      </text>
      <Pipe
        d="M500 26 V90"
        kind="grey"
        active={inlet.receiving.length > 0 || inlet.bypass}
      />
      <Pipe
        d="M500 58 H935"
        kind="grey"
        active={inlet.bypass}
        arrow={{ x: 935, y: 58, dir: "right" }}
      />
      <Valve
        x={700}
        y={58}
        kind="grey"
        io={io[IO.bypass]}
        name={IO.bypass}
        label="Bypass"
        labelAnchor="middle"
        labelDx={0}
        labelDy={-16}
      />
      <text x={948} y={62} className="diagram-label">
        Sewer
      </text>

      {train("A")}
      {train("B")}

      {/* The A/B valve does not follow incoming water, so it is shown
          without a direction */}
      <Valve
        x={500}
        y={100}
        kind="grey"
        io={io[IO.abSelector]}
        name={IO.abSelector}
        label="A/B valve"
        labelAnchor="middle"
        labelDx={0}
        labelDy={30}
      />

      {/* UV and into T3 */}
      <Pipe
        d="M500 474 V530"
        kind="clean"
        active={t3.receivingFrom.length > 0 || t3.circulating}
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
        name={IO.uvValve}
        label="UV valve"
      />

      <Tank
        x={330}
        y={530}
        w={340}
        h={110}
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
        arrow={{ x: 970, y: 735, dir: "down" }}
      />
      <Valve
        x={790}
        y={680}
        kind="waste"
        io={io[IO.wasteStorageTank]}
        name={IO.wasteStorageTank}
        label="T3 drain"
        labelAnchor="middle"
        labelDx={0}
        labelDy={-16}
      />
      <text x={970} y={763} textAnchor="middle" className="diagram-label">
        Drain
      </text>

      {/* T4 backup, filled from mains through an air gap */}
      <Pipe d="M115 470 V522" kind="mains" active={undefined} unknown />
      <text x={127} y={486} className="diagram-label">
        Mains
      </text>
      <text x={127} y={502} className="diagram-label is-muted">
        air gap
      </text>
      <BackupTank x={60} y={540} w={130} h={100} state={state} />
      <Pipe d="M115 640 V680 H250" kind="mains" active={backupToPump} />
      <Valve
        x={185}
        y={680}
        kind="mains"
        io={io[IO.backupWater]}
        name={IO.backupWater}
        label="Backup"
        labelAnchor="middle"
        labelDx={0}
        labelDy={-16}
      />

      {/* T3 to the distribution pump */}
      <Pipe d="M360 640 V680 H270" kind="clean" active={recycledToPump} />
      <Pipe d="M260 680 V704" kind={outletKind} active={supply.pumping} />

      {/* Circulation: the distribution pump pushes T3 water through UV */}
      <Pipe
        d="M276 720 H312 V465 H460"
        kind="clean"
        active={t3.circulating && supply.pumping}
        bridge
      />
      <Valve
        x={312}
        y={590}
        vertical
        kind="clean"
        io={io[IO.circulation]}
        name={IO.circulation}
        label="Circulation"
        labelAnchor="end"
        labelDx={-14}
      />

      <Pump
        x={260}
        y={720}
        r={16}
        dir="down"
        kind={outletKind}
        io={io[IO.distributionPump]}
        name={IO.distributionPump}
        label="Distribution"
        labelAnchor="end"
        labelDx={24}
      />

      {/* Outlets, active by their demand sensor */}
      <Pipe d="M260 736 V760" kind={outletKind} active={supply.toOutlets} />
      <Pipe d="M150 760 H360" kind={outletKind} active={supply.toOutlets} />
      <g className={`outlet${off(device.outlets.toilet)}`}>
        <Pipe
          d="M150 760 V782"
          kind={outletKind}
          active={supply.toilet}
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
          active={supply.wash}
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
          arrow={{ x: 440, y: 782, dir: "down" }}
        />
        <Valve
          x={395}
          y={760}
          kind={outletKind}
          io={io[IO.auxiliary]}
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
    ["waste", "To drain"],
    ["air", "Air"],
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
        <span className="legend-swatch is-idle" />
        No flow
      </li>
      <li>
        <span className="legend-swatch is-unknown" />
        Not measured
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
