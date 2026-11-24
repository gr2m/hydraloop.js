// Renders the diagram for states of the simulated H600 of the H600 dashboard
// (`apps/h600.gr2m.dev/lib/demo.ts`), one per kind of flow. `fixtures/states.json`
// holds the `DeviceState` of the first moment of each flow in three
// simulated days.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";

import {
  activeFlows,
  DiagramLegend,
  FlowDiagram,
  FlowSummary,
  type DeviceInfo,
  type DeviceState,
} from "../src/index.js";
import fixtures from "./fixtures/states.json" with { type: "json" };

const device = fixtures.device as DeviceInfo;
const states = fixtures.states as unknown as Record<string, DeviceState>;

beforeAll(() => {
  // Tooltips show times in the runtime's locale and time zone
  vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (
    this: Date,
  ) {
    return this.toISOString().slice(11, 16);
  });
});

describe("FlowDiagram", () => {
  test.each(Object.keys(states))("%s", (name) => {
    const html = renderToStaticMarkup(
      <FlowDiagram state={states[name]} device={device} />,
    );
    expect(html).toMatchSnapshot();
  });

  test("class names are prefixed", () => {
    const html = renderToStaticMarkup(
      <FlowDiagram state={states.transfer} device={device} />,
    );
    const classes = new Set(
      [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(" ")),
    );
    const unprefixed = [...classes].filter(
      (c) => !c.startsWith("hl-") && !c.startsWith("is-"),
    );
    expect(unprefixed).toEqual([]);
  });

  test("disconnected outlets", () => {
    const html = renderToStaticMarkup(
      <FlowDiagram
        state={states.receiving}
        device={{
          ...device,
          outlets: { toilet: false, washingMachine: null, auxiliary: true },
        }}
      />,
    );
    expect(html.match(/hl-outlet is-disconnected/g)).toHaveLength(1);
  });
});

describe("activeFlows", () => {
  test.each([
    ["receiving", /^Greywater → train [AB]$/],
    ["filth-removal", /^T1 [AB] → skim overflow → drain \(inferred\)$/],
    ["transfer", /^Train [AB] → UV → T3$/],
    ["circulation", /^T3 → UV → T3$/],
    ["draining", /^T3 → drain$/],
    ["backup-water", /^T4 → /],
  ])("%s", (name, flow) => {
    expect(activeFlows(states[name])).toContainEqual(
      expect.stringMatching(flow),
    );
  });
  // It's not known whether greywater comes in while the bypass is open
  test("bypass", () => {
    expect(activeFlows(states.bypass)).not.toContainEqual(
      expect.stringMatching(/^Greywater/),
    );
  });
});

test("FlowSummary", () => {
  const html = renderToStaticMarkup(<FlowSummary state={states.draining} />);
  expect(html).toContain('<p class="hl-flow-summary">');
  expect(html).toContain("T3 → drain");
});

test("DiagramLegend", () => {
  expect(renderToStaticMarkup(<DiagramLegend />)).toMatchSnapshot();
});
