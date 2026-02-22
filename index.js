// @ts-check

import { VERSION } from "./lib/version.js";
import { listDevices } from "./lib/list-devices.js";
import { getRecycledWaterByYear } from "./lib/get-recycled-water-by-year.js";
import { getRecycledWaterByMonth } from "./lib/get-recycled-water-by-month.js";
import { getAuxiliaryOutputByDay } from "./lib/get-auxiliary-output-by-day.js";
import { getBackupWaterByDay } from "./lib/get-backup-water-by-day.js";
import { getBackupWaterByMonth } from "./lib/get-backup-water-by-month.js";
import { getBypassMode } from "./lib/get-bypass-mode.js";
import { setBypassMode } from "./lib/set-bypass-mode.js";

export { VERSION } from "./lib/version.js";
export { RequestError } from "./lib/request-error.js";

const ROOT_API_URL = "https://hdm.hydraloop.com/api-root";

export class Hydraloop {
  static VERSION = VERSION;

  /**
   * @param {import("./index.d.ts").HydraloopOptions} options
   */
  constructor(options) {
    if (!options || !options.apiKey) {
      throw new Error("apiKey is required");
    }

    const state = {
      apiKey: options.apiKey,
      rootApiUrl: options.rootApiUrl || ROOT_API_URL,
      deviceLocalApiUrls: new Map(),
    };

    this.listDevices = listDevices.bind(null, state);
    this.getRecycledWaterByYear = getRecycledWaterByYear.bind(null, state);
    this.getRecycledWaterByMonth = getRecycledWaterByMonth.bind(null, state);
    this.getAuxiliaryOutputByDay = getAuxiliaryOutputByDay.bind(null, state);
    this.getBackupWaterByDay = getBackupWaterByDay.bind(null, state);
    this.getBackupWaterByMonth = getBackupWaterByMonth.bind(null, state);
    this.getBypassMode = getBypassMode.bind(null, state);
    this.setBypassMode = setBypassMode.bind(null, state);
  }
}
