import "server-only";

// Simulated H600 data for trying the dashboard without an HDM account. It
// follows the operating cycle described in Hydraloop's documentation (intake,
// about five hours of treatment, gravity transfer through UV into T3, weekly
// filth removal, periodic T3 circulation). The timings are illustrative, not
// measured.

import type { LoadOptions } from "./hdm";
import {
  IO,
  TANK_CAPACITY,
  transfers,
  type Dataset,
  type Point,
  type RoutineEvent,
  type Side,
  type TankId,
} from "./model";
import { computeStats, type Stats } from "./stats";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const T12_MAX = 185;
const T3_MAX = 280;
const T1_MIN = 30;
const T2_MIN = 40;

/** The simulation moves T1 on T2's scale, T1 holds much less (see TANK_CAPACITY) */
function t1Liters(v: number) {
  return Math.max(0, (v / T12_MAX) * TANK_CAPACITY.t1a!);
}

type Phase = "idle" | "receiving" | "treating" | "transferring" | "cleaning";

const ROUTINES: Record<Phase, [number, string, string]> = {
  idle: [1, "STANDBY", "PASSIVE_CIRCULATE"],
  receiving: [2, "INCOMING_WATER", "LEVEL_TANKS"],
  treating: [3, "SKIM_LEVEL_DETERMINATION", "FIND_HIGHEST_WATER_POINT"],
  transferring: [4, "TRANSFER", "TRANSFER_WATER_T3_LEVELED"],
  cleaning: [5, "FILTH_REMOVAL", "REMOVE_FILTH_ON_HEIGHT"],
};

function random(seed: number) {
  // mulberry32
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Train = {
  phase: Phase;
  t1: number;
  t2: number;
  phaseStart: number;
  lastInflow: number;
};

let cache:
  | { minute: number; data: Omit<Dataset, "from" | "until" | "fetchedAt"> }
  | undefined;

function run(now: number) {
  const minute = Math.floor(now / MINUTE);
  if (cache?.minute === minute) return cache.data;

  // Long enough for the 30-day statistics
  const start = Math.floor(now / DAY) * DAY - 31 * DAY;
  const tz = new Date(now).getTimezoneOffset() * MINUTE;

  // Showers and toilet flushes per day, seeded by the day so they stay stable
  const showers: { start: number; end: number }[] = [];
  const flushes: number[] = [];
  for (let day = start; day <= now; day += DAY) {
    const rand = random(day / DAY);
    const local = day + tz;
    for (const hour of [6.6, 7.1, 7.6, 19.4, 21.1]) {
      if (rand() < 0.2) continue;
      const begin = local + (hour + rand() * 0.4) * 3600_000;
      showers.push({ start: begin, end: begin + (6 + rand() * 7) * MINUTE });
    }
    for (let i = 0; i < 32; i++) {
      flushes.push(local + (7 + rand() * 16) * 3600_000);
    }
  }
  const flushSet = new Set(flushes.map((t) => Math.floor(t / MINUTE)));

  const trains: Record<Side, Train> = {
    A: { phase: "idle", t1: 40, t2: 60, phaseStart: start, lastInflow: 0 },
    B: { phase: "idle", t1: 38, t2: 55, phaseStart: start, lastInflow: 0 },
  };
  let t3 = 180;
  let route: Side = "A";

  const ioNames = [
    IO.bypass,
    IO.abSelector,
    IO.uvValve,
    IO.uvPower,
    IO.auxiliary,
    IO.backupWater,
    IO.backFlush,
    IO.wasteStorageTank,
    IO.distributionPump,
    IO.circulation,
    IO.toilet,
    IO.wash,
    IO.t4Max,
    IO.t4Min,
    ...[
      "air_pump",
      "bubbles_block",
      "add_air_valve",
      "release_air",
      "transfer_path",
      "waste_clean_tank",
      "diffuser_backwash",
    ].flatMap((n) => [n, `${n}_b`]),
  ];
  const io: Record<string, Point[]> = {};
  const current: Record<string, number> = {};
  for (const name of ioNames) {
    io[name] = [{ t: start, v: 0 }];
    current[name] = 0;
  }
  const set = (name: string, t: number, on: boolean) => {
    const v = on ? 1 : 0;
    if (current[name] !== v) {
      current[name] = v;
      io[name].push({ t, v });
    }
  };

  const tanks: Record<TankId, Point[]> = {
    t1a: [],
    t2a: [],
    t1b: [],
    t2b: [],
    t3: [],
  };
  const routines: RoutineEvent[] = [];
  const enter = (side: Side, phase: Phase, t: number) => {
    const train = trains[side];
    train.phase = phase;
    train.phaseStart = t;
    const [routine, name, state] = ROUTINES[phase];
    routines.push({ t, side, routine, name, state });
  };
  enter("A", "idle", start);
  enter("B", "idle", start);

  const noise = random(42);
  let showerIndex = 0;
  let backupMode = false;
  let flushRemaining = 0;

  for (let t = start; t <= now; t += MINUTE) {
    const local = new Date(t - tz);
    const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();

    // ── Intake ──
    while (showerIndex < showers.length && showers[showerIndex].end < t)
      showerIndex++;
    const showering =
      showerIndex < showers.length && showers[showerIndex].start <= t;
    const available = (s: Side) =>
      (trains[s].phase === "idle" || trains[s].phase === "receiving") &&
      trains[s].t1 + trains[s].t2 < T12_MAX * 2 - 20;
    if (showering) {
      if (!available(route)) {
        const other: Side = route === "A" ? "B" : "A";
        if (available(other)) route = other;
      }
      if (available(route)) {
        const train = trains[route];
        if (train.phase !== "receiving") enter(route, "receiving", t);
        const flow = 4 + noise() * 2;
        train.t1 += flow * 0.6;
        train.t2 += flow * 0.4;
        train.lastInflow = t;
        set(IO.bypass, t, false);
      } else {
        set(IO.bypass, t, true);
      }
    } else {
      set(IO.bypass, t, false);
    }
    // Selects the receiving train
    set(IO.abSelector, t, route === "B");
    set(IO.backFlush, t, minuteOfDay % 720 === 285);

    // ── Trains ──
    for (const side of ["A", "B"] as Side[]) {
      const train = trains[side];
      const sfx = side === "A" ? "" : "_b";
      const elapsed = t - train.phaseStart;

      if (train.phase === "receiving" && t - train.lastInflow > 40 * MINUTE) {
        enter(side, "treating", t);
      } else if (train.phase === "treating" && elapsed > 5 * 60 * MINUTE) {
        if (t3 < T3_MAX - 60) enter(side, "transferring", t);
      } else if (train.phase === "transferring") {
        if (train.t1 + train.t2 <= T1_MIN + T2_MIN + 2 || t3 >= T3_MAX - 5) {
          enter(side, "idle", t);
        }
      } else if (train.phase === "cleaning" && elapsed > 270 * MINUTE) {
        enter(side, "idle", t);
      } else if (train.phase === "idle") {
        // Weekly filth removal on Sunday, B after A
        const weekday = local.getUTCDay();
        const cleanAt = side === "A" ? 3 * 60 : 8 * 60;
        if (weekday === 0 && minuteOfDay === cleanAt)
          enter(side, "cleaning", t);
      }

      if (train.phase === "treating" && elapsed === 40 * MINUTE) {
        routines.push({
          t,
          side,
          routine: 1,
          name: "STANDBY",
          state: "AIR_BIOBALLS",
        });
      }

      const phase = train.phase;
      const cycle = Math.floor((t - train.phaseStart) / MINUTE);
      set(`transfer_path${sfx}`, t, phase === "transferring");
      // Filth removal skims over the overflow, the waste valve stays closed
      set(`waste_clean_tank${sfx}`, t, false);
      set(`diffuser_backwash${sfx}`, t, false);
      set(
        `air_pump${sfx}`,
        t,
        phase === "cleaning"
          ? true
          : phase === "treating"
            ? cycle % 15 < 11
            : phase === "transferring"
              ? false
              : minuteOfDay % 30 < 3,
      );
      set(
        `bubbles_block${sfx}`,
        t,
        phase === "treating" && cycle < 120 && cycle % 20 < 8,
      );
      set(
        `add_air_valve${sfx}`,
        t,
        phase === "transferring" && train.t1 < T1_MIN + 4,
      );
      // T2 is vented while water comes in, and about once an hour in standby
      set(
        `release_air${sfx}`,
        t,
        phase === "receiving" || (phase === "idle" && minuteOfDay % 60 < 4),
      );

      if (phase === "transferring") {
        const rate = 1.4 + noise() * 0.4;
        // T1 drains first. When it is low, the controller raises it from T2,
        // which shows as zigzags in T1.
        if (train.t1 > T1_MIN) {
          train.t1 -= rate;
        } else if (train.t2 > T2_MIN) {
          const move = Math.min(14, train.t2 - T2_MIN);
          train.t2 -= move;
          train.t1 += move;
        }
        t3 += rate;
      } else if (phase === "cleaning") {
        // T2 pressure holds T1 at the top, filth spills over the overflow
        const lift = Math.max(
          0,
          Math.min(6, T12_MAX - train.t1, train.t2 - T2_MIN),
        );
        train.t1 += lift;
        train.t2 -= lift + 0.1;
      }
      if (phase === "treating") {
        // Pressure in T2 lifts water into T1 for skimming, and it falls back
        // when the air pump pauses
        const shift = cycle % 15 < 2 ? 3 : cycle % 15 >= 13 ? -3 : 0;
        train.t1 += shift;
        train.t2 -= shift;
      }
      train.t1 = Math.min(T12_MAX, Math.max(0, train.t1));
      train.t2 = Math.min(T12_MAX, Math.max(0, train.t2));
    }

    // ── UV and T3 circulation every four hours ──
    const transferring = current.transfer_path || current.transfer_path_b;
    // The distribution pump drives the circulation through UV
    const circulating = minuteOfDay % 240 < 15;
    set(IO.circulation, t, circulating);
    set(IO.uvPower, t, Boolean(transferring || circulating));
    set(IO.uvValve, t, Boolean(transferring || circulating));

    // ── Distribution ──
    // Backup water is a mode that stays on until the next 12-hour check
    if (minuteOfDay % 720 === 286) backupMode = t3 < 40;
    if (flushSet.has(Math.floor(t / MINUTE))) flushRemaining = 2;
    const flushing = flushRemaining > 0;
    set(IO.toilet, t, flushing);
    set(IO.distributionPump, t, flushing || circulating);
    set(IO.backupWater, t, backupMode);
    set(IO.t4Max, t, !(backupMode && flushing));
    set(IO.t4Min, t, true);
    if (flushing) {
      if (!backupMode) t3 = Math.max(0, t3 - 3.2);
      flushRemaining--;
    }
    t3 = Math.min(T3_MAX, t3);

    if ((t / MINUTE) % 2 === 0) {
      const jitter = () => (noise() - 0.5) * 0.6;
      tanks.t1a.push({ t, v: t1Liters(trains.A.t1 + jitter()) });
      tanks.t2a.push({ t, v: trains.A.t2 + jitter() });
      tanks.t1b.push({ t, v: t1Liters(trains.B.t1 + jitter()) });
      tanks.t2b.push({ t, v: trains.B.t2 + jitter() });
      tanks.t3.push({ t, v: t3 + jitter() });
    }
  }

  const data = {
    device: {
      id: "demo",
      name: "Demo H600",
      serial: "SIMULATED",
      type: "H600",
      firmware: null,
      online: true,
      outlets: { toilet: true, washingMachine: false, auxiliary: false },
    },
    demo: true,
    tanks,
    tankMax: {
      t1a: TANK_CAPACITY.t1a!,
      t2a: T12_MAX,
      t1b: TANK_CAPACITY.t1b!,
      t2b: T12_MAX,
      t3: T3_MAX,
    },
    io,
    captions: {},
    routines,
    behaviors: [],
    warnings: [],
  };
  cache = { minute, data };
  return data;
}

export function simulate({ from, until }: LoadOptions): Dataset {
  const now = Date.now();
  const end = Math.min(until, now);
  const data = run(now);
  const inRange = (points: Point[]) => {
    // Keep the last point before the range, so the state at `from` is known
    const first = points.findIndex((p) => p.t >= from);
    const startIndex = first <= 0 ? 0 : first - 1;
    return points.slice(startIndex).filter((p) => p.t <= end);
  };
  return {
    ...data,
    from,
    until: end,
    fetchedAt: now,
    tanks: Object.fromEntries(
      Object.entries(data.tanks).map(([id, points]) => [
        id,
        points.filter((p) => p.t >= from && p.t <= end),
      ]),
    ) as Dataset["tanks"],
    io: Object.fromEntries(
      Object.entries(data.io).map(([name, points]) => [name, inRange(points)]),
    ),
    routines: data.routines.filter((r, i, all) => {
      if (r.t > end) return false;
      if (r.t >= from) return true;
      // The last routine of each side before the range is still active
      const next = all.slice(i + 1).find((n) => n.side === r.side);
      return !next || next.t >= from;
    }),
  };
}

/** Statistics of the simulation. Recycled water is the change of T3 during transfers. */
export function simulateStats({ range }: { range: number }): Stats {
  const until = Date.now();
  const ds = simulate({ from: until - range, until });
  const tz = new Date(until).getTimezoneOffset() * MINUTE;
  const perDay = new Map<number, number>();
  for (const transfer of transfers(ds)) {
    if (!transfer.t3Change || transfer.t3Change < 0) continue;
    const day = Math.floor((transfer.start - tz) / DAY) * DAY + tz;
    perDay.set(day, (perDay.get(day) ?? 0) + transfer.t3Change);
  }
  const days = [...perDay]
    .map(([t, v]) => ({ t, v: Math.round(v) }))
    .sort((a, b) => a.t - b.t);
  return {
    ...computeStats(ds, {
      liters: days.reduce((sum, p) => sum + p.v, 0),
      days,
      source: "transfers",
    }),
    demo: true,
    fetchedAt: until,
    warnings: [],
  };
}
