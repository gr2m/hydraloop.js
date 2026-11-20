"use client";

import { Fragment, useState, type ReactNode } from "react";

import {
  capacityNote,
  formatDuration,
  TRAIN_FULL_LITERS,
  TRAIN_FULL_SPREAD,
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

/** A box of the panel. Its description is hidden until "?" is pressed */
function StatusBlock({
  id,
  title,
  confidence,
  className,
  description,
  children,
}: {
  id: string;
  title: string;
  confidence: Confidence;
  className?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      className={className ? `status-block ${className}` : "status-block"}
      aria-labelledby={id}
    >
      <div className="status-head">
        <h3 id={id}>{title}</h3>
        <ConfidenceTag confidence={confidence} />
        {description && (
          <button
            type="button"
            className="help-toggle"
            aria-expanded={open}
            aria-controls={`${id}-description`}
            aria-label={`${open ? "Hide" : "Show"} description of ${title}`}
            onClick={() => setOpen(!open)}
          >
            ?
          </button>
        )}
      </div>
      {description && open && (
        <p id={`${id}-description`} className="status-evidence">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

function LevelRow({
  label,
  level,
  percent,
}: {
  label: string;
  level: TankLevel;
  /** Show the level in percent, for T1, whose liters are a rough estimate */
  percent?: boolean;
}) {
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
      <span className="level-value" title={capacityNote(level) || undefined}>
        {percent ? (
          pct === undefined ? (
            "–"
          ) : (
            `${Math.round(pct * 100)}%`
          )
        ) : (
          <>
            {formatLiters(level.liters)}
            <span className="muted"> / {Math.round(level.max)} L</span>
          </>
        )}
      </span>
      <span className="level-trend">
        {percent || trend === undefined || Math.abs(trend) < 0.3
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
    <StatusBlock
      id={`train-${side}`}
      title={`Train ${side}`}
      confidence={train.confidence}
      description={[train.detail, ...train.evidence].filter(Boolean).join(", ")}
    >
      <p className={`status-phase phase-${train.phase}`}>
        {train.label}
        {train.since !== undefined && (
          <span className="muted">
            {" "}
            for {formatDuration(state.t - train.since)}
          </span>
        )}
      </p>
      <LevelRow label="T1" level={state.tanks[a ? "t1a" : "t1b"]} percent />
      <LevelRow label="T2" level={state.tanks[a ? "t2a" : "t2b"]} />
      <dl className="status-facts">
        {train.behaviors.length > 0 && (
          <>
            <dt>HDM behavior</dt>
            <dd>
              {train.behaviors.map((b) => (
                <span key={b.name} className="behavior" title={b.name}>
                  {b.label}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt>Incoming water</dt>
        <dd>{ago(state.t, train.lastIncoming)}</dd>
        <dt>Transfer</dt>
        <dd>{ago(state.t, train.lastTransfer)}</dd>
      </dl>
    </StatusBlock>
  );
}

function NextFilthRemoval({ state }: { state: DeviceState }) {
  const { filling, bypass } = state.room;
  const train = filling && state.room.trains[filling];
  const liters = train?.accepting ? train.liters : undefined;
  return (
    <StatusBlock
      id="next-heading"
      title="Greywater until filth removal"
      confidence="inferred"
      className="room"
      description={
        <>
          After greywater stops, the train starts filth removal within about 10
          minutes once T2 holds about {TRAIN_FULL_LITERS} L, measured while
          vented. About 6 hours later it has transferred about 100 L to T3.
        </>
      }
    >
      <p className="room-value">
        {!train
          ? "Unknown"
          : bypass || !train.accepting
            ? "Not accepting water"
            : liters === undefined
              ? "Unknown"
              : `≈ ${Math.round(liters)} L`}
      </p>
      <dl className="status-facts">
        <dt>Receiving</dt>
        <dd>{filling ? `Train ${filling} (A/B valve)` : "No data"}</dd>
        {liters !== undefined && (
          <>
            <dt>Range</dt>
            <dd>
              {Math.max(0, Math.round(liters - TRAIN_FULL_SPREAD))}–
              {Math.round(liters + TRAIN_FULL_SPREAD)} L
            </dd>
          </>
        )}
      </dl>
    </StatusBlock>
  );
}

function RoomSummary({ state }: { state: DeviceState }) {
  const { room } = state;
  return (
    <StatusBlock
      id="room-heading"
      title="Room for greywater"
      confidence="inferred"
      className="room"
      description={
        <>
          A train counts as full at about {TRAIN_FULL_LITERS} L in T2, measured
          while vented. It then starts filth removal and takes no water until it
          is done.
        </>
      }
    >
      <p className="room-value">
        {room.liters === undefined
          ? "Unknown"
          : room.bypass
            ? "0 L, bypass open"
            : room.partial
              ? `≥ ${Math.round(room.liters)} L`
              : `≈ ${Math.round(room.liters)} L`}
        {room.bypassTest && (
          <span className="muted"> · bypass open for its 12-hour test</span>
        )}
      </p>
      <dl className="status-facts">
        {(["A", "B"] as Side[]).map((side) => {
          const train = room.trains[side];
          return (
            <Fragment key={side}>
              <dt>Train {side}</dt>
              <dd>
                {train.liters === undefined
                  ? train.reason
                  : train.accepting
                    ? `≈ ${Math.round(train.liters)} L`
                    : `0 L, ${train.reason.charAt(0).toLowerCase()}${train.reason.slice(1)}`}
                {train.t2 !== undefined && train.measuredAt !== undefined && (
                  <span className="muted">
                    {" "}
                    · {Math.round(train.t2)} L in T2{" "}
                    {formatDuration(state.t - train.measuredAt)} ago
                  </span>
                )}
              </dd>
            </Fragment>
          );
        })}
      </dl>
    </StatusBlock>
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
      <NextFilthRemoval state={state} />
      <RoomSummary state={state} />
      <TrainStatus side="A" state={state} />
      <TrainStatus side="B" state={state} />

      <StatusBlock
        id="t3-status"
        title="Storage and outlets"
        confidence={t3.confidence}
        description={t3.evidence.join(", ")}
      >
        <p className="status-phase">{t3.label}</p>
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
          {state.systemBehaviors.length > 0 && (
            <>
              <dt>HDM behavior</dt>
              <dd>
                {state.systemBehaviors.map((b) => (
                  <span key={b.name} className="behavior" title={b.name}>
                    {b.label}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      </StatusBlock>
    </div>
  );
}
