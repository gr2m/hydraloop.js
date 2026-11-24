import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import "hydraloop-diagram-react/styles.css";
import "./styles.css";

import {
  DiagramLegend,
  FlowDiagram,
  FlowSummary,
} from "hydraloop-diagram-react";
import {
  caption,
  stateAt,
  TANK_IDS,
  type Side,
  type TankId,
} from "hydraloop-diagram-react/model";
import {
  IO_GROUPS,
  PRESETS,
  ROUTINES,
  SUB_STATES,
  TANK_MAX,
  toDataset,
  type Inputs,
} from "./inputs.js";
import { fromSearch, toSearch } from "./url.js";

const TANK_NAMES: Record<TankId, string> = {
  t1a: "T1 A",
  t2a: "T2 A",
  t1b: "T1 B",
  t2b: "T2 B",
  t3: "T3",
};

type Theme = "system" | "light" | "dark";

/** The inputs from the URL, so they survive reloads and can be shared */
function load(): { inputs: Inputs; preset: string } {
  return (
    fromSearch(location.search) ?? {
      inputs: PRESETS[0].inputs(),
      preset: PRESETS[0].key,
    }
  );
}

function Playground() {
  const [initial] = useState(load);
  const [inputs, setInputs] = useState(initial.inputs);
  const [preset, setPreset] = useState(initial.preset);
  const [theme, setTheme] = useState<Theme>("system");
  const [t] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const search = toSearch(inputs, preset);
    if (search !== location.search) {
      history.replaceState(null, "", `${location.pathname}${search}${location.hash}`);
    }
  }, [inputs, preset]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const dataset = useMemo(() => toDataset(inputs, t), [inputs, t]);
  const state = useMemo(() => stateAt(dataset, t), [dataset, t]);

  /** Changes the inputs, which no longer match a preset */
  const edit = (change: (draft: Inputs) => void) => {
    setInputs((current) => {
      const next = structuredClone(current);
      change(next);
      return next;
    });
    setPreset("");
  };

  return (
    <div className="layout">
      <aside className="controls">
        <header>
          <h1>Diagram playground</h1>
          <p className="meta">hydraloop-diagram-react</p>
          <p className="hint">
            Set the signals, tank levels and routines. <code>stateAt()</code>{" "}
            derives the diagram's state from them.
          </p>
        </header>

        <section>
          <h2>Presets</h2>
          <div className="presets">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={preset === p.key}
                onClick={() => {
                  setInputs(p.inputs());
                  setPreset(p.key);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Routines</h2>
          {(["A", "B"] as Side[]).map((side) => (
            <RoutineControl
              key={side}
              side={side}
              inputs={inputs}
              edit={edit}
            />
          ))}
          <datalist id="sub-states">
            {SUB_STATES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </section>

        <section>
          <h2>Tanks</h2>
          <p className="hint">Level in liters, and its trend in L/min</p>
          {TANK_IDS.map((id) => (
            <TankControl key={id} id={id} inputs={inputs} edit={edit} />
          ))}
        </section>

        {IO_GROUPS.map((group) => (
          <section key={group.label}>
            <h2>{group.label}</h2>
            {group.hint && <p className="hint">{group.hint}</p>}
            {group.names.map((name) => (
              <IoControl key={name} name={name} inputs={inputs} edit={edit} />
            ))}
            {group.label === "Inlet" && (
              <Check
                label="Bypass switched on in the app"
                checked={inputs.bypassOverride}
                onChange={(v) => edit((d) => void (d.bypassOverride = v))}
              />
            )}
            {(group.label === "Train A" || group.label === "Train B") && (
              <Check
                label="Air added to T2 before"
                checked={
                  inputs.pressurized[group.label.endsWith("A") ? "A" : "B"]
                }
                onChange={(v) =>
                  edit(
                    (d) =>
                      void (d.pressurized[
                        group.label.endsWith("A") ? "A" : "B"
                      ] = v),
                  )
                }
              />
            )}
          </section>
        ))}

        <section>
          <h2>Connected outlets</h2>
          {(
            [
              ["toilet", "Toilets"],
              ["washingMachine", "Washer"],
              ["auxiliary", "Auxiliary"],
            ] as const
          ).map(([key, label]) => (
            <Check
              key={key}
              label={label}
              checked={inputs.outlets[key] !== false}
              onChange={(v) => edit((d) => void (d.outlets[key] = v))}
            />
          ))}
        </section>
      </aside>

      <main className="preview">
        <div className="toolbar">
          <span className="segmented" role="group" aria-label="Theme">
            {(["system", "light", "dark"] as Theme[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </button>
            ))}
          </span>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(
                JSON.stringify(state, null, 2),
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy DeviceState"}
          </button>
        </div>
        <figure>
          <FlowDiagram state={state} device={dataset.device} />
          <figcaption>
            <FlowSummary state={state} />
            <DiagramLegend />
          </figcaption>
        </figure>
        <details>
          <summary>DeviceState</summary>
          <pre>{JSON.stringify(state, null, 2)}</pre>
        </details>
      </main>
    </div>
  );
}

type ControlProps = {
  inputs: Inputs;
  edit: (change: (draft: Inputs) => void) => void;
};

function RoutineControl({ side, inputs, edit }: ControlProps & { side: Side }) {
  const routine = inputs.routines[side];
  return (
    <div className="row routine">
      <span className="name">Train {side}</span>
      <select
        aria-label={`Routine of train ${side}`}
        value={routine?.name ?? ""}
        onChange={(e) =>
          edit((d) => {
            d.routines[side] = e.target.value
              ? { name: e.target.value, state: "ENTRY" }
              : null;
          })
        }
      >
        <option value="">No routine</option>
        {ROUTINES.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <input
        aria-label={`Sub-state of train ${side}`}
        list="sub-states"
        disabled={!routine}
        value={routine?.state ?? ""}
        onChange={(e) =>
          edit((d) => {
            if (d.routines[side]) d.routines[side].state = e.target.value;
          })
        }
      />
    </div>
  );
}

function TankControl({ id, inputs, edit }: ControlProps & { id: TankId }) {
  const { liters, trend } = inputs.tanks[id];
  return (
    <div className="row tank">
      <span className="name">{TANK_NAMES[id]}</span>
      <input
        type="range"
        aria-label={`${TANK_NAMES[id]} liters`}
        min={0}
        max={TANK_MAX[id]}
        disabled={liters === null}
        value={liters ?? 0}
        onChange={(e) =>
          edit((d) => void (d.tanks[id].liters = Number(e.target.value)))
        }
      />
      <span className="value">{liters === null ? "–" : `${liters} L`}</span>
      <input
        type="number"
        aria-label={`${TANK_NAMES[id]} trend in liters per minute`}
        title="Trend in L/min"
        step={0.5}
        disabled={liters === null}
        value={trend}
        onChange={(e) =>
          edit((d) => void (d.tanks[id].trend = Number(e.target.value)))
        }
      />
      <Check
        label="Data"
        checked={liters !== null}
        onChange={(v) =>
          edit(
            (d) =>
              void (d.tanks[id].liters = v
                ? Math.round(TANK_MAX[id] / 2)
                : null),
          )
        }
      />
    </div>
  );
}

function IoControl({ name, inputs, edit }: ControlProps & { name: string }) {
  const value = inputs.io[name];
  const options: [string, number | undefined][] = [
    ["No data", undefined],
    ["Off", 0],
    ["On", 1],
  ];
  return (
    <div className="row">
      <span className="name">
        {caption({}, name)}
        <span className="io-name">{name}</span>
      </span>
      <span className="segmented" role="group" aria-label={caption({}, name)}>
        {options.map(([label, v]) => (
          <button
            key={label}
            type="button"
            aria-pressed={value === v}
            onClick={() =>
              edit((d) => {
                if (v === undefined) delete d.io[name];
                else d.io[name] = v;
              })
            }
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
