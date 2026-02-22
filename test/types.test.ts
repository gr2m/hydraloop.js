import { describe, it, expectTypeOf } from "vitest";

import { Hydraloop } from "../index.js";
import type {
  HydraloopOptions,
  Device,
  DeviceStatus,
  Person,
  LoginUser,
  Role,
  Permission,
  Organisation,
  WaterRecycledRecords,
  WaterRecycledCoordinates,
  WaterIntakeOfHouseCoordinates,
  AuxiliaryOutput,
  IoCoordinates,
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
    expectTypeOf(
      hydraloop.getAuxiliaryOutputByDay({
        deviceId: "id",
        year: 2025,
        month: 1,
        day: 15,
      }),
    ).toMatchTypeOf<Promise<AuxiliaryOutput[]>>();
    expectTypeOf(
      hydraloop.getBackupWaterByDay({
        deviceId: "id",
        year: 2025,
        month: 1,
        day: 15,
      }),
    ).toMatchTypeOf<Promise<IoCoordinates[]>>();
    expectTypeOf(
      hydraloop.getBackupWaterByMonth({
        deviceId: "id",
        year: 2025,
        month: 1,
      }),
    ).toMatchTypeOf<Promise<IoCoordinates[]>>();
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
    expectTypeOf(device.neighborDevices).toMatchTypeOf<Device[]>();
    expectTypeOf(device.settings).toMatchTypeOf<Record<string, unknown>>();
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
    expectTypeOf(records.waterRecycled).toMatchTypeOf<
      WaterRecycledCoordinates[]
    >();
    expectTypeOf(records.waterIntakeOfHouse).toMatchTypeOf<
      WaterIntakeOfHouseCoordinates[]
    >();

    const coord = {} as WaterRecycledCoordinates;
    expectTypeOf(coord.x).toBeString();
    expectTypeOf(coord.y).toBeNumber();
  });

  it("AuxiliaryOutput type shape", () => {
    const aux = {} as AuxiliaryOutput;
    expectTypeOf(aux.start).toBeString();
    expectTypeOf(aux.end).toBeString();
    expectTypeOf(aux.liters).toBeNumber();
  });

  it("IoCoordinates type shape", () => {
    const io = {} as IoCoordinates;
    expectTypeOf(io.x).toBeString();
    expectTypeOf(io.y).toBeNumber();
    expectTypeOf(io.actorId).toBeString();
  });

  it("BypassMode type shape", () => {
    const bypass = {} as BypassMode;
    expectTypeOf(bypass.bypassActive).toBeBoolean();
    expectTypeOf(bypass.minutesRemaining).toBeNumber();
    expectTypeOf(bypass.remaining).toBeString();
  });
});
