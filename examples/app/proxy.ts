import { Hydraloop } from "hydraloop/internal";
import { NextResponse, type NextRequest } from "next/server";

import {
  REFRESH_BEFORE,
  TOKEN_COOKIE,
  tokenCookieOptions,
  tokenExpiry,
} from "./lib/token";

/**
 * Refreshes the HDM token before it expires, so that the session lasts as
 * long as the app is used. Open pages ping `/api/session` to keep it alive.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const expiresAt = token && tokenExpiry(token);
  if (!token || !expiresAt) return NextResponse.next();

  const remaining = expiresAt - Date.now();
  // An expired token can't be refreshed, the app asks to sign in again
  if (remaining > REFRESH_BEFORE || remaining <= 0) return NextResponse.next();

  let refreshed: { token: string; expiresIn: number };
  try {
    refreshed = await new Hydraloop({ token }).root.auth.refreshToken();
  } catch {
    // Keep using the current token until it expires
    return NextResponse.next();
  }

  // Use the new token for this request already, and store it for the next
  request.cookies.set(TOKEN_COOKIE, refreshed.token);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(
    TOKEN_COOKIE,
    refreshed.token,
    tokenCookieOptions(refreshed.token, refreshed.expiresIn),
  );
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
