"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  cleanings,
  deviceEvents,
  formatDuration,
  latestSample,
  onIntervals,
  ioCoverageStart,
  stateAt,
  transfers,
  IO,
  type Dataset,
} from "@/lib/model";

import { EventTable } from "./event-table";
import { DiagramLegend, FlowDiagram, FlowSummary } from "./flow-diagram";
import { SessionKeepAlive } from "./session-keep-alive";
import { SiteHeader } from "./site-header";
import { StatusPanel } from "./status-panel";
import { Time } from "./time";
import { Timeline } from "./timeline";

const HOUR = 3600_000;
const RANGES = {
  "6h": { label: "6 hours", ms: 6 * HOUR },
  "24h": { label: "24 hours", ms: 24 * HOUR },
  "3d": { label: "3 days", ms: 72 * HOUR },
  "7d": { label: "7 days", ms: 168 * HOUR },
} as const;
type RangeKey = keyof typeof RANGES;

function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function signed(liters: number | undefined) {
  if (liters === undefined) return "–";
  const rounded = Math.round(liters);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)} L`;
}

export function HistoryExplorer() {
  const router = useRouter();
  const params = useSearchParams();
  const initialRange =
    (params.get("range") as RangeKey) in RANGES
      ? (params.get("range") as RangeKey)
      : "24h";
  const initialEnd = Number(params.get("end")) || undefined;
  /** A pinned moment from the URL, applied once its range has loaded */
  const initialAt = useRef(Number(params.get("at")) || undefined);

  const [range, setRange] = useState<RangeKey>(initialRange);
  /** End of the range, undefined for "now" */
  const [end, setEnd] = useState<number | undefined>(initialEnd);
  const [dataset, setDataset] = useState<Dataset>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [cursor, setCursor] = useState<number>();
  const [pinned, setPinned] = useState(false);

  // Keep the URL shareable: range, end and the pinned moment
  useEffect(() => {
    const search = new URLSearchParams({ range });
    if (end) search.set("end", String(end));
    if (pinned && cursor !== undefined)
      search.set("at", String(Math.round(cursor)));
    window.history.replaceState(null, "", `?${search}`);
  }, [range, end, pinned, cursor]);

  useEffect(() => {
    const controller = new AbortController();
    const until = end ?? Date.now();
    const from = until - RANGES[range].ms;
    setLoading(true);
    fetch(`/api/history?from=${from}&until=${until}`, {
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
        const next = (await response.json()) as Dataset;
        setDataset(next);
        setError(undefined);
        const at = initialAt.current;
        initialAt.current = undefined;
        const keep = at !== undefined && at >= next.from && at <= next.until;
        setCursor(keep ? at : undefined);
        setPinned(keep);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, end, router]);

  const latest = dataset && latestSample(dataset);
  const at = cursor ?? latest ?? dataset?.until;
  const state = useMemo(
    () => (dataset && at !== undefined ? stateAt(dataset, at) : undefined),
    [dataset, at],
  );
  const events = useMemo(
    () => (dataset ? deviceEvents(dataset) : []),
    [dataset],
  );
  const transferList = useMemo(
    () => (dataset ? transfers(dataset) : []),
    [dataset],
  );
  const cleaningList = useMemo(
    () => (dataset ? cleanings(dataset) : []),
    [dataset],
  );
  const totals = useMemo(() => {
    if (!dataset) return undefined;
    const total = (name: string) =>
      onIntervals(dataset.io[name], dataset.from, dataset.until).reduce(
        (sum, i) => sum + i.end - i.start,
        0,
      );
    return {
      bypass: total(IO.bypass),
      backup: total(IO.backupWater),
      hasBypass: IO.bypass in dataset.io,
      hasBackup: IO.backupWater in dataset.io,
    };
  }, [dataset]);

  const pan = (direction: -1 | 1) => {
    const current = end ?? Date.now();
    const next = current + (direction * RANGES[range].ms) / 2;
    setEnd(next >= Date.now() ? undefined : next);
  };
  const select = (t: number) => {
    setCursor(t);
    setPinned(true);
    // The diagram stays in view next to the tables on wide screens
    const aside = document.querySelector(".history-state");
    if (aside && getComputedStyle(aside).position === "sticky") return;
    document
      .getElementById("timeline")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const completed = transferList.filter((t) => !t.open && !t.clipped);
  const medianDuration = median(completed.map((t) => t.end - t.start));
  const medianIntoT3 = median(
    completed.flatMap((t) => (t.t3Change === undefined ? [] : [t.t3Change])),
  );

  return (
    <>
      {dataset ? (
        <SiteHeader device={dataset.device} demo={dataset.demo} />
      ) : (
        <header className="site-header" aria-busy="true" />
      )}
      <SessionKeepAlive />
      <main id="main" className="page">
        <div className="page-title">
          <h1>How the H600 behaved</h1>
          <div className="range-controls" role="group" aria-label="Time range">
            <div className="segmented">
              {(Object.keys(RANGES) as RangeKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={range === key}
                  onClick={() => setRange(key)}
                >
                  {RANGES[key].label}
                </button>
              ))}
            </div>
            <div className="segmented">
              <button
                type="button"
                onClick={() => pan(-1)}
                aria-label="Earlier"
              >
                ← Earlier
              </button>
              <button
                type="button"
                onClick={() => pan(1)}
                disabled={end === undefined}
                aria-label="Later"
              >
                Later →
              </button>
              <button
                type="button"
                onClick={() => setEnd(undefined)}
                disabled={end === undefined}
              >
                Now
              </button>
            </div>
          </div>
          {dataset && (
            <p className="page-status">
              <span>
                <Time t={dataset.from} format="datetime" /> to{" "}
                <Time t={dataset.until} format="datetime" />
              </span>
              {loading && <span className="muted">Loading…</span>}
            </p>
          )}
        </div>

        {error && (
          <div className="notice" role="alert">
            <p>Loading failed: {error}</p>
          </div>
        )}
        {dataset &&
          (() => {
            const coverage = ioCoverageStart(dataset);
            return coverage !== undefined &&
              coverage - dataset.from > 3600_000 ? (
              <div className="notice" role="status">
                <p>
                  HDM only returned valve and pump data from{" "}
                  <Time t={coverage} format="datetime" />. Valve lanes, transfer
                  and backup totals don&apos;t cover the time before that.
                </p>
              </div>
            ) : null;
          })()}
        {dataset && dataset.warnings.length > 0 && (
          <div className="notice" role="status">
            {dataset.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}

        {!dataset ? (
          <p className="empty">{loading ? "Loading history…" : "No data."}</p>
        ) : (
          <>
            <dl className="summary" aria-busy={loading}>
              <div>
                <dt>Transfers to T3</dt>
                <dd className="summary-value">{transferList.length}</dd>
                <dd className="muted">
                  {transferList.length > 0 &&
                    `A ${transferList.filter((t) => t.side === "A").length}, B ${transferList.filter((t) => t.side === "B").length}`}
                  {medianDuration !== undefined &&
                    `. Median ${formatDuration(medianDuration)}`}
                  {medianIntoT3 !== undefined &&
                    `, ${Math.round(medianIntoT3)} L into T3`}
                </dd>
              </div>
              <div>
                <dt>Filth removal</dt>
                <dd className="summary-value">{cleaningList.length}</dd>
                <dd className="muted">
                  <span className="mono">FILTH_REMOVAL</span> routines
                </dd>
              </div>
              <div>
                <dt>Bypass open</dt>
                <dd className="summary-value">
                  {totals?.hasBypass ? formatDuration(totals.bypass) : "–"}
                </dd>
                <dd className="muted">Greywater sent to the sewer</dd>
              </div>
              <div>
                <dt>On backup water</dt>
                <dd className="summary-value">
                  {totals?.hasBackup ? formatDuration(totals.backup) : "–"}
                </dd>
                <dd className="muted">Outlets supplied from T4</dd>
              </div>
            </dl>

            <div className="history-grid">
              <div className="history-main">
                <section
                  id="timeline"
                  className="history-timeline"
                  aria-label="Timeline"
                >
                  <Timeline
                    dataset={dataset}
                    cursor={cursor}
                    pinned={pinned}
                    onCursor={(t, pin) => {
                      setCursor(t);
                      if (pin !== undefined) setPinned(pin);
                    }}
                  />
                </section>

                <section
                  className="section"
                  aria-labelledby="transfers-heading"
                >
                  <h2 id="transfers-heading">Transfers to T3</h2>
                  <p className="section-lede">
                    From the transfer valve opening to it closing. The volume is
                    the change of T3, so toilet flushes drawing from T3 at the
                    same time make it smaller. T1+T2 is not used, as T2 reads
                    high while it holds air pressure.
                  </p>
                  {transferList.length === 0 ? (
                    <p className="empty">No transfers in this period.</p>
                  ) : (
                    <table>
                      <caption className="sr-only">Transfers to T3</caption>
                      <thead>
                        <tr>
                          <th scope="col">Train</th>
                          <th scope="col">Started</th>
                          <th scope="col" className="numeric">
                            Duration
                          </th>
                          <th scope="col" className="numeric">
                            Into T3
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {transferList.map((t) => (
                          <tr
                            key={`${t.side}-${t.start}`}
                            className="is-selectable"
                            onClick={() => select(t.start)}
                          >
                            <td>{t.side}</td>
                            <td>
                              <Time t={t.start} format="datetime" />
                              {t.clipped && (
                                <span className="muted"> (earlier)</span>
                              )}
                            </td>
                            <td className="numeric">
                              {formatDuration(t.end - t.start)}
                              {t.open && <span className="muted"> so far</span>}
                            </td>
                            <td className="numeric">{signed(t.t3Change)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>

                {cleaningList.length > 0 && (
                  <section
                    className="section"
                    aria-labelledby="cleaning-heading"
                  >
                    <h2 id="cleaning-heading">Filth removal</h2>
                    <p className="section-lede">
                      The <span className="mono">FILTH_REMOVAL</span> routine as
                      reported by HDM. A normal run holds T1 at the top for
                      about 4.5 hours, so filth and foam spill over the skim
                      overflow to the drain. That overflow has no valve signal,
                      so it&apos;s inferred. The waste valve usually stays
                      closed; when it opens right after the routine, T1 is
                      emptied to the drain. Select a run to see the moment water
                      leaves the train.
                    </p>
                    <table>
                      <caption className="sr-only">Filth removal runs</caption>
                      <thead>
                        <tr>
                          <th scope="col">Train</th>
                          <th scope="col">Started</th>
                          <th scope="col" className="numeric">
                            Duration
                          </th>
                          <th scope="col" className="numeric">
                            Skimming
                          </th>
                          <th scope="col" className="numeric">
                            Waste valve open
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {cleaningList.map((c) => (
                          <tr
                            key={`${c.side}-${c.start}`}
                            className="is-selectable"
                            onClick={() => select(c.focus)}
                          >
                            <td>{c.side}</td>
                            <td>
                              <Time t={c.start} format="datetime" />
                            </td>
                            <td className="numeric">
                              {formatDuration(c.end - c.start)}
                              {c.open && <span className="muted"> so far</span>}
                            </td>
                            <td className="numeric">
                              {c.skimming ? formatDuration(c.skimming) : "–"}
                            </td>
                            <td className="numeric">
                              {c.waste ? formatDuration(c.waste) : "–"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}

                <section
                  className="section"
                  aria-labelledby="history-events-heading"
                >
                  <h2 id="history-events-heading">Events</h2>
                  <EventTable
                    events={events}
                    caption="Events in the selected range"
                    timeFormat="datetime"
                    onSelect={select}
                  />
                </section>
              </div>
              <aside
                className="history-state"
                aria-label="State at the selected time"
              >
                {state && (
                  <>
                    <p className="history-state-time">
                      {cursor === undefined
                        ? "Latest in range, "
                        : pinned
                          ? "Pinned, "
                          : ""}
                      <Time t={state.t} format="datetime" />
                    </p>
                    <FlowDiagram state={state} device={dataset.device} />
                    <FlowSummary state={state} />
                    <DiagramLegend />
                    <StatusPanel state={state} />
                  </>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
    </>
  );
}
