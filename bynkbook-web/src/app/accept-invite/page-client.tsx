"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { acceptInvite } from "@/lib/api/team";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function AcceptInviteClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!token) {
        setMsg("Missing invite token.");
        setLoading(false);
        return;
      }

      try {
        const res = await acceptInvite(token);
        if (res?.status === "already_member") {
          setMsg("You are already a member of this business.");
        } else if (res?.status === "accepted") {
          setMsg("Invite accepted. Redirecting to Settings…");
        } else {
          setMsg("Invite processed.");
        }

        setTimeout(() => {
          router.replace("/settings");
        }, 900);
      } catch (e: any) {
        setMsg(e?.message ?? "Failed to accept invite.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, router]);

  return (
    <div className="max-w-xl mx-auto mt-10">
      <Card>
        <CardHeader>
          <CardTitle>Accept invite</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <Skeleton className="h-10 w-full" /> : null}
          {msg ? <div className="text-sm text-slate-700">{msg}</div> : null}
          <Button variant="outline" onClick={() => router.replace("/settings")}>
            Go to Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
