// @ts-check

/**
 * @param {import("../index.d.ts").State} state
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function request(state, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "X-API-KEY": state.apiKey,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`[${response.status}] ${text}`);
    // @ts-expect-error - custom properties
    error.status = response.status;
    // @ts-expect-error - custom properties
    error.response = text;
    throw error;
  }

  if (response.status === 201) {
    return undefined;
  }

  return response.json();
}
