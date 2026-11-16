// @ts-check

import { rootRequest } from "./api-request.js";

/**
 * Logs in with username and password, followed by the two-factor
 * authentication if the account requires it. The resulting token is used for
 * all following requests.
 *
 * @param {import("./index.d.ts").State} state
 * @param {import("./index.d.ts").LoginOptions} options
 * @returns {Promise<import("./root-types.d.ts").AuthToken>}
 */
export async function login(
  state,
  { username, password, totpCode, rememberDevice = false },
) {
  state.token = undefined;
  state.deviceTokens.clear();

  /** @type {import("./root-types.d.ts").AuthToken} */
  const auth = await rootRequest(
    state,
    { method: "POST", url: "/auth/login" },
    { body: { username, password } },
  );
  state.token = auth.token;

  if (auth.user.fullyLoggedIn) {
    return auth;
  }

  if (!totpCode) {
    throw new Error("totpCode is required for accounts with 2FA enabled");
  }

  // The login token is not fully logged in while 2FA is pending. The 2FA call
  // returns a new token (same shape as the login response) that replaces it.
  /** @type {import("./root-types.d.ts").AuthToken} */
  const twoFactorAuth = await rootRequest(
    state,
    { method: "POST", url: "/two-factor-authentication/authenticate" },
    {
      body: {
        totpCode: typeof totpCode === "function" ? await totpCode() : totpCode,
        rememberDevice,
      },
    },
  );
  state.token = twoFactorAuth.token;

  return twoFactorAuth;
}
