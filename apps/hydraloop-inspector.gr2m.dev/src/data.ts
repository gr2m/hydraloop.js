import errorsJson from "../error-catalogue/errors.json";
import causesJson from "../error-catalogue/causes.json";
import partsJson from "../error-catalogue/parts.json";
import errorPartsJson from "../error-catalogue/error_parts.json";
import { MAPPING, type ComponentMapping } from "./mapping";

export interface CatalogueError {
  code: string;
  title: string;
  summary: string;
  subsystem: string;
  urgency: "Urgent" | "Investigate" | "Routine";
  h600_applicability: string;
  revision_caveat: string;
  service_note: string | null;
  source_url: string;
  short_link: string | null;
  source_updated: string | null;
  reviewed: string;
}

export interface Cause {
  cause_id: string;
  error_code: string;
  cause: string;
  what_to_check: string;
  suggested_action: string;
  condition: string;
  parts: string;
  source_url: string;
  related_guide_url: string | null;
}

export interface Component {
  part_id: string;
  name: string;
  system: string;
  revision: string;
  notes: string | null;
  linked_error_count: number;
}

export interface ErrorPart {
  error_code: string;
  part_id: string;
  part_name: string;
  kind: string;
  related_causes: string;
  part_revision: string;
  source_url: string;
}

export const errors = errorsJson as CatalogueError[];
export const causes = causesJson as Cause[];
export const components = partsJson as Component[];
export const errorParts = errorPartsJson as ErrorPart[];

export const errorByCode = new Map(errors.map((e) => [e.code, e]));
export const componentById = new Map(components.map((c) => [c.part_id, c]));

export const causesByError = groupBy(causes, (c) => c.error_code);
export const linksByError = groupBy(errorParts, (l) => l.error_code);
export const linksByComponent = groupBy(errorParts, (l) => l.part_id);

export function mappingFor(componentId: string): ComponentMapping {
  return MAPPING[componentId] ?? { fidelity: "none", targets: [] };
}

const URGENCY_ORDER = { Urgent: 0, Investigate: 1, Routine: 2 } as const;
export const sortedErrors = [...errors].sort((a, b) => {
  if (a.code === "QUALITY") return 1;
  if (b.code === "QUALITY") return -1;
  return a.code.localeCompare(b.code);
});
export const urgencyRank = (e: CatalogueError) => URGENCY_ORDER[e.urgency] ?? 3;

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// CAD model index, built once the GLB has loaded.

export interface Solid {
  id: string;
  pn: string | null;
  name: string;
  sub: string | null;
  assemblyId: string;
  assemblyPn: string | null;
  assemblyName: string;
}

export interface ModelPart {
  key: string;
  pn: string | null;
  name: string;
  sub: string | null;
  assemblyPn: string;
  solidIds: string[];
}

export interface ModelAssembly {
  pn: string;
  name: string;
  instanceIds: string[];
  solidIds: string[];
  parts: ModelPart[];
}

/** Dutch CAD names translated for display. Part numbers stay authoritative. */
const DISPLAY_NAMES: Record<string, string> = {
  "Y stuk 45 , PVC": "Y-piece 45°, PVC",
  "Buis PVC Ø40x3": "PVC pipe Ø40x3",
  "Bocht PVC 45°Bi-Bu - Ø40": "PVC elbow 45°, Ø40",
  "M4 borgmoer": "M4 lock nut",
  "Draadstift M4": "M4 threaded stud",
  "M4 Tandveerring": "M4 serrated lock washer",
  "6x25 T25": "Self-tapping screw 6x25 T25",
  "RU 31UB100 000": 'G 1/2" outlet connector',
};

export const displayName = (name: string) => DISPLAY_NAMES[name] ?? name;

export function buildModelIndex(solids: Solid[]) {
  const assemblies = new Map<string, ModelAssembly>();
  for (const s of solids) {
    const apn = s.assemblyPn ?? s.assemblyName;
    let a = assemblies.get(apn);
    if (!a) {
      a = {
        pn: apn,
        name: s.assemblyName,
        instanceIds: [],
        solidIds: [],
        parts: [],
      };
      assemblies.set(apn, a);
    }
    if (!a.instanceIds.includes(s.assemblyId)) a.instanceIds.push(s.assemblyId);
    a.solidIds.push(s.id);
    const key = `${apn}|${s.pn ?? ""}|${s.name}`;
    let p = a.parts.find((x) => x.key === key);
    if (!p) {
      p = {
        key,
        pn: s.pn,
        name: s.name,
        sub: s.sub,
        assemblyPn: apn,
        solidIds: [],
      };
      a.parts.push(p);
    }
    p.solidIds.push(s.id);
  }
  const partByKey = new Map<string, ModelPart>();
  const partBySolid = new Map<string, ModelPart>();
  for (const a of assemblies.values()) {
    for (const p of a.parts) {
      partByKey.set(p.key, p);
      for (const id of p.solidIds) partBySolid.set(id, p);
    }
  }
  return { assemblies: [...assemblies.values()], partByKey, partBySolid };
}

export type ModelIndex = ReturnType<typeof buildModelIndex>;

const subPn = (sub: string | null) => sub?.match(/^HYD\d{4}/)?.[0] ?? null;

export function solidMatches(s: Solid, target: string) {
  return (
    target === "HYD0950" ||
    s.pn === target ||
    s.assemblyPn === target ||
    subPn(s.sub) === target
  );
}

export function resolveTargets(targets: string[], solids: Solid[]) {
  return solids
    .filter((s) => targets.some((t) => solidMatches(s, t)))
    .map((s) => s.id);
}

/** Catalogue components whose mapped geometry includes this solid. */
export function componentsForSolid(s: Solid) {
  return components.filter((c) => {
    const m = mappingFor(c.part_id);
    return (
      m.fidelity !== "none" &&
      !m.targets.includes("HYD0950") &&
      m.targets.some((t) => solidMatches(s, t))
    );
  });
}

// ---------------------------------------------------------------------------
// Search

export type SearchHit =
  | { type: "error"; score: number; error: CatalogueError }
  | { type: "component"; score: number; component: Component }
  | { type: "part"; score: number; part: ModelPart };

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-");

function score(query: string[], fields: [string | null | undefined, number][]) {
  let total = 0;
  for (const term of query) {
    let best = 0;
    for (const [value, weight] of fields) {
      if (!value) continue;
      const v = norm(value);
      const i = v.indexOf(term);
      if (i < 0) continue;
      const atWord = i === 0 || /[\s\-/(_.,]/.test(v[i - 1]);
      best = Math.max(best, weight * (v === term ? 3 : atWord ? 2 : 1));
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

export function search(raw: string, model: ModelIndex | null): SearchHit[] {
  const q = norm(raw).trim();
  if (!q) return [];
  // Allow "18" or "hl18" to find HL0018.
  const codeMatch = q.match(/^(?:hl)?0*(\d{1,4})$/);
  const terms = q.split(/\s+/);
  const hits: SearchHit[] = [];

  for (const e of errors) {
    const causeText = (causesByError.get(e.code) ?? [])
      .map((c) => `${c.cause} ${c.what_to_check} ${c.suggested_action}`)
      .join(" ");
    let s = score(terms, [
      [e.code, 10],
      [e.title, 6],
      [e.subsystem, 3],
      [e.summary, 2],
      [causeText, 1],
    ]);
    if (codeMatch && e.code === `HL${codeMatch[1].padStart(4, "0")}`) s += 100;
    if (s) hits.push({ type: "error", score: s, error: e });
  }
  for (const c of components) {
    const s = score(terms, [
      [c.part_id, 6],
      [c.name, 6],
      [c.system, 2],
      [c.notes, 1],
    ]);
    if (s) hits.push({ type: "component", score: s, component: c });
  }
  if (model) {
    for (const a of model.assemblies) {
      for (const p of a.parts) {
        const s = score(terms, [
          [p.pn, 8],
          [displayName(p.name), 6],
          [p.name, 5],
          [p.sub, 2],
          [a.name, 2],
        ]);
        if (s) hits.push({ type: "part", score: s, part: p });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}
