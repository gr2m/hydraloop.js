import "server-only";

import { cookies } from "next/headers";

import { simulate } from "./demo";
import { loadDataset, type LoadOptions } from "./hdm";
import type { Dataset } from "./model";

export const TOKEN_COOKIE = "hdm_token";
export const DEMO_COOKIE = "hdm_demo";

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

export function isUnauthorized(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    (error as { response?: { status?: number } }).response?.status === 401
  );
}
