import "server-only";

import { Hydraloop, type Local, type Root } from "hydraloop/internal";

import {
  routineSide,
  pressureToLiters,
  TANK_IDS,
  TANK_LINES,
  type Dataset,
  type DeviceInfo,
  type LevelTable,
  type Point,
  type RoutineEvent,
  type TankId,
} from "./model";

// Clients are cached per token. The SDK caches the device's local API URL and
// the device token, so we don't request them again on every poll.
type Cached = {
  hydraloop: Hydraloop;
  device?: Promise<Root.Device>;
  levels?: Promise<Local.DeviceLevels>;
  config?: Promise<Local.GraphConfig>;
};
const clients = new Map<string, Cached>();

function cached(token: string): Cached {
  let entry = clients.get(token);
  if (!entry) {
    if (clients.size > 20) clients.clear();
    entry = { hydraloop: new Hydraloop({ token }) };
    clients.set(token, entry);
  }
  return entry;
}

/** Forget a failed promise so that the next request tries again */
function remember<T>(
  entry: Cached,
  key: "device" | "levels" | "config",
  load: () => Promise<T>,
): Promise<T> {
  if (!entry[key]) {
    const promise = load();
    // @ts-expect-error -- the key matches T
    entry[key] = promise;
    promise.catch(() => {
      entry[key] = undefined;
    });
  }
  return entry[key] as Promise<T>;
}

async function firstDevice(hydraloop: Hydraloop) {
  const { records = [] } = await hydraloop.root.devices.listDevices({
    event: { first: 0, rows: 50 },
  });
  if (records.length === 0) throw new Error("No devices in this account");
  // Prefer an H600, as the dashboard is built for its two treatment trains
  return (
    records.find((d) => /600/.test(`${d.type} ${d.subType}`)) ?? records[0]
  );
}

function deviceInfo(device: Root.Device): DeviceInfo {
  return {
    id: device.id,
    name: device.alias || device.deviceName || device.serial,
    serial: device.serial ?? null,
    type: [device.type, device.subType].filter(Boolean).join(" ") || null,
    firmware: device.firmwareVersion ?? null,
    online: typeof device.online === "boolean" ? device.online : null,
    outlets: {
      toilet: device.toilet ?? null,
      washingMachine: device.washingMachine ?? null,
      auxiliary: device.auxiliary ?? null,
    },
  };
}

function toPoints(
  points: { x: string; y: number }[] | undefined,
  convert: (y: number) => number = (y) => y,
): Point[] {
  return (points ?? [])
    .map((p) => ({ t: Date.parse(p.x), v: convert(p.y) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
}

function settled<T>(
  result: PromiseSettledResult<T>,
  what: string,
  warnings: string[],
): T | undefined {
  if (result.status === "fulfilled") return result.value;
  const reason = result.reason as { response?: { status?: number } } | Error;
  if ("response" in reason && reason.response?.status === 401) throw reason;
  warnings.push(
    `${what} could not be loaded: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
  return undefined;
}

export type LoadOptions = {
  from: number;
  until: number;
  /** Also load the last known IO state and the latest routine before `from` */
  live?: boolean;
};

export async function loadDataset(
  token: string,
  { from, until, live = false }: LoadOptions,
): Promise<Dataset> {
  const entry = cached(token);
  const { hydraloop } = entry;
  const device = await remember(entry, "device", () => firstDevice(hydraloop));
  const deviceId = device.id;

  // Look further back to know the routine that runs at `from`, and since when
  const routinesFrom = from - 24 * 3600_000;

  const [levels, config, data, io, routines, lastIo, shallow] =
    await Promise.allSettled([
      remember(entry, "levels", () =>
        hydraloop.local.graph.getDeviceLevels({ deviceId }),
      ),
      remember(entry, "config", () =>
        hydraloop.local.graph.getGraphConfig({ deviceId, debugData: false }),
      ),
      hydraloop.local.graph.getData({
        deviceId,
        from: new Date(from),
        until: new Date(until),
        minutesInView: Math.round((until - from) / 60_000),
        debugData: false,
      }),
      hydraloop.local.graph.getIo({
        deviceId,
        from: new Date(from),
        until: new Date(until),
      }),
      hydraloop.local.graph.getRoutineData({
        deviceId,
        from: new Date(routinesFrom),
        until: new Date(until),
      }),
      live
        ? hydraloop.local.graph.getLastKnownIoState({ deviceId })
        : Promise.resolve([]),
      // Refresh the online state
      live
        ? hydraloop.root.devices.getDeviceShallow({ id: deviceId })
        : Promise.resolve(device),
    ]);

  const warnings: string[] = [];
  const levelTables = settled(levels, "Tank calibration", warnings);
  const graphConfig = settled(config, "Graph config", warnings);
  const graphData = settled(data, "Tank levels", warnings) ?? {};
  const ioData = settled(io, "Valves and pumps", warnings);
  const routineData = settled(routines, "Routines", warnings);
  const lastIoData = settled(lastIo, "Current valve state", warnings) ?? [];
  const deviceData = settled(shallow, "Device", warnings) ?? device;

  const tableFor = (id: TankId): LevelTable =>
    [
      ...((id === "t3" ? levelTables?.t3Levels : levelTables?.t1t2Levels) ??
        []),
    ].sort((a, b) => a.p - b.p);

  const tanks = {} as Record<TankId, Point[]>;
  const tankMax = {} as Record<TankId, number>;
  for (const id of TANK_IDS) {
    const table = tableFor(id);
    tankMax[id] = table.length ? table[table.length - 1].l : 0;
    tanks[id] = toPoints(graphData[TANK_LINES[id]], (y) =>
      // Without calibration, show the raw pressure points
      table.length ? Math.round(pressureToLiters(y, table) * 10) / 10 : y,
    );
    if (!table.length && tanks[id].length) {
      tankMax[id] = Math.max(...tanks[id].map((p) => p.v));
    }
  }
  if (!levelTables) {
    warnings.push("Tank levels are shown in raw pressure points, not liters.");
  }

  const ioPoints: Record<string, Point[]> = {};
  for (const [name, points] of Object.entries(ioData?.value ?? {})) {
    ioPoints[name] = toPoints(points);
  }
  // Add the last known state, which may be older than the range
  for (const state of lastIoData) {
    const t = Date.parse(state.time);
    const points = (ioPoints[state.type] ??= []);
    const last = points[points.length - 1];
    if (!Number.isFinite(t)) continue;
    if (!last || t > last.t) points.push({ t, v: state.value });
  }
  for (const [name, points] of Object.entries(ioPoints)) {
    points.sort((a, b) => a.t - b.t);
    // `getIo()` returns days of changes regardless of `from`. Keep the range,
    // plus the last change before it for the state at `from`.
    const first = points.findIndex((p) => p.t >= from);
    const start = first === -1 ? points.length - 1 : Math.max(0, first - 1);
    ioPoints[name] = points.slice(start);
  }

  const captions: Record<string, string> = {};
  for (const io of graphConfig?.ios ?? []) {
    if (io.caption) captions[io.name] = io.caption;
  }

  const routineEvents: RoutineEvent[] = (routineData?.routines ?? [])
    .map((r) => ({
      t: Date.parse(r.x),
      side: routineSide(r.side),
      routine: r.routine,
      name: r.name ?? "",
      state: r.state ?? "",
    }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);

  return {
    device: deviceInfo(deviceData),
    demo: false,
    from,
    until,
    fetchedAt: Date.now(),
    tanks,
    tankMax,
    io: ioPoints,
    captions,
    routines: routineEvents,
    warnings,
  };
}

export async function login(options: {
  username: string;
  password: string;
  totpCode?: string;
}) {
  const hydraloop = new Hydraloop();
  return hydraloop.login(options);
}
