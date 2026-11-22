import {
  getSession,
  isSameOrigin,
  isUnauthorized,
  sendHeartbeat,
} from "@/lib/session";

/** Keeps the live graph of the device active while a live page is open */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });
  try {
    await sendHeartbeat(session);
    return new Response(null, { status: 204 });
  } catch (error) {
    // A missing permission must not end the session like other 401s
    if (/Insufficient permissions/.test(String(error)))
      return new Response("Insufficient permissions", { status: 403 });
    if (isUnauthorized(error))
      return new Response("Session expired", { status: 401 });
    return new Response(
      error instanceof Error ? error.message : String(error),
      { status: 502 },
    );
  }
}
