import { notFound } from "next/navigation";
import DevDialogsPage from "./page-client";

export default function DevDialogsRoute() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DevDialogsPage />;
}
