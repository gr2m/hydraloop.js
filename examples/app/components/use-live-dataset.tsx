"use client";

import { subscribe } from "hydraloop/internal/socket";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { applyMessages, LIVE_ROOMS, type LiveMessage } from "@/lib/live";
import { latestSample, type Dataset } from "@/lib/model";

import { Time } from "./time";

export const POLL_INTERVAL = 10_000;
/** Readings older than this are flagged as stale */
const STALE_AFTER = 3 * 60_000;
/**
 * Reloads over REST for what the socket doesn't send: firmware behaviors
 * (rarely in `graph:io`), outages and the tank levels at the last venting
 */
const RELOAD_INTERVAL = 5 * 60_000;
/** The HDM web app keeps the live graph active every 90 seconds */
const HEARTBEAT_INTERVAL = 90_000;
/** Messages are applied together, as HDM sends them in batches */
const FLUSH_DELAY = 250;
/** Messages are kept this long to apply them again after a REST reload */
const REPLAY_WINDOW = 3 * 60_000;

/** How the live dataset is kept current */
export type LiveMode = "connecting" | "socket" | "polling";

class SessionExpired extends Error {
  response = { status: 401 };
}
class NoSocket extends Error {
  response = { status: 204 };
}

/**
 * The live dataset: loaded over REST, then kept current with the device
 * socket, which the browser opens itself with a device token from
 * `/api/socket`. Falls back to polling `/api/live` every 10 seconds in demo
 * mode, or if the socket fails.
 */
export function useLiveDataset(initial: Dataset) {
  const router = useRouter();
  const [dataset, setDataset] = useState(initial);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<LiveMode>("connecting");
  const [now, setNow] = useState(initial.fetchedAt);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const visible = () => document.visibilityState === "visible";

    function expired() {
      controller.abort();
      router.replace("/login?expired=1");
    }

    // Messages of the last minutes, to apply again after a REST reload, as
    // the reload may miss what arrived while it was loaded
    let recent: { at: number; message: LiveMessage }[] = [];
    let pending: LiveMessage[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    function flush() {
      flushTimer = undefined;
      const messages = pending;
      pending = [];
      if (messages.length && !signal.aborted) {
        setDataset((ds) => applyMessages(ds, messages, Date.now()));
      }
    }

    async function reload() {
      try {
        const response = await fetch("/api/live", {
          cache: "no-store",
          signal,
        });
        if (response.status === 401) return expired();
        if (!response.ok)
          throw new Error(`${response.status} ${await response.text()}`);
        const next = (await response.json()) as Dataset;
        const since = Date.now() - REPLAY_WINDOW;
        recent = recent.filter((r) => r.at >= since);
        setDataset(
          applyMessages(
            next,
            recent.map((r) => r.message),
            Date.now(),
          ),
        );
        setError(undefined);
      } catch (e) {
        if (!signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      }
    }

    function every(ms: number, task: () => void) {
      const id = setInterval(() => {
        if (visible() && !signal.aborted) task();
      }, ms);
      signal.addEventListener("abort", () => clearInterval(id));
    }

    function poll() {
      setMode("polling");
      every(POLL_INTERVAL, reload);
    }

    async function heartbeat() {
      try {
        const response = await fetch("/api/heartbeat", {
          method: "POST",
          signal,
        });
        if (response.status === 401) expired();
      } catch {
        // The socket also works without it
      }
    }

    async function listen() {
      const subscription = subscribe({
        rooms: [...LIVE_ROOMS],
        signal,
        // The device token is only kept by the subscription, in memory
        async connect() {
          const response = await fetch("/api/socket", {
            method: "POST",
            cache: "no-store",
            signal,
          });
          if (response.status === 401) {
            expired();
            throw new SessionExpired("Session expired");
          }
          if (response.status === 204) throw new NoSocket("Demo mode");
          if (!response.ok)
            throw new Error(`${response.status} ${await response.text()}`);
          const { localApiUrl, token } = (await response.json()) as {
            localApiUrl: string;
            token: string;
          };
          return { localApiUrl, token };
        },
        onConnect() {
          setMode("socket");
          // Load what was sent before or while the socket was disconnected
          void reload();
        },
        onDisconnect(reason) {
          setMode("connecting");
          setError(`Live connection lost (${reason}), reconnecting`);
        },
      });

      try {
        for await (const message of subscription) {
          const at = Date.now();
          recent.push({ at, message });
          if (recent.length > 2000) recent = recent.slice(-1000);
          pending.push(message);
          flushTimer ??= setTimeout(flush, FLUSH_DELAY);
        }
      } catch (e) {
        if (signal.aborted || e instanceof SessionExpired) return;
        if (!(e instanceof NoSocket)) {
          setError(
            `Live connection failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        poll();
      }
    }

    void listen();
    void heartbeat();
    every(HEARTBEAT_INTERVAL, heartbeat);
    every(RELOAD_INTERVAL, reload);
    // For the staleness check, which needs to notice when messages stop
    every(15_000, () => setNow(Date.now()));

    const onVisible = () => {
      if (!visible()) return;
      setNow(Date.now());
      void heartbeat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      controller.abort();
      clearTimeout(flushTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  const latest = latestSample(dataset);
  const stale =
    latest === undefined ||
    Math.max(now, dataset.fetchedAt) - latest > STALE_AFTER;
  return { dataset, error, latest, stale, mode };
}

type Live = ReturnType<typeof useLiveDataset>;

export function LiveStatus({ live }: { live: Live }) {
  const { dataset, latest, mode } = live;
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
      <span className="muted">
        {mode === "socket"
          ? "Live"
          : mode === "connecting"
            ? "Connecting…"
            : `Refreshes every ${POLL_INTERVAL / 1000} s`}
      </span>
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
      {error && <p>{error}. Showing the last loaded data.</p>}
      {dataset.warnings.map((w) => (
        <p key={w}>{w}</p>
      ))}
    </div>
  );
}
