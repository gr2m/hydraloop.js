// The HDM token is a JWT that expires after 30 minutes. A token that is
// still valid can be exchanged for a new one with `root.auth.refreshToken()`,
// without a new two-factor code. See proxy.ts.

export const TOKEN_COOKIE = "hdm_token";
export const DEMO_COOKIE = "hdm_demo";

/** Refresh tokens that expire within this time */
export const REFRESH_BEFORE = 10 * 60_000;

/** Expiry of a JWT in milliseconds since epoch, if it has one */
export function tokenExpiry(token: string): number | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** The cookie expires with the token, as an expired token is of no use */
export function tokenCookieOptions(token: string, expiresIn: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(tokenExpiry(token) ?? Date.now() + expiresIn * 1000),
  };
}
