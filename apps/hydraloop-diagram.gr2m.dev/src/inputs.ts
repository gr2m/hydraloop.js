// What the playground's controls set: the signals, tank levels and routines at
// one moment. `toDataset` turns them into a `Dataset`, so that `stateAt`
// derives the diagram's state from them as it does from real data.

import fixtures from "hydraloop-diagram-react/test/fixtures/states.json" with { type: "json" };
import {
  IO,
  sideIo,
  TANK_IDS,
  type Dataset,
  type DeviceInfo,
  type DeviceState,
  type Point,
  type RoutineEvent,
  type Side,
  type TankId,
} from "hydraloop-diagram-react/model";

const MINUTE = 60_000;

export type Routine = { name: string; state: string } | null;

export type Inputs = {
  /** IO values by name, 0 or 1. Missing IOs have no data. */
  io: Record<string, number>;
  /** Liters (null: no data) and trend in liters per minute */
  tanks: Record<TankId, { liters: number | null; trend: number }>;
  routines: Record<Side, Routine>;
  /** Air was added to T2 before, so it holds pressure while its valves are closed */
  pressurized: Record<Side, boolean>;
  /** The bypass is switched on in the app (`bypassByAppBypassValve`) */
  bypassOverride: boolean;
  outlets: DeviceInfo["outlets"];
};

/** Scale of each tank in liters, as for the H600 */
export const TANK_MAX: Record<TankId, number> = {
  t1a: 24,
  t2a: 185,
  t1b: 24,
  t2b: 185,
  t3: 280,
};

export const ROUTINES = [
  "STANDBY",
  "INCOMING_WATER",
  "SKIM_LEVEL_DETERMINATION",
  "FILTH_REMOVAL",
  "TRANSFER",
];

/** Sub-states seen on an H600, for suggestions */
export const SUB_STATES = [
  "ENTRY",
  "PRESSURE_RESET",
  "AIR_BIOBALLS",
  "CONFIGURE_HEIGHT",
  "PASSIVE_CIRCULATE",
  "DETECT_INCOMING_WATER",
  "LEVEL_TANKS",
  "LEVEL_TANKS_T1T2",
  "DETECT_STOP_INCOMING_WATER",
  "FIND_HIGHEST_WATER_POINT",
  "REMOVE_FILTH_ON_HEIGHT",
  "SKIM_LAST_WATER",
  "CLEAN_WITH_SUCTION",
  "WASTE_T1T2",
  "TRANSFER_WATER_T3_LEVELED",
  "TRANSFER_WATER_T3_WHILE_PUSHING",
  "TRANSFER_LAST_WATER_TO_T3",
  "CLEAN_TRANSFER_TUBE",
];

const trainIo = (side: Side) =>
  [
    "air_pump",
    "add_air_valve",
    "release_air",
    "bubbles_block",
    "transfer_path",
    "waste_clean_tank",
    "diffuser_backwash",
  ].map((name) => sideIo(name, side));

/** The IOs the diagram shows, grouped like the controls */
export const IO_GROUPS: { label: string; names: string[]; hint?: string }[] = [
  {
    label: "Inlet",
    names: [IO.bypass, IO.abSelector],
    hint: "A/B valve on selects train B",
  },
  { label: "Train A", names: trainIo("A") },
  { label: "Train B", names: trainIo("B") },
  {
    label: "Storage and UV-C",
    names: [
      IO.uvValve,
      IO.uvPower,
      IO.circulation,
      IO.backFlush,
      IO.wasteStorageTank,
    ],
  },
  {
    label: "Supply",
    names: [
      IO.distributionPump,
      IO.backupWater,
      IO.preBackupWater,
      IO.t4Max,
      IO.t4Min,
    ],
  },
  { label: "Outlet demand", names: [IO.toilet, IO.wash, IO.auxiliary] },
];

export function emptyInputs(): Inputs {
  return {
    io: {},
    tanks: Object.fromEntries(
      TANK_IDS.map((id) => [id, { liters: null, trend: 0 }]),
    ) as Inputs["tanks"],
    routines: { A: null, B: null },
    pressurized: { A: false, B: false },
    bypassOverride: false,
    outlets: { toilet: true, washingMachine: true, auxiliary: false },
  };
}

/** Both trains in standby, all valves closed */
function standby(): Inputs {
  const io: Record<string, number> = {};
  for (const group of IO_GROUPS) for (const name of group.names) io[name] = 0;
  io[IO.t4Min] = 1;
  return {
    ...emptyInputs(),
    io,
    tanks: {
      t1a: { liters: 12, trend: 0 },
      t2a: { liters: 60, trend: 0 },
      t1b: { liters: 12, trend: 0 },
      t2b: { liters: 90, trend: 0 },
      t3: { liters: 150, trend: 0 },
    },
    routines: {
      A: { name: "STANDBY", state: "PASSIVE_CIRCULATE" },
      B: { name: "STANDBY", state: "PASSIVE_CIRCULATE" },
    },
  };
}

/** The inputs that `stateAt` derived a state from */
export function fromState(state: DeviceState, device: DeviceInfo): Inputs {
  const io: Record<string, number> = {};
  for (const [name, value] of Object.entries(state.io)) {
    if (value) io[name] = value.value;
  }
  const tanks = Object.fromEntries(
    TANK_IDS.map((id) => [
      id,
      {
        liters:
          state.tanks[id].liters === undefined
            ? null
            : Math.round(state.tanks[id].liters!),
        trend: Math.round((state.tanks[id].trend ?? 0) * 10) / 10,
      },
    ]),
  ) as Inputs["tanks"];
  const routine = (side: Side): Routine => {
    const r = state.routine[side];
    return r ? { name: r.name, state: r.state } : null;
  };
  return {
    io,
    tanks,
    routines: { A: routine("A"), B: routine("B") },
    pressurized: {
      A: state.trains.A.pressurized,
      B: state.trains.B.pressurized,
    },
    bypassOverride: state.systemBehaviors.some(
      (b) => b.name === "bypassByAppBypassValve",
    ),
    outlets: device.outlets,
  };
}

const LABELS: Record<string, string> = {
  receiving: "Receiving greywater",
  "filth-removal": "Filth removal",
  transfer: "Transfer to T3",
  circulation: "T3 circulation through UV-C",
  "backup-water": "Supply from backup water",
  bypass: "Bypass",
  draining: "T3 draining",
};

/**
 * States of the simulated H600 of the H600 dashboard, from the package's test
 * fixtures
 */
export const PRESETS: { key: string; label: string; inputs: () => Inputs }[] = [
  { key: "standby", label: "Standby", inputs: standby },
  ...Object.entries(
    fixtures.states as unknown as Record<string, DeviceState>,
  ).map(([key, state]) => ({
    key,
    label: LABELS[key] ?? key,
    inputs: () => fromState(state, fixtures.device as DeviceInfo),
  })),
  { key: "no-data", label: "No data", inputs: emptyInputs },
];

/**
 * A dataset whose state at `t` matches the inputs. Each signal and routine
 * changed 5 minutes before `t`, and the tanks changed by their trend over the
 * 10 minutes before.
 */
export function toDataset(inputs: Inputs, t: number): Dataset {
  const changed = t - 5 * MINUTE;
  const io: Record<string, Point[]> = {};
  for (const [name, v] of Object.entries(inputs.io)) {
    io[name] = [{ t: changed, v }];
  }
  // Air added to T2 before: the air pump ran with the add air valve open
  for (const side of ["A", "B"] as Side[]) {
    if (!inputs.pressurized[side]) continue;
    for (const name of ["air_pump", "add_air_valve"]) {
      const key = sideIo(name, side);
      io[key] = [
        { t: t - 30 * MINUTE, v: 1 },
        { t: t - 20 * MINUTE, v: 0 },
        ...(io[key] ?? []),
      ];
    }
  }

  const tanks = {} as Dataset["tanks"];
  for (const id of TANK_IDS) {
    const { liters, trend } = inputs.tanks[id];
    tanks[id] =
      liters === null
        ? []
        : [
            { t: t - 10 * MINUTE, v: liters - trend * 10 },
            { t, v: liters },
          ];
  }

  const routines: RoutineEvent[] = [];
  for (const side of ["A", "B"] as Side[]) {
    const r = inputs.routines[side];
    if (r) routines.push({ t: changed, side, routine: 0, ...r });
  }

  return {
    device: {
      id: "playground",
      name: "Playground",
      serial: null,
      type: "H600",
      firmware: null,
      online: true,
      outlets: inputs.outlets,
    },
    demo: true,
    from: t - 60 * MINUTE,
    until: t,
    fetchedAt: t,
    tanks,
    tankMax: TANK_MAX,
    io,
    captions: {},
    routines,
    behaviors: inputs.bypassOverride
      ? [
          {
            name: "bypassByAppBypassValve",
            typeId: 0,
            side: "SYSTEM",
            label: "Bypass by app bypass valve",
            start: changed,
            end: t,
            open: true,
          },
        ]
      : [],
    warnings: [],
  };
}
