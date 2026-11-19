"use client";

// Times are rendered in the browser's time zone. The server may be in a
// different one, so the first render can differ from the hydrated one.

const formats = {
  time: { hour: "2-digit", minute: "2-digit" },
  seconds: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  datetime: {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  },
  date: { weekday: "short", day: "numeric", month: "short" },
  // 24 hour clock times, down to the precision of a timestamp
  clockMinutes: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  clockSeconds: {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  },
  clockMillis: {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type TimeFormat = keyof typeof formats;

export function formatTime(t: number, format: TimeFormat = "time") {
  return new Date(t).toLocaleString([], formats[format]);
}

/** The 24 hour clock format that shows all of a timestamp's precision */
export function clockFormat(t: number): TimeFormat {
  return t % 1000
    ? "clockMillis"
    : t % 60_000
      ? "clockSeconds"
      : "clockMinutes";
}

export function Time({
  t,
  format = "time",
}: {
  t: number;
  format?: TimeFormat;
}) {
  return (
    <time dateTime={new Date(t).toISOString()} suppressHydrationWarning>
      {formatTime(t, format)}
    </time>
  );
}
