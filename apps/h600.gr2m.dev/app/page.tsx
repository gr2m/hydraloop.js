import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Overview } from "@/components/overview";
import { LIVE_RANGE } from "@/lib/model";
import { getSession, isUnauthorized, load } from "@/lib/session";

export default function OverviewPage() {
  return (
    <Suspense fallback={<p className="page empty">Loading the H600…</p>}>
      <Current />
    </Suspense>
  );
}

async function Current() {
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
  return <Overview initial={dataset} />;
}
