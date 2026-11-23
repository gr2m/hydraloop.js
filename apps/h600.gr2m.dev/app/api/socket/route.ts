import {
  getSession,
  isSameOrigin,
  isUnauthorized,
  loadSocketConnection,
} from "@/lib/session";

/**
 * The local API URL and a device token, for the browser to open the device
 * socket itself. The device token works as a full HDM user token (see
 * README.md), so it is only given to pages of this app, and the browser keeps
 * it in memory only.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });
  try {
    const connection = await loadSocketConnection(session);
    // Demo mode has no socket, the browser polls simulated data instead
    if (!connection) return new Response(null, { status: 204 });
    return Response.json(connection, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (isUnauthorized(error))
      return new Response("Session expired", { status: 401 });
    return new Response(
      error instanceof Error ? error.message : String(error),
      { status: 502 },
    );
  }
}
