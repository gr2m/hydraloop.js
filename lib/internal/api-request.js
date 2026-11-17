// @ts-check

import { getDefaultDeviceId } from "./get-default-device-id.js";
import { getDeviceToken } from "./get-device-token.js";
import { getLocalApiUrl } from "./get-local-api-url.js";
import { request } from "./request.js";

/**
 * Sends a request to the root API.
 *
 * @param {import("./index.d.ts").State} state
 * @param {import("./index.d.ts").Route} route
 * @param {Record<string, any>} [options]
 * @returns {Promise<any>}
 */
export async function rootRequest(state, route, options = {}) {
  return request(state, buildUrl(state.rootApiUrl, route, options), {
    method: route.method,
    body: options.body,
    json: route.json,
  });
}

/**
 * Sends a request to the local API. If the request is for a device (it has a
 * `deviceId` parameter or a `deviceId` in its body), it is sent to the
 * device's local API together with a device-scoped token.
 *
 * Other requests are sent to the `localApiUrl` option or the local API of the
 * user's first device. Some of these endpoints require a device token as well,
 * so the token of the user's first device is sent with them.
 *
 * @param {import("./index.d.ts").State} state
 * @param {import("./index.d.ts").Route} route
 * @param {Record<string, any>} [options]
 * @returns {Promise<any>}
 */
export async function localRequest(state, route, options = {}) {
  const requestDeviceId = options.deviceId ?? options.body?.deviceId;
  const deviceId = requestDeviceId ?? (await getDefaultDeviceId(state));

  const [localApiUrl, deviceToken] = await Promise.all([
    !requestDeviceId && state.localApiUrl
      ? state.localApiUrl
      : getLocalApiUrl(state, deviceId),
    getDeviceToken(state, deviceId),
  ]);
  return request(state, buildUrl(localApiUrl, route, options), {
    method: route.method,
    body: options.body,
    deviceToken,
    json: route.json,
  });
}

/**
 * @param {string} baseUrl
 * @param {import("./index.d.ts").Route} route
 * @param {Record<string, any>} options
 * @returns {string}
 */
function buildUrl(baseUrl, route, options) {
  let path = route.url;
  for (const name of route.path ?? []) {
    path = path.replace(`{${name}}`, encodeURIComponent(options[name]));
  }

  const params = new URLSearchParams();
  for (const name of route.query ?? []) {
    const value = options[name];
    if (value == null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(name, serializeQueryValue(item));
    }
  }

  const query = params.size ? `?${params}` : "";
  return `${baseUrl.replace(/\/$/, "")}${path}${query}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function serializeQueryValue(value) {
  if (value instanceof Date) return value.toISOString();
  // e.g. the lazy loading `event` parameter of list endpoints
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
