// Renders the "Receiving greywater" preset as the static SVG of the package's
// readme. Run by readme-svg.js through Vite, so it resolves the package's
// source like the app does.

import { renderToStaticMarkup } from "react-dom/server";

import { FlowDiagram } from "hydraloop-diagram-react";
import { stateAt } from "hydraloop-diagram-react/model";

import { PRESETS, toDataset } from "../src/inputs.js";

/** The time the tooltips show, at least in UTC */
const T = Date.UTC(2026, 10, 20, 12);

export function render(styles: string) {
  const preset = PRESETS.find((p) => p.key === "receiving")!;
  const dataset = toDataset(preset.inputs(), T);
  const svg = renderToStaticMarkup(
    <FlowDiagram state={stateAt(dataset, T)} device={dataset.device} />,
  );
  // A standalone SVG with the package's styles. As an image, it can't load
  // fonts or stylesheets, and `:root` is the <svg> element.
  const end = svg.indexOf(">") + 1;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${svg.slice(4, end)}` +
    `<style><![CDATA[${styles}${OVERRIDES}]]></style>` +
    svg.slice(end)
  );
}

/**
 * A system font, and the backgrounds of GitHub, which fill the gaps where
 * pipes cross
 */
const OVERRIDES = `
:root { --hl-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; --hl-bg: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --hl-bg: #0d1117; } }
`;
