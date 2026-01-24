"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { acceptInvite } from "@/lib/api/team";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function AcceptInviteClient() {
  const router = useRouter();
  const sp = useSearchParams();

  // Invite token from query
  const token = sp.get("token") ?? "";

  // Preserve deep-link back to this exact invite
  const nextUrl = useMemo(() => {
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    return `/accept-invite${qs}`;
  }, [token]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) {
        setMsg("Missing invite token.");
        setLoading(false);
        return;
      }

      // Backend accept endpoint is JWT-protected
      try {
        await getCurrentUser();
      } catch {
        setNeedsAuth(true);
        setMsg("Sign in to accept this invite.");
        setLoading(false);
        return;
      }

      try {
        const res = await acceptInvite(token);

        if (res?.status === "already_member") {
          setMsg("You are already a member of this business. Redirecting…");
        } else if (res?.status === "accepted") {
          setMsg("Invite accepted. Redirecting…");
        } else {
          setMsg("Invite processed. Redirecting…");
        }

        setTimeout(() => {
          const biz = res?.businessId;
          if (biz) {
            router.replace(`/dashboard?businessId=${encodeURIComponent(biz)}`);
            return;
          }
          router.replace("/dashboard");
        }, 700);
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

          {needsAuth ? (
            <div className="flex items-center gap-2">
              <Button
                className="h-8 px-3 text-xs"
                onClick={() => router.replace(`/login?next=${encodeURIComponent(nextUrl)}`)}
              >
                Sign in
              </Button>

              <Button
                className="h-8 px-3 text-xs"
                variant="outline"
                onClick={() => router.replace(`/signup?next=${encodeURIComponent(nextUrl)}`)}
              >
                Create account
              </Button>
            </div>
          ) : (
            <Button
              className="h-8 px-3 text-xs"
              variant="outline"
              onClick={() => router.replace("/dashboard")}
            >
              Continue
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
