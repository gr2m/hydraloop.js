// @ts-check

import { RequestError } from "./request-error.js";

/**
 * @param {import("../index.d.ts").State} state
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function request(state, url, options = {}) {
  const requestHeaders = {
    accept: "application/json",
    "X-API-KEY": state.apiKey,
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers: requestHeaders,
  });

  if (!response.ok) {
    const body = await response.text();
    const method = options.method || "GET";

    const redactedHeaders = /** @type {Record<string, string>} */ ({
      ...requestHeaders,
    });
    redactedHeaders["X-API-KEY"] = "***";

    const responseHeaders = /** @type {Record<string, string>} */ ({});
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    throw new RequestError(`[${response.status}] ${body}`, {
      request: {
        method,
        url,
        headers: redactedHeaders,
        body: options.body,
      },
      response: {
        url: response.url,
        status: response.status,
        headers: responseHeaders,
        body,
      },
    });
  }

  if (response.status === 201) {
    return undefined;
  }

  return response.json();
}
