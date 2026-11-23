// Data for the maintenance view: the health HDM reports for the device, the
// device signals the firmware diagnosed, tickets and service log, the
// connectivity of the last 30 days and the device vitals.
//
// Texts such as the titles of device signals and outage causes come from the
// translations of the HDM web app (see `lib/hdm-texts.ts`).

import type { Point } from "./model";

/** How far back the device signals are loaded */
export const SIGNALS_RANGE = 365 * 24 * 3600_000;
/** Range of the connectivity and vitals charts. `getData()` refuses more than 30 days. */
export const CONNECTIVITY_RANGE = 30 * 24 * 3600_000;
/** Reports of the same signal less than this apart are shown as one */
export const SIGNAL_MERGE_GAP = 24 * 3600_000;

export type IssueLevel =
  | "blocking"
  | "major"
  | "minor"
  | "attention"
  | "notice";

export type Issue = { level: IssueLevel; text: string };

/**
 * Reports of a device signal, from the first one until the signal was
 * reported fixed. Many signals are never reported fixed, e.g. a soap bomb.
 */
export type SignalEpisode = {
  key: string;
  /** The train, if the signal is for one */
  side: string | null;
  errorId: number | null;
  title: string;
  description: string | null;
  start: number;
  /** The latest report */
  last: number;
  /** When it was reported fixed */
  end: number | null;
  /** Reports merged into this one (see `SIGNAL_MERGE_GAP`) */
  count: number;
  /** HDM lists it as a current issue of the device */
  active: boolean;
};

export type TicketItem = {
  id: string;
  title: string;
  status: string;
  closed: boolean;
  priority: string | null;
  subject: string | null;
  cause: string | null;
  solution: string | null;
  /** Context the support team added, as plain text */
  note: string | null;
  /** Created by HDM for a device signal, not by a person */
  automatic: boolean;
  created: number;
  closedAt: number | null;
};

export type ServiceItem = {
  id: string;
  t: number;
  type: string;
  person: string | null;
  title: string;
  text: string;
};

export type Professional = {
  role: string;
  organisation: string | null;
  note: string | null;
  since: number | null;
};

export type OutageGroup =
  | "scheduled"
  | "server"
  | "network"
  | "power"
  | "device";

export type OutageItem = {
  start: number;
  end: number;
  cause: string;
  title: string;
  description: string | null;
  group: OutageGroup;
};

export type RestartItem = { t: number; reason: string };

export type VitalSeries = {
  key: string;
  label: string;
  unit: string;
  digits: number;
  points: Point[];
  /** Values below this are highlighted, e.g. the supply voltage when power is lost */
  low?: { below: number; label: string };
  note?: string;
};

export type Maintenance = {
  demo: boolean;
  fetchedAt: number;
  device: {
    name: string;
    serial: string | null;
    type: string | null;
    firmware: string | null;
    firmwareCore: string | null;
    hardware: string | null;
    online: boolean | null;
    lastOnline: number | null;
    timeZone: string | null;
    commissioned: number | null;
    warrantyUntil: number | null;
    maintenanceMonths: number | null;
    lastMaintenance: number | null;
    /** From HDM, or estimated from the last maintenance or commissioning plus the period */
    nextMaintenance: { t: number; estimated: boolean } | null;
  };
  issues: Issue[];
  /** Outputs HDM flags as stuck powered */
  stuck: string[];
  /** Outputs currently switched manually, e.g. by a technician */
  manual: { name: string; label: string; since: number }[];
  signals: SignalEpisode[];
  signalsFrom: number;
  tickets: TicketItem[];
  serviceLog: ServiceItem[];
  professionals: Professional[];
  /** Undefined if it could not be loaded */
  connectivity?: {
    from: number;
    until: number;
    outages: OutageItem[];
    restarts: RestartItem[];
  };
  vitals?: { from: number; until: number; series: VitalSeries[] };
  warnings: string[];
};

/** A raw status log entry, as returned by `getStatusLogData()` */
export type StatusLogInput = {
  t: number;
  errorId: number | null;
  information: string;
  side: string | null;
};

const SIGNAL = /^deviceSignals\.([A-Za-z0-9_]+)\.(description|fixed)$/;

/**
 * Pairs the `deviceSignals.<key>.description` entries of the status log with
 * the `.fixed` entry that follows, per signal and train. Reports less than
 * `SIGNAL_MERGE_GAP` apart are merged. `active` holds the keys of the signals
 * HDM lists as current issues. Active signals first, then newest first.
 */
export function signalEpisodes(
  entries: StatusLogInput[],
  text: (
    key: string,
    side: string | null,
  ) => { title: string; description: string | null },
  active: ReadonlySet<string>,
): SignalEpisode[] {
  const latest = new Map<string, SignalEpisode>();
  const episodes: SignalEpisode[] = [];
  for (const entry of [...entries].sort((a, b) => a.t - b.t)) {
    const match = SIGNAL.exec(entry.information);
    if (!match) continue;
    const [, key, kind] = match;
    const side = entry.side || null;
    const id = `${key} ${side}`;
    const previous = latest.get(id);
    if (kind === "fixed") {
      if (previous && previous.end === null) previous.end = entry.t;
      continue;
    }
    const since = previous && (previous.end ?? previous.last);
    if (previous && since !== undefined && entry.t - since < SIGNAL_MERGE_GAP) {
      previous.last = entry.t;
      previous.end = null;
      previous.count++;
      continue;
    }
    const episode: SignalEpisode = {
      key,
      side,
      errorId: entry.errorId,
      ...text(key, side),
      start: entry.t,
      last: entry.t,
      end: null,
      count: 1,
      active: false,
    };
    latest.set(id, episode);
    episodes.push(episode);
  }
  for (const episode of latest.values()) {
    episode.active = episode.end === null && active.has(episode.key);
  }
  return episodes.sort(
    (a, b) => Number(b.active) - Number(a.active) || b.last - a.last,
  );
}

/** Groups the outage classifications of `getOutageSummaries()` */
export function outageGroup(cause: string): OutageGroup {
  if (cause === "scheduled_restart") return "scheduled";
  if (/^server_|tcp_session_replaced/.test(cause)) return "server";
  if (/power|brownout/.test(cause)) return "power";
  if (/wifi|ethernet|dhcp|dns|tcp|tls|connection/.test(cause)) {
    return "network";
  }
  return "device";
}

export const OUTAGE_GROUPS: Record<OutageGroup, string> = {
  scheduled: "Scheduled restart",
  server: "HDM server",
  network: "Network",
  power: "Power",
  device: "Device",
};

/** Merged time covered by the outages, in milliseconds */
export function outageTime(outages: OutageItem[]) {
  let total = 0;
  let end = -Infinity;
  for (const o of [...outages].sort((a, b) => a.start - b.start)) {
    const start = Math.max(o.start, end);
    if (o.end > start) total += o.end - start;
    end = Math.max(end, o.end);
  }
  return total;
}

export function addMonths(t: number, months: number) {
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

/** Strips the HTML of a ticket field */
export function plainText(html: string | null | undefined) {
  if (!html) return null;
  const text = html
    .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return text || null;
}
