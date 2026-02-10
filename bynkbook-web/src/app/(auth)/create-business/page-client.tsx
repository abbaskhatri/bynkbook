"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { useQueryClient } from "@tanstack/react-query";

import { createBusiness } from "@/lib/api/businesses";
import { useBusinesses } from "@/lib/queries/useBusinesses";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function CreateBusinessClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();

  async function onSignOut() {
    try {
      await signOut();
    } finally {
      qc.clear();
      router.replace("/login");
    }
  }

  const nextUrl = useMemo(() => sp.get("next") ?? "/dashboard", [sp]);

  const businessesQ = useBusinesses();

  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");

  // Optional business profile fields
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
    } catch {
      return "America/Chicago";
    }
  });
  const [fiscalStartMonth, setFiscalStartMonth] = useState("1");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
      } catch {
        router.replace(
          `/login?next=${encodeURIComponent(`/create-business?next=${encodeURIComponent(nextUrl)}`)}`
        );
        return;
      } finally {
        setCheckingSession(false);
      }
    })();
  }, [router, nextUrl]);

  useEffect(() => {
    if (checkingSession) return;
    if (businessesQ.isLoading) return;

    const list = businessesQ.data ?? [];
    if (list.length > 0) {
      router.replace(nextUrl);
    }
  }, [checkingSession, businessesQ.isLoading, businessesQ.data, router, nextUrl]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const biz = await createBusiness({
        name: name.trim(),
        address: address.trim() || null,
        phone: phone.trim() || null,
        logo_url: logoUrl.trim() || null,
        industry: industry.trim() || null,
        currency: (currency || "USD").toUpperCase(),
        timezone: timezone.trim() || "America/Chicago",
        fiscal_year_start_month: Number(fiscalStartMonth || "1"),
      });
      if (!biz?.id) {
        setError("Business creation failed. Please try again.");
        return;
      }

      qc.setQueryData(["businesses"], (prev: any) => {
        const arr = Array.isArray(prev) ? prev : [];
        if (arr.some((b: any) => b?.id === biz.id)) return arr;
        return [biz, ...arr];
      });
      qc.invalidateQueries({ queryKey: ["businesses"] });

      const hasQuery = nextUrl.includes("?");
      const sep = hasQuery ? "&" : "?";
      const url = nextUrl.includes("businessId=")
        ? nextUrl
        : `${nextUrl}${sep}businessId=${encodeURIComponent(biz.id)}`;

      router.replace(url);
    } catch (err: any) {
      setError(err?.message ?? "Business creation failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-0 pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Create your business</CardTitle>
            <Button variant="outline" className="h-8 px-3 text-xs" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Business name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Abbas Consulting LLC"
                autoComplete="organization"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Phone (optional)</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(469) 000-0000" />
              </div>

              <div className="space-y-2">
                <Label>Industry (optional)</Label>
                <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Retail" />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Address (optional)</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City, State, ZIP" />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Logo URL (optional)</Label>
                <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
              </div>

              <div className="space-y-2">
                <Label>Fiscal year start month</Label>
                <Input value={fiscalStartMonth} onChange={(e) => setFiscalStartMonth(e.target.value)} placeholder="1" />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Timezone</Label>
                <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Chicago" />
              </div>
            </div>

            {error ? <div className="text-sm text-red-600">{error}</div> : null}

            <Button type="submit" className="w-full" disabled={submitting || !name.trim()}>
              {submitting ? "Creating…" : "Create business"}
            </Button>

            <div className="text-xs text-slate-500">You need a business to continue into the app.</div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
