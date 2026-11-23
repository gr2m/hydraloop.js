// Data model of the dashboard, on top of the model of `hydraloop-diagram-react`,
// which works out the state of the H600 at a point in time (`stateAt`). This
// file adds what only the dashboard uses: loading helpers for `lib/hdm.ts`,
// the timeline's signal groups, routine segments, events, transfers and
// cleanings, and formatting. Used on the server and in the browser.

import {
  caption,
  fillingTrain,
  humanize,
  IO,
  onIntervals,
  OTHER_BEHAVIORS,
  roomAt,
  routineAt,
  routinePhase,
  sideIo,
  SKIM_STATES,
  TANK_CAPACITY,
  TANK_IDS,
  valueAt,
  type Behavior,
  type Dataset,
  type Interval,
  type LevelTable,
  type Point,
  type RoutineSide,
  type Side,
  type TankId,
  type TrainPhase,
} from "hydraloop-diagram-react/model";

export * from "hydraloop-diagram-react/model";

/** How far back the live view loads data, long enough to include a venting of both trains */
export const LIVE_RANGE = 8 * 3600_000;

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

// ── Loading ────────────────────────────────────────────────────────────────

/** `fullT1T2WasteSoapBombA` → `Full T1 T2 waste soap bomb` */
export function behaviorLabel(name: string) {
  const words = name
    .replace(/([a-z])([AB])$/, "$1")
    .replace(/^t(\d)/, "T$1")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((w) => (/^T\d$/.test(w) ? w : w.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function behaviorSide(name: string): RoutineSide {
  const match = /[a-z]([AB])$/.exec(name);
  return match ? (match[1] as Side) : "SYSTEM";
}

/** Pairs `engaged` and `disengaged` events into behaviors */
export function behaviorIntervals(
  events: { t: number; name: string; typeId: number; engaged: boolean }[],
  from: number,
  until: number,
): Behavior[] {
  const result: Behavior[] = [];
  const engaged = new Map<string, { t: number; typeId: number }>();
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.t > until) break;
    if (e.engaged) {
      if (!engaged.has(e.name)) engaged.set(e.name, e);
      continue;
    }
    const start = engaged.get(e.name);
    engaged.delete(e.name);
    if (!start || e.t < from) continue;
    result.push(behavior(e.name, start.typeId, start.t, e.t, false));
  }
  for (const [name, start] of engaged) {
    result.push(behavior(name, start.typeId, start.t, until, true));
  }
  return result.sort((a, b) => a.start - b.start);
}

function behavior(
  name: string,
  typeId: number,
  start: number,
  end: number,
  open: boolean,
): Behavior {
  return {
    name,
    typeId,
    side: behaviorSide(name),
    label: behaviorLabel(name),
    start,
    end,
    open,
  };
}

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

/**
 * T1 pressure points while full: the median while filth spills over the skim
 * overflow (`REMOVE_FILTH_ON_HEIGHT`), about 855–870 on both trains of an H600
 */
export const T1_FULL_POINTS = 865;

/**
 * T1 pressure points to liters, linear from empty (0 points) to full. When T2
 * is vented, T1 drops by about as much as T2 rises with this scale: 22 L for
 * a full T1, as the median of 110 ventings, with a wide spread (13–32 L).
 */
export function t1PointsToLiters(p: number): number {
  return Math.max(0, Math.min(1, p / T1_FULL_POINTS)) * TANK_CAPACITY.t1a!;
}

export function routineSide(side: string | null | undefined): RoutineSide {
  const s = (side ?? "").trim().toUpperCase();
  if (s === "A" || s.endsWith("_A")) return "A";
  if (s === "B" || s.endsWith("_B")) return "B";
  return "SYSTEM";
}

// ── Timeline ───────────────────────────────────────────────────────────────

/**
 * Signal groups of the timeline, in order. Signals that aren't listed, like
 * the battery, buzzer, auxiliary and washer demand signals, go to "Other".
 */
export const IO_GROUPS: { key: string; label: string; names: string[] }[] = [
  {
    key: "water-valves",
    label: "Water valves",
    names: [
      IO.bypass,
      IO.abSelector,
      "transfer_path",
      "transfer_path_b",
      "waste_clean_tank",
      "waste_clean_tank_b",
      IO.uvValve,
      IO.circulation,
      IO.backupWater,
      IO.preBackupWater,
      IO.backFlush,
      "diffuser_backwash",
      "diffuser_backwash_b",
      IO.wasteStorageTank,
    ],
  },
  {
    key: "air-valves",
    label: "Air valves",
    names: [
      "add_air_valve",
      "add_air_valve_b",
      "bubbles_block",
      "bubbles_block_b",
      "release_air",
      "release_air_b",
    ],
  },
  { key: "air-pumps", label: "Air pumps", names: ["air_pump", "air_pump_b"] },
  { key: "water-pumps", label: "Water pumps", names: [IO.distributionPump] },
  { key: "lights", label: "Lights", names: [IO.uvPower] },
  {
    key: "sensors",
    label: "Sensors",
    names: [IO.toilet, IO.t4Min, IO.t4Max],
  },
];

// ── Room for greywater ─────────────────────────────────────────────────────

/**
 * Uncertainty of the room for greywater: the threshold was 132–135 L, and
 * T1, which holds some of the water, was at 15–19 L when checked
 */
export const TRAIN_FULL_SPREAD = 10;

/**
 * Room for greywater over the dataset's range, at `steps` points, and the
 * greywater the filling train takes until it starts filth removal
 */
export function roomSeries(
  ds: Dataset,
  steps: number,
): { room: Point[]; next: Point[] } {
  const room: Point[] = [];
  const next: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ds.from + ((ds.until - ds.from) * i) / steps;
    const r = roomAt(ds, t);
    if (r.liters !== undefined && !r.partial) room.push({ t, v: r.liters });
    const train = r.filling && r.trains[r.filling];
    if (!train) continue;
    if (r.bypass || train.accepting === false) next.push({ t, v: 0 });
    else if (train.liters !== undefined) next.push({ t, v: train.liters });
  }
  return { room, next };
}

// ── Water being cleaned ────────────────────────────────────────────────────

// In 30 days of an H600's data, every FILTH_REMOVAL that ran to its end took
// about 4.5 h, then TRANSFER moved 85–120 L (about 100 L) into T3 in about
// 1.4 h. So T3 got the water about 6 h after filth removal started. A train
// in SKIM_LEVEL_DETERMINATION / FIND_HIGHEST_WATER_POINT starts filth removal
// about 5 minutes later.

export const FILTH_REMOVAL_DURATION = 4.5 * 3600_000;
export const TRANSFER_DURATION = 1.4 * 3600_000;
/** What a transfer after filth removal adds to T3 */
export const TRANSFER_LITERS = 100;
export const TRANSFER_SPREAD = 20;

/**
 * T3 reads about this when it is empty. The outlets then switch to backup
 * water, so only what is above it is available.
 */
export const T3_EMPTY_LITERS = 28;

export type Cleaning = {
  side: Side;
  stage: "starting" | "cleaning" | "transferring";
  /** Liters still to come into T3 */
  liters: number;
  /** When the transfer into T3 starts */
  transferAt: number;
  /** When the transfer into T3 is done */
  readyAt: number;
  /** The end of filth removal was reported by the H600, not estimated */
  reported: boolean;
};

/** Water in a train that is being cleaned and will be transferred to T3 */
export function cleaningAt(ds: Dataset, t: number): Cleaning[] {
  const result: Cleaning[] = [];
  for (const side of ["A", "B"] as Side[]) {
    const { current, start } = routineAt(ds, side, t);
    if (!current || start === undefined) continue;
    if (
      current.name === "FILTH_REMOVAL" ||
      (current.name === "SKIM_LEVEL_DETERMINATION" &&
        current.state === "FIND_HIGHEST_WATER_POINT")
    ) {
      const begin = current.name === "FILTH_REMOVAL" ? start : t;
      // The H600 reports the time left when the routine changes. Only use it
      // if it was reported for this run.
      const left = ds.cleaningTimeLeft?.[side];
      const reported = !!left && left.ms > 0 && left.t >= start - 60_000;
      const transferAt = Math.max(
        t,
        reported ? left.t + left.ms : begin + FILTH_REMOVAL_DURATION,
      );
      result.push({
        side,
        stage: current.name === "FILTH_REMOVAL" ? "cleaning" : "starting",
        liters: TRANSFER_LITERS,
        transferAt,
        readyAt: transferAt + TRANSFER_DURATION,
        reported,
      });
    } else if (current.name === "TRANSFER") {
      const before = valueAt(ds.tanks.t3, start);
      const now = valueAt(ds.tanks.t3, t);
      const moved =
        before === undefined || now === undefined ? 0 : now - before;
      result.push({
        side,
        stage: "transferring",
        liters: Math.max(0, TRANSFER_LITERS - moved),
        transferAt: start,
        readyAt: Math.max(t, start + TRANSFER_DURATION),
        reported: false,
      });
    }
  }
  return result.sort((a, b) => a.readyAt - b.readyAt);
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

/**
 * Routine segments where STANDBY and INCOMING_WATER are split at A/B valve
 * switches. The parts while the valve selects the other train get `valve`
 * set to that train, as no greywater enters, and INCOMING_WATER gets the
 * "idle" phase (see `stateAt`).
 */
const VALVE_ROUTINES = new Set(["STANDBY", "INCOMING_WATER"]);

export function valveRoutineSegments(
  ds: Dataset,
): (RoutineSegment & { valve?: Side })[] {
  const switches = (ds.io[IO.abSelector] ?? []).map((p) => p.t);
  return routineSegments(ds).flatMap((s) => {
    if (!VALVE_ROUTINES.has(s.name) || s.side === "SYSTEM") return [s];
    const cuts = [s.start, ...switches.filter((t) => t > s.start && t < s.end)];
    const parts: (RoutineSegment & { valve?: Side })[] = [];
    cuts.forEach((start, i) => {
      const end = cuts[i + 1] ?? s.end;
      const filling = fillingTrain(ds, start);
      const valve = filling && filling !== s.side ? filling : undefined;
      const last = parts[parts.length - 1];
      if (last && last.valve === valve) {
        last.end = end;
        return;
      }
      parts.push({
        ...s,
        start,
        end,
        open: s.open && end === s.end,
        phase: valve ? "idle" : s.phase,
        valve,
      });
    });
    return parts;
  });
}

export type DeviceEvent = {
  /**
   * `<source>:<t>:<suffix>`, unique within a dataset, e.g.
   * `routine:1763550000000:A-FILTH_REMOVAL-ENTRY`
   */
  id: string;
  t: number;
  side: RoutineSide;
  label: string;
  detail: string;
  source: "routine" | "behavior" | "io" | "manual";
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
  // The bubbles block valve closes while its signal is on
  const open = /^bubbles_block(_b)?$/.test(name) ? !on : on;
  return `${label} ${open ? "opened" : "closed"}`;
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
      id: `routine:${r.t}:${r.side}-${r.name}-${r.state}`,
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
  for (const b of ds.behaviors ?? []) {
    const edges: [number, boolean][] = [[b.start, true]];
    if (!b.open) edges.push([b.end, false]);
    for (const [t, engaged] of edges) {
      if (t < ds.from || t > ds.until) continue;
      events.push({
        id: `behavior:${t}:${b.name}-${engaged ? "engaged" : "disengaged"}`,
        t,
        side: b.side,
        label: `${b.label} ${engaged ? "started" : "ended"}`,
        detail: `behavior ${b.name} ${engaged ? "engaged" : "disengaged"}`,
        source: "behavior",
        key: !OTHER_BEHAVIORS.has(b.name),
      });
    }
  }
  for (const [name, points] of Object.entries(ds.io)) {
    for (let i = 1; i < points.length; i++) {
      const before = points[i - 1].v > 0;
      const after = points[i].v > 0;
      if (before === after || points[i].t < ds.from || points[i].t > ds.until) {
        continue;
      }
      events.push({
        id: `io:${points[i].t}:${name}-${after ? "on" : "off"}`,
        t: points[i].t,
        side: ioSide(name),
        label: ioEventLabel(ds.captions, name, after),
        detail: `${name} ${points[i - 1].v} → ${points[i].v}`,
        source: "io",
        key: KEY_IOS.has(name),
      });
    }
  }
  for (const [name, points] of Object.entries(ds.manual ?? {})) {
    for (let i = 0; i < points.length; i++) {
      // Before the first point, the IO is taken to be automatic
      const before = i > 0 && points[i - 1].v > 0;
      const after = points[i].v > 0;
      if (before === after) continue;
      if (points[i].t < ds.from || points[i].t > ds.until) continue;
      events.push({
        id: `manual:${points[i].t}:${name}-${after ? "on" : "off"}`,
        t: points[i].t,
        side: ioSide(name),
        label: `${caption(ds.captions, name)} ${after ? "switched manually" : "back to automatic"}`,
        detail: `${name} manual ${after ? 1 : 0}`,
        source: "manual",
        key: true,
      });
    }
  }
  return events.sort((a, b) => b.t - a.t);
}

/** Intervals during which an IO was switched manually, within [from, until] */
export function manualIntervals(ds: Dataset, name: string) {
  return onIntervals(ds.manual?.[name], ds.from, ds.until);
}

export type Transfer = Interval & {
  side: Side;
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
          const t3Before = valueAt(ds.tanks.t3, interval.start);
          const t3After = valueAt(ds.tanks.t3, interval.end);
          return {
            ...interval,
            side,
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
      // The waste valve opens right when the routine ends, if at all
      const wasteIntervals = onIntervals(
        ds.io[sideIo("waste_clean_tank", s.side as Side)],
        s.start,
        Math.min(ds.until, s.end + 15 * 60_000),
      );
      const waste = wasteIntervals.reduce((sum, i) => sum + i.end - i.start, 0);
      const skimStart = s.states.find((x) => SKIM_STATES.has(x.state))?.t;
      return {
        ...s,
        side: s.side as Side,
        waste,
        skimming: skimStart === undefined ? 0 : s.end - skimStart,
        /** A moment when water leaves the train, to show in the diagram */
        focus:
          wasteIntervals[0]?.start ??
          (skimStart === undefined ? s.start : skimStart + 60_000),
      };
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
