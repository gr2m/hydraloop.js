import "server-only";

import { humanize } from "./model";

// The HDM web app's English texts, e.g. the title and description of each
// device signal. They are loaded from the web app instead of copied, so new
// signals and causes are covered too. Without them, keys are humanized.

const TEXTS_URL = "https://hdm.hydraloop.com/hdm/assets/i18n/en.json";
const TTL = 24 * 3600_000;

type Texts = Record<string, unknown>;

let cache: { at: number; texts: Promise<Texts> } | undefined;

async function fetchTexts(): Promise<Texts> {
  const response = await fetch(TEXTS_URL);
  if (!response.ok) throw new Error(`${response.status} ${TEXTS_URL}`);
  return (await response.json()) as Texts;
}

export type Lookup = (path: string) => string | undefined;

/** Looks up a dotted path, e.g. `deviceSignals.soapBomb.title` */
export async function hdmTexts(): Promise<Lookup> {
  if (!cache || Date.now() - cache.at > TTL) {
    const texts = fetchTexts();
    cache = { at: Date.now(), texts };
    texts.catch(() => {
      cache = undefined;
    });
  }
  let texts: Texts = {};
  try {
    texts = await cache.texts;
  } catch {
    // Fall back to humanized keys
  }
  return (path) => {
    let value: unknown = texts;
    // Keys can contain dots themselves, e.g. ticket solutions like
    // `other_/_other_(fill_in_comments)`, so only split as far as needed
    const parts = path.split(".");
    for (let i = 0; i < parts.length; i++) {
      if (!value || typeof value !== "object") return undefined;
      const record = value as Record<string, unknown>;
      const rest = parts.slice(i).join(".");
      if (typeof record[rest] === "string") return record[rest] as string;
      value = record[parts[i]];
    }
    return typeof value === "string" ? value : undefined;
  };
}

/** A key like `externalFactor` or `t3_waste_not_opening_properly` as words */
export function readable(key: string) {
  return humanize(
    key.replace(/[/()]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
  ).replace(/\s+/g, " ");
}
