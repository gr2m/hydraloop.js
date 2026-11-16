import type { NextRequest } from "next/server";

import { getSession, isUnauthorized, load } from "@/lib/session";

const MAX_RANGE = 31 * 24 * 3600_000;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });

  const params = request.nextUrl.searchParams;
  const until = Math.min(Number(params.get("until")) || Date.now(), Date.now());
  const from = Number(params.get("from")) || until - 24 * 3600_000;
  if (from >= until || until - from > MAX_RANGE) {
    return new Response("Invalid range", { status: 400 });
  }

  try {
    return Response.json(await load(session, { from, until }));
  } catch (error) {
    if (isUnauthorized(error))
      return new Response("Session expired", { status: 401 });
    return new Response(
      error instanceof Error ? error.message : String(error),
      { status: 502 },
    );
  }
}
