// semantic-release plugin that sets the version ranges of dependencies on other
// packages in this repository before a package is published.
//
// In the repository, `hydraloop-internal` depends on `"hydraloop":
// "0.0.0-development"`, the placeholder version of every package in
// packages/, so that npm links the local package instead of installing it from
// the registry. Before publishing, this plugin replaces the placeholder with
// `^<version>` of the latest `<name>@<version>` tag of that package. When both
// packages are released in the same run, `hydraloop` is released first, so
// its new tag already exists.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PLACEHOLDER = "0.0.0-development";

/**
 * @param {unknown} _pluginConfig
 * @param {{ cwd: string, logger: { log: (...args: unknown[]) => void } }} context
 */
export function prepare(_pluginConfig, { cwd, logger }) {
  const path = join(cwd, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  let changed = false;

  for (const field of ["dependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(pkg[field] || {})) {
      if (range !== PLACEHOLDER) continue;

      const version = getLatestVersion(name, cwd);
      pkg[field][name] = `^${version}`;
      changed = true;
      logger.log("Set %s.%s to ^%s", field, name, version);
    }
  }

  if (changed) {
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  }
}

/**
 * @param {string} name
 * @param {string} cwd
 */
function getLatestVersion(name, cwd) {
  const [tag] = execFileSync(
    "git",
    ["tag", "--merged", "HEAD", "--list", `${name}@*`, "--sort=-v:refname"],
    { cwd, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

  if (!tag) {
    throw new Error(
      `No "${name}@<version>" tag found to set its version range`,
    );
  }

  return tag.slice(name.length + 1);
}
