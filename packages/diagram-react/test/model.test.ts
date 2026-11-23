import { describe, expect, test } from "vitest";

import {
  capacityNote,
  caption,
  IO,
  roomAt,
  sideIo,
  stateAt,
  stepAt,
  valueAt,
  type Dataset,
  type RoutineEvent,
} from "../src/model.js";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 10, 20, 12);

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    device: {
      id: "test",
      name: "Test H600",
      serial: null,
      type: "H600",
      firmware: null,
      online: true,
      outlets: { toilet: true, washingMachine: true, auxiliary: false },
    },
    demo: true,
    from: T0,
    until: T0 + 60 * MINUTE,
    fetchedAt: T0 + 60 * MINUTE,
    tanks: { t1a: [], t2a: [], t1b: [], t2b: [], t3: [] },
    tankMax: { t1a: 24, t2a: 185, t1b: 24, t2b: 185, t3: 280 },
    io: {},
    captions: {},
    routines: [],
    behaviors: [],
    warnings: [],
    ...overrides,
  };
}

function routine(
  minutes: number,
  side: RoutineEvent["side"],
  name: string,
  state = "ENTRY",
): RoutineEvent {
  return { t: T0 + minutes * MINUTE, side, routine: 0, name, state };
}

/** IO points from [minute, value] pairs */
function io(...points: [number, number][]) {
  return points.map(([m, v]) => ({ t: T0 + m * MINUTE, v }));
}

describe("lookups", () => {
  const points = io([0, 0], [10, 100], [60, 0]);

  test("stepAt", () => {
    expect(stepAt(points, T0 - 1)).toBeUndefined();
    expect(stepAt(points, T0 + 15 * MINUTE)?.v).toBe(100);
    expect(stepAt(undefined, T0)).toBeUndefined();
  });

  test("valueAt interpolates, but not across gaps", () => {
    expect(valueAt(points, T0 + 5 * MINUTE)).toBe(50);
    // 50 minutes between the points is a gap in the data
    expect(valueAt(points, T0 + 30 * MINUTE)).toBeUndefined();
    expect(valueAt(points, T0 + 65 * MINUTE)).toBe(0);
    expect(valueAt(points, T0 + 75 * MINUTE)).toBeUndefined();
  });
});

describe("labels", () => {
  test("sideIo", () => {
    expect(sideIo("transfer_path", "A")).toBe("transfer_path");
    expect(sideIo("transfer_path", "B")).toBe("transfer_path_b");
  });

  test("caption", () => {
    expect(caption({}, IO.bypass)).toBe("Bypass");
    expect(caption({}, "air_pump_b")).toBe("Air pump B");
    expect(caption({ release_air: "Release air valve" }, "release_air")).toBe(
      "Release air valve",
    );
  });

  test("capacityNote", () => {
    const level = { liters: 10, pct: 0.5, trend: 0 };
    expect(capacityNote({ ...level, max: 20, capacity: undefined })).toBe("");
    expect(capacityNote({ ...level, max: 24, capacity: 24 })).toBe(
      "The tank holds about 24 L (estimated from Hydraloop's 3D model).",
    );
    expect(capacityNote({ ...level, max: 185, capacity: 200 })).toMatch(
      /^The scale is the sensor's range of 185 L\./,
    );
  });
});

describe("stateAt", () => {
  test("without data", () => {
    const state = stateAt(dataset(), T0);
    expect(state.trains.A.phase).toBe("unknown");
    expect(state.trains.A.confidence).toBe("unknown");
    expect(state.tanks.t3.liters).toBeUndefined();
    expect(state.t3.label).toBe("Holding");
    expect(state.t4.label).toBe("No float data");
    expect(state.supply.source).toBe("unknown");
    expect(state.room.liters).toBeUndefined();
  });

  test("tank levels, fill and trend", () => {
    const ds = dataset({
      tanks: {
        t1a: [],
        t2a: [],
        t1b: [],
        t2b: [],
        t3: io([0, 100], [10, 120], [20, 140]),
      },
    });
    const { t3 } = stateAt(ds, T0 + 20 * MINUTE).tanks;
    expect(t3.liters).toBe(140);
    expect(t3.pct).toBe(0.5);
    expect(t3.trend).toBe(2);
    expect(t3.capacity).toBeUndefined();
  });

  test("reported routine", () => {
    const ds = dataset({
      routines: [
        routine(0, "A", "FILTH_REMOVAL", "ENTRY"),
        routine(5, "A", "FILTH_REMOVAL", "REMOVE_FILTH_ON_HEIGHT"),
        routine(0, "B", "STANDBY", "PASSIVE_CIRCULATE"),
      ].sort((a, b) => a.t - b.t),
    });
    const { trains, routine: current } = stateAt(ds, T0 + 10 * MINUTE);
    expect(trains.A).toMatchObject({
      phase: "cleaning",
      label: "Filth removal",
      detail: "Remove filth on height",
      confidence: "reported",
      since: T0,
      skimming: true,
    });
    expect(trains.B).toMatchObject({
      phase: "idle",
      label: "Standby",
      detail: "Passive circulate",
      skimming: false,
    });
    expect(current.A?.state).toBe("REMOVE_FILTH_ON_HEIGHT");
  });

  test("an open transfer valve overrides the routine", () => {
    const ds = dataset({
      routines: [routine(0, "B", "STANDBY")],
      io: {
        transfer_path_b: io([0, 0], [5, 1]),
        [IO.uvPower]: io([0, 1]),
      },
    });
    const state = stateAt(ds, T0 + 10 * MINUTE);
    expect(state.trains.B).toMatchObject({
      phase: "transferring",
      confidence: "valve",
      since: T0 + 5 * MINUTE,
      evidence: ["Transfer valve open"],
    });
    expect(state.t3).toMatchObject({
      label: "Receiving from B",
      receivingFrom: ["B"],
      uv: true,
    });
  });

  test("greywater goes to the train of the A/B valve", () => {
    const ds = dataset({
      routines: [
        routine(0, "A", "INCOMING_WATER"),
        routine(0, "B", "INCOMING_WATER"),
      ],
      io: { [IO.abSelector]: io([0, 1]), [IO.bypass]: io([0, 0]) },
    });
    const state = stateAt(ds, T0 + MINUTE);
    expect(state.inlet).toEqual({ bypass: false, receiving: ["B"] });
    expect(state.trains.A.phase).toBe("idle");
    expect(state.trains.B.phase).toBe("receiving");
    expect(state.room.filling).toBe("B");
  });

  test("supply from backup water", () => {
    const ds = dataset({
      io: {
        [IO.backupWater]: io([0, 1]),
        [IO.distributionPump]: io([0, 1]),
        [IO.toilet]: io([0, 1]),
        [IO.t4Max]: io([0, 0]),
        [IO.t4Min]: io([0, 1]),
      },
    });
    const state = stateAt(ds, T0);
    expect(state.supply).toMatchObject({
      pumping: true,
      source: "backup",
      toilet: true,
    });
    expect(state.t4.label).toBe("Above min");
  });

  test("T2 holds pressure after air was added", () => {
    const ds = dataset({
      io: {
        air_pump: io([0, 0], [10, 1], [12, 0]),
        add_air_valve: io([0, 0], [10, 1], [12, 0]),
        release_air: io([0, 1], [5, 0]),
      },
    });
    expect(stateAt(ds, T0 + 8 * MINUTE).trains.A.pressurized).toBe(false);
    expect(stateAt(ds, T0 + 20 * MINUTE).trains.A.pressurized).toBe(true);
  });
});

describe("roomAt", () => {
  test("room from T2 at the last venting", () => {
    const ds = dataset({
      routines: [routine(0, "A", "STANDBY"), routine(0, "B", "FILTH_REMOVAL")],
      // Vented for 4 minutes, T2 settles at 100 L in the second half
      io: { release_air: io([0, 0], [10, 1], [14, 0]) },
      tanks: {
        t1a: [],
        t2a: io([10, 90], [12, 100], [13, 100], [14, 101]),
        t1b: [],
        t2b: [],
        t3: [],
      },
    });
    const room = roomAt(ds, T0 + 30 * MINUTE);
    expect(room.trains.A).toMatchObject({
      liters: 34,
      t2: 100,
      accepting: true,
    });
    expect(room.trains.B).toMatchObject({ liters: 0, accepting: false });
    expect(room.liters).toBe(34);
    expect(room.partial).toBe(false);
  });

  test("the bypass during a scheduled restart doesn't count", () => {
    const ds = dataset({
      io: { [IO.bypass]: io([0, 0], [10, 1], [11, 0], [30, 1]) },
      outages: [
        {
          start: T0 + 10 * MINUTE,
          end: T0 + 11 * MINUTE,
          classification: "scheduled_restart",
        },
      ],
    });
    expect(roomAt(ds, T0 + 10.5 * MINUTE)).toMatchObject({
      bypass: false,
      restart: true,
    });
    expect(roomAt(ds, T0 + 40 * MINUTE)).toMatchObject({
      bypass: true,
      restart: false,
      liters: 0,
    });
  });
});
