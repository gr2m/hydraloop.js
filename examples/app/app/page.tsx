import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LiveDashboard } from "@/components/live-dashboard";
import { LIVE_RANGE } from "@/lib/model";
import { getSession, isUnauthorized, load } from "@/lib/session";

export default function LivePage() {
  return (
    <Suspense fallback={<p className="page empty">Loading the H600…</p>}>
      <Live />
    </Suspense>
  );
}

async function Live() {
  const session = await getSession();
  if (!session) redirect("/login");

  await connection();
  const until = Date.now();
  let dataset;
  try {
    dataset = await load(session, {
      from: until - LIVE_RANGE,
      until,
      live: true,
    });
  } catch (error) {
    if (isUnauthorized(error)) redirect("/login?expired=1");
    throw error;
  }
  return <LiveDashboard initial={dataset} />;
}
