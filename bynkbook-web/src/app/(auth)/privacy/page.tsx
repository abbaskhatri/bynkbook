"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, LockKeyhole, ShieldCheck, FileText } from "lucide-react";

import BrandLogo from "@/components/app/BrandLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function PrivacyPage() {
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
                Privacy
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
                Privacy Policy
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                This page explains the high-level privacy approach for BynkBook, including account data, business-scoped information, and operational use of the product.
              </p>
            </div>

            <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="border-b border-slate-200 bg-slate-50 p-6 lg:border-b-0 lg:border-r sm:p-8">
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-emerald-50 p-2 text-emerald-700">
                      <LockKeyhole className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Account security</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Authentication, password recovery, and access flows are handled through secure account processes.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-sky-50 p-2 text-sky-700">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Business-scoped data</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Businesses, entries, settings, and operations are intended to stay properly scoped within the app experience.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-violet-50 p-2 text-violet-700">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Operational records</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Activity, exports, and workflow actions may be used to support administration, audit visibility, and product operations.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 sm:p-8">
                <div className="space-y-8 text-sm leading-7 text-slate-700">
                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">1. Information we use</h2>
                    <p className="mt-2">
                      BynkBook may process account information, business profile details, bookkeeping records, workflow actions, and product configuration data in order to provide the application experience.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">2. How information supports the product</h2>
                    <p className="mt-2">
                      Information is used to support sign-in, business creation, ledger workflows, reconciliation, reporting, exports, and administrative surfaces inside the product.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">3. Business-scoped visibility</h2>
                    <p className="mt-2">
                      The product is designed around business-scoped access and controlled workflow surfaces. Visibility and actions may vary depending on the user’s role and the business context.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">4. Security and operational controls</h2>
                    <p className="mt-2">
                      BynkBook is intended to support safer operational behavior through controlled sign-in, password reset flows, closed-period handling, activity visibility, and administrative constraints where implemented.
                    </p>
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold text-slate-950">5. Contact and updates</h2>
                    <p className="mt-2">
                      This privacy page can be updated as the product evolves. Replace this placeholder legal copy with your final business-approved privacy policy before public launch.
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