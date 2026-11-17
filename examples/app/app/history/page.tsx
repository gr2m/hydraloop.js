import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { HistoryExplorer } from "@/components/history-explorer";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "History · H600" };

export default function HistoryPage() {
  return (
    <Suspense fallback={<p className="page empty">Loading history…</p>}>
      <History />
    </Suspense>
  );
}

async function History() {
  if (!(await getSession())) redirect("/login");
  return <HistoryExplorer />;
}
