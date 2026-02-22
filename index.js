// @ts-check

const ROOT_API_URL = "https://hdm.hydraloop.com/api-root";

export class Hydraloop {
  /** @type {string} */
  #apiKey;

  /** @type {string} */
  #rootApiUrl;

  /** @type {Map<string, string>} */
  #deviceLocalApiUrls = new Map();

  /**
   * @param {import("./index.d.ts").HydraloopOptions} options
   */
  constructor(options) {
    if (!options || !options.apiKey) {
      throw new Error("apiKey is required");
    }
    this.#apiKey = options.apiKey;
    this.#rootApiUrl = options.rootApiUrl || ROOT_API_URL;
  }

  /**
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  async #request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        accept: "application/json",
        "X-API-KEY": this.#apiKey,
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

  /**
   * @param {string} deviceId
   * @returns {Promise<string>}
   */
  async #getLocalApiUrl(deviceId) {
    if (this.#deviceLocalApiUrls.has(deviceId)) {
      return /** @type {string} */ (this.#deviceLocalApiUrls.get(deviceId));
    }

    await this.listDevices();

    if (!this.#deviceLocalApiUrls.has(deviceId)) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    return /** @type {string} */ (this.#deviceLocalApiUrls.get(deviceId));
  }

  /**
   * List all coupled devices.
   * @returns {Promise<import("./index.d.ts").Device[]>}
   */
  async listDevices() {
    const devices = await this.#request(
      `${this.#rootApiUrl}/external-api/list-coupled-devices`,
    );

    for (const device of devices) {
      if (device.id && device.localApiUrl) {
        this.#deviceLocalApiUrls.set(device.id, device.localApiUrl);
      }
    }

    return devices;
  }

  /**
   * @param {{ x: string, y: number }[]} records
   * @returns {{ timestamp: string, liters: number }[]}
   */
  #mapTimestampLiters(records) {
    return records.map(({ x, y }) => ({ timestamp: x, liters: y }));
  }

  /**
   * Get recycled water data by year.
   * @param {{ deviceId: string, year: number }} options
   * @returns {Promise<import("./index.d.ts").WaterRecycledRecords>}
   */
  async getRecycledWaterByYear({ deviceId, year }) {
    const localApiUrl = await this.#getLocalApiUrl(deviceId);
    const params = new URLSearchParams({
      deviceId,
      year: String(year),
    });
    const data = await this.#request(
      `${localApiUrl}/external-api/recycled-water-by-year?${params}`,
    );
    return {
      waterRecycled: this.#mapTimestampLiters(data.waterRecycled),
      waterIntakeOfHouse: this.#mapTimestampLiters(data.waterIntakeOfHouse),
    };
  }

  /**
   * Get recycled water data by month.
   * @param {{ deviceId: string, year: number, month: number }} options
   * @returns {Promise<import("./index.d.ts").WaterRecycledRecords>}
   */
  async getRecycledWaterByMonth({ deviceId, year, month }) {
    const localApiUrl = await this.#getLocalApiUrl(deviceId);
    const params = new URLSearchParams({
      deviceId,
      year: String(year),
      month: String(month),
    });
    const data = await this.#request(
      `${localApiUrl}/external-api/recycled-water-by-month?${params}`,
    );
    return {
      waterRecycled: this.#mapTimestampLiters(data.waterRecycled),
      waterIntakeOfHouse: this.#mapTimestampLiters(data.waterIntakeOfHouse),
    };
  }

  /**
   * Get auxiliary output data by day.
   * @param {{ deviceId: string, year: number, month: number, day: number }} options
   * @returns {Promise<import("./index.d.ts").AuxiliaryOutput[]>}
   */
  async getAuxiliaryOutputByDay({ deviceId, year, month, day }) {
    const localApiUrl = await this.#getLocalApiUrl(deviceId);
    const params = new URLSearchParams({
      deviceId,
      year: String(year),
      month: String(month),
      day: String(day),
    });
    return this.#request(
      `${localApiUrl}/external-api/auxiliary-output-by-day?${params}`,
    );
  }

  /**
   * Get backup water data by day.
   * @param {{ deviceId: string, year: number, month: number, day: number }} options
   * @returns {Promise<import("./index.d.ts").BackupWaterEntry[]>}
   */
  async getBackupWaterByDay({ deviceId, year, month, day }) {
    const localApiUrl = await this.#getLocalApiUrl(deviceId);
    const params = new URLSearchParams({
      deviceId,
      year: String(year),
      month: String(month),
      day: String(day),
    });
    const data = await this.#request(
      `${localApiUrl}/external-api/backup-water-by-day?${params}`,
    );
    return data.map(({ x, y, actorId }) => ({
      timestamp: x,
      liters: y,
      actorId,
    }));
  }

  /**
   * Get backup water data by month.
   * @param {{ deviceId: string, year: number, month: number }} options
   * @returns {Promise<import("./index.d.ts").BackupWaterEntry[]>}
   */
  async getBackupWaterByMonth({ deviceId, year, month }) {
    const localApiUrl = await this.#getLocalApiUrl(deviceId);
    const params = new URLSearchParams({
      deviceId,
      year: String(year),
      month: String(month),
    });
    const data = await this.#request(
      `${localApiUrl}/external-api/backup-water-by-month?${params}`,
    );
    return data.map(({ x, y, actorId }) => ({
      timestamp: x,
      liters: y,
      actorId,
    }));
  }

  /**
   * Get current bypass mode status.
   * @param {{ deviceId: string }} options
   * @returns {Promise<import("./index.d.ts").BypassMode>}
   */
  async getBypassMode({ deviceId }) {
    const localApiUrl = await this.#getLocalApiUrl(deviceId);
    const params = new URLSearchParams({ deviceId });
    return this.#request(`${localApiUrl}/external-api/bypass-mode?${params}`);
  }

  /**
   * Activate or deactivate bypass mode.
   * @param {{ deviceId: string, activate: boolean }} options
   * @returns {Promise<void>}
   */
  async setBypassMode({ deviceId, activate }) {
    const localApiUrl = await this.#getLocalApiUrl(deviceId);
    return this.#request(`${localApiUrl}/external-api/bypass-mode`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ deviceId, activate }),
    });
  }
}
