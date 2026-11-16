// Shared data model for the dashboard. Used on the server (to normalize API
// responses) and in the browser (to derive the state at a point in time).
//
// The phase of each train comes from the routine that HDM reports for its
// side (e.g. `INCOMING_WATER`, `TRANSFER`). Where no routine is known, it
// falls back to valve signals. Each state says how it was determined.

export type Side = "A" | "B";
export type RoutineSide = Side | "SYSTEM";
export type TankId = "t1a" | "t2a" | "t1b" | "t2b" | "t3";

export const TANK_IDS: TankId[] = ["t1a", "t2a", "t1b", "t2b", "t3"];

/** Graph line names of `hydraloop.local.graph.getData()` per tank */
export const TANK_LINES: Record<TankId, string> = {
  t1a: "tank1",
  t2a: "tank2",
  t1b: "tank1_b",
  t2b: "tank2_b",
  t3: "tank3",
};

export const TANK_LABELS: Record<TankId, string> = {
  t1a: "T1 A",
  t2a: "T2 A",
  t1b: "T1 B",
  t2b: "T2 B",
  t3: "T3",
};

/**
 * IO names as returned by `hydraloop.local.graph.getIo()`. B-side IOs of the
 * H600 have a `_b` suffix. The roles were derived by correlating the signals
 * with each other and with the routines of an H600 (firmware 9.24).
 */
export const IO = {
  /** Sends incoming greywater to the sewer while on */
  bypass: "grey_water_bypass",
  /** Switched twice a day with `back_flush`, not by incoming water */
  abSelector: "grey_water_ab_selection_valve",
  uvValve: "uv_valve",
  uvPower: "uv_power",
  auxiliary: "auxiliary",
  /** Outlets are supplied from T4 while on (stays on for hours) */
  backupWater: "backup_water",
  preBackupWater: "pre_backup_water_valve",
  backFlush: "back_flush",
  /** Drains T3 */
  wasteStorageTank: "waste_storage_tank",
  distributionPump: "distribution_pump",
  /** A valve, despite its name: routes the distribution pump back through UV into T3 */
  circulation: "circulation_pump",
  /** Demand sensors of the outlets */
  toilet: "toilet",
  wash: "wash",
  /** Float sensors of T4 */
  t4Max: "tank4",
  t4Min: "tank4_enough_water",
} as const;

export function sideIo(name: string, side: Side) {
  return side === "A" ? name : `${name}_b`;
}

/** A value at a time. `t` is milliseconds since epoch. */
export type Point = { t: number; v: number };

export type RoutineEvent = {
  t: number;
  side: RoutineSide;
  routine: number;
  name: string;
  state: string;
};

export type DeviceInfo = {
  id: string;
  name: string;
  serial: string | null;
  type: string | null;
  firmware: string | null;
  online: boolean | null;
  /** Which outlets are connected, from the device configuration */
  outlets: {
    toilet: boolean | null;
    washingMachine: boolean | null;
    auxiliary: boolean | null;
  };
};

/** Normalized data of a time range, for both the live and history views */
export type Dataset = {
  device: DeviceInfo;
  demo: boolean;
  from: number;
  until: number;
  fetchedAt: number;
  /** Tank levels in liters (converted with the device's calibration tables) */
  tanks: Record<TankId, Point[]>;
  /** Capacity in liters, the last entry of the calibration table */
  tankMax: Record<TankId, number>;
  /** IO values by IO name, one point per change, sorted by time */
  io: Record<string, Point[]>;
  /** Human readable IO names from the graph config */
  captions: Record<string, string>;
  /** Routine changes, sorted by time. Includes the last one before `from`. */
  routines: RoutineEvent[];
  /** Data that could not be loaded */
  warnings: string[];
};

// ── Conversion and labels ──────────────────────────────────────────────────

export type LevelTable = { p: number; l: number }[];

/** Pressure points to liters, interpolated linearly between table entries */
export function pressureToLiters(p: number, table: LevelTable): number {
  if (table.length === 0) return NaN;
  if (p <= table[0].p) return table[0].l;
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1];
    const b = table[i];
    if (p <= b.p) {
      return b.p === a.p ? b.l : a.l + ((p - a.p) / (b.p - a.p)) * (b.l - a.l);
    }
  }
  return table[table.length - 1].l;
}

export function routineSide(side: string | null | undefined): RoutineSide {
  const s = (side ?? "").trim().toUpperCase();
  if (s === "A" || s.endsWith("_A")) return "A";
  if (s === "B" || s.endsWith("_B")) return "B";
  return "SYSTEM";
}

/** `PASSIVE_CIRCULATE` → `Passive circulate` */
export function humanize(text: string) {
  const words = text.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const IO_LABELS: Record<string, string> = {
  [IO.bypass]: "Bypass",
  [IO.abSelector]: "A/B valve",
  [IO.uvValve]: "UV valve",
  [IO.uvPower]: "UV-C",
  [IO.backupWater]: "Backup water",
  [IO.preBackupWater]: "Pre backup water valve",
  [IO.wasteStorageTank]: "T3 drain",
  [IO.circulation]: "Circulation valve",
  [IO.distributionPump]: "Distribution pump",
  [IO.toilet]: "Toilet demand",
  [IO.wash]: "Washer demand",
  [IO.t4Max]: "T4 max float",
  [IO.t4Min]: "T4 min float",
  transfer_path: "Transfer A",
  transfer_path_b: "Transfer B",
  waste_clean_tank: "Waste A",
  waste_clean_tank_b: "Waste B",
};

export function caption(captions: Record<string, string>, name: string) {
  if (IO_LABELS[name]) return IO_LABELS[name];
  // The graph config captions are often just the IO name
  const text =
    captions[name] && captions[name] !== name ? captions[name] : name;
  const label = humanize(text.replace(/_b$/, ""));
  return /_b$/.test(text) ? `${label} B` : label;
}

// ── Lookups ────────────────────────────────────────────────────────────────

/** Index of the last point at or before `t`, or -1 */
function indexAt(points: { t: number }[], t: number) {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Step value: the last known value at or before `t` */
export function stepAt(points: Point[] | undefined, t: number) {
  if (!points?.length) return undefined;
  const i = indexAt(points, t);
  return i === -1 ? undefined : points[i];
}

/** Linearly interpolated value at `t`, undefined outside of the data */
export function valueAt(points: Point[] | undefined, t: number) {
  if (!points?.length) return undefined;
  const i = indexAt(points, t);
  if (i === -1) return undefined;
  const a = points[i];
  const b = points[i + 1];
  // Don't interpolate across gaps in the data
  if (!b) return t - a.t <= 10 * 60_000 ? a.v : undefined;
  if (b.t - a.t > 30 * 60_000) return t - a.t <= 10 * 60_000 ? a.v : undefined;
  return a.v + ((t - a.t) / (b.t - a.t)) * (b.v - a.v);
}

/** When the IO last changed its on/off state at or before `t` */
function onSince(points: Point[], t: number) {
  let i = indexAt(points, t);
  if (i === -1) return undefined;
  const on = points[i].v > 0;
  while (i > 0 && points[i - 1].v > 0 === on) i--;
  return points[i].t;
}

// ── Phases ─────────────────────────────────────────────────────────────────

export type Confidence = "reported" | "valve" | "inferred" | "unknown";

export type TrainPhase =
  | "cleaning"
  | "transferring"
  | "receiving"
  | "treating"
  | "idle"
  | "other"
  | "unknown";

/** HDM routine names per phase, as reported by `getRoutineData()` */
const ROUTINE_PHASES: Record<string, TrainPhase> = {
  STANDBY: "idle",
  INCOMING_WATER: "receiving",
  SKIM_LEVEL_DETERMINATION: "treating",
  FILTH_REMOVAL: "cleaning",
  TRANSFER: "transferring",
};

export function routinePhase(name: string): TrainPhase {
  if (ROUTINE_PHASES[name]) return ROUTINE_PHASES[name];
  const text = name.toLowerCase();
  if (/clean|filth|flush|waste|purge|drain/.test(text)) return "cleaning";
  if (/transfer/.test(text)) return "transferring";
  if (/incoming|fill|collect|intake|inlet/.test(text)) return "receiving";
  if (/skim|treat|aerat|bio/.test(text)) return "treating";
  if (/standby|idle|wait|passive/.test(text)) return "idle";
  return "other";
}

const PHASE_LABELS: Record<TrainPhase, string> = {
  cleaning: "Self-cleaning",
  transferring: "Transferring to T3",
  receiving: "Receiving greywater",
  treating: "Treating",
  idle: "Standby",
  other: "Other",
  unknown: "Unknown",
};

// ── State at a point in time ───────────────────────────────────────────────

export type IoValue = { on: boolean; value: number; since: number | undefined };

export type TankLevel = {
  liters: number | undefined;
  max: number;
  pct: number | undefined;
  /** Liters per minute over the previous 10 minutes */
  trend: number | undefined;
};

export type TrainState = {
  side: Side;
  phase: TrainPhase;
  /** HDM routine name, or a phase label when there is no routine */
  label: string;
  /** HDM routine sub-state */
  detail: string | undefined;
  confidence: Confidence;
  since: number | undefined;
  evidence: string[];
  lastIncoming: number | undefined;
  lastTransfer: number | undefined;
  /** Water flows from T2 into T1, inferred from a falling T2 level */
  t2ToT1: boolean;
};

export type T3State = {
  label: string;
  confidence: Confidence;
  evidence: string[];
  receivingFrom: Side[];
  uv: boolean | undefined;
  circulating: boolean | undefined;
  draining: boolean | undefined;
};

export type SupplyState = {
  pumping: boolean | undefined;
  /** Water goes to the outlets, not around the circulation loop */
  toOutlets: boolean | undefined;
  source: "recycled" | "backup" | "unknown";
  toilet: boolean | undefined;
  wash: boolean | undefined;
  auxiliary: boolean | undefined;
};

export type T4State = {
  max: boolean | undefined;
  min: boolean | undefined;
  label: string;
};

export type InletState = {
  bypass: boolean | undefined;
  receiving: Side[];
};

export type DeviceState = {
  t: number;
  tanks: Record<TankId, TankLevel>;
  io: Record<string, IoValue | undefined>;
  routine: Partial<Record<RoutineSide, RoutineEvent>>;
  inlet: InletState;
  trains: Record<Side, TrainState>;
  t3: T3State;
  t4: T4State;
  supply: SupplyState;
};

const TREND_WINDOW = 10 * 60_000;

/** The current routine of a side and when it started (first sub-state) */
function routineAt(ds: Dataset, side: RoutineSide, t: number) {
  let current: RoutineEvent | undefined;
  let start: number | undefined;
  let lastIncoming: number | undefined;
  let lastTransfer: number | undefined;
  for (const r of ds.routines) {
    if (r.t > t) break;
    if (r.side !== side) continue;
    if (!current || current.name !== r.name) {
      start = r.t;
      if (r.name === "INCOMING_WATER") lastIncoming = r.t;
      if (r.name === "TRANSFER") lastTransfer = r.t;
    }
    current = r;
  }
  return { current, start, lastIncoming, lastTransfer };
}

export function stateAt(ds: Dataset, t: number): DeviceState {
  const tanks = {} as Record<TankId, TankLevel>;
  for (const id of TANK_IDS) {
    const liters = valueAt(ds.tanks[id], t);
    const before = valueAt(ds.tanks[id], t - TREND_WINDOW);
    const max = ds.tankMax[id];
    tanks[id] = {
      liters,
      max,
      pct:
        liters === undefined || !max
          ? undefined
          : Math.max(0, Math.min(1, liters / max)),
      trend:
        liters === undefined || before === undefined
          ? undefined
          : (liters - before) / (TREND_WINDOW / 60_000),
    };
  }

  const io: Record<string, IoValue | undefined> = {};
  for (const [name, points] of Object.entries(ds.io)) {
    const p = stepAt(points, t);
    io[name] = p && { on: p.v > 0, value: p.v, since: onSince(points, t) };
  }
  const on = (name: string) => io[name]?.on;

  const routine: Partial<Record<RoutineSide, RoutineEvent>> = {};

  const train = (side: Side): TrainState => {
    const { current, start, lastIncoming, lastTransfer } = routineAt(
      ds,
      side,
      t,
    );
    if (current) routine[side] = current;
    const waste = io[sideIo("waste_clean_tank", side)];
    const transfer = io[sideIo("transfer_path", side)];
    const air = io[sideIo("air_pump", side)];
    const bubbles = io[sideIo("bubbles_block", side)];
    const evidence = [
      transfer?.on && "Transfer valve open",
      waste?.on && "Waste valve open",
      air?.on && "Air pump running",
      bubbles?.on && "Bubble block on",
    ].filter((e): e is string => Boolean(e));
    // T2 drains through T1 while T1 is emptied to the drain or into T3
    const t2Trend = tanks[side === "A" ? "t2a" : "t2b"].trend;
    const t2ToT1 =
      Boolean(waste?.on || transfer?.on) &&
      t2Trend !== undefined &&
      t2Trend <= -0.5;
    const base = { side, lastIncoming, lastTransfer, evidence, t2ToT1 };

    const routineText = current
      ? [humanize(current.name), current.state && humanize(current.state)]
          .filter(Boolean)
          .join(" · ")
      : undefined;

    // An open waste or transfer valve moves water, whatever the routine is
    if (waste?.on || transfer?.on) {
      const draining = Boolean(waste?.on);
      return {
        ...base,
        phase: draining ? "cleaning" : "transferring",
        label: draining ? "Draining to waste" : PHASE_LABELS.transferring,
        detail: routineText && `HDM routine: ${routineText}`,
        confidence: "valve",
        since: (draining ? waste : transfer)?.since,
      };
    }
    if (current) {
      return {
        ...base,
        phase: routinePhase(current.name),
        label: humanize(current.name),
        detail: current.state ? humanize(current.state) : undefined,
        confidence: "reported",
        since: start,
      };
    }
    if (!waste && !transfer) {
      return {
        ...base,
        phase: "unknown",
        label: PHASE_LABELS.unknown,
        detail: undefined,
        confidence: "unknown",
        since: undefined,
      };
    }
    return {
      ...base,
      phase: air?.on ? "treating" : "idle",
      label: PHASE_LABELS[air?.on ? "treating" : "idle"],
      detail: undefined,
      confidence: "inferred",
      since: undefined,
    };
  };

  const trains = { A: train("A"), B: train("B") };
  const system = routineAt(ds, "SYSTEM", t).current;
  if (system) routine.SYSTEM = system;

  const receivingFrom = (["A", "B"] as Side[]).filter(
    (s) => io[sideIo("transfer_path", s)]?.on,
  );
  const uv = on(IO.uvPower);
  const circulating = on(IO.circulation);
  const draining = on(IO.wasteStorageTank);
  const t3Base = { receivingFrom, uv, circulating, draining };
  let t3: T3State;
  if (draining) {
    t3 = {
      ...t3Base,
      label: "Draining",
      confidence: "valve",
      evidence: ["T3 drain valve open"],
    };
  } else if (receivingFrom.length) {
    t3 = {
      ...t3Base,
      label: `Receiving from ${receivingFrom.join(" and ")}`,
      confidence: "valve",
      evidence: receivingFrom.map((s) => `Transfer ${s} open`),
    };
  } else if (circulating) {
    t3 = {
      ...t3Base,
      label: "Circulating through UV",
      confidence: "valve",
      evidence: ["Circulation valve open", ...(uv ? ["UV on"] : [])],
    };
  } else {
    t3 = {
      ...t3Base,
      label: "Holding",
      confidence: io[IO.circulation] ? "valve" : "unknown",
      evidence: [],
    };
  }

  const backup = on(IO.backupWater);
  const pumping = on(IO.distributionPump);
  const supply: SupplyState = {
    pumping,
    toOutlets: pumping === undefined ? undefined : pumping && !circulating,
    source: backup === undefined ? "unknown" : backup ? "backup" : "recycled",
    toilet: on(IO.toilet),
    wash: on(IO.wash),
    auxiliary: on(IO.auxiliary),
  };

  const t4Max = on(IO.t4Max);
  const t4Min = on(IO.t4Min);
  const t4: T4State = {
    max: t4Max,
    min: t4Min,
    label:
      t4Max === undefined && t4Min === undefined
        ? "No float data"
        : t4Max
          ? "Full"
          : t4Min
            ? "Above min"
            : "Below min",
  };

  const inlet: InletState = {
    bypass: on(IO.bypass),
    receiving: (["A", "B"] as Side[]).filter(
      (s) => trains[s].phase === "receiving",
    ),
  };

  return { t, tanks, io, routine, inlet, trains, t3, t4, supply };
}

/** Time of the latest tank reading */
export function latestSample(ds: Dataset) {
  let latest = 0;
  for (const id of TANK_IDS) {
    const points = ds.tanks[id];
    if (points.length) latest = Math.max(latest, points[points.length - 1].t);
  }
  return latest || undefined;
}

// ── Intervals and events ───────────────────────────────────────────────────

export type Interval = {
  start: number;
  end: number;
  /** Still on at the end of the range */
  open: boolean;
  /** Started before the range */
  clipped: boolean;
};

/** Intervals during which an IO was on, within [from, until] */
export function onIntervals(
  points: Point[] | undefined,
  from: number,
  until: number,
): Interval[] {
  if (!points?.length) return [];
  const result: Interval[] = [];
  let start: number | undefined;
  let clipped = false;
  for (const p of points) {
    if (p.t > until) break;
    const isOn = p.v > 0;
    if (isOn && start === undefined) {
      clipped = p.t < from;
      start = Math.max(p.t, from);
    } else if (!isOn && start !== undefined) {
      if (p.t >= from) result.push({ start, end: p.t, open: false, clipped });
      start = undefined;
    }
  }
  if (start !== undefined) {
    result.push({ start, end: until, open: true, clipped });
  }
  return result;
}

export type RoutineSegment = Interval & {
  side: RoutineSide;
  name: string;
  phase: TrainPhase;
  /** Sub-states in order, with their start time */
  states: { t: number; state: string }[];
};

/** Routines as intervals per side. Consecutive sub-states are merged. */
export function routineSegments(ds: Dataset): RoutineSegment[] {
  const result: RoutineSegment[] = [];
  const open = new Map<RoutineSide, RoutineSegment>();
  for (const r of ds.routines) {
    if (r.t > ds.until) break;
    const current = open.get(r.side);
    if (current && current.name === r.name) {
      current.states.push({ t: r.t, state: r.state });
      continue;
    }
    if (current) {
      current.end = r.t;
      current.open = false;
      result.push(current);
    }
    open.set(r.side, {
      side: r.side,
      name: r.name,
      phase: routinePhase(r.name),
      start: r.t,
      end: ds.until,
      open: true,
      clipped: r.t < ds.from,
      states: [{ t: r.t, state: r.state }],
    });
  }
  result.push(...open.values());
  return result
    .filter((s) => s.end > ds.from)
    .map((s) => ({ ...s, start: Math.max(s.start, ds.from) }))
    .sort((a, b) => a.start - b.start);
}

export type DeviceEvent = {
  t: number;
  side: RoutineSide;
  label: string;
  detail: string;
  source: "routine" | "io";
  /** Key events are shown by default, others only on request */
  key: boolean;
};

const KEY_IOS = new Set<string>([
  IO.bypass,
  IO.backupWater,
  IO.wasteStorageTank,
  IO.circulation,
  "transfer_path",
  "transfer_path_b",
  "waste_clean_tank",
  "waste_clean_tank_b",
]);

function ioSide(name: string): RoutineSide {
  if (name.endsWith("_b")) return "B";
  if (
    /^(air_pump|bubbles_block|add_air_valve|release_air|transfer_path|waste_clean_tank|diffuser_backwash)$/.test(
      name,
    )
  ) {
    return "A";
  }
  return "SYSTEM";
}

function ioEventLabel(
  captions: Record<string, string>,
  name: string,
  on: boolean,
) {
  const label = caption(captions, name);
  if (name === IO.backupWater) {
    return on ? "Switched to backup water" : "Switched to recycled water";
  }
  if (name === IO.toilet || name === IO.wash) {
    return `${label} ${on ? "started" : "ended"}`;
  }
  if (name === IO.t4Max || name === IO.t4Min) {
    return `${label} ${on ? "wet" : "dry"}`;
  }
  if (name !== IO.circulation && /pump|power/.test(name)) {
    return `${label} ${on ? "started" : "stopped"}`;
  }
  return `${label} ${on ? "opened" : "closed"}`;
}

/** Routine changes and IO edges within the dataset's range, newest first */
export function deviceEvents(ds: Dataset): DeviceEvent[] {
  const events: DeviceEvent[] = [];
  const previous = new Map<RoutineSide, string>();
  for (const r of ds.routines) {
    const changed = previous.get(r.side) !== r.name;
    previous.set(r.side, r.name);
    if (r.t < ds.from || r.t > ds.until) continue;
    events.push({
      t: r.t,
      side: r.side,
      label: changed
        ? `${humanize(r.name)}${r.state && r.state !== "ENTRY" ? ` · ${humanize(r.state)}` : ""}`
        : humanize(r.state),
      detail: `${r.name}/${r.state}`,
      source: "routine",
      // Sub-state changes within a routine are frequent
      key: changed,
    });
  }
  for (const [name, points] of Object.entries(ds.io)) {
    for (let i = 1; i < points.length; i++) {
      const before = points[i - 1].v > 0;
      const after = points[i].v > 0;
      if (before === after || points[i].t < ds.from || points[i].t > ds.until) {
        continue;
      }
      events.push({
        t: points[i].t,
        side: ioSide(name),
        label: ioEventLabel(ds.captions, name, after),
        detail: `${name} ${points[i - 1].v} → ${points[i].v}`,
        source: "io",
        key: KEY_IOS.has(name),
      });
    }
  }
  return events.sort((a, b) => b.t - a.t);
}

export type Transfer = Interval & {
  side: Side;
  /** Drop of T1+T2 in liters between start and end */
  trainDrop: number | undefined;
  /** Change of T3 in liters between start and end */
  t3Change: number | undefined;
};

/** Transfers by the transfer valve of each side */
export function transfers(ds: Dataset): Transfer[] {
  return (["A", "B"] as Side[])
    .flatMap((side) =>
      onIntervals(ds.io[sideIo("transfer_path", side)], ds.from, ds.until)
        // The valve is also opened briefly while cleaning the transfer tube
        .filter((i) => i.open || i.end - i.start >= 2 * 60_000)
        .map((interval) => {
          const level = (t: number) => {
            const t1 = valueAt(ds.tanks[side === "A" ? "t1a" : "t1b"], t);
            const t2 = valueAt(ds.tanks[side === "A" ? "t2a" : "t2b"], t);
            return t1 === undefined || t2 === undefined ? undefined : t1 + t2;
          };
          const before = level(interval.start);
          const after = level(interval.end);
          const t3Before = valueAt(ds.tanks.t3, interval.start);
          const t3After = valueAt(ds.tanks.t3, interval.end);
          return {
            ...interval,
            side,
            trainDrop:
              before === undefined || after === undefined
                ? undefined
                : before - after,
            t3Change:
              t3Before === undefined || t3After === undefined
                ? undefined
                : t3After - t3Before,
          };
        }),
    )
    .sort((a, b) => b.start - a.start);
}

/** `FILTH_REMOVAL` routines, which open the waste valve of their side */
export function cleanings(ds: Dataset) {
  return routineSegments(ds)
    .filter((s) => s.phase === "cleaning" && s.side !== "SYSTEM")
    .map((s) => {
      const waste = onIntervals(
        ds.io[sideIo("waste_clean_tank", s.side as Side)],
        s.start,
        s.end,
      ).reduce((sum, i) => sum + i.end - i.start, 0);
      return { ...s, side: s.side as Side, waste };
    })
    .sort((a, b) => b.start - a.start);
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}

export function formatLiters(liters: number | undefined) {
  return liters === undefined ? "–" : `${Math.round(liters)} L`;
}

/** Earliest IO data in the dataset. `getIo()` only returns a few days. */
export function ioCoverageStart(ds: Dataset) {
  let first: number | undefined;
  for (const points of Object.values(ds.io)) {
    if (points.length && (first === undefined || points[0].t < first)) {
      first = points[0].t;
    }
  }
  return first;
}
