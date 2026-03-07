"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, FileText, ShieldCheck } from "lucide-react";

import BrandLogo from "@/components/app/BrandLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function TermsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <BrandLogo size="md" priority />
          <Button variant="outline" className="rounded-full" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>

        <Card className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_70px_rgba(15,23,42,0.08)]">
          <CardContent className="p-0">
            <div className="border-b border-slate-200 px-6 py-6 sm:px-8">
              <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-700">
                Terms
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
                Terms of Service
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                This page provides the high-level terms framework for using BynkBook. Replace this placeholder with final business-approved legal text before public launch.
              </p>
            </div>

            <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="border-b border-slate-200 bg-slate-50 p-6 lg:border-b-0 lg:border-r sm:p-8">
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-emerald-50 p-2 text-emerald-700">
                      <BadgeCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Use of the service</div>
                      <div className="mt-1 text-sm text-slate-600">
                        BynkBook is intended for legitimate bookkeeping, reconciliation, reporting, and business administration workflows.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-sky-50 p-2 text-sky-700">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Account responsibility</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Users are responsible for account access, credentials, and authorized activity under their use of the product.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-violet-50 p-2 text-violet-700">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Operational use</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Product workflows, exports, and administrative surfaces should be used in accordance with applicable business and accounting requirements.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 sm:p-8">
                <div className="space-y-8 text-sm leading-7 text-slate-700">
                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">1. Acceptance of terms</h2>
                    <p className="mt-2">
                      By using BynkBook, users agree to the operational, account, and platform terms that govern access to the service.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">2. Account and access</h2>
                    <p className="mt-2">
                      Users are responsible for maintaining valid account access and using the application only in authorized business contexts.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">3. Business data and workflows</h2>
                    <p className="mt-2">
                      BynkBook may support ledgers, reconciliation flows, reports, exports, vendors, and other accounting-adjacent workflows. Users remain responsible for how they operate and review their business data.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">4. Product availability and changes</h2>
                    <p className="mt-2">
                      The service may evolve over time, including updates to UI, workflow behavior, and available features. Terms may also be updated as the product matures.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">5. Final legal copy</h2>
                    <p className="mt-2">
                      Replace this placeholder text with final business-approved terms before public launch or production distribution.
                    </p>
                  </section>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}