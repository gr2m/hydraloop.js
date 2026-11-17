"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  cleaningAt,
  formatDuration,
  stateAt,
  T3_EMPTY_LITERS,
  TRAIN_FULL_SPREAD,
  TRANSFER_LITERS,
  TRANSFER_SPREAD,
  type Cleaning,
  type Dataset,
  type DeviceState,
  type Side,
} from "@/lib/model";
import {
  PUMP_LITERS_PER_SECOND,
  type BypassCause,
  type Stats,
} from "@/lib/stats";

import { SessionKeepAlive } from "./session-keep-alive";
import { SiteHeader } from "./site-header";
import { Time } from "./time";
import { LiveNotices, LiveStatus, useLiveDataset } from "./use-live-dataset";

function Tile({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="tile">
      <dt>{label}</dt>
      <dd className="tile-value">{value}</dd>
      {children && <dd className="tile-detail">{children}</dd>}
    </div>
  );
}

function liters(value: number, prefix = "≈ ") {
  const rounded = Math.round(value);
  return `${rounded === 0 ? "" : prefix}${rounded.toLocaleString()} L`;
}

// ── Now ────────────────────────────────────────────────────────────────────

function NextCleaningTile({ state }: { state: DeviceState }) {
  const { filling, bypass } = state.room;
  const train = filling && state.room.trains[filling];
  const label = "Until the next cleaning";
  if (!filling || !train) {
    return <Tile label={label} value="Unknown" />;
  }
  if (bypass || !train.accepting) {
    return (
      <Tile label={label} value="–">
        {bypass
          ? "The bypass is open, greywater goes to the drain."
          : `Train ${filling} takes no water: ${train.reason.charAt(0).toLowerCase()}${train.reason.slice(1)}.`}
      </Tile>
    );
  }
  if (train.liters === undefined) {
    return (
      <Tile label={label} value="Unknown">
        Train {filling} receives greywater. {train.reason}.
      </Tile>
    );
  }
  return (
    <Tile label={label} value={liters(train.liters)}>
      More greywater into train {filling} before it starts filth removal (
      {Math.max(0, Math.round(train.liters - TRAIN_FULL_SPREAD))}–
      {Math.round(train.liters + TRAIN_FULL_SPREAD)} L).
    </Tile>
  );
}

function trainRoom(state: DeviceState, side: Side) {
  const train = state.room.trains[side];
  if (train.liters === undefined) return `train ${side} unknown`;
  return train.accepting
    ? `train ${side} ${liters(train.liters)}`
    : `train ${side} 0 L`;
}

function RoomTile({ state }: { state: DeviceState }) {
  const { room } = state;
  const label = "Until greywater goes to the drain";
  if (room.liters === undefined) return <Tile label={label} value="Unknown" />;
  if (room.bypass) {
    return (
      <Tile label={label} value="0 L">
        The bypass is open, greywater goes to the drain now.
      </Tile>
    );
  }
  return (
    <Tile label={label} value={liters(room.liters, room.partial ? "≥ " : "≈ ")}>
      Both trains together: {trainRoom(state, "A")}, {trainRoom(state, "B")}.
      {room.partial && " One train has no level reading yet."}
    </Tile>
  );
}

function AvailableTile({ state }: { state: DeviceState }) {
  const t3 = state.tanks.t3.liters;
  const label = "Recycled water ready";
  if (t3 === undefined) return <Tile label={label} value="Unknown" />;
  const usable = Math.max(0, t3 - T3_EMPTY_LITERS);
  return (
    <Tile label={label} value={liters(usable)}>
      {state.supply.source === "backup"
        ? usable < 5
          ? "T3 is empty. The outlets get fresh backup water."
          : "In T3, but the outlets still get fresh backup water."
        : `In T3 for the outlets. When it's empty, they get fresh backup water.`}
    </Tile>
  );
}

function CleaningLine({ cleaning, now }: { cleaning: Cleaning; now: number }) {
  const { side, stage, readyAt, transferAt } = cleaning;
  const ready = (
    <>
      ready around <Time t={readyAt} /> (in {formatDuration(readyAt - now)})
    </>
  );
  if (stage === "transferring") {
    return (
      <>
        Train {side} is moving it into T3, {ready}.
      </>
    );
  }
  return (
    <>
      Train {side} {stage === "starting" ? "starts" : "is in"} filth removal,
      moves it into T3 from about <Time t={transferAt} />, {ready}.
    </>
  );
}

function CleaningTile({
  dataset,
  state,
}: {
  dataset: Dataset;
  state: DeviceState;
}) {
  const cleanings = useMemo(
    () => cleaningAt(dataset, state.t),
    [dataset, state.t],
  );
  const label = "Being cleaned";
  if (cleanings.length === 0) {
    return (
      <Tile label={label} value="None">
        A train is cleaned once it is full, then about {TRANSFER_LITERS} L go
        into T3 about 6 hours later.
      </Tile>
    );
  }
  const total = cleanings.reduce((sum, c) => sum + c.liters, 0);
  return (
    <Tile label={label} value={liters(total)}>
      {cleanings.map((c) => (
        <span key={c.side} className="tile-line">
          <CleaningLine cleaning={c} now={state.t} />
        </span>
      ))}
      <span className="tile-line muted">
        A transfer adds {TRANSFER_LITERS - TRANSFER_SPREAD}–
        {TRANSFER_LITERS + TRANSFER_SPREAD} L.
      </span>
    </Tile>
  );
}

// ── Last 30 days ───────────────────────────────────────────────────────────

const CAUSES: Record<BypassCause, string> = {
  busy: "Both trains full or cleaning",
  app: "Switched on in the app",
  draining: "A train was emptied to the drain",
  other: "Other",
};

/** A day around `t` in the history view, with `t` pinned */
function historyHref(t: number) {
  const end = t + 12 * 3600_000;
  const search = new URLSearchParams({ range: "24h" });
  if (end < Date.now()) search.set("end", String(Math.round(end)));
  search.set("at", String(Math.round(t + 60_000)));
  return `/history?${search}`;
}

function useStats() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch(`/api/stats?zone=${encodeURIComponent(zone)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login?expired=1");
          return;
        }
        if (!response.ok)
          throw new Error(`${response.status} ${await response.text()}`);
        setStats((await response.json()) as Stats);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, [router]);
  return { stats, error };
}

function StatsSection() {
  const { stats, error } = useStats();
  if (error) {
    return (
      <div className="notice" role="alert">
        <p>Loading the last 30 days failed: {error}</p>
      </div>
    );
  }
  if (!stats) {
    return <p className="empty">Loading the last 30 days…</p>;
  }

  const { recycled, bypass, backup } = stats;
  const ioFrom = stats.ioFrom ?? stats.until;
  const covered = stats.until - Math.max(stats.from, ioFrom);
  const days = Math.round((stats.until - stats.from) / (24 * 3600_000));
  const episodes = bypass?.episodes ?? [];
  const busy = episodes.filter((e) => e.cause === "busy");
  const others = (["app", "draining", "other"] as BypassCause[]).filter(
    (c) => bypass && bypass.total[c] > 0,
  );

  return (
    <>
      {(stats.warnings.length > 0 || ioFrom - stats.from > 24 * 3600_000) && (
        <div className="notice" role="status">
          {ioFrom - stats.from > 24 * 3600_000 && (
            <p>
              HDM only returned valve data from{" "}
              <Time t={ioFrom} format="datetime" />. The bypass and backup water
              figures start there.
            </p>
          )}
          {stats.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      <dl className="overview-grid is-three">
        <Tile
          label="Recycled"
          value={recycled ? liters(recycled.liters, "") : "–"}
        >
          {recycled &&
            `About ${Math.round(recycled.liters / days)} L a day, moved into T3 on ${recycled.days.filter((d) => d.v > 0).length} days. ${recycled.source === "hdm" ? "As reported by HDM." : "From the change of T3 during transfers."}`}
        </Tile>

        <Tile
          label="Greywater lost, both trains busy"
          value={
            !bypass
              ? "–"
              : busy.length === 0
                ? "None"
                : formatDuration(bypass.total.busy)
          }
        >
          {bypass &&
            (busy.length === 0
              ? "Greywater never went to the drain because both trains were full or cleaning."
              : `Greywater went to the drain ${busy.length === 1 ? "once" : `${busy.length} times`} because both trains were full or cleaning. The H600 can't measure how much.`)}
        </Tile>

        <Tile
          label="Fresh water instead of recycled"
          value={backup ? liters(Math.round(backup.liters / 10) * 10) : "–"}
        >
          {backup?.duration === 0 && "The outlets never needed backup water."}
          {!!backup?.duration &&
            `The outlets got fresh backup water for ${formatDuration(backup.duration)} (${Math.round((backup.duration / covered) * 100)}% of the time) because T3 was empty. Estimated from ${formatDuration(backup.pumpSeconds * 1000)} of pumping at about ${PUMP_LITERS_PER_SECOND} L/s.`}
        </Tile>
      </dl>

      {episodes.length > 0 && (
        <div className="overview-episodes">
          <table>
            <caption>
              Greywater sent to the drain
              {others.length > 0 && (
                <span className="muted">
                  {" "}
                  · also{" "}
                  {others
                    .map(
                      (c) =>
                        `${CAUSES[c].toLowerCase()} ${formatDuration(bypass!.total[c])}`,
                    )
                    .join(", ")}
                </span>
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col" className="numeric">
                  Duration
                </th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((e) => (
                <tr key={e.start}>
                  <td>
                    <Link href={historyHref(e.start)}>
                      <Time t={e.start} format="datetime" />
                    </Link>
                  </td>
                  <td className="numeric">
                    {formatDuration(e.end - e.start)}
                    {e.open && <span className="muted"> so far</span>}
                  </td>
                  <td>{CAUSES[e.cause]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Not counting the 1-minute test of the bypass every 12 hours.
          </p>
        </div>
      )}
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function Overview({ initial }: { initial: Dataset }) {
  const live = useLiveDataset(initial);
  const { dataset, latest } = live;
  const state = useMemo(
    () => stateAt(dataset, latest ?? dataset.until),
    [dataset, latest],
  );

  return (
    <>
      <SiteHeader device={dataset.device} demo={dataset.demo} />
      <SessionKeepAlive />
      <main id="main" className="page">
        <div className="page-title">
          <h1>The H600 at a glance</h1>
          <LiveStatus live={live} />
        </div>
        <LiveNotices live={live} />

        <section className="overview-section" aria-labelledby="now-heading">
          <div className="overview-head">
            <h2 id="now-heading">Now</h2>
            <Link href="/live">Live details →</Link>
          </div>
          <dl className="overview-grid">
            <NextCleaningTile state={state} />
            <RoomTile state={state} />
            <AvailableTile state={state} />
            <CleaningTile dataset={dataset} state={state} />
          </dl>
        </section>

        <section className="overview-section" aria-labelledby="month-heading">
          <div className="overview-head">
            <h2 id="month-heading">Last 30 days</h2>
            <Link href="/history?range=7d">History →</Link>
          </div>
          <StatsSection />
        </section>
      </main>
    </>
  );
}
