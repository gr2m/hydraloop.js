// Writes packages/hydraloop-diagram-react/assets/receiving-greywater.svg, the image of
// the package's readme: `npm run readme-svg`

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

// Tooltip times are formatted in the local time zone
process.env.TZ = "UTC";

const pkg = new URL(
  "../../../packages/hydraloop-diagram-react/",
  import.meta.url,
);
const out = new URL("assets/receiving-greywater.svg", pkg);

const server = await createServer({
  root: new URL("..", import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "warn",
});
try {
  const { render } = await server.ssrLoadModule("/scripts/readme-svg.tsx");
  const styles = readFileSync(new URL("src/styles.css", pkg), "utf8")
    // Without comments and blank lines
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\n\s*\n/g, "\n");
  mkdirSync(new URL(".", out), { recursive: true });
  writeFileSync(out, render(styles) + "\n");
  console.log("Wrote %s", out.pathname);
} finally {
  await server.close();
}
