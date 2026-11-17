import { getSession } from "@/lib/session";

/** Pinged by open pages, so that proxy.ts refreshes the token in time */
export async function GET() {
  const session = await getSession();
  return new Response(null, { status: session ? 204 : 401 });
}
