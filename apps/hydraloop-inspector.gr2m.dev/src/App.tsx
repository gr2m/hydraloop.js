import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Viewer, type ViewPreset } from "./viewer";
import {
  buildModelIndex,
  causesByError,
  componentById,
  components,
  componentsForSolid,
  displayName,
  errorByCode,
  linksByComponent,
  linksByError,
  mappingFor,
  resolveTargets,
  search,
  sortedErrors,
  type CatalogueError,
  type Component,
  type ModelAssembly,
  type ModelIndex,
  type ModelPart,
  type SearchHit,
  type Solid,
} from "./data";
import { FIDELITY_LABEL, type Fidelity } from "./mapping";
import { parseHash, sceneFor, toHash, type Selection } from "./selection";

type Tab = "problems" | "components" | "parts";

const MODEL_URL = `${import.meta.env.BASE_URL}models/h600.glb`;

export function App() {
  const viewport = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [solids, setSolids] = useState<Solid[]>([]);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(() => parseHash(location.hash));
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("problems");
  const [explode, setExplode] = useState(0);
  const [coversHidden, setCoversHidden] = useState(false);
  const [xray, setXray] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [sheet, setSheet] = useState<"peek" | "full">("peek");
  const [fullscreen, setFullscreen] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);

  const model = useMemo<ModelIndex | null>(() => (solids.length ? buildModelIndex(solids) : null), [solids]);
  const solidById = useMemo(() => new Map(solids.map((s) => [s.id, s])), [solids]);
  const scene = useMemo(() => sceneFor(selection, solids, model), [selection, solids, model]);
  const hits = useMemo(() => search(query, model), [query, model]);

  // Viewer lifecycle
  useEffect(() => {
    const v = new Viewer(viewport.current!, overlay.current!);
    viewerRef.current = v;
    const applyTheme = () => v.setThemeColors(resolveColor(viewport.current!, "--h6-primary", "#0a72ef"), resolveColor(viewport.current!, "--h6-secondary", "#f5a524"));
    applyTheme();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", applyTheme);
    v.load(MODEL_URL, setProgress).then(setSolids, (e) => setLoadError(String(e?.message ?? e)));
    return () => {
      mq.removeEventListener("change", applyTheme);
      v.dispose();
    };
  }, []);

  // Hash routing keeps selections linkable and makes browser back work.
  useEffect(() => {
    const onHash = () => setSelection(parseHash(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const select = (s: Selection | null) => {
    const hash = toHash(s);
    if (location.hash !== hash) location.hash = hash;
    setSelection(s);
    // On phones, drop the sheet so the highlighted geometry is visible.
    if (s) setSheet("peek");
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !model) return;
    v.onPick = (id) => {
      if (!id) return select(null);
      const part = model.partBySolid.get(id);
      if (part) select({ kind: "part", key: part.key });
    };
    v.onHover = (id, x, y) => setHover(id ? { id, x, y } : null);
  }, [model]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !solids.length) return;
    v.setHighlight(scene.highlight);
    v.setMarkers(scene.markers);
    const ids = [...scene.highlight.primary, ...scene.highlight.secondary];
    if (ids.length && ids.length < solids.length) v.focus(ids);
    else if (!selection) v.focus();
  }, [scene, solids]);

  useEffect(() => viewerRef.current?.setExplode(explode), [explode, solids]);
  useEffect(() => viewerRef.current?.setCoversHidden(coversHidden), [coversHidden, solids]);
  // Each new selection starts in X-ray so highlighted parts inside the unit are
  // visible; the toolbar button can still turn it off.
  useEffect(() => setXray(scene.highlight.primary.length + scene.highlight.secondary.length > 0), [scene]);
  useEffect(() => viewerRef.current?.setXray(xray), [xray, solids]);

  // Full screen hides the panel. Where the browser supports it (not iPhone Safari),
  // the app also enters native full screen; leaving it with Esc exits our mode too.
  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    if (next && !document.fullscreenElement) appRef.current?.requestFullscreen?.().catch(() => {});
    if (!next && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  useEffect(() => {
    const onChange = () => !document.fullscreenElement && setFullscreen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.fullscreenElement && setFullscreen(false);
    document.addEventListener("fullscreenchange", onChange);
    addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      removeEventListener("keydown", onKey);
    };
  }, []);

  const hoverSolid = hover ? solidById.get(hover.id) : null;
  const hasHighlight = scene.highlight.primary.length + scene.highlight.secondary.length > 0;

  return (
    <div className="vbg-report h6-app" ref={appRef} data-fullscreen={fullscreen || undefined}>
      <a className="vbg-skip-link" href="#h6-panel">
        Skip to search
      </a>

      <section className="h6-stage" aria-label="3D model">
        <div className="h6-viewport" ref={viewport} />
        <div className="h6-overlay" ref={overlay} aria-hidden="true" />

        {!solids.length && (
          <div className="h6-loading" role="status">
            {loadError ? `Could not load the 3D model: ${loadError}` : `Loading 3D model ${Math.round(progress * 100)}%`}
          </div>
        )}

        {hoverSolid && hover && (
          <div className="h6-tooltip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 14}px)` }} aria-hidden="true">
            <span>{displayName(hoverSolid.name)}</span>
            {hoverSolid.pn && <span className="vbg-mono">{hoverSolid.pn}</span>}
          </div>
        )}

        {hasHighlight && (
          <div className="h6-legend vbg-caption" aria-hidden="true">
            {scene.highlight.primary.length > 0 && (
              <span>
                <i data-tone="primary" /> Modeled part
              </span>
            )}
            {scene.highlight.secondary.length > 0 && (
              <span>
                <i data-tone="secondary" /> Location or housing
              </span>
            )}
          </div>
        )}

        <Toolbar
          explode={explode}
          setExplode={setExplode}
          coversHidden={coversHidden}
          setCoversHidden={setCoversHidden}
          xray={xray}
          setXray={setXray}
          onView={(p) => viewerRef.current?.view(p)}
          onFit={() => {
            const ids = [...scene.highlight.primary, ...scene.highlight.secondary];
            viewerRef.current?.focus(ids.length ? ids : undefined);
          }}
          onZoom={(f) => viewerRef.current?.zoom(f)}
          fullscreen={fullscreen}
          onFullscreen={toggleFullscreen}
        />
      </section>

      <aside className="h6-panel" id="h6-panel" data-sheet={sheet} aria-label="Search and details">
        <button
          className="h6-sheet-handle"
          type="button"
          aria-label={sheet === "full" ? "Collapse panel" : "Expand panel"}
          onClick={() => setSheet(sheet === "full" ? "peek" : "full")}
        >
          <span />
        </button>

        <header className="h6-head">
          <div className="h6-title-row">
            <h1 className="vbg-heading-20">Hydraloop H600 inspector</h1>
            <span className="vbg-meta">V2.1 230V</span>
          </div>
          <div className="h6-search">
            <label className="vbg-visually-hidden" htmlFor="h6-q">
              Search problems and parts
            </label>
            <input
              id="h6-q"
              type="search"
              placeholder="Search errors, parts, part numbers"
              value={query}
              autoComplete="off"
              spellCheck={false}
              onFocus={() => setSheet("full")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits[0]) {
                  pickHit(hits[0], select);
                  setQuery("");
                }
                if (e.key === "Escape") setQuery("");
              }}
            />
          </div>
        </header>

        <div className="h6-body">
          {query.trim() ? (
            <SearchResults hits={hits} query={query} onPick={(h) => (pickHit(h, select), setQuery(""))} />
          ) : selection ? (
            <Detail selection={selection} model={model} solids={solids} solidById={solidById} select={select} />
          ) : (
            <Browse tab={tab} setTab={setTab} model={model} select={select} />
          )}
        </div>
      </aside>
    </div>
  );
}

/** Resolves a CSS color token (oklch, light-dark) to a hex string three.js understands. */
function resolveColor(el: HTMLElement, token: string, fallback: string) {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  el.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || !computed) return fallback;
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function pickHit(h: SearchHit, select: (s: Selection) => void) {
  if (h.type === "error") select({ kind: "error", code: h.error.code });
  else if (h.type === "component") select({ kind: "component", id: h.component.part_id });
  else select({ kind: "part", key: h.part.key });
}

// ---------------------------------------------------------------------------
// Toolbar

function Toolbar(props: {
  explode: number;
  setExplode: (n: number) => void;
  coversHidden: boolean;
  setCoversHidden: (b: boolean) => void;
  xray: boolean;
  setXray: (b: boolean) => void;
  onView: (p: ViewPreset) => void;
  onFit: () => void;
  onZoom: (f: number) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
}) {
  const [views, setViews] = useState(false);
  return (
    <div className="h6-toolbar" role="toolbar" aria-label="View controls">
      <label className="h6-explode">
        <span className="vbg-label">Explode</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={props.explode}
          onChange={(e) => props.setExplode(Number(e.target.value))}
          onPointerUp={props.onFit}
          onKeyUp={props.onFit}
          aria-valuetext={`${Math.round(props.explode * 100)}%`}
        />
      </label>
      <button type="button" className="h6-tool" aria-pressed={props.coversHidden} onClick={() => props.setCoversHidden(!props.coversHidden)}>
        Hide covers
      </button>
      <button type="button" className="h6-tool" aria-pressed={props.xray} onClick={() => props.setXray(!props.xray)}>
        X-ray
      </button>
      <div className="h6-views">
        <button type="button" className="h6-tool" aria-expanded={views} onClick={() => setViews(!views)}>
          Views
        </button>
        {views && (
          <div className="h6-menu" role="menu" onClick={() => setViews(false)}>
            {(["front", "back", "left", "right", "top", "iso"] as ViewPreset[]).map((p) => (
              <button key={p} type="button" role="menuitem" onClick={() => props.onView(p)}>
                {p === "iso" ? "3D" : p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="h6-tool" onClick={props.onFit}>
        Fit
      </button>
      <span className="h6-zoom">
        <button type="button" className="h6-tool" aria-label="Zoom in" onClick={() => props.onZoom(0.7)}>
          +
        </button>
        <button type="button" className="h6-tool" aria-label="Zoom out" onClick={() => props.onZoom(1.4)}>
          −
        </button>
      </span>
      <button type="button" className="h6-tool" aria-pressed={props.fullscreen} onClick={props.onFullscreen}>
        {props.fullscreen ? "Exit full screen" : "Full screen"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse lists

function Browse({ tab, setTab, model, select }: { tab: Tab; setTab: (t: Tab) => void; model: ModelIndex | null; select: (s: Selection) => void }) {
  const tabs: [Tab, string, number][] = [
    ["problems", "Problems", sortedErrors.length],
    ["components", "Components", components.length],
    ["parts", "CAD parts", model?.assemblies.reduce((n, a) => n + a.parts.length, 0) ?? 0],
  ];
  return (
    <>
      <div className="h6-tabs" role="tablist">
        {tabs.map(([id, label, count]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label} <span className="h6-count">{count}</span>
          </button>
        ))}
      </div>
      {tab === "problems" && <ErrorList errors={sortedErrors} select={select} />}
      {tab === "components" && <ComponentList select={select} />}
      {tab === "parts" && model && <PartTree model={model} select={select} />}
    </>
  );
}

function Urgency({ e }: { e: CatalogueError }) {
  return (
    <span className="h6-urgency" data-urgency={e.urgency}>
      {e.urgency}
    </span>
  );
}

function ErrorList({ errors, select }: { errors: CatalogueError[]; select: (s: Selection) => void }) {
  return (
    <ul className="h6-list">
      {errors.map((e) => (
        <li key={e.code}>
          <button type="button" className="h6-row" onClick={() => select({ kind: "error", code: e.code })}>
            <span className="h6-code vbg-mono">{e.code === "QUALITY" ? "—" : e.code}</span>
            <span className="h6-row-main">
              <span className="h6-row-title">{e.title}</span>
              <span className="h6-row-sub">{e.subsystem}</span>
            </span>
            <Urgency e={e} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function FidelityTag({ f }: { f: Fidelity }) {
  return (
    <span className="h6-fidelity" data-fidelity={f}>
      {FIDELITY_LABEL[f]}
    </span>
  );
}

function ComponentList({ select }: { select: (s: Selection) => void }) {
  const bySystem = new Map<string, Component[]>();
  for (const c of components) bySystem.set(c.system, [...(bySystem.get(c.system) ?? []), c]);
  return (
    <div className="h6-groups">
      <p className="vbg-caption h6-intro">Functional components named in the troubleshooting catalogue. Many are not separate bodies in the CAD export; each row says how it is shown.</p>
      {[...bySystem.entries()].map(([system, list]) => (
        <section key={system}>
          <h2 className="h6-group-title vbg-label">{system}</h2>
          <ul className="h6-list">
            {list.map((c) => (
              <li key={c.part_id}>
                <button type="button" className="h6-row" onClick={() => select({ kind: "component", id: c.part_id })}>
                  <span className="h6-row-main">
                    <span className="h6-row-title">{c.name}</span>
                    <FidelityTag f={mappingFor(c.part_id).fidelity} />
                  </span>
                  <span className="h6-row-count" title="Linked problems">
                    {c.linked_error_count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PartTree({ model, select }: { model: ModelIndex; select: (s: Selection) => void }) {
  const sorted = [...model.assemblies].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="h6-groups">
      <p className="vbg-caption h6-intro">Bodies from the H600 V2.1 STEP assembly (HYD0950), grouped by top-level assembly.</p>
      <ul className="h6-tree">
        {sorted.map((a) => (
          <AssemblyRow key={a.pn} a={a} select={select} />
        ))}
      </ul>
    </div>
  );
}

function AssemblyRow({ a, select }: { a: ModelAssembly; select: (s: Selection) => void }) {
  const single = a.parts.length === 1;
  return (
    <li>
      <details>
        <summary>
          <span className="h6-row-main">
            <span className="h6-row-title">
              {displayName(a.name)}
              {a.instanceIds.length > 1 && <span className="h6-mult"> ×{a.instanceIds.length}</span>}
            </span>
            <span className="vbg-mono h6-pn">{a.pn}</span>
          </span>
          <button type="button" className="h6-link" onClick={(e) => (e.preventDefault(), select({ kind: "part", key: `asm:${a.pn}` }))}>
            Show
          </button>
        </summary>
        {!single && (
          <ul className="h6-list h6-sublist">
            {uniqueParts(a.parts).map((p) => (
              <li key={p.key}>
                <button type="button" className="h6-row" onClick={() => select({ kind: "part", key: p.key })}>
                  <span className="h6-row-main">
                    <span className="h6-row-title">
                      {displayName(p.name)}
                      {p.solidIds.length > 1 && <span className="h6-mult"> ×{p.solidIds.length}</span>}
                    </span>
                    {p.pn && <span className="vbg-mono h6-pn">{p.pn}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

const uniqueParts = (parts: ModelPart[]) => [...parts].sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)));

// ---------------------------------------------------------------------------
// Search results

function SearchResults({ hits, query, onPick }: { hits: SearchHit[]; query: string; onPick: (h: SearchHit) => void }) {
  if (!hits.length) return <p className="h6-empty">No problems or parts match “{query.trim()}”.</p>;
  const groups: [string, SearchHit[]][] = [
    ["Problems", hits.filter((h) => h.type === "error")],
    ["Components", hits.filter((h) => h.type === "component")],
    ["CAD parts", hits.filter((h) => h.type === "part")],
  ];
  return (
    <div className="h6-groups" aria-live="polite">
      {groups
        .filter(([, list]) => list.length)
        .map(([title, list]) => (
          <section key={title}>
            <h2 className="h6-group-title vbg-label">
              {title} <span className="h6-count">{list.length}</span>
            </h2>
            <ul className="h6-list">
              {list.slice(0, 12).map((h) => (
                <li key={h.type + (h.type === "error" ? h.error.code : h.type === "component" ? h.component.part_id : h.part.key)}>
                  <button type="button" className="h6-row" onClick={() => onPick(h)}>
                    {h.type === "error" && (
                      <>
                        <span className="h6-code vbg-mono">{h.error.code === "QUALITY" ? "—" : h.error.code}</span>
                        <span className="h6-row-main">
                          <span className="h6-row-title">{h.error.title}</span>
                          <span className="h6-row-sub">{h.error.subsystem}</span>
                        </span>
                        <Urgency e={h.error} />
                      </>
                    )}
                    {h.type === "component" && (
                      <span className="h6-row-main">
                        <span className="h6-row-title">{h.component.name}</span>
                        <FidelityTag f={mappingFor(h.component.part_id).fidelity} />
                      </span>
                    )}
                    {h.type === "part" && (
                      <span className="h6-row-main">
                        <span className="h6-row-title">{displayName(h.part.name)}</span>
                        <span className="h6-row-sub">
                          {h.part.pn && <span className="vbg-mono">{h.part.pn}</span>}
                          {h.part.pn && " in "}
                          {h.part.assemblyPn !== h.part.pn && h.part.assemblyPn}
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details

function Back({ select }: { select: (s: Selection | null) => void }) {
  return (
    <button type="button" className="h6-back" onClick={() => (history.length > 1 && location.hash.length > 2 ? history.back() : select(null))}>
      ← Back
    </button>
  );
}

function Detail(props: {
  selection: Selection;
  model: ModelIndex | null;
  solids: Solid[];
  solidById: Map<string, Solid>;
  select: (s: Selection | null) => void;
}) {
  const { selection, select } = props;
  let body: ReactNode = null;
  if (selection.kind === "error") body = <ErrorDetail code={selection.code} solids={props.solids} select={select} />;
  else if (selection.kind === "component") body = <ComponentDetail id={selection.id} solids={props.solids} model={props.model} select={select} />;
  else body = <PartDetail k={selection.key} model={props.model} solidById={props.solidById} select={select} />;
  return (
    <article className="h6-detail">
      <div className="h6-detail-nav">
        <Back select={select} />
        <button type="button" className="h6-link" onClick={() => select(null)}>
          Clear
        </button>
      </div>
      {body}
    </article>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function ErrorDetail({ code, solids, select }: { code: string; solids: Solid[]; select: (s: Selection) => void }) {
  const e = errorByCode.get(code)!;
  const links = linksByError.get(code) ?? [];
  const causes = causesByError.get(code) ?? [];
  const order: Fidelity[] = ["modeled", "housing", "approximate", "external", "none"];
  const rows = [...links].sort((a, b) => order.indexOf(mappingFor(a.part_id).fidelity) - order.indexOf(mappingFor(b.part_id).fidelity));
  const notShown = rows.filter((l) => mappingFor(l.part_id).fidelity === "none" || !resolveTargets(mappingFor(l.part_id).targets, solids).length).length;

  return (
    <>
      <header className="h6-detail-head">
        <p className="h6-detail-kicker">
          <span className="vbg-mono">{e.code === "QUALITY" ? "General topic" : e.code}</span>
          <Urgency e={e} />
        </p>
        <h2 className="vbg-heading-24">{e.title}</h2>
        <p className="h6-summary">{e.summary}</p>
      </header>

      {e.service_note && (
        <p className="h6-callout" data-urgency={e.urgency}>
          {e.service_note}
        </p>
      )}

      <section className="h6-section">
        <h3 className="vbg-heading-16">Where to look</h3>
        <p className="vbg-caption">
          {links.length} components linked in the catalogue. {notShown > 0 && `${notShown} ${notShown === 1 ? "is" : "are"} not in the CAD export and cannot be shown.`} Being linked does not
          mean a part is faulty.
        </p>
        <ul className="h6-list">
          {rows.map((l) => {
            const m = mappingFor(l.part_id);
            const shown = m.fidelity !== "none" && resolveTargets(m.targets, solids).length > 0;
            return (
              <li key={l.part_id}>
                <button type="button" className="h6-row" onClick={() => select({ kind: "component", id: l.part_id })}>
                  <i className="h6-swatch" data-tone={!shown ? "none" : m.fidelity === "modeled" ? "primary" : "secondary"} aria-hidden="true" />
                  <span className="h6-row-main">
                    <span className="h6-row-title">{l.part_name}</span>
                    <span className="h6-row-sub">
                      {l.kind}
                      {l.related_causes && ` · ${l.related_causes}`}
                    </span>
                    <FidelityTag f={shown ? m.fidelity : "none"} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="h6-section">
        <h3 className="vbg-heading-16">Possible causes</h3>
        <ol className="h6-causes">
          {causes.map((c) => (
            <li key={c.cause_id}>
              <p className="h6-cause-title">{c.cause}</p>
              {c.condition !== "As applicable" && <p className="h6-condition">{c.condition}</p>}
              <dl>
                <dt>Check</dt>
                <dd>{c.what_to_check}</dd>
                <dt>Action</dt>
                <dd>{c.suggested_action}</dd>
              </dl>
              {c.related_guide_url && (
                <p className="vbg-caption">
                  <ExternalLink href={c.related_guide_url}>Related service guide</ExternalLink>
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="h6-section h6-facts">
        <h3 className="vbg-heading-16">Applicability and source</h3>
        <dl>
          <dt>Subsystem</dt>
          <dd>{e.subsystem}</dd>
          <dt>H600</dt>
          <dd>{e.h600_applicability}</dd>
          <dt>Revision</dt>
          <dd>{e.revision_caveat}</dd>
          {e.source_updated && (
            <>
              <dt>Article updated</dt>
              <dd>{e.source_updated}</dd>
            </>
          )}
          <dt>Reviewed</dt>
          <dd>{e.reviewed}</dd>
        </dl>
        <p>
          <ExternalLink href={e.source_url}>Official troubleshooting article</ExternalLink>
        </p>
        <p className="vbg-caption">Reference material, not verified repair instructions. Use qualified service personnel for electrical, leak and internal work.</p>
      </section>
    </>
  );
}

function ComponentDetail({ id, solids, model, select }: { id: string; solids: Solid[]; model: ModelIndex | null; select: (s: Selection) => void }) {
  const c = componentById.get(id)!;
  const m = mappingFor(id);
  const ids = m.fidelity === "none" ? [] : resolveTargets(m.targets, solids);
  const parts = model ? [...new Map(ids.map((i) => model.partBySolid.get(i)!).map((p) => [p.key, p])).values()] : [];
  const links = linksByComponent.get(id) ?? [];
  return (
    <>
      <header className="h6-detail-head">
        <p className="h6-detail-kicker">
          <span className="vbg-mono">{c.part_id}</span>
          <span>{c.system}</span>
        </p>
        <h2 className="vbg-heading-24">{c.name}</h2>
        {c.notes && <p className="h6-summary">{c.notes}</p>}
      </header>

      <section className="h6-section">
        <h3 className="vbg-heading-16">In the 3D model</h3>
        <p>
          <FidelityTag f={ids.length ? m.fidelity : "none"} />
        </p>
        {m.note && <p>{m.note}</p>}
        {parts.length > 0 && parts.length <= 40 && (
          <ul className="h6-list">
            {parts.map((p) => (
              <li key={p.key}>
                <button type="button" className="h6-row" onClick={() => select({ kind: "part", key: p.key })}>
                  <span className="h6-row-main">
                    <span className="h6-row-title">
                      {displayName(p.name)}
                      {p.solidIds.length > 1 && <span className="h6-mult"> ×{p.solidIds.length}</span>}
                    </span>
                    {p.pn && <span className="vbg-mono h6-pn">{p.pn}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="h6-section">
        <h3 className="vbg-heading-16">Linked problems</h3>
        {links.length ? (
          <ul className="h6-list">
            {links.map((l) => {
              const e = errorByCode.get(l.error_code)!;
              return (
                <li key={l.error_code}>
                  <button type="button" className="h6-row" onClick={() => select({ kind: "error", code: e.code })}>
                    <span className="h6-code vbg-mono">{e.code === "QUALITY" ? "—" : e.code}</span>
                    <span className="h6-row-main">
                      <span className="h6-row-title">{e.title}</span>
                      <span className="h6-row-sub">{l.kind}</span>
                    </span>
                    <Urgency e={e} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="vbg-caption">No problems linked.</p>
        )}
      </section>

      <section className="h6-section h6-facts">
        <dl>
          <dt>Revision</dt>
          <dd>{c.revision}</dd>
        </dl>
        <p className="vbg-caption">Catalogue IDs are database identifiers, not manufacturer part numbers.</p>
      </section>
    </>
  );
}

function PartDetail({ k, model, solidById, select }: { k: string; model: ModelIndex | null; solidById: Map<string, Solid>; select: (s: Selection) => void }) {
  if (!model) return <p className="h6-empty">Loading model…</p>;
  const asm = k.startsWith("asm:") ? model.assemblies.find((a) => a.pn === k.slice(4)) : null;
  const part = asm ? null : model.partByKey.get(k);
  if (!asm && !part) return <p className="h6-empty">This part is not in the model.</p>;

  const ids = asm ? asm.solidIds : part!.solidIds;
  const first = solidById.get(ids[0])!;
  const name = asm ? asm.name : part!.name;
  const pn = asm ? asm.pn : part!.pn;
  const related = new Map<string, Component>();
  for (const id of ids) for (const c of componentsForSolid(solidById.get(id)!)) related.set(c.part_id, c);
  const parentAsm = model.assemblies.find((a) => a.pn === first.assemblyPn);

  return (
    <>
      <header className="h6-detail-head">
        <p className="h6-detail-kicker">
          {pn && <span className="vbg-mono">{pn}</span>}
          <span>{asm ? "Assembly" : "CAD part"}</span>
        </p>
        <h2 className="vbg-heading-24">{displayName(name)}</h2>
        {displayName(name) !== name && <p className="vbg-caption">CAD name: {name}</p>}
      </header>

      <section className="h6-section h6-facts">
        <dl>
          {!asm && parentAsm && parentAsm.pn !== pn && (
            <>
              <dt>Assembly</dt>
              <dd>
                <button type="button" className="h6-link" onClick={() => select({ kind: "part", key: `asm:${parentAsm.pn}` })}>
                  {displayName(parentAsm.name)}
                </button>{" "}
                <span className="vbg-mono">{parentAsm.pn}</span>
              </dd>
            </>
          )}
          {!asm && part!.sub && (
            <>
              <dt>Sub-assembly</dt>
              <dd>{part!.sub}</dd>
            </>
          )}
          <dt>Instances</dt>
          <dd>{asm ? asm.instanceIds.length : ids.length}</dd>
          {asm && (
            <>
              <dt>Bodies</dt>
              <dd>{ids.length}</dd>
            </>
          )}
        </dl>
      </section>

      {asm && asm.parts.length > 1 && (
        <section className="h6-section">
          <h3 className="vbg-heading-16">Contains</h3>
          <ul className="h6-list">
            {uniqueParts(asm.parts).map((p) => (
              <li key={p.key}>
                <button type="button" className="h6-row" onClick={() => select({ kind: "part", key: p.key })}>
                  <span className="h6-row-main">
                    <span className="h6-row-title">
                      {displayName(p.name)}
                      {p.solidIds.length > 1 && <span className="h6-mult"> ×{p.solidIds.length}</span>}
                    </span>
                    {p.pn && <span className="vbg-mono h6-pn">{p.pn}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="h6-section">
        <h3 className="vbg-heading-16">Catalogue components here</h3>
        {related.size ? (
          <ul className="h6-list">
            {[...related.values()].map((c) => (
              <li key={c.part_id}>
                <button type="button" className="h6-row" onClick={() => select({ kind: "component", id: c.part_id })}>
                  <span className="h6-row-main">
                    <span className="h6-row-title">{c.name}</span>
                    <FidelityTag f={mappingFor(c.part_id).fidelity} />
                  </span>
                  <span className="h6-row-count" title="Linked problems">
                    {c.linked_error_count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vbg-caption">No troubleshooting component is mapped to this part.</p>
        )}
      </section>
    </>
  );
}
