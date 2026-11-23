// Applies messages of the device socket to a dataset, in the browser. The
// live views load the dataset over REST and keep it current with the socket
// (see components/use-live-dataset.tsx).

import type { SocketMessage } from "hydraloop-internal/socket";

import {
  behaviorLabel,
  behaviorSide,
  LIVE_RANGE,
  pressureToLiters,
  routineSide,
  t1PointsToLiters,
  TANK_LINES,
  type Behavior,
  type Dataset,
  type Point,
  type TankId,
} from "./model";

export const LIVE_ROOMS = ["graph", "device-state", "device-status"] as const;

export type LiveMessage = SocketMessage<(typeof LIVE_ROOMS)[number]>;

/** Messages with data the device reported */
const DEVICE_DATA = new Set<LiveMessage["name"]>([
  "graph:graph",
  "graph:io",
  "graph:routine",
  "device-state:setting-value",
]);

const TANK_BY_LINE = Object.fromEntries(
  Object.entries(TANK_LINES).map(([id, line]) => [line, id as TankId]),
) as Record<string, TankId>;

/** Pressure points to liters, as `loadDataset()` converts them on the server */
function toLiters(ds: Dataset, id: TankId, y: number) {
  if (id === "t1a" || id === "t1b") {
    return Math.round(t1PointsToLiters(y) * 10) / 10;
  }
  const table = id === "t3" ? ds.levelTables?.t3 : ds.levelTables?.t1t2;
  return table?.length ? Math.round(pressureToLiters(y, table) * 10) / 10 : y;
}

/**
 * Adds a point, keeping the points sorted by time. A point at a time that is
 * already there is dropped, as messages may repeat what REST loaded.
 */
function addPoint(points: Point[], point: Point) {
  if (!Number.isFinite(point.t) || !Number.isFinite(point.v)) return;
  let i = points.length;
  while (i > 0 && points[i - 1].t > point.t) i--;
  if (i > 0 && points[i - 1].t === point.t) return;
  points.splice(i, 0, point);
}

/** Copies the arrays and records before they are changed */
function copy(ds: Dataset): Dataset {
  return {
    ...ds,
    device: { ...ds.device },
    tanks: Object.fromEntries(
      Object.entries(ds.tanks).map(([id, points]) => [id, [...points]]),
    ) as Dataset["tanks"],
    io: Object.fromEntries(
      Object.entries(ds.io).map(([name, points]) => [name, [...points]]),
    ),
    manual: Object.fromEntries(
      Object.entries(ds.manual ?? {}).map(([name, points]) => [
        name,
        [...points],
      ]),
    ),
    routines: [...ds.routines],
    behaviors: ds.behaviors.map((b) => ({ ...b })),
    cleaningTimeLeft: { ...ds.cleaningTimeLeft },
  };
}

/**
 * The dataset with the messages applied, as of `now`: the range moves on to
 * end at `now`, and data older than `LIVE_RANGE` is dropped, except for the
 * last value before the range (for the state at its start).
 */
export function applyMessages(
  dataset: Dataset,
  messages: LiveMessage[],
  now: number,
): Dataset {
  const ds = copy(dataset);

  for (const message of messages) {
    // Data from the device means it is online, e.g. after a restart whose
    // `online` message was missed while the socket was disconnected
    if (DEVICE_DATA.has(message.name)) ds.device.online = true;

    switch (message.name) {
      case "graph:graph":
        for (const [line, points] of Object.entries(message.payload)) {
          const id = TANK_BY_LINE[line];
          if (!id || !Array.isArray(points)) continue;
          for (const p of points) {
            addPoint(ds.tanks[id], {
              t: Date.parse(p.x),
              v: toLiters(ds, id, p.y),
            });
          }
        }
        break;

      case "graph:io": {
        const { value, manual, behavior } = message.payload;
        for (const [record, changes] of [
          [ds.io, value],
          [ds.manual!, manual],
        ] as const) {
          for (const [name, points] of Object.entries(changes ?? {})) {
            if (!points.length) continue;
            record[name] ??= [];
            for (const p of points) {
              addPoint(record[name], { t: Date.parse(p.x), v: p.y });
            }
          }
        }
        for (const b of behavior ?? []) {
          applyBehavior(ds.behaviors, {
            t: Date.parse(b.time),
            name: b.typeName,
            typeId: b.typeId,
            engaged: b.subTypeName === "engaged",
          });
        }
        break;
      }

      case "graph:routine":
        for (const r of message.payload.routines) {
          const event = {
            t: Date.parse(r.x),
            side: routineSide(r.side),
            routine: r.routine,
            name: r.name ?? "",
            state: r.state ?? "",
          };
          if (!Number.isFinite(event.t)) continue;
          const repeated = ds.routines.some(
            (e) =>
              e.t === event.t &&
              e.side === event.side &&
              e.state === event.state,
          );
          if (repeated) continue;
          let i = ds.routines.length;
          while (i > 0 && ds.routines[i - 1].t > event.t) i--;
          ds.routines.splice(i, 0, event);
        }
        break;

      case "device-state:setting-value": {
        const match = /^cleaningTimeLeft([AB])$/.exec(message.payload.name);
        const t = Date.parse(message.payload.time);
        if (match && Number.isFinite(t)) {
          const side = match[1] as "A" | "B";
          const last = ds.cleaningTimeLeft![side];
          if (!last || t >= last.t) {
            ds.cleaningTimeLeft![side] = { t, ms: message.payload.value };
          }
        }
        break;
      }

      case "device-status:online":
        ds.device.online = true;
        break;

      case "device-status:offline":
        ds.device.online = false;
        break;

      // Restarts and dynamic graph lines are not shown. Outages are loaded
      // over REST, see useLiveDataset().
      default:
        break;
    }
  }

  return slide(ds, now);
}

/** Opens or closes a behavior, like `behaviorIntervals()` does */
function applyBehavior(
  behaviors: Behavior[],
  e: { t: number; name: string; typeId: number; engaged: boolean },
) {
  if (!Number.isFinite(e.t)) return;
  const open = behaviors.find((b) => b.name === e.name && b.open);
  if (e.engaged) {
    if (open) return;
    behaviors.push({
      name: e.name,
      typeId: e.typeId,
      side: behaviorSide(e.name),
      label: behaviorLabel(e.name),
      start: e.t,
      end: e.t,
      open: true,
    });
    behaviors.sort((a, b) => a.start - b.start);
  } else if (open) {
    open.end = e.t;
    open.open = false;
  }
}

/** Moves the range on to end at `now` (mutates `ds`, which is a copy) */
function slide(ds: Dataset, now: number): Dataset {
  const until = Math.max(ds.until, now);
  const from = until - LIVE_RANGE;
  const trim = (points: Point[]) => {
    const first = points.findIndex((p) => p.t >= from);
    const start = first === -1 ? points.length - 1 : Math.max(0, first - 1);
    return start > 0 ? points.slice(start) : points;
  };
  for (const id of Object.keys(ds.tanks) as TankId[]) {
    // Tank levels start at `from`, as the server loads them
    ds.tanks[id] = ds.tanks[id].filter((p) => p.t >= from);
  }
  for (const record of [ds.io, ds.manual!]) {
    for (const name of Object.keys(record)) record[name] = trim(record[name]);
  }
  for (const b of ds.behaviors) if (b.open) b.end = until;
  ds.behaviors = ds.behaviors.filter((b) => b.end >= from);
  return { ...ds, from, until, fetchedAt: now };
}
