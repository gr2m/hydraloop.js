import type { NextRequest } from "next/server";

import { STATS_RANGE } from "@/lib/stats";
import { getSession, isUnauthorized, loadStats } from "@/lib/session";

/** Statistics of the last 30 days. `zone` is the time zone for daily figures. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });

  const zone = request.nextUrl.searchParams.get("zone") || "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
  } catch {
    return new Response("Invalid zone", { status: 400 });
  }

  try {
    return Response.json(
      await loadStats(session, { range: STATS_RANGE, zone }),
    );
  } catch (error) {
    if (isUnauthorized(error))
      return new Response("Session expired", { status: 401 });
    return new Response(
      error instanceof Error ? error.message : String(error),
      { status: 502 },
    );
  }
}
