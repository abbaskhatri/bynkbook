import { Suspense } from "react";
import SettingsPageClient from "./page-client";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageClient />
    </Suspense>
  );
}
