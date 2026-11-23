// @ts-check

import { RequestError } from "hydraloop";

const REDACTED_HEADERS = ["authorization", "additional-authorization"];

/**
 * @param {import("./index.d.ts").State} state
 * @param {string} url
 * @param {{ method: string, body?: unknown, deviceToken?: string, json?: boolean }} options
 * @returns {Promise<any>}
 */
export async function request(state, url, { method, body, deviceToken, json }) {
  /** @type {Record<string, string>} */
  const requestHeaders = { accept: "application/json" };
  if (state.token) {
    requestHeaders.authorization = `Bearer ${state.token}`;
  }
  if (deviceToken) {
    requestHeaders["additional-authorization"] = deviceToken;
  }
  if (body !== undefined) {
    requestHeaders["content-type"] = "application/json";
  }

  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody,
  });
  const responseBody = await response.text();

  if (!response.ok) {
    const redactedHeaders = { ...requestHeaders };
    for (const name of REDACTED_HEADERS) {
      if (name in redactedHeaders) redactedHeaders[name] = "***";
    }

    /** @type {Record<string, string>} */
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    throw new RequestError(`[${response.status}] ${responseBody}`, {
      request: {
        method,
        url,
        headers: redactedHeaders,
        body: requestBody,
      },
      response: {
        url: response.url,
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      },
    });
  }

  if (!responseBody) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    return JSON.parse(responseBody);
  }

  // The API sends some JSON responses as text/html, e.g. `false` or `0`
  if (json) {
    try {
      return JSON.parse(responseBody);
    } catch {
      return responseBody;
    }
  }

  return responseBody;
}
