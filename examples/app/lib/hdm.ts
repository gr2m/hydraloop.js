import "server-only";

import { Hydraloop, type Local, type Root } from "hydraloop/internal";

import {
  behaviorIntervals,
  routineSide,
  pressureToLiters,
  t1PointsToLiters,
  TANK_CAPACITY,
  TANK_IDS,
  TANK_LINES,
  type Dataset,
  type DeviceInfo,
  type LevelTable,
  type Point,
  type RoutineEvent,
  type TankId,
} from "./model";
import { computeStats, type Stats } from "./stats";

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
    if (id === "t1a" || id === "t1b") {
      // The calibration table doesn't fit T1, see t1PointsToLiters
      tankMax[id] = TANK_CAPACITY[id]!;
      tanks[id] = toPoints(
        graphData[TANK_LINES[id]],
        (y) => Math.round(t1PointsToLiters(y) * 10) / 10,
      );
      continue;
    }
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
    warnings.push(
      "T2 and T3 levels are shown in raw pressure points, not liters.",
    );
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
    behaviors: behaviorIntervals(
      (ioData?.behavior ?? []).map((b) => ({
        t: Date.parse(b.time),
        name: b.typeName,
        typeId: b.typeId,
        engaged: b.subTypeName === "engaged",
      })),
      from,
      until,
    ),
    warnings,
  };
}

const statsCache = new Map<string, { at: number; stats: Promise<Stats> }>();
const STATS_TTL = 10 * 60_000;

/**
 * Statistics of the last `range` milliseconds. `getIo()` returns about 5 days
 * before `until`, whatever `from` is, so valves are loaded window by window.
 */
export function loadStats(
  token: string,
  { range, zone }: { range: number; zone: string },
): Promise<Stats> {
  const key = `${token} ${zone} ${range}`;
  const hit = statsCache.get(key);
  if (hit && Date.now() - hit.at < STATS_TTL) return hit.stats;
  if (statsCache.size > 20) statsCache.clear();
  const stats = computeStatsFromHdm(token, range, zone);
  statsCache.set(key, { at: Date.now(), stats });
  stats.catch(() => statsCache.delete(key));
  return stats;
}

async function computeStatsFromHdm(
  token: string,
  range: number,
  zone: string,
): Promise<Stats> {
  const entry = cached(token);
  const { hydraloop } = entry;
  const device = await remember(entry, "device", () => firstDevice(hydraloop));
  const deviceId = device.id;
  const until = Date.now();
  const from = until - range;

  const loadIo = async () => {
    const value: Record<string, Map<number, number>> = {};
    const behavior = new Map<
      string,
      { t: number; name: string; typeId: number; engaged: boolean }
    >();
    let end = until;
    // At most 12 windows, in case HDM returns more or less than expected
    for (let i = 0; i < 12 && end > from; i++) {
      const io = await hydraloop.local.graph.getIo({
        deviceId,
        from: new Date(Math.max(from, end - 24 * 3600_000)),
        until: new Date(end),
      });
      let earliest = end;
      for (const [name, points] of Object.entries(io.value ?? {})) {
        const map = (value[name] ??= new Map());
        for (const p of points) {
          const t = Date.parse(p.x);
          if (!Number.isFinite(t)) continue;
          map.set(t, p.y);
          earliest = Math.min(earliest, t);
        }
      }
      for (const b of io.behavior ?? []) {
        const t = Date.parse(b.time);
        if (!Number.isFinite(t)) continue;
        behavior.set(`${t} ${b.typeName} ${b.subTypeName}`, {
          t,
          name: b.typeName,
          typeId: b.typeId,
          engaged: b.subTypeName === "engaged",
        });
      }
      if (earliest >= end) break;
      end = earliest;
    }
    const points: Record<string, Point[]> = {};
    for (const [name, map] of Object.entries(value)) {
      points[name] = [...map]
        .map(([t, v]) => ({ t, v }))
        .sort((a, b) => a.t - b.t);
    }
    return { points, behaviors: [...behavior.values()] };
  };

  const [io, routines, recycled] = await Promise.allSettled([
    loadIo(),
    hydraloop.local.graph.getRoutineData({
      deviceId,
      // Look further back to know the routine that runs at `from`
      from: new Date(from - 24 * 3600_000),
      until: new Date(until),
    }),
    hydraloop.local.graph.getWaterRecycledData({
      deviceId,
      unit: "day",
      from: new Date(from).toISOString(),
      until: new Date(until).toISOString(),
      zone,
    }),
  ]);

  const warnings: string[] = [];
  const ioData = settled(io, "Valves and pumps", warnings);
  const routineData = settled(routines, "Routines", warnings);
  const recycledData = settled(recycled, "Recycled water", warnings);

  const days = toPoints(recycledData?.waterRecycled).filter(
    (p) => p.t >= from - 24 * 3600_000,
  );
  const stats = computeStats(
    {
      from,
      until,
      io: ioData?.points ?? {},
      routines: (routineData?.routines ?? [])
        .map((r) => ({
          t: Date.parse(r.x),
          side: routineSide(r.side),
          routine: r.routine,
          name: r.name ?? "",
          state: r.state ?? "",
        }))
        .filter((r) => Number.isFinite(r.t))
        .sort((a, b) => a.t - b.t),
      behaviors: behaviorIntervals(ioData?.behaviors ?? [], from, until),
    },
    recycledData
      ? {
          liters: days.reduce((sum, p) => sum + p.v, 0),
          days,
          source: "hdm",
        }
      : undefined,
  );
  return { ...stats, demo: false, fetchedAt: Date.now(), warnings };
}

export async function login(options: {
  username: string;
  password: string;
  totpCode?: string;
}) {
  const hydraloop = new Hydraloop();
  return hydraloop.login(options);
}
