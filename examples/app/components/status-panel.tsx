import {
  formatDuration,
  formatLiters,
  type Confidence,
  type DeviceState,
  type Side,
  type TankLevel,
} from "@/lib/model";

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  reported: "HDM routine",
  valve: "Valve signal",
  inferred: "Inferred",
  unknown: "No data",
};

const CONFIDENCE_HELP: Record<Confidence, string> = {
  reported: "The routine HDM reports for this side",
  valve: "Reported directly by an HDM valve or pump signal",
  inferred: "Derived from pumps, not reported by HDM",
  unknown: "The signals needed for this are missing",
};

export function ConfidenceTag({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`tag is-${confidence}`}
      title={CONFIDENCE_HELP[confidence]}
    >
      {CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

function LevelRow({ label, level }: { label: string; level: TankLevel }) {
  const pct = level.pct;
  const trend = level.trend;
  return (
    <div className="level-row">
      <span className="level-label">{label}</span>
      <span className="level-track" aria-hidden>
        {pct !== undefined && (
          <span className="level-fill" style={{ width: `${pct * 100}%` }} />
        )}
      </span>
      <span className="level-value">
        {formatLiters(level.liters)}
        <span className="muted"> / {Math.round(level.max)} L</span>
      </span>
      <span className="level-trend">
        {trend === undefined || Math.abs(trend) < 0.3
          ? ""
          : `${trend > 0 ? "+" : "−"}${Math.abs(trend).toFixed(1)} L/min`}
      </span>
    </div>
  );
}

function ago(now: number, t: number | undefined) {
  return t === undefined
    ? "Not in the last 24 hours"
    : `${formatDuration(now - t)} ago`;
}

function TrainStatus({ side, state }: { side: Side; state: DeviceState }) {
  const train = state.trains[side];
  const a = side === "A";
  return (
    <section className="status-block" aria-labelledby={`train-${side}`}>
      <div className="status-head">
        <h3 id={`train-${side}`}>Train {side}</h3>
        <ConfidenceTag confidence={train.confidence} />
      </div>
      <p className={`status-phase phase-${train.phase}`}>
        {train.label}
        {train.since !== undefined && (
          <span className="muted">
            {" "}
            for {formatDuration(state.t - train.since)}
          </span>
        )}
      </p>
      <p className="status-evidence">
        {[train.detail, ...train.evidence].filter(Boolean).join(", ")}
      </p>
      <LevelRow label="T1" level={state.tanks[a ? "t1a" : "t1b"]} />
      <LevelRow label="T2" level={state.tanks[a ? "t2a" : "t2b"]} />
      <dl className="status-facts">
        <dt>Incoming water</dt>
        <dd>{ago(state.t, train.lastIncoming)}</dd>
        <dt>Transfer</dt>
        <dd>{ago(state.t, train.lastTransfer)}</dd>
      </dl>
    </section>
  );
}

export function StatusPanel({ state }: { state: DeviceState }) {
  const { t3, t4, supply, inlet } = state;
  const demand = [
    supply.toilet && "toilet",
    supply.wash && "washer",
    supply.auxiliary && "auxiliary",
  ].filter(Boolean);
  return (
    <div className="status-panel">
      <TrainStatus side="A" state={state} />
      <TrainStatus side="B" state={state} />

      <section className="status-block" aria-labelledby="t3-status">
        <div className="status-head">
          <h3 id="t3-status">Storage and outlets</h3>
          <ConfidenceTag confidence={t3.confidence} />
        </div>
        <p className="status-phase">{t3.label}</p>
        <p className="status-evidence">{t3.evidence.join(", ")}</p>
        <LevelRow label="T3" level={state.tanks.t3} />
        <dl className="status-facts">
          <dt>Supply</dt>
          <dd>
            {supply.source === "unknown"
              ? "No data"
              : supply.source === "backup"
                ? "Backup water from T4"
                : "Recycled water from T3"}
          </dd>
          <dt>Outlets</dt>
          <dd>
            {supply.toOutlets === undefined
              ? "No data"
              : demand.length
                ? `Supplying ${demand.join(", ")}`
                : supply.toOutlets
                  ? "Distribution pump running"
                  : "No demand"}
          </dd>
          <dt>T4</dt>
          <dd>{t4.label}</dd>
          <dt>UV-C</dt>
          <dd>{t3.uv === undefined ? "No data" : t3.uv ? "On" : "Off"}</dd>
          <dt>Bypass</dt>
          <dd>
            {inlet.bypass === undefined
              ? "No data"
              : inlet.bypass
                ? "Open, greywater goes to the sewer"
                : "Closed"}
          </dd>
        </dl>
      </section>
    </div>
  );
}
