// The sidebar's settings in the URL's query, so a link opens the same diagram.
// An unchanged preset is just its key (`?preset=transfer`). Edited inputs are
// spelled out:
//
//   on=bypass,uv_power   IOs that are on
//   off=tank4            IOs that are off (IOs in neither have no data)
//   t2a=60,-1.5          Tank level in liters and trend in L/min (missing: no data)
//   A=TRANSFER.ENTRY     Routine and sub-state of a train (missing: no routine)
//   pressurized=A,B      Trains with air added to T2 before
//   bypass=1             Bypass switched on in the app
//   outlets=toilet,auxiliary  Connected outlets

import { TANK_IDS, type Side } from "hydraloop-diagram-react/model";

import { emptyInputs, PRESETS, type Inputs } from "./inputs.js";

const SIDES: Side[] = ["A", "B"];
const OUTLETS = ["toilet", "washingMachine", "auxiliary"] as const;

const list = (value: string | null) =>
  value ? value.split(",").filter(Boolean) : [];

export function toSearch(inputs: Inputs, preset: string): string {
  const params = new URLSearchParams();
  if (preset) {
    params.set("preset", preset);
    return `?${params}`;
  }

  const names = Object.keys(inputs.io);
  const on = names.filter((name) => inputs.io[name]);
  const off = names.filter((name) => !inputs.io[name]);
  if (on.length) params.set("on", on.join(","));
  if (off.length) params.set("off", off.join(","));

  for (const id of TANK_IDS) {
    const { liters, trend } = inputs.tanks[id];
    if (liters !== null)
      params.set(id, trend ? `${liters},${trend}` : `${liters}`);
  }

  for (const side of SIDES) {
    const routine = inputs.routines[side];
    if (routine) params.set(side, `${routine.name}.${routine.state}`);
  }

  const pressurized = SIDES.filter((side) => inputs.pressurized[side]);
  if (pressurized.length) params.set("pressurized", pressurized.join(","));
  if (inputs.bypassOverride) params.set("bypass", "1");
  params.set(
    "outlets",
    OUTLETS.filter((key) => inputs.outlets[key] !== false).join(","),
  );

  // Keep commas readable
  return `?${params}`.replaceAll("%2C", ",");
}

/** The inputs and preset of a query, or null if it has none */
export function fromSearch(
  search: string,
): { inputs: Inputs; preset: string } | null {
  const params = new URLSearchParams(search);

  const preset = PRESETS.find((p) => p.key === params.get("preset"));
  if (preset) return { inputs: preset.inputs(), preset: preset.key };

  const keys = [
    "on",
    "off",
    "pressurized",
    "bypass",
    "outlets",
    ...TANK_IDS,
    ...SIDES,
  ];
  if (!keys.some((key) => params.has(key))) return null;

  const inputs = emptyInputs();
  for (const name of list(params.get("off"))) inputs.io[name] = 0;
  for (const name of list(params.get("on"))) inputs.io[name] = 1;

  for (const id of TANK_IDS) {
    const [liters, trend] = list(params.get(id)).map(Number);
    if (Number.isFinite(liters)) {
      inputs.tanks[id] = {
        liters,
        trend: Number.isFinite(trend) ? trend : 0,
      };
    }
  }

  for (const side of SIDES) {
    const value = params.get(side);
    if (!value) continue;
    const dot = value.indexOf(".");
    inputs.routines[side] =
      dot === -1
        ? { name: value, state: "ENTRY" }
        : { name: value.slice(0, dot), state: value.slice(dot + 1) };
  }

  const pressurized = list(params.get("pressurized"));
  for (const side of SIDES)
    inputs.pressurized[side] = pressurized.includes(side);
  inputs.bypassOverride = params.get("bypass") === "1";

  if (params.has("outlets")) {
    const outlets = list(params.get("outlets"));
    for (const key of OUTLETS) inputs.outlets[key] = outlets.includes(key);
  }

  return { inputs, preset: "" };
}
