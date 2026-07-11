import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";
import SettingsPageClient from "./page-client";

export default function SettingsPage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading settings" />}>
      <SettingsPageClient />
    </Suspense>
  );
}
