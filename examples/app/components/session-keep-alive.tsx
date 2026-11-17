"use client";

import { useEffect } from "react";

/** Less than REFRESH_BEFORE in lib/token.ts, so a ping falls into it */
const INTERVAL = 4 * 60_000;

/**
 * Pings the server while the page is open, also in a background tab, so that
 * proxy.ts can refresh the HDM token before it expires.
 */
export function SessionKeepAlive() {
  useEffect(() => {
    const timer = setInterval(() => {
      fetch("/api/session", { cache: "no-store" }).catch(() => {});
    }, INTERVAL);
    return () => clearInterval(timer);
  }, []);
  return null;
}
