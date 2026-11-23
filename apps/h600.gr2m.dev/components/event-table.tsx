"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { DeviceEvent } from "@/lib/model";

import { clockFormat, formatTime, Time } from "./time";

export function EventTable({
  events,
  caption,
  limit = 30,
  selected,
  onSelect,
}: {
  events: DeviceEvent[];
  caption: string;
  limit?: number;
  /** The id of the selected event */
  selected?: string;
  onSelect?: (event: DeviceEvent, id: string) => void;
}) {
  const [showAll, setShowAll] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [focusSelected, setFocusSelected] = useState(false);
  const body = useRef<HTMLTableSectionElement>(null);
  const filtered = showAll ? events : events.filter((e) => e.key);
  const selectedIndex = filtered.findIndex((e) => e.id === selected);
  const visible =
    expanded || selectedIndex >= limit ? filtered : filtered.slice(0, limit);

  const select = (index: number) => {
    const event = filtered[index];
    if (!event || !onSelect) return;
    if (index >= limit) setExpanded(true);
    onSelect(event, event.id);
  };

  // Enter and space select the focused event. Then up and left go to the
  // newer event above, down and right to the older one
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      const index = (e.target as HTMLElement).dataset.index;
      if (index === undefined) return;
      e.preventDefault();
      select(Number(index));
      return;
    }
    if (selectedIndex === -1) return;
    const step =
      e.key === "ArrowUp" || e.key === "ArrowLeft"
        ? -1
        : e.key === "ArrowDown" || e.key === "ArrowRight"
          ? 1
          : 0;
    if (!step) return;
    e.preventDefault();
    select(Math.min(filtered.length - 1, Math.max(0, selectedIndex + step)));
    setFocusSelected(true);
  };

  // Move the focus along, which also scrolls the row into view
  useEffect(() => {
    if (!focusSelected) return;
    setFocusSelected(false);
    body.current
      ?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
      ?.focus();
  }, [focusSelected, selectedIndex]);

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
          <tbody ref={body} onKeyDown={onSelect && onKey}>
            {visible.map((e, i) => (
              <Fragment key={e.id}>
                {(i === 0 || day(visible[i - 1].t) !== day(e.t)) && (
                  <tr className="day-row">
                    <th scope="colgroup" colSpan={4}>
                      <Time t={e.t} format="date" />
                    </th>
                  </tr>
                )}
                <tr
                  data-index={i}
                  className={
                    onSelect
                      ? i === selectedIndex
                        ? "is-selectable is-selected"
                        : "is-selectable"
                      : undefined
                  }
                  tabIndex={
                    onSelect
                      ? i === (selectedIndex === -1 ? 0 : selectedIndex)
                        ? 0
                        : -1
                      : undefined
                  }
                  aria-current={
                    onSelect && i === selectedIndex ? "true" : undefined
                  }
                  onClick={
                    onSelect &&
                    (() => {
                      select(i);
                      setFocusSelected(true);
                    })
                  }
                >
                  <td className="mono">
                    <Time t={e.t} format={clockFormat(e.t)} />
                  </td>
                  <td>{e.side === "SYSTEM" ? "–" : e.side}</td>
                  <td>{e.label}</td>
                  <td className="mono muted">{e.detail}</td>
                </tr>
              </Fragment>
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

/** The calendar day in the browser's time zone */
function day(t: number) {
  return formatTime(t, "date");
}
