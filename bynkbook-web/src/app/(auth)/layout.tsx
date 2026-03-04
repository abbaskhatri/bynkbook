import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  // Auth group shell: neutral slate background only.
  // Individual pages handle centering + skeletons to avoid blank panes.
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}