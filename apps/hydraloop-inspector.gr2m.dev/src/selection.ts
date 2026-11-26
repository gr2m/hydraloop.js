import { componentById, errorByCode, linksByError, mappingFor, resolveTargets, type ModelIndex, type Solid } from "./data";
import type { Highlight, Marker } from "./viewer";

export type Selection =
  | { kind: "error"; code: string }
  | { kind: "component"; id: string }
  | { kind: "part"; key: string };

export function parseHash(hash: string): Selection | null {
  const [, kind, raw] = hash.match(/^#\/(error|component|part)\/(.+)$/) ?? [];
  if (!kind) return null;
  const value = decodeURIComponent(raw);
  if (kind === "error") return errorByCode.has(value) ? { kind, code: value } : null;
  if (kind === "component") return componentById.has(value) ? { kind, id: value } : null;
  return { kind: "part", key: value };
}

export function toHash(s: Selection | null) {
  if (!s) return "#/";
  if (s.kind === "error") return `#/error/${s.code}`;
  if (s.kind === "component") return `#/component/${s.id}`;
  return `#/part/${encodeURIComponent(s.key)}`;
}

export interface Scene3D {
  highlight: Highlight;
  markers: Marker[];
}

const EMPTY: Scene3D = { highlight: { primary: [], secondary: [] }, markers: [] };

function componentScene(ids: string[], solids: Solid[]) {
  const highlight: Highlight = { primary: [], secondary: [] };
  const groups = new Map<string, { labels: string[]; ids: string[]; tone: Marker["tone"] }>();
  for (const id of ids) {
    const c = componentById.get(id);
    const m = mappingFor(id);
    if (!c || m.fidelity === "none") continue;
    const hit = resolveTargets(m.targets, solids);
    if (!hit.length) continue;
    const tone = m.fidelity === "modeled" ? "primary" : "secondary";
    highlight[tone].push(...hit);
    if (m.targets.includes("HYD0950")) continue;
    const key = `${tone}:${[...m.targets].sort().join(",")}`;
    const g = groups.get(key) ?? { labels: [], ids: hit, tone };
    g.labels.push(shortName(c.name));
    groups.set(key, g);
  }
  // A solid that is both the component and an approximation stays primary.
  const primary = new Set(highlight.primary);
  highlight.secondary = highlight.secondary.filter((id) => !primary.has(id));
  const markers = [...groups.entries()].map(([key, g]) => ({
    key,
    tone: g.tone,
    ids: g.ids,
    label: g.labels.length > 2 ? `${g.labels[0]}, ${g.labels[1]} +${g.labels.length - 2}` : g.labels.join(", "),
  }));
  return { highlight, markers };
}

export function shortName(name: string) {
  return name.split(/\s+[—/(]\s*|\s+\/\s+/)[0];
}

export function sceneFor(sel: Selection | null, solids: Solid[], model: ModelIndex | null): Scene3D {
  if (!sel || !model) return EMPTY;
  if (sel.kind === "error") {
    const ids = [...new Set((linksByError.get(sel.code) ?? []).map((l) => l.part_id))];
    return componentScene(ids, solids);
  }
  if (sel.kind === "component") return componentScene([sel.id], solids);
  const ids = sel.key.startsWith("asm:")
    ? model.assemblies.find((a) => a.pn === sel.key.slice(4))?.solidIds
    : model.partByKey.get(sel.key)?.solidIds;
  return ids ? { highlight: { primary: ids, secondary: [] }, markers: [] } : EMPTY;
}
