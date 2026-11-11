import { describe, it, expectTypeOf } from "vitest";

import { Hydraloop } from "../index.js";
import type {
  HydraloopOptions,
  Device,
  DeviceIssue,
  DeviceStatus,
  Person,
  LoginUser,
  Role,
  Permission,
  Organisation,
  WaterRecycledRecords,
  WaterRecycledEntry,
  WaterIntakeOfHouseEntry,
  TankLevel,
  TankLevels,
  TankLevelsByMonth,
  BypassMode,
} from "../index.js";

describe("Hydraloop types", () => {
  it("constructor accepts HydraloopOptions", () => {
    const options: HydraloopOptions = { apiKey: "test" };
    expectTypeOf(options).toMatchTypeOf<HydraloopOptions>();
    expectTypeOf(new Hydraloop(options)).toMatchTypeOf<Hydraloop>();
  });

  it("constructor accepts optional rootApiUrl", () => {
    const options: HydraloopOptions = {
      apiKey: "test",
      rootApiUrl: "https://example.com",
    };
    expectTypeOf(options).toMatchTypeOf<HydraloopOptions>();
  });

  it("method return types", () => {
    const hydraloop = new Hydraloop({ apiKey: "test" });

    expectTypeOf(hydraloop.listDevices()).toMatchTypeOf<Promise<Device[]>>();
    expectTypeOf(
      hydraloop.getRecycledWaterByYear({ deviceId: "id", year: 2025 }),
    ).toMatchTypeOf<Promise<WaterRecycledRecords>>();
    expectTypeOf(
      hydraloop.getRecycledWaterByMonth({
        deviceId: "id",
        year: 2025,
        month: 1,
      }),
    ).toMatchTypeOf<Promise<WaterRecycledRecords>>();
    expectTypeOf(hydraloop.getTankLevels({ deviceId: "id" })).toMatchTypeOf<
      Promise<TankLevels>
    >();
    expectTypeOf(
      hydraloop.getTankLevelsByMonth({
        deviceId: "id",
        year: 2025,
        month: 1,
      }),
    ).toMatchTypeOf<Promise<TankLevelsByMonth>>();
    expectTypeOf(hydraloop.getBypassMode({ deviceId: "id" })).toMatchTypeOf<
      Promise<BypassMode>
    >();
    expectTypeOf(
      hydraloop.setBypassMode({ deviceId: "id", activate: true }),
    ).toMatchTypeOf<Promise<void>>();
  });

  it("Device type shape", () => {
    const device = {} as Device;
    expectTypeOf(device.deviceStatus).toMatchTypeOf<DeviceStatus>();
    expectTypeOf(device.owner).toMatchTypeOf<Person>();
    expectTypeOf(device.organisation).toMatchTypeOf<Organisation>();
    expectTypeOf(device.localApiUrl).toBeString();
    expectTypeOf(device.online).toBeBoolean();
    expectTypeOf(device.toilet).toBeBoolean();
    expectTypeOf(device.washingMachine).toBeBoolean();
    expectTypeOf(device.connectedToilets).toBeNumber();
    expectTypeOf(device.hasTransferUpgradeKit).toBeBoolean();
    expectTypeOf(device.firmwareCoreVersion).toEqualTypeOf<string | null>();
    expectTypeOf(device.neighborDevices).toMatchTypeOf<Device[]>();
    expectTypeOf(device.settings).toMatchTypeOf<Record<string, unknown>>();
  });

  it("DeviceStatus type shape", () => {
    const status = {} as DeviceStatus;
    expectTypeOf(status.hasBlockingIssue).toBeBoolean();
    expectTypeOf(status.blockingInfo).toEqualTypeOf<DeviceIssue[]>();
    expectTypeOf(status.hasAttentionRequired).toBeBoolean();
    expectTypeOf(status.attentionRequiredInfo).toEqualTypeOf<DeviceIssue[]>();
  });

  it("Person type shape", () => {
    const person = {} as Person;
    expectTypeOf(person.user).toMatchTypeOf<LoginUser>();
  });

  it("LoginUser type shape", () => {
    const loginUser = {} as LoginUser;
    expectTypeOf(loginUser.roles).toMatchTypeOf<Role[]>();
  });

  it("Role type shape", () => {
    const role = {} as Role;
    expectTypeOf(role.permissions).toMatchTypeOf<Permission[]>();
    expectTypeOf(role.roles).toMatchTypeOf<Role[]>();
  });

  it("WaterRecycledRecords type shape", () => {
    const records = {} as WaterRecycledRecords;
    expectTypeOf(records.waterRecycled).toMatchTypeOf<WaterRecycledEntry[]>();
    expectTypeOf(records.waterIntakeOfHouse).toMatchTypeOf<
      WaterIntakeOfHouseEntry[]
    >();

    const entry = {} as WaterRecycledEntry;
    expectTypeOf(entry.timestamp).toBeString();
    expectTypeOf(entry.liters).toBeNumber();
  });

  it("TankLevels type shape", () => {
    const levels = {} as TankLevels;
    expectTypeOf(levels.tank2).toEqualTypeOf<TankLevel | null>();
    expectTypeOf(levels.tank2b).toEqualTypeOf<TankLevel | null>();
    expectTypeOf(levels.tank3).toEqualTypeOf<TankLevel | null>();

    const level = {} as TankLevel;
    expectTypeOf(level.timestamp).toBeString();
    expectTypeOf(level.percentage).toBeNumber();
    expectTypeOf(level.liters).toBeNumber();
  });

  it("TankLevelsByMonth type shape", () => {
    const levels = {} as TankLevelsByMonth;
    expectTypeOf(levels.tank2).toEqualTypeOf<TankLevel[]>();
    expectTypeOf(levels.tank2b).toEqualTypeOf<TankLevel[]>();
    expectTypeOf(levels.tank3).toEqualTypeOf<TankLevel[]>();
  });

  it("BypassMode type shape", () => {
    const bypass = {} as BypassMode;
    expectTypeOf(bypass.bypassActive).toBeBoolean();
    expectTypeOf(bypass.minutesRemaining).toBeNumber();
    expectTypeOf(bypass.remaining).toBeString();
  });
});
