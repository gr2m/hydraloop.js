// Statistics over a longer range (30 days), computed on the server from the
// valves, routines and behaviors, plus HDM's own recycled water figures.
//
// Derived from 30 days of an H600's data, not documented by Hydraloop:
// - `getWaterRecycledData()` reports the liters each day's transfers added to
//   T3, about 100 L per transfer.
// - Besides a 1-minute test every 12 hours, the bypass opened when neither
//   train accepted water, when switched on in the app, and while a train was
//   emptied to the drain. The H600 can't measure the water that went through
//   it, so only the time is known.
// - While `backup_water` is on, the distribution pump supplies the outlets
//   from T4, which is filled with fresh water. On recycled water, T3 dropped
//   by about 0.06 L per second of pumping to the outlets.

import {
  ACCEPTING_ROUTINES,
  IO,
  isBypassTest,
  onIntervals,
  routineAt,
  sideIo,
  type Behavior,
  type Dataset,
  type Interval,
  type Point,
  type Side,
} from "./model";

export const STATS_RANGE = 30 * 24 * 3600_000;

/** Liters per second of the distribution pump supplying the outlets */
export const PUMP_LITERS_PER_SECOND = 0.06;

/** Behaviors that run the distribution pump to check the system, not for an outlet */
const DIAGNOSTIC_BEHAVIOR = /^(distribution|notUsingDistributionPump)/;

export type BypassCause = "busy" | "app" | "draining" | "other";

export type BypassEpisode = Interval & { cause: BypassCause };

export type Stats = {
  demo: boolean;
  from: number;
  until: number;
  fetchedAt: number;
  /** Earliest valve data. Bypass and backup totals start here. */
  ioFrom: number | undefined;
  recycled:
    | {
        liters: number;
        /** Liters per day, at the start of the day */
        days: Point[];
        source: "hdm" | "transfers";
      }
    | undefined;
  bypass:
    | {
        episodes: BypassEpisode[];
        total: Record<BypassCause, number>;
      }
    | undefined;
  backup:
    | {
        duration: number;
        /** Distribution pump time while on backup water, in seconds */
        pumpSeconds: number;
        /** Estimated fresh water supplied to the outlets */
        liters: number;
      }
    | undefined;
  warnings: string[];
};

export type StatsInput = Pick<
  Dataset,
  "from" | "until" | "io" | "routines" | "behaviors"
>;

/** Total time two lists of intervals overlap */
function overlap(a: Interval[], b: Interval[]) {
  let total = 0;
  for (const x of a) {
    for (const y of b) {
      total += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));
    }
  }
  return total;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) result.push({ start, end, open: false, clipped: false });
    }
  }
  return result;
}

function behaviorsMatching(
  behaviors: Behavior[],
  test: (name: string) => boolean,
) {
  return behaviors
    .filter((b) => test(b.name))
    .map((b) => ({ start: b.start, end: b.end, open: b.open, clipped: false }));
}

export function bypassCause(
  input: StatsInput,
  interval: Interval,
): BypassCause {
  const touches = (intervals: Interval[]) =>
    intervals.some((i) => i.start < interval.end && i.end > interval.start);
  if (
    touches(
      behaviorsMatching(input.behaviors, (n) => n === "bypassByAppBypassValve"),
    )
  ) {
    return "app";
  }
  const draining = (["A", "B"] as Side[]).flatMap((side) =>
    onIntervals(
      input.io[sideIo("waste_clean_tank", side)],
      interval.start - 60_000,
      interval.end,
    ),
  );
  if (
    touches(draining) ||
    touches(behaviorsMatching(input.behaviors, (n) => /^fullT1T2Waste/.test(n)))
  ) {
    return "draining";
  }
  // Just after it opened, as the routines may change at the same time
  const t = Math.min(interval.end, interval.start + 60_000);
  const accepting = (["A", "B"] as Side[]).some((side) => {
    const routine = routineAt(input, side, t).current;
    return !routine || ACCEPTING_ROUTINES.has(routine.name);
  });
  return accepting ? "other" : "busy";
}

export function computeStats(
  input: StatsInput,
  recycled: Stats["recycled"],
): Omit<Stats, "demo" | "fetchedAt" | "warnings"> {
  const { from, until, io } = input;
  let ioFrom: number | undefined;
  for (const points of Object.values(io)) {
    const first = points.find((p) => p.t >= from)?.t;
    if (first !== undefined && (ioFrom === undefined || first < ioFrom))
      ioFrom = first;
  }

  const bypassIntervals = onIntervals(io[IO.bypass], from, until).filter(
    (i) => !isBypassTest(i),
  );
  const total: Record<BypassCause, number> = {
    busy: 0,
    app: 0,
    draining: 0,
    other: 0,
  };
  const episodes = bypassIntervals.map((interval) => {
    const cause = bypassCause(input, interval);
    total[cause] += interval.end - interval.start;
    return { ...interval, cause };
  });

  const backupIntervals = onIntervals(io[IO.backupWater], from, until);
  const pumping = intersect(
    onIntervals(io[IO.distributionPump], from, until),
    backupIntervals,
  );
  const pumpMs =
    pumping.reduce((sum, i) => sum + i.end - i.start, 0) -
    overlap(pumping, onIntervals(io[IO.circulation], from, until)) -
    overlap(
      pumping,
      behaviorsMatching(input.behaviors, (n) => DIAGNOSTIC_BEHAVIOR.test(n)),
    );
  const pumpSeconds = Math.max(0, pumpMs / 1000);

  return {
    from,
    until,
    ioFrom,
    recycled,
    bypass:
      IO.bypass in io ? { episodes: episodes.reverse(), total } : undefined,
    backup:
      IO.backupWater in io
        ? {
            duration: backupIntervals.reduce(
              (sum, i) => sum + i.end - i.start,
              0,
            ),
            pumpSeconds,
            liters: pumpSeconds * PUMP_LITERS_PER_SECOND,
          }
        : undefined,
  };
}
