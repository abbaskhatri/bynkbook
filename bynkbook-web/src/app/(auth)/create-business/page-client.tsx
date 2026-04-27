"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, CalendarDays, Globe2, Landmark, ShieldCheck } from "lucide-react";

import { createBusiness } from "@/lib/api/businesses";
import { useBusinesses } from "@/lib/queries/useBusinesses";

import BrandLogo from "@/components/app/BrandLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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

  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
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

  const businessesQ = useBusinesses({ enabled: !checkingSession });

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
      <div className="min-h-screen bg-slate-950 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <Card className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <CardContent className="grid gap-6 p-6 lg:grid-cols-[0.95fr_1.05fr] lg:p-8">
              <div className="space-y-4">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-20 w-full rounded-2xl" />
                <Skeleton className="h-20 w-full rounded-2xl" />
              </div>
              <div className="space-y-4">
                <Skeleton className="h-10 w-full rounded-xl" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Skeleton className="h-10 w-full rounded-xl" />
                  <Skeleton className="h-10 w-full rounded-xl" />
                </div>
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_28%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#020617_0%,#0f172a_48%,#0b1120_100%)]" />
      <div className="pointer-events-none absolute -left-20 top-20 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 sm:px-6 lg:px-8">
        <Card className="w-full overflow-hidden rounded-[32px] border border-white/10 bg-white/6 shadow-[0_30px_90px_rgba(2,6,23,0.55)] backdrop-blur-xl">
          <CardContent className="grid gap-0 p-0 lg:grid-cols-[0.96fr_1.04fr]">
            <div className="relative overflow-hidden border-b border-white/10 p-6 lg:border-b-0 lg:border-r lg:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.12),transparent_24%)]" />
              <div className="relative z-10">
                <BrandLogo size="lg" tone="light" priority />
                <div className="mt-8 max-w-md">
                  <div className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-200">
                    Business setup
                  </div>
                  <h1 className="mt-4 text-3xl font-semibold leading-tight text-white">
                    Create your first BynkBook workspace.
                  </h1>
                  <p className="mt-3 text-sm leading-7 text-slate-300">
                    Set up the business profile once, then move directly into ledger, reconciliation, vendors, and reporting.
                  </p>
                </div>

                <div className="mt-8 grid gap-3">
                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-emerald-400/12 p-2 text-emerald-200">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Business-scoped bookkeeping</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Users, entries, settings, and workflows stay cleanly isolated per business.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-sky-400/12 p-2 text-sky-200">
                      <Globe2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Region-aware defaults</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Configure timezone, currency, and fiscal year start to match the business from day one.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-violet-400/12 p-2 text-violet-200">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Professional foundation</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Start with structured business metadata so reports, permissions, and exports stay consistent.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Timezone</div>
                    <div className="mt-2 text-lg font-semibold text-white">Ready</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Currency</div>
                    <div className="mt-2 text-lg font-semibold text-white">Scoped</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Control</div>
                    <div className="mt-2 text-lg font-semibold text-white">Clean</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/96 p-6 text-slate-900 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-700">
                    Create business
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                    Set up your business profile
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    You need one business workspace before you can continue into the app.
                  </p>
                </div>

                <Button variant="outline" className="h-10 rounded-xl border-slate-200 px-4" onClick={onSignOut}>
                  Sign out
                </Button>
              </div>

              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Business name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Abbas Consulting LLC"
                    autoComplete="organization"
                    className="h-11 rounded-xl"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(469) 000-0000"
                      className="h-11 rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="industry">Industry</Label>
                    <Input
                      id="industry"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      placeholder="e.g. Retail"
                      className="h-11 rounded-xl"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Street, City, State, ZIP"
                    className="h-11 rounded-xl"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="logoUrl">Logo</Label>
                    <label
                      htmlFor="logoFile"
                      className="inline-flex h-9 cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      Upload logo
                    </label>
                  </div>

                  <Input
                    id="logoUrl"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="Paste logo URL or use Upload logo"
                    className="h-11 rounded-xl"
                  />

                  <input
                    id="logoFile"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      const reader = new FileReader();
                      reader.onload = () => {
                        const result = String(reader.result ?? "");
                        if (result) setLogoUrl(result);
                      };
                      reader.readAsDataURL(file);
                    }}
                  />

                  <div className="text-xs text-slate-500">
                    Upload a logo image or paste a public logo URL.
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="currency">Currency</Label>
                    <div className="relative">
                      <Landmark className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="currency"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        placeholder="USD"
                        className="h-11 rounded-xl pl-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fiscalStartMonth">Fiscal year start month</Label>
                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <select
                        id="fiscalStartMonth"
                        value={fiscalStartMonth}
                        onChange={(e) => setFiscalStartMonth(e.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none ring-0 focus:border-emerald-500"
                      >
                        <option value="1">January</option>
                        <option value="2">February</option>
                        <option value="3">March</option>
                        <option value="4">April</option>
                        <option value="5">May</option>
                        <option value="6">June</option>
                        <option value="7">July</option>
                        <option value="8">August</option>
                        <option value="9">September</option>
                        <option value="10">October</option>
                        <option value="11">November</option>
                        <option value="12">December</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input
                    id="timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="America/Chicago"
                    className="h-11 rounded-xl"
                  />
                </div>

                {error ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  These settings help BynkBook initialize the business with the right financial context.
                </div>

                <Button type="submit" className="h-11 w-full rounded-xl" disabled={submitting || !name.trim()}>
                  <span>{submitting ? "Creating…" : "Create business"}</span>
                  {!submitting ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-between text-xs text-slate-500">
                <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/login")}>
                  Back to sign in
                </button>

                <div className="flex items-center gap-3">
                  <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/privacy")}>
                    Privacy
                  </button>
                  <span className="text-slate-300">•</span>
                  <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/terms")}>
                    Terms
                  </button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
