import "server-only";

// Simulated H600 data for trying the dashboard without an HDM account.
//
// The sequences of routines, valves, pumps and behaviors follow 30 days of a
// real H600's data (firmware 9.24): the order of the routine sub-states and
// how long they last, which valve opens when, and how the firmware reacts to
// a full train, an empty T3, a restart or a power loss. Tank levels, usage
// and the times of incidents are made up.
//
// What it simulates, per train:
// - STANDBY: PRESSURE_RESET → AIR_BIOBALLS → CONFIGURE_HEIGHT →
//   PASSIVE_CIRCULATE, repeated every two hours. The air pump runs in
//   PASSIVE_CIRCULATE, the add air valve pressurizes T2 in CONFIGURE_HEIGHT.
// - INCOMING_WATER on both trains when greywater comes in, with T2 vented,
//   then SKIM_LEVEL_DETERMINATION. Greywater only enters the train that the
//   A/B valve selects.
// - Once T2 of a train holds `TRAIN_FULL_LITERS` while vented, the train
//   checks its level (FIND_HIGHEST_WATER_POINT …), the A/B valve switches to
//   the other train, and FILTH_REMOVAL skims for about 4.5 hours.
// - TRANSFER after every FILTH_REMOVAL, through UV-C into T3: about 100 L in
//   about an hour, leveled first, then pushed with air pressure. It ends by
//   cleaning the transfer tube.
//
// And for the whole device:
// - A scheduled restart every 12 hours: the bypass falls open for a minute,
//   the A/B valve falls back to A, and the backup water and back flush are
//   checked.
// - T3 circulation through UV-C every 3 hours, with a short diffuser
//   backwash before and after. Skipped while on backup water.
// - UV-C switched on for a second or two every 15 minutes.
// - Toilet flushes run the distribution pump. When T3 is empty, the outlets
//   switch to backup water (T4) until the next transfer.
// - T3 is drained and rinsed before a transfer if it was empty for hours
//   (`fullT3WasteCleaning`), and T4 overflows into T3 when the outlets switch
//   back to recycled water (`t4OverflowBackflush`).
// - Incidents: a soap bomb, a periodic waste of a train after its transfer, a
//   power loss after which both trains and T3 are drained, a technician
//   filling T3 with backup water by hand, the bypass switched on in the app,
//   a leaking toilet, and connection losses.

import type { LoadOptions } from "./hdm";
import {
  CONNECTIVITY_RANGE,
  SIGNALS_RANGE,
  type Maintenance,
  type OutageItem,
  type RestartItem,
  type VitalSeries,
} from "./maintenance";
import {
  behaviorIntervals,
  IO,
  TANK_CAPACITY,
  TRAIN_FULL_LITERS,
  transfers,
  ventedLevel,
  ventings,
  type Dataset,
  type Point,
  type RoutineEvent,
  type Side,
  type TankId,
} from "./model";
import { computeStats, PUMP_LITERS_PER_SECOND, type Stats } from "./stats";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Tank levels are integrated in steps of this */
const TICK = 10 * SECOND;
/** Tank readings are reported this often */
const SAMPLE = MINUTE;

const T1_MAX = TANK_CAPACITY.t1a!;
/** Scale of T2, the end of the `t1t2Levels` calibration table */
const T2_MAX = 185;
const T3_MAX = 280;
/** T3 reads about this when it is empty (see T3_EMPTY_LITERS) */
const T3_FLOOR = 26;
/** T1 while T2 holds air pressure in STANDBY */
const T1_LIFTED = 13;
/** Liters per minute from T1 through UV-C into T3 */
const TRANSFER_RATE = 1.7;
/** Liters per hour that spill over T1's skim overflow during FILTH_REMOVAL */
const SKIM_RATE = 2;

const ROUTINE_NUMBERS: Record<string, number> = {
  STANDBY: 1,
  INCOMING_WATER: 2,
  SKIM_LEVEL_DETERMINATION: 3,
  FILTH_REMOVAL: 4,
  TRANSFER: 5,
};

const BEHAVIOR_TYPES: Record<string, number> = {
  distributionPumpFailSafeSmallLeak: 1,
  fullT1T2WasteSoapBombA: 6,
  fullT1T2WasteSoapBombB: 6,
  fullT3WasteCleaning: 13,
  fullWastePowerLoss: 19,
  eyeballingBackupWater: 40,
  pressingOptButton: 54,
  bypassByAppBypassValve: 57,
  t4OverflowBackflush: 73,
  fullT1T2WastePeriodicSmallA: 90,
  fullT1T2WastePeriodicSmallB: 90,
};

const SIDES: Side[] = ["A", "B"];
const other = (side: Side): Side => (side === "A" ? "B" : "A");

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

/** Start of the current day (UTC). Incidents are placed relative to it. */
function dayStart(now: number) {
  return Math.floor(now / DAY) * DAY;
}

/** Times of the incidents, so the maintenance view shows the same ones */
function incidents(now: number) {
  const today = dayStart(now);
  return {
    /** Bypass switched on in the app, and switched on again briefly */
    appBypass: [
      { start: today - DAY + 18.9 * HOUR, ms: 102 * MINUTE },
      { start: today - DAY + 23.3 * HOUR, ms: 36 * SECOND },
    ],
    /** Bursts of the distribution pump, as if a toilet leaks */
    leak: today - DAY + 21.5 * HOUR,
    /** A technician fills T3 with backup water by hand */
    manualFill: today - 2 * DAY + 7.33 * HOUR,
    powerLoss: today - 3 * DAY + 14.17 * HOUR,
    /** The first filth removal of train A after this ends in a soap bomb */
    soapBombAfter: today - 8 * DAY,
    /** A day with a lot of greywater */
    guests: today - 5 * DAY,
    /** The first transfer of train B after this is followed by a periodic waste */
    periodicWasteAfter: today - 12 * DAY,
  };
}

/** Restarts and connection losses of the device */
function simulatedOutages(from: number, until: number, now: number) {
  const today = dayStart(now);
  const outages: OutageItem[] = [];
  const restarts: RestartItem[] = [];
  // A scheduled restart every 12 hours
  for (
    let t = Math.ceil(from / (12 * HOUR)) * 12 * HOUR;
    t < until;
    t += 12 * HOUR
  ) {
    outages.push({
      start: t + 2 * SECOND,
      end: t + 36 * SECOND,
      cause: "scheduled_restart",
      title: "Scheduled device restart",
      description: "The device performed its routine scheduled restart.",
      group: "scheduled",
    });
    restarts.push({ t: t + 52 * SECOND, reason: "Scheduled restart" });
  }
  const { powerLoss } = incidents(now);
  for (const [start, minutes, cause, title, group] of [
    [today - 26.3 * DAY, 2, "server_restart", "Server restarted", "server"],
    [today - 19.7 * DAY, 1, "server_restart", "Server restarted", "server"],
    [
      today - 15.4 * DAY,
      12,
      "server_response_timeout",
      "Server stopped responding",
      "server",
    ],
    [
      today - 8.2 * DAY,
      70,
      "wifi_access_point_unavailable",
      "Wi-Fi network could not be found",
      "network",
    ],
    [
      powerLoss,
      1,
      "power_restored_restart",
      "Restart after mains power returned",
      "power",
    ],
    [
      today - 1.6 * DAY,
      1,
      "server_response_timeout",
      "Server stopped responding",
      "server",
    ],
  ] as const) {
    if (start + minutes * MINUTE < from || start > until) continue;
    outages.push({
      start,
      end: start + minutes * MINUTE,
      cause,
      title,
      description: null,
      group,
    });
  }
  outages.sort((a, b) => a.start - b.start);
  return { outages, restarts };
}

/** A minimal binary heap of callbacks by time, in insertion order on ties */
class Queue {
  #heap: { t: number; seq: number; fn: () => void }[] = [];
  #seq = 0;

  push(t: number, fn: () => void) {
    const heap = this.#heap;
    heap.push({ t, seq: this.#seq++, fn });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.#less(i, parent)) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  }

  peek() {
    return this.#heap[0];
  }

  pop() {
    const heap = this.#heap;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let min = i;
        if (l < heap.length && this.#less(l, min)) min = l;
        if (r < heap.length && this.#less(r, min)) min = r;
        if (min === i) break;
        [heap[i], heap[min]] = [heap[min], heap[i]];
        i = min;
      }
    }
    return top;
  }

  #less(a: number, b: number) {
    const x = this.#heap[a];
    const y = this.#heap[b];
    return x.t < y.t || (x.t === y.t && x.seq < y.seq);
  }
}

/** How T1 moves relative to T2 */
type Mode =
  /** T2 is vented, T1 and T2 level out */
  | "vent"
  /** Air pressure in T2 lifts T1 */
  | "lift"
  /** Air pressure holds T1 at its skim overflow */
  | "full"
  /** Nothing moves */
  | "hold";

type Step = {
  routine: string;
  state: string;
  /** Duration, or the minimum duration with `until` */
  ms?: number;
  /** Ends the step once true, checked every tick */
  until?: () => boolean;
  mode?: Mode;
  /** Liters per minute from T1 through UV-C into T3 */
  out?: number;
  /** Liters per hour over the skim overflow */
  skim?: number;
  enter?: () => void;
};

type Train = {
  side: Side;
  sfx: string;
  /** Liters in T1 and T2 together */
  water: number;
  t1: number;
  routine: string;
  state: string;
  mode: Mode;
  out: number;
  skim: number;
  /** Liters per minute to the drain while the waste valve is open */
  waste: number;
  /** Increased by every new program, which ends the previous one */
  token: number;
  /** Checks its level or removes filth, and doesn't accept greywater */
  busy: boolean;
  wait?: { until: () => boolean; minAt: number; next: () => void };
};

type SimulatedData = Omit<
  Dataset,
  "from" | "until" | "fetchedAt" | "behaviors" | "outages"
> & {
  behaviorEvents: {
    t: number;
    name: string;
    typeId: number;
    engaged: boolean;
  }[];
  /** Start and planned duration of each filth removal */
  filthRemovals: { side: Side; t: number; ms: number }[];
  /** When the soap bomb happened, if it did */
  soapBomb: number | undefined;
};

let cache: { minute: number; data: SimulatedData } | undefined;

function run(now: number): SimulatedData {
  const minute = Math.floor(now / MINUTE);
  if (cache?.minute === minute) return cache.data;

  // Long enough for the 30-day statistics
  const today = dayStart(now);
  const start = today - 31 * DAY;
  const tz = new Date(now).getTimezoneOffset() * MINUTE;
  const incident = incidents(now);
  const rand = random(42);
  const between = (a: number, b: number) => a + rand() * (b - a);

  // ── Recording ──

  const ioNames = [
    IO.bypass,
    IO.abSelector,
    IO.uvValve,
    IO.uvPower,
    IO.circulation,
    IO.distributionPump,
    IO.preBackupWater,
    IO.backupWater,
    IO.backFlush,
    IO.wasteStorageTank,
    IO.auxiliary,
    IO.wash,
    IO.toilet,
    IO.t4Max,
    IO.t4Min,
    "accu_charge_enable",
    "battery_power_on",
    "battery_power_enable",
    "buzzer",
    ...[
      "air_pump",
      "add_air_valve",
      "bubbles_block",
      "release_air",
      "transfer_path",
      "diffuser_backwash",
      "waste_clean_tank",
    ].flatMap((n) => [n, `${n}_b`]),
  ];
  const initial: Record<string, number> = {
    [IO.t4Min]: 1,
    battery_power_on: 1,
    battery_power_enable: 1,
  };
  const io: Record<string, Point[]> = {};
  const current: Record<string, number> = {};
  for (const name of ioNames) {
    current[name] = initial[name] ?? 0;
    io[name] = [{ t: start, v: current[name] }];
  }
  const manual: Record<string, Point[]> = {};
  const routines: RoutineEvent[] = [];
  const behaviorEvents: SimulatedData["behaviorEvents"] = [];
  const filthRemovals: SimulatedData["filthRemovals"] = [];
  let soapBomb: number | undefined;

  const queue = new Queue();
  let clock = start;
  // Whole milliseconds, as the device reports
  const at = (t: number, fn: () => void) => queue.push(Math.round(t), fn);
  const later = (ms: number, fn: () => void) => at(clock + ms, fn);

  const set = (name: string, on: boolean) => {
    const v = on ? 1 : 0;
    if (current[name] === v) return;
    current[name] = v;
    io[name].push({ t: clock, v });
  };
  const pulse = (name: string, ms: number) => {
    set(name, true);
    later(ms, () => set(name, false));
  };
  const setManual = (name: string, on: boolean) => {
    (manual[name] ??= []).push({ t: clock, v: on ? 1 : 0 });
  };
  const behavior = (name: string, engaged: boolean) => {
    behaviorEvents.push({
      t: clock,
      name,
      typeId: BEHAVIOR_TYPES[name] ?? 0,
      engaged,
    });
  };
  const behaviorFor = (name: string, ms: number) => {
    behavior(name, true);
    later(ms, () => behavior(name, false));
  };

  /** An IO that is on while anyone uses it */
  const shared = (name: string) => {
    const users = new Set<string>();
    return {
      add(user: string) {
        users.add(user);
        set(name, true);
      },
      remove(user: string) {
        users.delete(user);
        set(name, users.size > 0);
      },
      use(user: string, ms: number) {
        this.add(user);
        later(ms, () => this.remove(user));
      },
      get busy() {
        return users.size > 0;
      },
    };
  };
  const uv = shared(IO.uvPower);
  const uvValve = shared(IO.uvValve);
  const circulationValve = shared(IO.circulation);
  const pump = shared(IO.distributionPump);
  const backFlush = shared(IO.backFlush);
  const toilet = shared(IO.toilet);
  let users = 0;
  const user = (name: string) => `${name}-${users++}`;

  const backwashPulse = (ms: number) => {
    pulse("diffuser_backwash", ms);
    pulse("diffuser_backwash_b", ms);
  };

  // ── Device state ──

  const trains: Record<Side, Train> = {
    A: {
      side: "A",
      sfx: "",
      water: 80,
      t1: T1_LIFTED,
      routine: "",
      state: "",
      mode: "lift",
      out: 0,
      skim: 0,
      waste: 0,
      token: 0,
      busy: false,
    },
    B: {
      side: "B",
      sfx: "_b",
      water: 35,
      t1: T1_LIFTED,
      routine: "",
      state: "",
      mode: "lift",
      out: 0,
      skim: 0,
      waste: 0,
      token: 0,
      busy: false,
    },
  };
  /** The train that the A/B valve sends greywater to */
  let selected: Side = "A";
  let t3 = 60;
  let t3Draining = false;
  /** Liters per minute into T3 other than from the trains */
  let t3Filling = 0;
  let backupMode = false;
  let backupSince = start;
  let circulating = false;
  let intakes = 0;
  let intakeFlow = 0;
  let lastIntakeEnd = start;
  /** Reasons for the bypass to be open other than both trains being busy */
  const bypassReasons = new Set<string>();
  let soapBombDone = false;
  let periodicWasteDone = false;

  // The bypass opens when the A/B valve's train doesn't accept greywater,
  // which happens when the other train is busy as well
  const updateBypass = () =>
    set(IO.bypass, bypassReasons.size > 0 || trains[selected].busy);
  const select = (side: Side) => {
    selected = side;
    set(IO.abSelector, side === "B");
    updateBypass();
  };
  const backupOn = () => {
    if (!backupMode) backupSince = clock;
    backupMode = true;
    if (!circulating) set(IO.backupWater, true);
  };
  const backupOff = () => {
    backupMode = false;
    set(IO.backupWater, false);
  };

  // ── Train programs ──

  const enter = (train: Train, routine: string, state: string) => {
    const add = (s: string) =>
      routines.push({
        t: clock,
        side: train.side,
        routine: ROUTINE_NUMBERS[routine],
        name: routine,
        state: s,
      });
    if (train.routine !== routine) {
      add("ENTRY");
      train.routine = routine;
      updateBypass();
    }
    if (state !== "ENTRY") add(state);
    train.state = state;
  };

  const program = (train: Train, steps: Step[], done?: () => void) => {
    const token = ++train.token;
    train.wait = undefined;
    let i = 0;
    const next = () => {
      if (train.token !== token) return;
      train.wait = undefined;
      const step = steps[i++];
      if (!step) return done?.();
      enter(train, step.routine, step.state);
      if (step.mode) train.mode = step.mode;
      train.out = step.out ?? 0;
      train.skim = step.skim ?? 0;
      step.enter?.();
      if (step.until) {
        train.wait = { until: step.until, minAt: clock + (step.ms ?? 0), next };
      } else {
        later(step.ms ?? 0, next);
      }
    };
    next();
    return token;
  };
  /** Runs `fn` later, unless the train started another program */
  const guarded = (train: Train, ms: number, fn: () => void) => {
    const token = train.token;
    later(ms, () => {
      if (train.token === token) fn();
    });
  };
  const air = (train: Train, name: string, on: boolean) =>
    set(`${name}${train.sfx}`, on);

  /** The air pump circulates water through T1 until something happens */
  const passiveCirculate = (train: Train): Step => ({
    routine: "STANDBY",
    state: "PASSIVE_CIRCULATE",
    until: () => false,
    mode: "lift",
    enter: () => {
      air(train, "add_air_valve", false);
      // Greywater that came in while the train was busy
      if (intakes > 0) {
        guarded(train, 0, () => incoming(train));
        return;
      }
      // Air is topped up now and then
      if (rand() < 0.3) {
        guarded(train, between(5, 100) * MINUTE, () =>
          pulse(`add_air_valve${train.sfx}`, between(3, 12) * SECOND),
        );
      }
      guarded(train, 2 * HOUR, () => standby(train, { resetMs: 48 * SECOND }));
    },
  });

  const standby = (
    train: Train,
    {
      entry = false,
      resetMs = 17 * SECOND,
      periodicWaste = false,
    }: { entry?: boolean; resetMs?: number; periodicWaste?: boolean } = {},
  ) => {
    if (entry) train.routine = "";
    const configure: Step[] = [
      {
        routine: "STANDBY",
        state: "AIR_BIOBALLS",
        ms: 20 * SECOND,
        mode: "hold",
        enter: () => {
          air(train, "release_air", false);
          air(train, "air_pump", false);
        },
      },
      {
        routine: "STANDBY",
        state: "CONFIGURE_HEIGHT",
        ms: between(60, 85) * SECOND,
        mode: "lift",
        enter: () => {
          air(train, "air_pump", true);
          air(train, "add_air_valve", true);
        },
      },
      passiveCirculate(train),
    ];
    const wasteSteps: Step[] = periodicWaste
      ? [
          {
            routine: "STANDBY",
            state: "AIR_BIOBALLS",
            ms: 0,
            mode: "hold",
            enter: () => {
              air(train, "release_air", false);
              air(train, "air_pump", false);
            },
          },
          {
            routine: "STANDBY",
            state: "WASTE_T1T2",
            ms: 144 * SECOND,
            mode: "vent",
            enter: () => {
              const name = `fullT1T2WastePeriodicSmall${train.side}`;
              behavior(name, true);
              bypassReasons.add(`waste-${train.side}`);
              updateBypass();
              air(train, "waste_clean_tank", true);
              train.waste = 12;
              later(5 * SECOND, () =>
                pulse(`release_air${train.sfx}`, 5 * SECOND),
              );
              later(144 * SECOND, () => {
                behavior(name, false);
                air(train, "waste_clean_tank", false);
                train.waste = 0;
                const flush = user("waste");
                backFlush.use(flush, 16 * SECOND);
                later(60 * SECOND, () => {
                  bypassReasons.delete(`waste-${train.side}`);
                  updateBypass();
                });
              });
            },
          },
          {
            routine: "STANDBY",
            state: "PRESSURE_RESET",
            ms: 17 * SECOND,
            mode: "vent",
            enter: () => {
              air(train, "air_pump", true);
              air(train, "release_air", true);
            },
          },
        ]
      : [];
    program(train, [
      {
        routine: "STANDBY",
        state: "PRESSURE_RESET",
        ms: resetMs,
        mode: "vent",
        enter: () => {
          air(train, "air_pump", true);
          air(train, "release_air", true);
        },
      },
      ...wasteSteps,
      ...configure,
    ]);
  };

  const incoming = (train: Train) => {
    program(
      train,
      [
        {
          routine: "INCOMING_WATER",
          state: "LEVEL_TANKS",
          ms: between(40, 50) * SECOND,
          mode: "vent",
          enter: () => {
            air(train, "air_pump", false);
            air(train, "release_air", true);
            // Sometimes the air pump runs briefly, with the bubbles block
            // closing and opening every few seconds
            if (rand() < 0.35) {
              guarded(train, 5 * SECOND, () => {
                air(train, "air_pump", true);
                for (let i = 0; i < 7; i++) {
                  later(i * 3 * SECOND, () =>
                    pulse(`bubbles_block${train.sfx}`, 2 * SECOND),
                  );
                }
                later(23 * SECOND, () => air(train, "air_pump", false));
              });
            }
          },
        },
        {
          routine: "INCOMING_WATER",
          state: "DETECT_STOP_INCOMING_WATER",
          // Until no greywater came in for 7 minutes
          until: () => intakes === 0 && clock - lastIntakeEnd >= 7 * MINUTE,
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "WAIT_RELEASE_AIR_CLOSED",
          ms: 7 * SECOND,
          mode: "hold",
          enter: () => air(train, "release_air", false),
        },
      ],
      () => {
        if (train.water - train.t1 >= TRAIN_FULL_LITERS) findHighest(train);
        else standby(train, { entry: true });
      },
    );
  };

  /** The level check before filth removal */
  const findHighest = (train: Train) => {
    program(
      train,
      [
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "WAIT_BEFORE_PUSH",
          ms: 0,
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "FIND_HIGHEST_WATER_POINT",
          ms: 61 * SECOND,
          mode: "full",
          enter: () => {
            // From now on, greywater goes to the other train
            train.busy = true;
            select(other(train.side));
            air(train, "air_pump", true);
            air(train, "bubbles_block", true);
            guarded(train, 4 * SECOND, () => air(train, "add_air_valve", true));
          },
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "PRE_CHECK_SUCTION_OCCURED",
          ms: 12 * SECOND,
          mode: "hold",
          enter: () => {
            air(train, "air_pump", false);
            air(train, "bubbles_block", false);
            air(train, "add_air_valve", false);
          },
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "THROW_AWAY_WATER_OF_BUBBLES",
          ms: 15 * SECOND,
          enter: () => air(train, "air_pump", true),
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "PRE_CHECK_SUCTION_OCCURED",
          ms: 12 * SECOND,
          enter: () => air(train, "air_pump", false),
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "WAIT_FOR_HEIGHT_MEASURE",
          ms: 5 * SECOND,
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "WAIT_INCOMING_WATER_SENSOR_DETECTION",
          ms: 6 * SECOND,
          enter: () => air(train, "air_pump", true),
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "LEVEL_TANKS_TO_FIX_INCOMING_WATER_SENSOR",
          ms: 17 * SECOND,
          mode: "vent",
          enter: () => air(train, "release_air", true),
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "WAIT_STABLE_T1_T2",
          ms: 7 * SECOND,
          mode: "hold",
          enter: () => air(train, "release_air", false),
        },
        {
          routine: "SKIM_LEVEL_DETERMINATION",
          state: "DETECT_INCOMING_WATER",
          ms: between(14, 20) * SECOND,
        },
      ],
      () => filth(train),
    );
  };

  const filth = (train: Train) => {
    const skimMs = 4.5 * HOUR - 383 * SECOND + between(-10, 10) * MINUTE;
    const total = skimMs + 383 * SECOND;
    filthRemovals.push({ side: train.side, t: clock, ms: Math.round(total) });
    const bomb =
      !soapBombDone && train.side === "A" && clock > incident.soapBombAfter;
    if (bomb) soapBombDone = true;
    program(
      train,
      [
        {
          routine: "FILTH_REMOVAL",
          state: "INITIALIZE_HEIGHT",
          ms: 40 * SECOND,
          mode: "full",
          enter: () => {
            air(train, "air_pump", true);
            air(train, "add_air_valve", true);
          },
        },
        {
          routine: "FILTH_REMOVAL",
          state: "WAIT_STABLE",
          ms: 18 * SECOND,
          enter: () => air(train, "add_air_valve", false),
        },
        {
          routine: "FILTH_REMOVAL",
          state: "STARTUP_WAIT",
          ms: 318 * SECOND,
          enter: () => {
            // Too much foam: the train is emptied to the drain
            if (bomb) guarded(train, 258 * SECOND, () => soap(train));
          },
        },
        {
          routine: "FILTH_REMOVAL",
          state: "REMOVE_FILTH_ON_HEIGHT",
          ms: skimMs,
          skim: SKIM_RATE,
          enter: () => {
            // Air is topped up now and then to hold T1 at the overflow
            for (let i = 0; i < 3; i++) {
              guarded(train, between(0.1, 0.95) * skimMs, () =>
                pulse(`add_air_valve${train.sfx}`, between(3, 60) * SECOND),
              );
            }
            // T3 is drained and rinsed before the transfer if it was empty
            // for hours
            guarded(train, skimMs - 35 * MINUTE, () => {
              if (backupMode && clock - backupSince > 4 * HOUR) cleanT3();
            });
          },
        },
        {
          routine: "FILTH_REMOVAL",
          state: "SKIM_LAST_WATER",
          ms: 3 * SECOND,
          enter: () => air(train, "add_air_valve", true),
        },
        {
          routine: "FILTH_REMOVAL",
          state: "TEMPORARY_NO_MEASURE_LEVEL",
          ms: 37 * SECOND,
          enter: () => {
            air(train, "add_air_valve", false);
            pulse(`release_air${train.sfx}`, 11 * SECOND);
          },
        },
      ],
      () => transfer(train),
    );
  };

  /** `fullT1T2WasteSoapBomb`: the train is emptied to the drain */
  const soap = (train: Train) => {
    const name = `fullT1T2WasteSoapBomb${train.side}`;
    const wasteEnd = clock + 5 * MINUTE;
    soapBomb = clock;
    train.busy = false;
    behavior(name, true);
    bypassReasons.add(`waste-${train.side}`);
    air(train, "waste_clean_tank", true);
    train.waste = 25;
    later(5 * MINUTE, () => {
      behavior(name, false);
      air(train, "waste_clean_tank", false);
      train.waste = 0;
      backFlush.use(user("soap"), 12 * SECOND);
      later(SECOND, () => pulse(`diffuser_backwash${train.sfx}`, 28 * SECOND));
      pulse(`bubbles_block${train.sfx}`, 42 * SECOND);
      later(MINUTE, () => {
        bypassReasons.delete(`waste-${train.side}`);
        updateBypass();
      });
    });
    program(train, [
      {
        routine: "STANDBY",
        state: "PRESSURE_RESET",
        ms: 12 * SECOND,
        mode: "vent",
        enter: () => air(train, "release_air", true),
      },
      {
        routine: "SKIM_LEVEL_DETERMINATION",
        state: "WAIT_RELEASE_AIR_CLOSED",
        ms: 7 * SECOND,
        enter: () => {
          air(train, "release_air", false);
          air(train, "air_pump", false);
        },
      },
      {
        routine: "SKIM_LEVEL_DETERMINATION",
        state: "WAIT_BEFORE_PUSH",
        ms: 0,
      },
      {
        routine: "SKIM_LEVEL_DETERMINATION",
        state: "FIND_HIGHEST_WATER_POINT",
        ms: 96 * SECOND,
        enter: () => {
          air(train, "air_pump", true);
          air(train, "bubbles_block", true);
          guarded(train, 4 * SECOND, () => air(train, "add_air_valve", true));
        },
      },
      {
        routine: "SKIM_LEVEL_DETERMINATION",
        state: "PRE_CHECK_SUCTION_OCCURED",
        ms: 0,
        enter: () => {
          air(train, "air_pump", false);
          air(train, "bubbles_block", false);
          air(train, "add_air_valve", false);
        },
      },
      {
        routine: "STANDBY",
        state: "PRESSURE_RESET",
        ms: 17 * SECOND,
        mode: "vent",
        enter: () => {
          air(train, "air_pump", true);
          air(train, "release_air", true);
        },
      },
      {
        routine: "STANDBY",
        state: "AIR_BIOBALLS",
        ms: 20 * SECOND,
        mode: "hold",
        enter: () => {
          air(train, "release_air", false);
          air(train, "air_pump", false);
        },
      },
      {
        routine: "STANDBY",
        state: "CONFIGURE_HEIGHT",
        // Until a while after the waste valve closed
        until: () => clock >= wasteEnd + 78 * SECOND,
        mode: "lift",
        enter: () => {
          air(train, "air_pump", true);
          air(train, "add_air_valve", true);
        },
      },
      passiveCirculate(train),
    ]);
  };

  const transfer = (train: Train) => {
    const startWater = train.water;
    let leveledAt = 0;
    let pushedAt = 0;
    let pushing = false;
    const push = () => {
      if (!pushing) return;
      pulse(`bubbles_block${train.sfx}`, 53 * SECOND);
      later(SECOND, () => {
        if (!pushing) return;
        air(train, "air_pump", true);
        air(train, "add_air_valve", true);
        later(17 * SECOND, () => {
          air(train, "air_pump", false);
          air(train, "add_air_valve", false);
        });
      });
      later(between(128, 140) * SECOND, push);
    };
    const circulationPulses = () => {
      const pumping = user("transfer");
      circulationValve.use(pumping, 4 * SECOND);
      pump.use(pumping, 4 * SECOND);
      later(5 * SECOND, () => circulationValve.use(user("transfer"), SECOND));
    };
    program(
      train,
      [
        {
          routine: "TRANSFER",
          state: "LEVEL_TANKS_T1T2",
          ms: 31 * SECOND,
          mode: "vent",
          enter: () => {
            // The train accepts greywater again
            train.busy = false;
            updateBypass();
            air(train, "air_pump", false);
            air(train, "release_air", true);
          },
        },
        {
          routine: "TRANSFER",
          state: "SINK_IN_WATER_T1",
          ms: 10 * MINUTE,
          mode: "hold",
          enter: () => air(train, "release_air", false),
        },
        {
          routine: "TRANSFER",
          state: "WAIT_DONE_WASTE_T3",
          until: () => !t3Draining,
        },
        {
          routine: "TRANSFER",
          state: "WAIT_DONE_DESINFECT_T3",
          ms: 185 * SECOND,
          until: () => !circulating,
        },
        {
          routine: "TRANSFER",
          state: "DELAY_DETECTION_WORKING_TRANSFER",
          ms: 29 * SECOND,
          enter: () => {
            backwashPulse(2 * SECOND);
            later(2 * SECOND, () => air(train, "release_air", true));
            later(10 * SECOND, () => {
              uv.add(`transfer-${train.side}`);
              uvValve.add(`transfer-${train.side}`);
              air(train, "transfer_path", true);
              train.mode = "vent";
              train.out = TRANSFER_RATE;
            });
            later(20 * SECOND, circulationPulses);
            if (backupMode) {
              // T4 overflows into T3 when the outlets switch back to
              // recycled water
              for (const ms of [73, 136]) {
                later(ms * SECOND, () => {
                  pulse(IO.t4Max, 2 * SECOND);
                  behaviorFor("t4OverflowBackflush", 6 * SECOND);
                  const overflow = user("overflow");
                  backFlush.use(overflow, 6 * SECOND);
                  pump.use(overflow, 6 * SECOND);
                });
              }
              later(154 * SECOND, backupOff);
            }
          },
        },
        {
          routine: "TRANSFER",
          state: "TRANSFER_WATER_T3_LEVELED",
          ms: 25 * MINUTE,
          mode: "vent",
          out: TRANSFER_RATE,
          enter: () => (leveledAt = clock),
          until: () =>
            train.water <= startWater * 0.5 || clock - leveledAt > 30 * MINUTE,
        },
        {
          routine: "TRANSFER",
          state: "WAIT_RELEASE_AIR_CLOSED",
          ms: 5 * SECOND,
          mode: "hold",
          out: TRANSFER_RATE,
          enter: () => {
            air(train, "release_air", false);
            circulationPulses();
          },
        },
        {
          routine: "TRANSFER",
          state: "TRANSFER_WATER_T3_WHILE_PUSHING",
          ms: 10 * MINUTE,
          mode: "lift",
          out: TRANSFER_RATE,
          until: () => train.water <= 36 || clock - pushedAt > 40 * MINUTE,
          enter: () => {
            pushing = true;
            pushedAt = clock;
            push();
          },
        },
        {
          routine: "TRANSFER",
          state: "TRANSFER_LAST_WATER_TO_T3",
          ms: 18 * SECOND,
          out: TRANSFER_RATE,
          enter: () => (pushing = false),
        },
        {
          routine: "TRANSFER",
          state: "CLEAN_WITH_SUCTION",
          ms: 272 * SECOND,
          enter: () => {
            air(train, "bubbles_block", false);
            air(train, "transfer_path", false);
            uvValve.remove(`transfer-${train.side}`);
            later(5 * SECOND, () => uv.remove(`transfer-${train.side}`));
            air(train, "air_pump", true);
            air(train, "add_air_valve", true);
            later(152 * SECOND, () => {
              air(train, "air_pump", false);
              air(train, "add_air_valve", false);
            });
          },
        },
        {
          routine: "TRANSFER",
          state: "CLEAN_TRANSFER_TUBE",
          ms: 17 * SECOND,
          enter: () => {
            backwashPulse(SECOND);
            pulse(`transfer_path${train.sfx}`, 11 * SECOND);
            later(SECOND, () => {
              const tube = user("tube");
              uv.use(tube, 14 * SECOND);
              circulationValve.use(tube, 13 * SECOND);
              later(SECOND, () => pump.use(tube, 12 * SECOND));
            });
            later(15 * SECOND, () => {
              backwashPulse(2 * SECOND);
              circulationValve.use(user("tube"), SECOND);
            });
          },
        },
      ],
      () => {
        const periodicWaste =
          !periodicWasteDone &&
          train.side === "B" &&
          clock > incident.periodicWasteAfter;
        if (periodicWaste) periodicWasteDone = true;
        standby(train, { entry: true, resetMs: 49 * SECOND, periodicWaste });
        // T3 is circulated through UV-C once the transfer is done
        later(5 * MINUTE, () => {
          if (!backupMode) circulate(between(7, 30) * MINUTE);
        });
      },
    );
  };

  // ── Device programs ──

  /** T3 circulates through UV-C, driven by the distribution pump */
  const circulate = (ms: number) => {
    if (circulating || uvValve.busy) return;
    circulating = true;
    const double = rand() < 0.4;
    backwashPulse(2 * SECOND);
    if (double) later(7 * SECOND, () => backwashPulse(2 * SECOND));
    const begin = double ? 9 * SECOND : 2 * SECOND;
    const key = user("circulation");
    later(begin, () => {
      uv.add(key);
      circulationValve.add(key);
      uvValve.add(key);
      // The pump draws from T3
      set(IO.backupWater, false);
      later(SECOND, () => pump.add(key));
    });
    later(begin + ms, () => {
      pump.remove(key);
      later(3 * SECOND, () => {
        uv.remove(key);
        circulationValve.remove(key);
      });
      later(4 * SECOND, () => uvValve.remove(key));
      later(5 * SECOND, () => {
        backwashPulse(2 * SECOND);
        circulating = false;
        set(IO.backupWater, backupMode);
      });
    });
  };

  /** `fullT3WasteCleaning`: T3 is drained and rinsed */
  const cleanT3 = () => {
    behaviorFor("fullT3WasteCleaning", 309 * SECOND);
    t3Draining = true;
    set(IO.wasteStorageTank, true);
    for (let i = 0; i < 5; i++) {
      later(349 * SECOND + i * 55 * SECOND, () => {
        const rinse = user("rinse");
        backFlush.use(rinse, 16 * SECOND);
        later(11 * SECOND, () => pump.use(rinse, 5 * SECOND));
        if (i === 4) {
          later(16 * SECOND, () => {
            set(IO.wasteStorageTank, false);
            t3Draining = false;
            circulate(between(7, 10) * MINUTE);
          });
        }
      });
    }
  };

  const flush = (ms: number) => {
    const key = user("toilet");
    toilet.add(key);
    pump.add(key);
    if (backupMode && rand() < 0.05)
      behaviorFor("eyeballingBackupWater", 3 * SECOND);
    later(ms, () => toilet.remove(key));
    later(ms + 2 * SECOND, () => {
      pump.remove(key);
      if (backupMode) return;
      t3 -= (PUMP_LITERS_PER_SECOND * (ms + 2 * SECOND)) / SECOND;
      if (t3 <= T3_FLOOR + 2) {
        t3 = Math.max(T3_FLOOR, t3);
        backupOn();
      }
    });
  };

  const restart = () => {
    bypassReasons.add("restart");
    updateBypass();
    set("battery_power_enable", false);
    set("battery_power_on", false);
    set("accu_charge_enable", false);
    // The A/B valve falls back to A
    set(IO.abSelector, false);
    behavior("pressingOptButton", false);
    later(25 * SECOND, () => behavior("pressingOptButton", true));
    const resting = SIDES.filter((s) => trains[s].routine === "STANDBY");
    for (const side of resting) {
      const train = trains[side];
      train.token++;
      train.wait = undefined;
      train.mode = "hold";
      train.state = "";
      air(train, "air_pump", false);
    }
    later(49 * SECOND, () => {
      set(IO.t4Min, false);
      set(IO.t4Min, true);
    });
    later(52 * SECOND, () => {
      set("battery_power_enable", true);
      set("battery_power_on", true);
      set("accu_charge_enable", true);
      later(46 * MINUTE, () => set("accu_charge_enable", false));
      bypassReasons.delete("restart");
      select(selected);
      set(IO.backupWater, false);
      for (const side of resting) {
        if (trains[side].routine === "STANDBY") {
          standby(trains[side], { entry: true, resetMs: 47 * SECOND });
        }
      }
    });
    // Backup water and back flush are checked
    later(53 * SECOND, () => {
      const check = user("check");
      backFlush.use(check, 19 * SECOND);
      later(4 * SECOND, () => set(IO.backupWater, true));
      later(10 * SECOND, () => pump.use(check, 9 * SECOND));
      later(19 * SECOND, () => set(IO.backupWater, false));
    });
    // T3 circulation every 3 hours, unless it is empty
    for (let k = 0; k < 4; k++) {
      later(82 * SECOND + k * 3 * HOUR, () => {
        if (k > 0 && backupMode) backwashPulse(2 * SECOND);
        else circulate(between(7, 40) * MINUTE);
      });
      if (k === 0) {
        later(82 * SECOND + 15 * SECOND, () => {
          if (!circulating) set(IO.backupWater, backupMode);
        });
      }
    }
    // The battery is charged now and then
    for (const [from, ms] of [
      [4.77 * HOUR, 69 * MINUTE],
      [9.9 * HOUR, 67 * MINUTE],
    ]) {
      later(from, () => {
        set("accu_charge_enable", true);
        later(ms, () => set("accu_charge_enable", false));
      });
    }
  };

  const powerLoss = () => {
    bypassReasons.add("power");
    updateBypass();
    for (const train of Object.values(trains)) {
      train.token++;
      train.wait = undefined;
      train.mode = "hold";
      train.state = "";
      train.out = 0;
      train.skim = 0;
      train.busy = false;
      for (const name of [
        "air_pump",
        "add_air_valve",
        "bubbles_block",
        "release_air",
        "transfer_path",
      ]) {
        air(train, name, false);
      }
      uv.remove(`transfer-${train.side}`);
      uvValve.remove(`transfer-${train.side}`);
    }
    later(62 * SECOND, () => {
      for (const train of Object.values(trains)) {
        train.routine = "";
        enter(train, "STANDBY", "ENTRY");
      }
    });
    // Both trains and T3 are drained after a power loss
    later(9 * MINUTE, () => {
      behavior("fullWastePowerLoss", true);
      const drain = (train: Train, ms: number, next: () => void) => {
        air(train, "waste_clean_tank", true);
        train.waste = 15;
        train.mode = "vent";
        pulse(`release_air${train.sfx}`, 10 * SECOND);
        later(ms, () => {
          air(train, "waste_clean_tank", false);
          train.waste = 0;
          next();
        });
      };
      drain(trains.A, 119 * SECOND, () =>
        drain(trains.B, 588 * SECOND, () => {
          t3Draining = true;
          set(IO.wasteStorageTank, true);
          later(1126 * SECOND, () => {
            set(IO.wasteStorageTank, false);
            t3Draining = false;
            behavior("fullWastePowerLoss", false);
            bypassReasons.delete("power");
            updateBypass();
            for (const train of Object.values(trains)) standby(train);
          });
        }),
      );
    });
  };

  /** A technician fills T3 with backup water and drains it by hand */
  const manualFill = () => {
    const names = [
      IO.distributionPump,
      IO.backupWater,
      IO.wasteStorageTank,
      IO.backFlush,
      IO.preBackupWater,
    ];
    for (const name of names) setManual(name, true);
    pulse("buzzer", SECOND);
    later(6 * SECOND, () => {
      set(IO.backupWater, true);
      set(IO.preBackupWater, true);
      backFlush.add("manual");
      pump.add("manual");
      t3Filling = 15;
    });
    later(250 * SECOND, () => {
      set(IO.backupWater, backupMode);
      set(IO.preBackupWater, false);
      backFlush.remove("manual");
      pump.remove("manual");
      t3Filling = 0;
    });
    later(327 * SECOND, () => {
      set(IO.wasteStorageTank, true);
      t3Draining = true;
    });
    later(537 * SECOND, () => {
      set(IO.wasteStorageTank, false);
      t3Draining = false;
      for (const name of names) setManual(name, false);
    });
  };

  /** Pump bursts every 15 seconds, as if a toilet leaks */
  const leak = () => {
    for (let burst = 0; burst < 3; burst++) {
      later(burst * 300 * SECOND, () => {
        behaviorFor("distributionPumpFailSafeSmallLeak", 275 * SECOND);
        for (let i = 0; i < 18; i++) {
          later(i * 15 * SECOND, () => {
            const key = user("leak");
            toilet.use(key, 3 * SECOND);
            pump.use(key, 13 * SECOND);
            if (!backupMode) t3 = Math.max(T3_FLOOR, t3 - 0.8);
          });
        }
      });
    }
  };

  const appBypass = (ms: number) => {
    behavior("bypassByAppBypassValve", true);
    bypassReasons.add("app");
    updateBypass();
    later(ms, () => {
      behavior("bypassByAppBypassValve", false);
      bypassReasons.delete("app");
      updateBypass();
    });
  };

  // ── Schedule ──

  for (let day = start; day <= now; day += DAY) {
    const r = random(day / DAY);
    const local = day + tz;
    // Greywater from showers and sinks, at local times
    const intake: { start: number; ms: number; flow: number }[] = [];
    for (const [hour, chance] of [
      [6.8, 0.75],
      [7.4, 0.5],
      [20.5, 0.6],
    ]) {
      if (r() > chance) continue;
      intake.push({
        start: local + (hour + r() * 0.5) * HOUR,
        ms: (5 + r() * 5) * MINUTE,
        flow: 3.5 + r(),
      });
    }
    for (let i = 0; i < 3; i++) {
      intake.push({
        start: local + (7 + r() * 16) * HOUR,
        ms: (1 + r() * 2) * MINUTE,
        flow: 3,
      });
    }
    // Guests: more greywater than one train can take while the other one
    // removes filth, so both are busy and greywater is bypassed
    if (day === incident.guests) {
      for (const hour of [7.9, 8.3, 8.7, 9.1, 9.5, 17.6, 18, 18.4, 18.8]) {
        intake.push({ start: local + hour * HOUR, ms: 9 * MINUTE, flow: 6 });
      }
    }
    intake.sort((a, b) => a.start - b.start);
    let free = 0;
    for (const { start: t, ms, flow } of intake) {
      if (t < free || t < start) continue;
      free = t + ms + MINUTE;
      at(t, () => {
        intakes++;
        intakeFlow = flow;
        for (const side of SIDES) {
          const train = trains[side];
          const delay = side === selected ? 0 : r() * 30 * SECOND;
          later(delay, () => {
            if (train.state === "PASSIVE_CIRCULATE") incoming(train);
          });
        }
      });
      at(t + ms, () => {
        intakes--;
        lastIntakeEnd = clock;
      });
    }
    // Toilet flushes
    for (let i = 0; i < 20; i++) {
      const t = local + (6.5 + r() * 17) * HOUR;
      if (t >= start) at(t, () => flush((40 + r() * 45) * SECOND));
    }
    // Restarts every 12 hours
    for (const t of [day, day + 12 * HOUR]) at(t, restart);
    // UV-C is switched on briefly every 15 minutes
    for (let t = day + 11.75 * MINUTE; t < day + DAY; t += 15 * MINUTE) {
      at(t, () => uv.use("check", (1 + r()) * SECOND));
    }
  }
  for (const { start: t, ms } of incident.appBypass) at(t, () => appBypass(ms));
  at(incident.leak, leak);
  at(incident.manualFill, manualFill);
  at(incident.powerLoss, powerLoss);

  // ── Run ──

  behavior("pressingOptButton", true);
  for (const side of SIDES) standby(trains[side], { entry: true });
  updateBypass();

  const tanks: Record<TankId, Point[]> = {
    t1a: [],
    t2a: [],
    t1b: [],
    t2b: [],
    t3: [],
  };
  const noise = random(7);
  const jitter = (amount: number) => (noise() - 0.5) * amount;
  const dt = TICK / MINUTE;

  for (let t = start; t <= now; t += TICK) {
    // Events up to this tick
    while (queue.peek() && queue.peek()!.t <= t) {
      const event = queue.pop();
      clock = event.t;
      event.fn();
    }
    clock = t;
    for (const train of Object.values(trains)) {
      if (train.wait && clock >= train.wait.minAt && train.wait.until()) {
        train.wait.next();
      }
    }

    // Water
    for (const train of Object.values(trains)) {
      if (intakes > 0 && train.side === selected && !current[IO.bypass]) {
        train.water += intakeFlow * dt;
      }
      if (train.waste) {
        train.water = Math.max(8, train.water - train.waste * dt);
      }
      if (train.out && current[`transfer_path${train.sfx}`]) {
        const moved = Math.max(
          0,
          Math.min(train.out * dt, train.water - 20, T3_MAX - t3),
        );
        train.water -= moved;
        t3 += moved;
      }
      train.water -= (train.skim * dt) / 60;
      const target =
        train.mode === "vent"
          ? (T1_MAX * train.water) / (T2_MAX + T1_MAX)
          : train.mode === "lift"
            ? Math.min(T1_LIFTED, train.water - 15)
            : train.mode === "full"
              ? Math.min(T1_MAX, train.water - 15)
              : train.t1;
      const step = 4 * dt;
      train.t1 += Math.max(-step, Math.min(step, target - train.t1));
      train.t1 = Math.max(0, Math.min(T1_MAX, train.t1, train.water));
    }
    t3 += t3Filling * dt;
    if (t3Draining) t3 = Math.max(T3_FLOOR - 2, t3 - 12 * dt);
    t3 = Math.min(T3_MAX, t3);

    if (t % SAMPLE === 0) {
      const t1 = (train: Train) =>
        Math.max(0, Math.min(T1_MAX, train.t1 + jitter(0.3)));
      const t2 = (train: Train) =>
        Math.max(0, train.water - train.t1 + jitter(0.6));
      tanks.t1a.push({ t, v: t1(trains.A) });
      tanks.t2a.push({ t, v: t2(trains.A) });
      tanks.t1b.push({ t, v: t1(trains.B) });
      tanks.t2b.push({ t, v: t2(trains.B) });
      tanks.t3.push({ t, v: Math.max(0, t3 + jitter(0.8)) });
    }
  }

  const data: SimulatedData = {
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
      t2a: T2_MAX,
      t1b: TANK_CAPACITY.t1b!,
      t2b: T2_MAX,
      t3: T3_MAX,
    },
    io,
    manual,
    captions: {},
    routines,
    behaviorEvents,
    filthRemovals,
    soapBomb,
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
    const startIndex =
      first === -1 ? points.length - 1 : first <= 0 ? 0 : first - 1;
    return points.slice(startIndex).filter((p) => p.t <= end);
  };
  // T2 at the last venting before the range, as `loadDataset()` does
  const ventedBefore: Dataset["ventedBefore"] = {};
  for (const side of SIDES) {
    const name = side === "A" ? "release_air" : "release_air_b";
    const vent = ventings(data.io[name], from).at(-1);
    const level =
      vent && ventedLevel(data.tanks[side === "A" ? "t2a" : "t2b"], vent);
    if (level) ventedBefore[side] = level;
  }
  // Time left of filth removal, as reported when the routine started
  const cleaningTimeLeft: Dataset["cleaningTimeLeft"] = {};
  for (const f of data.filthRemovals) {
    if (f.t <= end) cleaningTimeLeft[f.side] = { t: f.t, ms: f.ms };
  }
  const { behaviorEvents, filthRemovals, soapBomb, ...rest } = data;
  void filthRemovals;
  void soapBomb;
  return {
    ...rest,
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
    manual: Object.fromEntries(
      Object.entries(data.manual ?? {}).map(([name, points]) => [
        name,
        inRange(points),
      ]),
    ),
    routines: data.routines.filter((r, i, all) => {
      if (r.t > end) return false;
      if (r.t >= from) return true;
      // The routine of each side before the range is still active, from its
      // first sub-state
      const next = all.slice(i + 1).find((n) => n.side === r.side);
      if (!next || next.t >= from) return true;
      const nextRoutine = all
        .slice(i + 1)
        .find((n) => n.side === r.side && n.name !== r.name);
      return nextRoutine === undefined || nextRoutine.t >= from;
    }),
    behaviors: behaviorIntervals(behaviorEvents, from, end),
    outages: simulatedOutages(from - DAY, end, now).outages.map((o) => ({
      start: o.start,
      end: o.end,
      classification: o.cause,
    })),
    ventedBefore,
    cleaningTimeLeft,
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

/** Simulated maintenance data. Signals, tickets and outages match the simulated incidents. */
export function simulateMaintenance(): Maintenance {
  const until = Date.now();
  const from = until - CONNECTIVITY_RANGE;
  const noise = random(42);
  const ago = (days: number) => until - days * DAY;
  const incident = incidents(until);
  const { soapBomb } = run(until);
  const { outages, restarts } = simulatedOutages(from, until, until);

  const step = 22 * MINUTE;
  const series = (f: (t: number) => number) => {
    const points: Point[] = [];
    for (let t = from; t <= until; t += step) points.push({ t, v: f(t) });
    return points;
  };
  const daily = (t: number) => Math.sin(((t % DAY) / DAY) * 2 * Math.PI);
  const vitals: VitalSeries[] = [
    {
      key: "uv_temperature",
      label: "UV-C lamp temperature",
      unit: "°C",
      digits: 1,
      points: series(
        (t) => 24 + 2 * daily(t) + (noise() < 0.08 ? 12 * noise() : 0),
      ),
    },
    {
      key: "power_voltage",
      label: "Supply voltage",
      unit: "V",
      digits: 1,
      low: { below: 19, label: "Power lost" },
      points: series((t) =>
        Math.abs(t - incident.powerLoss) < step / 2 ? 0 : 23 + noise() * 0.2,
      ),
    },
    {
      key: "battery_voltage",
      label: "Battery voltage",
      unit: "V",
      digits: 2,
      points: series(
        (t) => 5.6 - ((t - from) / CONNECTIVITY_RANGE) * 0.08 + noise() * 0.03,
      ),
    },
    {
      key: "device_amperage",
      label: "Device current",
      unit: "A",
      digits: 2,
      points: series(() =>
        noise() < 0.1 ? 1 + noise() * 0.8 : 0.03 + noise() * 0.02,
      ),
    },
    {
      key: "dist_pump_amperage",
      label: "Distribution pump current",
      unit: "A",
      digits: 2,
      points: series(() => (noise() < 0.12 ? 1.6 + noise() * 0.6 : 0.005)),
    },
  ];

  const leakEnd = incident.leak + 875 * SECOND;
  return {
    demo: true,
    fetchedAt: until,
    device: {
      name: "Demo H600",
      serial: "SIMULATED",
      type: "H600",
      firmware: null,
      firmwareCore: null,
      hardware: null,
      online: true,
      lastOnline: until,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      commissioned: ago(300),
      warrantyUntil: ago(300) + 2 * 365 * DAY,
      maintenanceMonths: 24,
      lastMaintenance: null,
      nextMaintenance: { t: ago(300) + 2 * 365 * DAY, estimated: true },
    },
    issues: [{ level: "minor", text: "Leaking toilet" }],
    stuck: [],
    manual: [],
    signals: [
      ...(incident.leak < until
        ? [
            {
              key: "toiletPipeLeak",
              side: null,
              errorId: 20,
              title: "Leaking toilet",
              description:
                "The distribution pump starts too often, as if a toilet or its pipe leaks.",
              start: incident.leak,
              last: Math.min(leakEnd, until),
              end: null,
              count: 3,
              active: true,
            },
          ]
        : []),
      ...(soapBomb
        ? [
            {
              key: "soapBomb",
              side: "A",
              errorId: 23,
              title: "Soap bomb detected",
              description: "Too much foam. The train was emptied to the drain.",
              start: soapBomb,
              last: soapBomb,
              end: null,
              count: 1,
              active: false,
            },
          ]
        : []),
      {
        key: "cloggedT1T2BottomOrAirIntake",
        side: null,
        errorId: 29,
        title: "Clogged T1/T2 bottom or air intake",
        description: null,
        start: ago(45),
        last: ago(44.5),
        end: ago(44),
        count: 3,
        active: false,
      },
    ],
    signalsFrom: until - SIGNALS_RANGE,
    tickets: [
      {
        id: "demo-1",
        title: "Unable to release water out of T3 properly",
        status: "Closed",
        closed: true,
        priority: "Low",
        subject: "Malfunction / Error",
        cause: "Improper plumbing",
        solution: "No intervention needed",
        note: null,
        automatic: true,
        created: ago(60),
        closedAt: ago(58),
      },
    ],
    serviceLog: [
      {
        id: "demo-s3",
        t: incident.manualFill + 9 * MINUTE,
        type: "Maintenance report",
        person: "Installer",
        title: "Maintenance report - Fill T3 with backup water",
        text: "Filled T3 with backup water and drained it again to check the T3 drain.",
      },
      {
        id: "demo-s1",
        t: ago(58),
        type: "Ticket cause",
        person: "Support",
        title:
          "Cause has been set for ticket Unable to release water out of T3 properly:",
        text: "Improper plumbing",
      },
      {
        id: "demo-s2",
        t: ago(300),
        type: "Maintenance report",
        person: "Installer",
        title: "Maintenance report - Fill T3 with backup water",
        text: "Successfully filled T3.",
      },
    ],
    professionals: [
      {
        role: "Installer",
        organisation: "Demo installer",
        note: null,
        since: ago(300),
      },
    ],
    connectivity: { from, until, outages, restarts },
    vitals: { from, until, series: vitals },
    warnings: [],
  };
}
