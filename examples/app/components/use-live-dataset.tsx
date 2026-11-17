"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { latestSample, type Dataset } from "@/lib/model";

import { Time } from "./time";

export const POLL_INTERVAL = 10_000;
/** Readings older than this are flagged as stale */
const STALE_AFTER = 3 * 60_000;

/** The live dataset, refreshed every 10 seconds while the page is visible */
export function useLiveDataset(initial: Dataset) {
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
  const stale =
    latest === undefined || dataset.fetchedAt - latest > STALE_AFTER;
  return { dataset, error, latest, stale };
}

type Live = ReturnType<typeof useLiveDataset>;

export function LiveStatus({ live }: { live: Live }) {
  const { dataset, latest } = live;
  return (
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
      <span className="muted">Refreshes every {POLL_INTERVAL / 1000} s</span>
    </p>
  );
}

export function LiveNotices({ live }: { live: Live }) {
  const { dataset, error, latest, stale } = live;
  if (!stale && !error && dataset.warnings.length === 0) return null;
  return (
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
  );
}
