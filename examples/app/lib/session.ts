import "server-only";

import { cookies } from "next/headers";

import { simulate, simulateMaintenance, simulateStats } from "./demo";
import {
  loadDataset,
  loadMaintenance as loadHdmMaintenance,
  loadSocketConnection as loadHdmSocketConnection,
  loadStats as loadHdmStats,
  sendHeartbeat as sendHdmHeartbeat,
  type LoadOptions,
  type SocketConnection,
} from "./hdm";
import type { Maintenance } from "./maintenance";
import type { Dataset } from "./model";
import type { Stats } from "./stats";
import { DEMO_COOKIE, TOKEN_COOKIE } from "./token";

export type Session = { kind: "demo" } | { kind: "hdm"; token: string };

/**
 * The HDM token is kept in an httpOnly cookie, so it never reaches browser
 * JavaScript. `HYDRALOOP_TOKEN` can be set instead to skip the login form.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  if (store.get(DEMO_COOKIE)?.value === "1") return { kind: "demo" };
  const token = store.get(TOKEN_COOKIE)?.value ?? process.env.HYDRALOOP_TOKEN;
  return token ? { kind: "hdm", token } : null;
}

export function load(session: Session, options: LoadOptions): Promise<Dataset> {
  if (session.kind === "demo") return Promise.resolve(simulate(options));
  return loadDataset(session.token, options);
}

export function loadStats(
  session: Session,
  options: { range: number; zone: string },
): Promise<Stats> {
  if (session.kind === "demo") return Promise.resolve(simulateStats(options));
  return loadHdmStats(session.token, options);
}

export function loadMaintenance(session: Session): Promise<Maintenance> {
  if (session.kind === "demo") return Promise.resolve(simulateMaintenance());
  return loadHdmMaintenance(session.token);
}

/** Undefined in demo mode, which simulates data instead of using the socket */
export async function loadSocketConnection(
  session: Session,
): Promise<SocketConnection | undefined> {
  if (session.kind === "demo") return undefined;
  return loadHdmSocketConnection(session.token);
}

export async function sendHeartbeat(session: Session): Promise<void> {
  if (session.kind === "demo") return;
  await sendHdmHeartbeat(session.token);
}

/**
 * Whether a request comes from a page of this app. Browsers send
 * `Sec-Fetch-Site` with every request; requests without it (e.g. curl) carry
 * no cookies of a browser either.
 */
export function isSameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}

export function isUnauthorized(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    (error as { response?: { status?: number } }).response?.status === 401
  );
}
