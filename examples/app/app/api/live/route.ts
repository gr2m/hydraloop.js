import { getSession, isUnauthorized, load } from "@/lib/session";

/** The last 3 hours of data (enough for a venting), plus the current valve state */
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });
  const until = Date.now();
  try {
    const dataset = await load(session, {
      from: until - 3 * 3600_000,
      until,
      live: true,
    });
    return Response.json(dataset);
  } catch (error) {
    if (isUnauthorized(error))
      return new Response("Session expired", { status: 401 });
    return new Response(
      error instanceof Error ? error.message : String(error),
      { status: 502 },
    );
  }
}
