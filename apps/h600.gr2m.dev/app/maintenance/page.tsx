import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { MaintenanceView } from "@/components/maintenance-view";
import { getSession, isUnauthorized, loadMaintenance } from "@/lib/session";

export const metadata: Metadata = { title: "Maintenance · H600" };

export default function MaintenancePage() {
  return (
    <Suspense fallback={<p className="page empty">Loading maintenance…</p>}>
      <Maintenance />
    </Suspense>
  );
}

async function Maintenance() {
  const session = await getSession();
  if (!session) redirect("/login");

  await connection();
  let maintenance;
  try {
    maintenance = await loadMaintenance(session);
  } catch (error) {
    if (isUnauthorized(error)) redirect("/login?expired=1");
    throw error;
  }
  return <MaintenanceView data={maintenance} />;
}
