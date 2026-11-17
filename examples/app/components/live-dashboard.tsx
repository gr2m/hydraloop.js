"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { deviceEvents, latestSample, stateAt, type Dataset } from "@/lib/model";

import { EventTable } from "./event-table";
import { DiagramLegend, FlowDiagram, FlowSummary } from "./flow-diagram";
import { SignalTable } from "./signal-table";
import { SessionKeepAlive } from "./session-keep-alive";
import { SiteHeader } from "./site-header";
import { StatusPanel } from "./status-panel";
import { Time } from "./time";

const POLL_INTERVAL = 10_000;
/** Readings older than this are flagged as stale */
const STALE_AFTER = 3 * 60_000;

export function LiveDashboard({ initial }: { initial: Dataset }) {
  const router = useRouter();
  const [dataset, setDataset] = useState(initial);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/live", { cache: "no-store" });
          if (response.status === 401) {
            router.replace("/login?expired=1");
            return;
          }
          if (!response.ok)
            throw new Error(`${response.status} ${await response.text()}`);
          const next = (await response.json()) as Dataset;
          if (!cancelled) {
            setDataset(next);
            setError(undefined);
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL);
    }

    timer = setTimeout(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  const latest = latestSample(dataset);
  // Show the state at the latest reading, so that levels and valves line up
  const state = useMemo(
    () => stateAt(dataset, latest ?? dataset.until),
    [dataset, latest],
  );
  const events = useMemo(() => deviceEvents(dataset), [dataset]);
  const stale =
    latest === undefined || dataset.fetchedAt - latest > STALE_AFTER;

  return (
    <>
      <SiteHeader device={dataset.device} demo={dataset.demo} />
      <SessionKeepAlive />
      <main id="main" className="page">
        <div className="page-title">
          <h1>What the H600 is doing now</h1>
          <p className="page-status" aria-live="polite">
            {dataset.device.online === false ? (
              <span className="status-dot is-offline">Offline</span>
            ) : (
              <span className="status-dot is-online">Online</span>
            )}
            {latest !== undefined && (
              <span>
                Latest reading <Time t={latest} format="seconds" />
              </span>
            )}
            <span className="muted">
              Refreshes every {POLL_INTERVAL / 1000} s
            </span>
          </p>
        </div>

        {(stale || error || dataset.warnings.length > 0) && (
          <div className="notice" role="status">
            {stale && (
              <p>
                {latest === undefined
                  ? "No tank readings in the last 8 hours."
                  : "The latest tank reading is more than 3 minutes old. The device may be offline or its data delayed."}
              </p>
            )}
            {error && (
              <p>Refreshing failed: {error}. Showing the last loaded data.</p>
            )}
            {dataset.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}

        <div className="live-grid">
          <figure className="diagram-figure">
            <FlowDiagram state={state} device={dataset.device} />
            <FlowSummary state={state} />
            <figcaption>
              <DiagramLegend />
              <p className="muted">
                Colored pipes carry water according to a routine, valve, pump or
                sensor signal. Hover a valve, pump, sensor or tank for its raw
                value.
              </p>
            </figcaption>
          </figure>
          <StatusPanel state={state} />
        </div>

        <section className="section" aria-labelledby="events-heading">
          <h2 id="events-heading">Last 8 hours</h2>
          <EventTable events={events} caption="Events in the last 8 hours" />
        </section>

        <section className="section" aria-labelledby="signals-heading">
          <h2 id="signals-heading" className="sr-only">
            Signals
          </h2>
          <SignalTable state={state} captions={dataset.captions} />
        </section>
      </main>
    </>
  );
}
