"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        router.replace("/dashboard");
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  return null;
}
