"use client";

import { useMemo } from "react";
import {
  DiagramLegend,
  FlowDiagram,
  FlowSummary,
} from "hydraloop-diagram-react";

import { stateAt, type Dataset } from "@/lib/model";

import { SignalTable } from "./signal-table";
import { SessionKeepAlive } from "./session-keep-alive";
import { SiteHeader } from "./site-header";
import { StatusPanel } from "./status-panel";
import { LiveNotices, LiveStatus, useLiveDataset } from "./use-live-dataset";

export function LiveDashboard({ initial }: { initial: Dataset }) {
  const live = useLiveDataset(initial);
  const { dataset, latest } = live;
  // Show the state at the latest reading, so that levels and valves line up
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
          <h1>What the H600 is doing now</h1>
          <LiveStatus live={live} />
        </div>
        <LiveNotices live={live} />

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
