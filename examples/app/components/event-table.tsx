"use client";

import { useState } from "react";

import type { DeviceEvent } from "@/lib/model";

import { Time, type TimeFormat } from "./time";

export function EventTable({
  events,
  caption,
  timeFormat = "seconds",
  limit = 30,
  onSelect,
}: {
  events: DeviceEvent[];
  caption: string;
  timeFormat?: TimeFormat;
  limit?: number;
  onSelect?: (t: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const filtered = showAll ? events : events.filter((e) => e.key);
  const visible = expanded ? filtered : filtered.slice(0, limit);

  return (
    <div className="event-table">
      <div className="table-toolbar">
        <p className="muted">
          {showAll
            ? `All ${events.length} events`
            : `${filtered.length} of ${events.length} events: routine changes, inlet, transfer, cleaning and backup`}
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Include air pumps and other actuators
        </label>
      </div>
      {visible.length === 0 ? (
        <p className="empty">No events in this period.</p>
      ) : (
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Train</th>
              <th scope="col">Event</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e, i) => (
              <tr
                key={`${e.t}-${e.detail}-${i}`}
                className={onSelect ? "is-selectable" : undefined}
                onClick={onSelect && (() => onSelect(e.t))}
              >
                <td className="mono">
                  <Time t={e.t} format={timeFormat} />
                </td>
                <td>{e.side === "SYSTEM" ? "–" : e.side}</td>
                <td>{e.label}</td>
                <td className="mono muted">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {filtered.length > limit && (
        <button
          type="button"
          className="button is-quiet"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show fewer" : `Show all ${filtered.length}`}
        </button>
      )}
    </div>
  );
}
