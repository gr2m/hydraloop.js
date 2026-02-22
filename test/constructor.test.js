import { describe, it, expect } from "vitest";

import { Hydraloop, VERSION } from "../index.js";

describe("constructor", () => {
  it("throws if apiKey is missing", () => {
    expect(() => new Hydraloop()).toThrowError(/apiKey is required/);
  });

  it("throws if options is empty object", () => {
    expect(() => new Hydraloop({})).toThrowError(/apiKey is required/);
  });

  it("creates instance with apiKey", () => {
    const h = new Hydraloop({ apiKey: "test-key" });
    expect(h).toBeInstanceOf(Hydraloop);
  });

  it("exposes VERSION as static property", () => {
    expect(Hydraloop.VERSION).toBe(VERSION);
  });

  it("exports VERSION", () => {
    expect(typeof VERSION).toBe("string");
  });
});
