import "server-only";

import { Hydraloop, type Local, type Root } from "hydraloop-internal";

import {
  behaviorIntervals,
  caption,
  routineSide,
  pressureToLiters,
  sideIo,
  t1PointsToLiters,
  TANK_CAPACITY,
  TANK_IDS,
  TANK_LINES,
  ventedLevel,
  ventings,
  type Dataset,
  type DeviceInfo,
  type LevelTable,
  type Outage,
  type Point,
  type RoutineEvent,
  type Side,
  type TankId,
} from "./model";
import { hdmTexts, readable, type Lookup } from "./hdm-texts";
import {
  addMonths,
  CONNECTIVITY_RANGE,
  outageGroup,
  plainText,
  signalEpisodes,
  SIGNALS_RANGE,
  type Issue,
  type IssueLevel,
  type Maintenance,
  type VitalSeries,
} from "./maintenance";
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
  // A 401 ends the session, unless the account lacks the permission
  if (
    "response" in reason &&
    reason.response?.status === 401 &&
    !/Insufficient permissions/.test(String((reason as Error).message))
  ) {
    throw reason;
  }
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

  const [
    levels,
    config,
    data,
    io,
    routines,
    lastIo,
    shallow,
    outages,
    treatment,
  ] = await Promise.allSettled([
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
    loadOutages(hydraloop, deviceId, from, until),
    live
      ? hydraloop.local.settings.getTankTreatmentState({ deviceId })
      : Promise.resolve([]),
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

  // Without calibration, show the raw pressure points
  const toLiters = (id: TankId) => {
    const table = tableFor(id);
    return (y: number) =>
      table.length ? Math.round(pressureToLiters(y, table) * 10) / 10 : y;
  };

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
    tanks[id] = toPoints(graphData[TANK_LINES[id]], toLiters(id));
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
  const manualPoints: Record<string, Point[]> = {};
  for (const [name, points] of Object.entries(ioData?.manual ?? {})) {
    manualPoints[name] = toPoints(points);
  }
  // Add the last known state, which may be older than the range
  for (const state of lastIoData) {
    const t = Date.parse(state.time);
    if (!Number.isFinite(t)) continue;
    for (const [record, v] of [
      [ioPoints, state.value],
      [manualPoints, state.manual],
    ] as const) {
      const points = (record[state.type] ??= []);
      const last = points[points.length - 1];
      if (!last || t > last.t) points.push({ t, v });
    }
  }
  for (const points of [
    ...Object.values(ioPoints),
    ...Object.values(manualPoints),
  ]) {
    points.sort((a, b) => a.t - b.t);
  }

  // T2 at the last venting before `from`. Without it, the room for greywater
  // is unknown until both trains vent again, which can take hours.
  const ventedBefore: Partial<Record<Side, Point>> = {};
  await Promise.all(
    (["A", "B"] as const).map(async (side) => {
      const vent = ventings(ioPoints[sideIo("release_air", side)], from)
        .filter((i) => !i.open)
        .at(-1);
      if (!vent) return;
      const id = side === "A" ? "t2a" : "t2b";
      try {
        const data = await hydraloop.local.graph.getData({
          deviceId,
          from: new Date(vent.start),
          until: new Date(vent.end),
          minutesInView: Math.ceil((vent.end - vent.start) / 60_000),
          debugData: false,
        });
        const level = ventedLevel(
          toPoints(data[TANK_LINES[id]], toLiters(id)),
          vent,
        );
        if (level) ventedBefore[side] = level;
      } catch {
        // The room is then unknown until the next venting
      }
    }),
  );

  // `getIo()` returns days of changes regardless of `from`. Keep the range,
  // plus the last change before it for the state at `from`.
  for (const record of [ioPoints, manualPoints]) {
    for (const [name, points] of Object.entries(record)) {
      const first = points.findIndex((p) => p.t >= from);
      const start = first === -1 ? points.length - 1 : Math.max(0, first - 1);
      record[name] = points.slice(start);
    }
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
    manual: manualPoints,
    captions,
    routines: routineEvents,
    levelTables: { t1t2: tableFor("t2a"), t3: tableFor("t3") },
    ventedBefore,
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
    outages: outages.status === "fulfilled" ? outages.value : undefined,
    cleaningTimeLeft:
      treatment.status === "fulfilled"
        ? cleaningTimeLeft(treatment.value)
        : undefined,
    warnings,
  };
}

export type SocketConnection = {
  deviceId: string;
  localApiUrl: string;
  /**
   * A device token. It works as a full user token, so it must only be given
   * to the browser of the user it belongs to.
   */
  token: string;
  expiresAt: number;
};

/** What the browser needs to open the device socket itself */
export async function loadSocketConnection(
  token: string,
): Promise<SocketConnection> {
  const entry = cached(token);
  const { hydraloop } = entry;
  const device = await remember(entry, "device", () => firstDevice(hydraloop));
  // Always a new device token, as the browser asks after the old one was refused
  const { token: deviceToken, expiresIn } =
    await hydraloop.root.auth.tokenForDevice({ deviceId: device.id });
  return {
    deviceId: device.id,
    localApiUrl: device.localApiUrl,
    token: deviceToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

/**
 * Keeps the live graph of the device active, as the HDM web app does every
 * 90 seconds while it shows the graph. The socket also sent readings in real
 * time without it, but it may be what keeps the H600 from reporting only
 * about once a minute.
 */
export async function sendHeartbeat(token: string): Promise<void> {
  const entry = cached(token);
  const { hydraloop } = entry;
  const device = await remember(entry, "device", () => firstDevice(hydraloop));
  await hydraloop.local.graph.setActiveHeartBeat({
    body: { deviceId: device.id },
  });
}

/**
 * `cleaningTimeLeftA/B` of `getTankTreatmentState()`, in milliseconds. The
 * HDM web app shows them as the time left of filth removal.
 */
function cleaningTimeLeft(
  settings: { name?: string; value?: number; time?: string }[],
): Dataset["cleaningTimeLeft"] {
  const result: Dataset["cleaningTimeLeft"] = {};
  for (const side of ["A", "B"] as const) {
    const setting = settings.find((s) => s.name === `cleaningTimeLeft${side}`);
    const t = Date.parse(setting?.time ?? "");
    if (typeof setting?.value === "number" && Number.isFinite(t)) {
      result[side] = { t, ms: setting.value };
    }
  }
  return result;
}

/** A response item of `getOutageSummaries()`, which has no schema in the spec */
type OutageSummary = {
  startedAt: string;
  endedAt?: string | null;
  classification: string;
};

/**
 * Restarts and connection losses, to tell the scheduled restart apart.
 * Undefined if HDM refuses them, e.g. with a 401 for missing permissions,
 * which must not end the session like other 401s.
 */
async function loadOutages(
  hydraloop: Hydraloop,
  deviceId: string,
  from: number,
  until: number,
): Promise<Outage[] | undefined> {
  let summaries: OutageSummary[];
  try {
    summaries = await hydraloop.local.connectivity.getOutageSummaries({
      deviceId,
      from: new Date(from),
      until: new Date(until),
    });
  } catch {
    return undefined;
  }
  return summaries
    .map((o) => ({
      start: Date.parse(o.startedAt),
      end: o.endedAt ? Date.parse(o.endedAt) : until,
      classification: o.classification,
    }))
    .filter((o) => Number.isFinite(o.start) && Number.isFinite(o.end));
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

  const [io, routines, recycled, outages] = await Promise.allSettled([
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
    loadOutages(hydraloop, deviceId, from, until),
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
      outages: outages.status === "fulfilled" ? outages.value : undefined,
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

// ── Maintenance ────────────────────────────────────────────────────────────

/** Series of `getData()` shown as device vitals, scaled like the HDM web app does */
const VITALS: (Omit<VitalSeries, "points"> & { scale: number })[] = [
  {
    key: "uv_temperature",
    label: "UV-C lamp temperature",
    unit: "°C",
    digits: 1,
    scale: 1,
  },
  {
    key: "power_voltage",
    label: "Supply voltage",
    unit: "V",
    digits: 1,
    scale: 0.1,
    // The HDM web app takes less than 19 V as a power loss
    low: { below: 19, label: "Power lost" },
    note: "From the power supply inside the H600, not the mains voltage.",
  },
  {
    key: "battery_voltage",
    label: "Battery voltage",
    unit: "V",
    digits: 2,
    scale: 0.01,
    note: "The rechargeable AA batteries that keep the controller running during a power cut.",
  },
  {
    key: "device_amperage",
    label: "Device current",
    unit: "A",
    digits: 2,
    scale: 0.001,
  },
  {
    key: "dist_pump_amperage",
    label: "Distribution pump current",
    unit: "A",
    digits: 2,
    scale: 0.001,
    note: "Peaks while the pump supplies an outlet or circulates T3.",
  },
];

const ISSUE_FIELDS: [IssueLevel, keyof Root.DeviceStatus][] = [
  ["blocking", "blockingInfo"],
  ["major", "majorIssueInfo"],
  ["minor", "minorIssueInfo"],
  ["attention", "attentionRequiredInfo"],
  ["notice", "noticeInfo"],
];

function time(value: string | null | undefined) {
  const t = Date.parse(value ?? "");
  return Number.isFinite(t) ? t : null;
}

/** The service log returns 20 entries before `from`, so it is loaded page by page */
async function loadServiceLog(hydraloop: Hydraloop, deviceId: string) {
  const entries: Root.ServiceLogEntry[] = [];
  let from = new Date();
  for (let page = 0; page < 10; page++) {
    const batch = await hydraloop.root.devices.getServiceLogEntries({
      deviceId,
      from,
    });
    entries.push(...batch);
    const last = time(batch.at(-1)?.time);
    if (batch.length < 20 || last === null) break;
    from = new Date(last);
  }
  // Pages may overlap at the time they are split at
  return [...new Map(entries.map((e) => [e.id, e])).values()];
}

/**
 * Fills in the `{{name}}` placeholders of an HDM text. Without a value, a
 * placeholder is left out, together with a `(Side …)` around it.
 */
function fill(text: string, data: Record<string, unknown> = {}) {
  return text
    .replace(/\(side \{\{(\w+)\}\}\)\s*/gi, (match, name: string) =>
      data[name] == null || data[name] === "" ? "" : match,
    )
    .replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      data[name] == null ? "" : String(data[name]),
    )
    .trim();
}

function issueText(text: Lookup, issue: Root.DeviceIssue | string) {
  const key = typeof issue === "string" ? issue : issue.info;
  const data = typeof issue === "string" ? {} : issue.data;
  const found = key.startsWith("deviceSignals.")
    ? text(`${key}.title`)
    : text(key);
  return fill(found ?? readable(key.split(".").at(-1) ?? key), data);
}

function restartReason(text: Lookup, chip?: number, software?: number) {
  if (software) {
    return (
      text(`graph.restartReasons.software.${software}`) ??
      `Software reason ${software}`
    );
  }
  if (chip) {
    return (
      text(`graph.restartReasons.chip.${chip}`) ?? `Hardware reason ${chip}`
    );
  }
  return "Unknown reason";
}

export async function loadMaintenance(token: string): Promise<Maintenance> {
  const entry = cached(token);
  const { hydraloop } = entry;
  const device = await remember(entry, "device", () => firstDevice(hydraloop));
  const deviceId = device.id;
  const until = Date.now();
  const from = until - CONNECTIVITY_RANGE;

  const [
    details,
    statusLog,
    tickets,
    serviceLog,
    professionals,
    outages,
    data,
    lastIo,
    config,
  ] = await Promise.allSettled([
    hydraloop.root.devices.getDevice({ id: deviceId }),
    hydraloop.local.graph.getStatusLogData({
      deviceId,
      from: new Date(until - SIGNALS_RANGE),
      until: new Date(until),
    }),
    hydraloop.root.ticket.listTickets({ event: { first: 0, rows: 100 } }),
    loadServiceLog(hydraloop, deviceId),
    hydraloop.root.devices.listLinkedProfessionals({
      deviceId,
      event: { first: 0, rows: 50 },
    }),
    hydraloop.local.connectivity.getOutageSummaries({
      deviceId,
      from: new Date(from),
      until: new Date(until),
    }) as Promise<OutageSummary[]>,
    hydraloop.local.graph.getData({
      deviceId,
      from: new Date(from),
      until: new Date(until),
      minutesInView: Math.round(CONNECTIVITY_RANGE / 60_000),
      debugData: false,
    }),
    hydraloop.local.graph.getLastKnownIoState({ deviceId }),
    remember(entry, "config", () =>
      hydraloop.local.graph.getGraphConfig({ deviceId, debugData: false }),
    ),
  ]);
  const text = await hdmTexts();

  const warnings: string[] = [];
  const info = settled(details, "Device details", warnings) ?? device;
  const logData = settled(statusLog, "Device signals", warnings);
  const ticketData = settled(tickets, "Tickets", warnings);
  const serviceData = settled(serviceLog, "Service log", warnings) ?? [];
  const professionalData = settled(professionals, "Professionals", warnings);
  const outageData = settled(outages, "Outages", warnings);
  const graphData = settled(data, "Device vitals", warnings);
  const lastIoData = settled(lastIo, "Current valve state", warnings) ?? [];
  const graphConfig = settled(config, "Graph config", warnings);

  const captions: Record<string, string> = {};
  for (const io of graphConfig?.ios ?? []) {
    if (io.caption) captions[io.name] = io.caption;
  }

  const issues: Issue[] = [];
  // Device signals among the issues, e.g. `releaseAirStuckClosed`
  const activeSignals = new Set<string>();
  for (const [level, field] of ISSUE_FIELDS) {
    const list = info.deviceStatus?.[field];
    if (!Array.isArray(list)) continue;
    for (const issue of list as (Root.DeviceIssue | string)[]) {
      issues.push({ level, text: issueText(text, issue) });
      const key = typeof issue === "string" ? issue : issue.info;
      if (key?.startsWith("deviceSignals.")) {
        activeSignals.add(key.split(".")[1]);
      }
    }
  }

  const commissioned = time(info.commissionDate);
  const lastMaintenance = time(info.lastMaintenanceDate);
  const months = info.maintenancePeriod || null;
  const scheduled =
    time(info.maintenancePlannedDate) ?? time(info.nextMaintenanceDate);
  const since = lastMaintenance ?? commissioned;
  const nextMaintenance =
    scheduled !== null
      ? { t: scheduled, estimated: false }
      : since !== null && months
        ? { t: addMonths(since, months), estimated: true }
        : null;

  const restarts = (
    (graphData?.restart ?? []) as unknown as {
      x: string;
      restartReasonChip?: number;
      restartReasonSoftware?: number;
    }[]
  )
    .map((r) => ({
      t: Date.parse(r.x),
      reason: restartReason(text, r.restartReasonChip, r.restartReasonSoftware),
    }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);

  return {
    demo: false,
    fetchedAt: Date.now(),
    device: {
      name: info.alias || info.deviceName || info.serial,
      serial: info.serial ?? null,
      type: [info.type, info.subType].filter(Boolean).join(" ") || null,
      firmware: info.firmwareVersion ?? null,
      firmwareCore: info.firmwareCoreVersion ?? null,
      hardware: info.hardwareVersion ?? null,
      online: typeof info.online === "boolean" ? info.online : null,
      lastOnline: time(info.lastOnline),
      timeZone: info.timezones?.[0] ?? null,
      commissioned,
      warrantyUntil: time(info.endOfWarranty),
      maintenanceMonths: months,
      lastMaintenance,
      nextMaintenance,
    },
    issues,
    stuck: lastIoData
      .filter((io) => io.stuckPower)
      .map((io) => caption(captions, io.type)),
    manual: lastIoData
      .filter((io) => io.manual > 0)
      .map((io) => ({
        name: io.type,
        label: caption(captions, io.type),
        since: Date.parse(io.time),
      })),
    signals: signalEpisodes(
      (logData?.statusLogEntries ?? []).map((e) => ({
        t: Date.parse(e.time),
        errorId: e.errorId ?? null,
        information: e.information ?? "",
        side: e.side || null,
      })),
      (key, side) => {
        const description = text(`deviceSignals.${key}.description`);
        return {
          title: fill(text(`deviceSignals.${key}.title`) ?? readable(key), {
            side,
          }),
          description: description ? fill(description, { side }) : null,
        };
      },
      activeSignals,
    ),
    signalsFrom: until - SIGNALS_RANGE,
    tickets: (ticketData?.records ?? [])
      .filter((t) => t.deviceId === deviceId)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: text(`ticket.status.${t.statusKey}`) ?? readable(t.statusKey),
        closed: Boolean(t.statusClosed),
        priority: t.priorityKey
          ? (text(`ticket.priority.${t.priorityKey}`) ??
            readable(t.priorityKey))
          : null,
        subject: t.subjectTypeKey
          ? (text(`ticket.subjectType.${t.subjectTypeKey}`) ??
            readable(t.subjectTypeKey))
          : null,
        cause: t.causeKey
          ? (text(`ticket.cause.${t.causeKey}`) ?? readable(t.causeKey))
          : null,
        solution: t.solutionKey
          ? (text(`ticket.solution.${t.solutionKey}`) ??
            readable(t.solutionKey))
          : null,
        note: plainText(t.contextInformation),
        automatic:
          Boolean(t.deviceSignalIssue) || t.creatorPersonName === "HDM",
        created: Date.parse(t.created),
        closedAt: time(t.closed),
      }))
      .sort(
        (a, b) => Number(a.closed) - Number(b.closed) || b.created - a.created,
      ),
    serviceLog: serviceData
      .map((e) => {
        const [title = "", ...rest] = (e.text ?? "").split("\n");
        return {
          id: e.id,
          t: Date.parse(e.time),
          type: text(e.typeKey) ?? readable(e.typeKey.split(".").at(-1) ?? ""),
          person: e.person || null,
          title: title.trim(),
          text: rest.join("\n").trim(),
        };
      })
      .sort((a, b) => b.t - a.t),
    professionals: (professionalData?.records ?? []).map((p) => ({
      role: p.type,
      organisation: p.person?.organisationName || null,
      note: p.description,
      since: time(p.start),
    })),
    connectivity: outageData && {
      from,
      until,
      outages: outageData
        .map((o) => ({
          start: Date.parse(o.startedAt),
          end: o.endedAt ? Date.parse(o.endedAt) : until,
          cause: o.classification,
          title:
            text(`connectivityTrace.causes.${o.classification}.title`) ??
            readable(o.classification),
          description:
            text(`connectivityTrace.causes.${o.classification}.description`) ??
            null,
          group: outageGroup(o.classification),
        }))
        .filter((o) => Number.isFinite(o.start) && Number.isFinite(o.end)),
      restarts,
    },
    vitals: graphData && {
      from,
      until,
      series: VITALS.map(({ scale, ...series }) => ({
        ...series,
        points: toPoints(
          graphData[series.key],
          (y) =>
            Math.round(y * scale * 10 ** series.digits) / 10 ** series.digits,
        ),
      })).filter((series) => series.points.length > 0),
    },
    warnings,
  };
}
