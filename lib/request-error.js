// @ts-check

export class RequestError extends Error {
  /**
   * @param {string} message
   * @param {{
   *   request: { method: string, url: string, headers: Record<string, string>, body?: any },
   *   response: { url: string, status: number, headers: Record<string, string>, body: string }
   * }} options
   */
  constructor(message, { request, response }) {
    super(message);
    this.name = "RequestError";
    this.request = request;
    this.response = response;
  }
}
