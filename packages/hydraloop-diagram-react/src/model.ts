// Model of a Hydraloop H600: works out what the device is doing at a point in
// time (`stateAt`) from a `Dataset` of tank levels, IO signals, routines and
// firmware behaviors, as loaded from the internal HDM API. `FlowDiagram`
// draws the resulting `DeviceState`. Has no dependencies, so it also works
// without React, e.g. on a server.
//
// The phase of each train comes from the routine that HDM reports for its
// side (e.g. `INCOMING_WATER`, `TRANSFER`). Where no routine is known, it
// falls back to valve signals. Each state says how it was determined.

export type Side = "A" | "B";
export type RoutineSide = Side | "SYSTEM";
export type TankId = "t1a" | "t2a" | "t1b" | "t2b" | "t3";

export const TANK_IDS: TankId[] = ["t1a", "t2a", "t1b", "t2b", "t3"];

/**
 * IO names as returned by `hydraloop.local.graph.getIo()`. B-side IOs of the
 * H600 have a `_b` suffix. The roles were derived by correlating the signals
 * with each other and with the routines of an H600 (firmware 9.24).
 */
export const IO = {
  /** Sends incoming greywater to the sewer while on */
  bypass: "grey_water_bypass",
  /**
   * Selects the train that receives greywater (0: A, 1: B). Switched when a
   * train starts filth removal, and for a minute during a restart
   */
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
  /** Tank levels in liters (see `t1PointsToLiters` and `pressureToLiters`) */
  tanks: Record<TankId, Point[]>;
  /**
   * Scale in liters: T1's capacity, else the last entry of the calibration
   * table (the most the sensor can report, not the tank's capacity)
   */
  tankMax: Record<TankId, number>;
  /** IO values by IO name, one point per change, sorted by time */
  io: Record<string, Point[]>;
  /**
   * Whether an IO is switched manually (1) instead of by the firmware (0),
   * e.g. by a technician or a maintenance procedure in the HDM web app. Same
   * shape as `io`.
   */
  manual?: Record<string, Point[]>;
  /** Human readable IO names from the graph config */
  captions: Record<string, string>;
  /** Routine changes, sorted by time. Includes the last one before `from`. */
  routines: RoutineEvent[];
  /** Firmware behaviors (e.g. `fullT1T2WasteSoapBombA`) overlapping the range */
  behaviors: Behavior[];
  /**
   * Restarts and connection losses from `getOutageSummaries()`. Undefined if
   * they could not be loaded.
   */
  outages?: Outage[];
  /**
   * T2 in liters at the last venting of each train before `from`, as tank
   * levels are only loaded from `from` (see `ventedLevels`)
   */
  ventedBefore?: Partial<Record<Side, Point>>;
  /**
   * Time left of filth removal per train, as last reported by the H600
   * (`cleaningTimeLeftA/B` of `getTankTreatmentState()`), and when it was
   * reported. Only loaded for the live views.
   */
  cleaningTimeLeft?: Partial<Record<Side, { t: number; ms: number }>>;
  /**
   * Calibration tables of T2 and T3, to convert the pressure points of live
   * messages to liters in the browser. Undefined if they could not be loaded.
   */
  levelTables?: { t1t2: LevelTable; t3: LevelTable };
  /** Data that could not be loaded */
  warnings: string[];
};

/** An outage from `getOutageSummaries()`, e.g. a `scheduled_restart` */
export type Outage = {
  start: number;
  end: number;
  classification: string;
};

/**
 * A firmware behavior from the `behavior` list of `getIo()`, from its
 * `engaged` to its `disengaged` event. Behaviors explain why the controller
 * acts, e.g. `fullT1T2WasteSoapBombA` while it empties train A to the drain.
 */
export type Behavior = {
  name: string;
  typeId: number;
  side: RoutineSide;
  label: string;
  start: number;
  end: number;
  /** Not disengaged by the end of the range */
  open: boolean;
};

/** Calibration table of a tank: pressure points to liters */
export type LevelTable = { p: number; l: number }[];

// ── Tank capacities ────────────────────────────────────────────────────────

// Estimated from Hydraloop's H600 V2.1 CAD model, not certified by Hydraloop:
// T1 holds about 24 L, T2 about 200 L. The `t1t2Levels` calibration table
// ends at 185 L, which fits T2 (T2 drops by about as much as T3 rises during
// transfers), but not T1: T1 reads up to ~930 pressure points, past the
// table's end at 703 points, which would be 185 L in a 24 L tank.

/** Physical capacity in liters, estimated from the H600 CAD model */
export const TANK_CAPACITY: Partial<Record<TankId, number>> = {
  t1a: 24,
  t1b: 24,
  t2a: 200,
  t2b: 200,
};

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

/**
 * Behaviors that explain nothing the app shows. `pressingOptButton` is
 * engaged for about 12 hours at a time, nearly always.
 */
export const OTHER_BEHAVIORS = new Set(["pressingOptButton"]);

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

export type IoValue = {
  on: boolean;
  value: number;
  since: number | undefined;
  /** Switched manually instead of by the firmware */
  manual: boolean;
};

export type TankLevel = {
  liters: number | undefined;
  /** Scale in liters, see `Dataset.tankMax` */
  max: number;
  /** Physical capacity, estimated from the H600 CAD model (see TANK_CAPACITY) */
  capacity: number | undefined;
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
  /** Firmware behaviors of this train that are engaged */
  behaviors: Behavior[];
  /**
   * Filth and foam spill over the skim overflow of T1 to the drain, inferred
   * from the `FILTH_REMOVAL` routine (the overflow has no valve signal)
   */
  skimming: boolean;
  /**
   * T2 holds air pressure: air was last added to it after its release air
   * valve was last opened. Also while air is being added
   */
  pressurized: boolean;
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
  /** The pump pressurizes the outlets, also while it circulates through UV */
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
  /** Engaged firmware behaviors that don't belong to a train */
  systemBehaviors: Behavior[];
  /** Estimated room for greywater before it is bypassed */
  room: Room;
};

const TREND_WINDOW = 10 * 60_000;

/** `FILTH_REMOVAL` sub-states while T1 is held at the skim overflow */
export const SKIM_STATES = new Set([
  "REMOVE_FILTH_ON_HEIGHT",
  "SKIM_LAST_WATER",
]);

/** The current routine of a side and when it started (first sub-state) */
export function routineAt(
  ds: Pick<Dataset, "routines">,
  side: RoutineSide,
  t: number,
) {
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
      capacity: TANK_CAPACITY[id],
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
    io[name] = p && {
      on: p.v > 0,
      value: p.v,
      since: onSince(points, t),
      manual: (stepAt(ds.manual?.[name], t)?.v ?? 0) > 0,
    };
  }
  const on = (name: string) => io[name]?.on;

  const routine: Partial<Record<RoutineSide, RoutineEvent>> = {};
  const active = (ds.behaviors ?? []).filter(
    (b) =>
      !OTHER_BEHAVIORS.has(b.name) &&
      b.start <= t &&
      (b.open ? t <= b.end : t < b.end),
  );

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
      bubbles?.on && "Bubbles block closed",
    ].filter((e): e is string => Boolean(e));
    // T2 drains through T1 while T1 is emptied to the drain or into T3
    const t2Trend = tanks[side === "A" ? "t2a" : "t2b"].trend;
    const t2ToT1 =
      Boolean(waste?.on || transfer?.on) &&
      t2Trend !== undefined &&
      t2Trend <= -0.5;
    // During `FILTH_REMOVAL`, the air pump runs continuously and holds T1 at
    // the top of its range, so filth spills over the skim overflow
    const skimming =
      current?.name === "FILTH_REMOVAL" &&
      SKIM_STATES.has(current.state) &&
      air?.on !== false;
    if (skimming) evidence.push("Skimming over the overflow (inferred)");
    const behaviors = active.filter((b) => b.side === side);
    const base = {
      side,
      lastIncoming,
      lastTransfer,
      evidence,
      t2ToT1,
      skimming,
      behaviors,
      pressurized: holdsPressure(ds, side, t),
    };

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
        detail: [
          behaviors.length > 0 &&
            `HDM behavior: ${behaviors.map((b) => b.label).join(", ")}`,
          routineText && `HDM routine: ${routineText}`,
        ]
          .filter(Boolean)
          .join(". "),
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
    const pumpOff = on(IO.distributionPump) === false;
    t3 = {
      ...t3Base,
      label: pumpOff
        ? "Circulation valve open, pump off"
        : "Circulating through UV",
      confidence: "valve",
      evidence: [
        "Circulation valve open",
        ...(pumpOff ? ["Distribution pump off"] : []),
        ...(uv ? ["UV on"] : []),
      ],
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
    toOutlets: pumping,
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

  // HDM often reports INCOMING_WATER for both trains, or only for the one
  // the A/B valve doesn't select, while only the selected train's T2 rises.
  // So incoming water on either side goes to the train of the A/B valve.
  const filling = fillingTrain(ds, t);
  const incoming = (["A", "B"] as Side[]).filter(
    (s) => trains[s].phase === "receiving",
  );
  if (filling && incoming.length > 0) {
    const other: Side = filling === "A" ? "B" : "A";
    if (trains[other].phase === "receiving") {
      trains[other] = {
        ...trains[other],
        phase: "idle",
        confidence: "valve",
        evidence: [...trains[other].evidence, `A/B valve set to ${filling}`],
      };
    }
    const current = routine[filling];
    if (
      trains[filling].confidence === "reported" &&
      current &&
      ACCEPTING_ROUTINES.has(current.name)
    ) {
      trains[filling] = {
        ...trains[filling],
        phase: "receiving",
        confidence: "valve",
        evidence: [...trains[filling].evidence, `A/B valve set to ${filling}`],
      };
    }
  }
  const inlet: InletState = {
    bypass: on(IO.bypass),
    receiving: filling ? (incoming.length > 0 ? [filling] : []) : incoming,
  };

  const systemBehaviors = active.filter((b) => b.side === "SYSTEM");

  return {
    t,
    tanks,
    io,
    routine,
    inlet,
    trains,
    t3,
    t4,
    supply,
    systemBehaviors,
    room: roomAt(ds, t),
  };
}

// ── Room for greywater ─────────────────────────────────────────────────────

// Derived from 30 days of an H600's data, not documented by Hydraloop:
// - Greywater only enters the train selected by the A/B valve, and only in
//   STANDBY (or during INCOMING_WATER).
// - After each incoming water, SKIM_LEVEL_DETERMINATION checks the train
//   with T2 vented. Once T2 holds about 134 L, the train starts
//   FILTH_REMOVAL, the A/B valve switches to the other train, and the train
//   doesn't accept water for the ~4.5 h it lasts.
// - The bypass opens when neither train can accept water. It is also tested
//   for about a minute every 12 hours, while the trains accept water.
// So T2 is taken from its last venting, which happens about once an hour.
// Greywater also fills T1, but T1 holds at most about 24 L.

/** T2 at which a train is full and starts FILTH_REMOVAL */
export const TRAIN_FULL_LITERS = 134;

/** Routines in which a train accepts greywater */
export const ACCEPTING_ROUTINES = new Set([
  "STANDBY",
  "INCOMING_WATER",
  "TRANSFER",
]);

/**
 * Without outages, bypass openings shorter than this are taken for the
 * scheduled restart
 */
const RESTART_MAX = 2 * 60_000;

/**
 * Whether a bypass opening is from the controller's scheduled restart every
 * 12 hours. The bypass valve falls open while the controller is down. Falls
 * back to the duration if the outages could not be loaded.
 */
export function isScheduledRestart(
  ds: Pick<Dataset, "outages">,
  interval: Interval,
) {
  if (!ds.outages) {
    return (
      !interval.open &&
      !interval.clipped &&
      interval.end - interval.start < RESTART_MAX
    );
  }
  return ds.outages.some(
    (o) =>
      o.classification === "scheduled_restart" &&
      o.start < interval.end + 60_000 &&
      o.end > interval.start - 60_000,
  );
}

/**
 * The train that the A/B valve sends greywater to. The valve is also
 * switched for a minute during a restart, which is skipped.
 */
export function fillingTrain(ds: Dataset, t: number): Side | undefined {
  const points = ds.io[IO.abSelector];
  if (!points?.length) return undefined;
  let i = indexAt(points, t);
  while (i > 0 && (stepAt(ds.io[IO.bypass], points[i].t)?.v ?? 0) > 0) i--;
  if (i === -1) return undefined;
  return points[i].v > 0 ? "B" : "A";
}

/**
 * Whether T2 holds air pressure at `t`: the air pump last ran with the add air
 * valve open after the release air valve was last open
 */
function holdsPressure(ds: Dataset, side: Side, t: number) {
  const pump = onIntervals(ds.io[sideIo("air_pump", side)], -Infinity, t);
  const add = onIntervals(ds.io[sideIo("add_air_valve", side)], -Infinity, t);
  let added = -Infinity;
  for (const p of pump) {
    for (const a of add) {
      if (Math.max(p.start, a.start) < Math.min(p.end, a.end)) {
        added = Math.max(added, Math.min(p.end, a.end));
      }
    }
  }
  const released = onIntervals(
    ds.io[sideIo("release_air", side)],
    -Infinity,
    t,
  ).at(-1)?.end;
  return added > (released ?? -Infinity);
}

/** Vent openings shorter than this don't settle the levels */
const MIN_VENT = 60_000;

/** Openings of a release air valve that are long enough to settle T2 */
export function ventings(points: Point[] | undefined, until: number) {
  return onIntervals(points, -Infinity, until).filter(
    (i) => i.end - i.start >= MIN_VENT,
  );
}

/** T2 in liters at the end of a venting: the median of its second half */
export function ventedLevel(t2: Point[], vent: Interval): Point | undefined {
  // The second half of the vent, after the water settled
  const from = (vent.start + vent.end) / 2;
  const levels: number[] = [];
  for (let i = Math.max(0, indexAt(t2, from)); i < t2.length; i++) {
    const p = t2[i];
    if (p.t > vent.end) break;
    if (p.t >= from) levels.push(p.v);
  }
  if (levels.length === 0) return undefined;
  levels.sort((a, b) => a - b);
  return { t: vent.end, v: levels[levels.length >> 1] };
}

/**
 * T2 in liters, measured while it was vented, one point per venting.
 * Starts with the last venting before the range, if it was loaded.
 */
export function ventedLevels(ds: Dataset, side: Side): Point[] {
  const t2 = ds.tanks[side === "A" ? "t2a" : "t2b"];
  const before = ds.ventedBefore?.[side];
  const result: Point[] = before ? [before] : [];
  for (const vent of ventings(ds.io[sideIo("release_air", side)], ds.until)) {
    const level = ventedLevel(t2, vent);
    if (level && level.t > (before?.t ?? -Infinity)) result.push(level);
  }
  return result;
}

export type TrainRoom = {
  side: Side;
  /** Liters the train can still take, 0 while it doesn't accept water */
  liters: number | undefined;
  /** T2 at the last venting */
  t2: number | undefined;
  measuredAt: number | undefined;
  accepting: boolean | undefined;
  reason: string;
};

export type Room = {
  /** Liters the H600 can take before greywater is bypassed */
  liters: number | undefined;
  /** Only one train is known, so `liters` is a lower bound */
  partial: boolean;
  /** The bypass is open, not counting the scheduled restart */
  bypass: boolean;
  /** The bypass is open for the scheduled restart, which doesn't count as full */
  restart: boolean;
  /** The train that receives greywater, and starts filth removal next */
  filling: Side | undefined;
  trains: Record<Side, TrainRoom>;
};

const roomCache = new WeakMap<
  Dataset,
  { vented: Record<Side, Point[]>; bypass: Interval[] }
>();

export function roomAt(ds: Dataset, t: number): Room {
  let cache = roomCache.get(ds);
  if (!cache) {
    cache = {
      vented: { A: ventedLevels(ds, "A"), B: ventedLevels(ds, "B") },
      bypass: onIntervals(ds.io[IO.bypass], ds.from, ds.until),
    };
    roomCache.set(ds, cache);
  }
  const { vented } = cache;
  const opening = cache.bypass.find((i) => i.start <= t && t < i.end);
  const bypassOpen =
    opening !== undefined || (stepAt(ds.io[IO.bypass], t)?.v ?? 0) > 0;
  const restart = opening !== undefined && isScheduledRestart(ds, opening);
  const bypass = bypassOpen && !restart;

  const train = (side: Side): TrainRoom => {
    const last = stepAt(vented[side], t);
    const routine = routineAt(ds, side, t).current;
    const waste =
      (stepAt(ds.io[sideIo("waste_clean_tank", side)], t)?.v ?? 0) > 0;
    const busy = waste
      ? "Waste valve open"
      : routine && !ACCEPTING_ROUTINES.has(routine.name)
        ? humanize(routine.name)
        : undefined;
    if (busy) {
      return {
        side,
        liters: 0,
        t2: last?.v,
        measuredAt: last?.t,
        accepting: false,
        reason: `${busy}, not accepting water`,
      };
    }
    if (!last) {
      return {
        side,
        liters: undefined,
        t2: undefined,
        measuredAt: undefined,
        accepting: routine ? true : undefined,
        reason: "No venting with level data yet",
      };
    }
    return {
      side,
      liters: Math.max(0, TRAIN_FULL_LITERS - last.v),
      t2: last.v,
      measuredAt: last.t,
      accepting: true,
      reason: last.v >= TRAIN_FULL_LITERS ? "Full" : "Accepting water",
    };
  };

  const trains = { A: train("A"), B: train("B") };
  const known = [trains.A.liters, trains.B.liters].filter(
    (l) => l !== undefined,
  );
  const partial = !bypass && known.length === 1;
  const liters = bypass
    ? 0
    : known.length === 0
      ? undefined
      : known.reduce((sum, l) => sum + l, 0);
  return {
    liters,
    partial,
    bypass,
    restart,
    filling: fillingTrain(ds, t),
    trains,
  };
}

// ── Intervals ──────────────────────────────────────────────────────────────

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

/** Explains the capacity of a tank whose scale is the sensor's range */
export function capacityNote(level: TankLevel) {
  if (level.capacity === undefined) return "";
  return level.capacity === Math.round(level.max)
    ? `The tank holds about ${level.capacity} L (estimated from Hydraloop's 3D model).`
    : `The scale is the sensor's range of ${Math.round(level.max)} L. The tank holds about ${level.capacity} L (estimated from Hydraloop's 3D model).`;
}
