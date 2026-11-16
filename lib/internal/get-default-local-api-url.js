// @ts-check

import { rootRequest } from "./api-request.js";

/**
 * Returns the local API URL for requests that are not for a specific device.
 * Unless set with the `localApiUrl` option, it is the URL of the preferred
 * local server, which is looked up on the first call and cached.
 *
 * @param {import("./index.d.ts").State} state
 * @returns {Promise<string>}
 */
export async function getDefaultLocalApiUrl(state) {
  if (state.localApiUrl) {
    return state.localApiUrl;
  }

  /** @type {import("./root-types.d.ts").LocalServer[]} */
  const localServers = await rootRequest(
    state,
    { method: "GET", url: "/devices/local-servers", query: ["preferredFirst"] },
    { preferredFirst: true },
  );

  const localServer = localServers.find((server) => server.apiUrl);
  if (!localServer) {
    throw new Error("No local server found");
  }

  state.localApiUrl = localServer.apiUrl;
  return localServer.apiUrl;
}
