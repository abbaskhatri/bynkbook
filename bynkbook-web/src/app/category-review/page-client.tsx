"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";
import { updateEntry, type Entry } from "@/lib/api/entries";

import { PageHeader } from "@/components/app/page-header";
import { selectTriggerClass } from "@/components/primitives/tokens";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Tags } from "lucide-react";

function formatUsdAccountingFromCents(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  const neg = n < 0;
  const abs = Math.abs(n);

  const dollars = Math.floor(abs / 100);
  const cents = Math.round(abs % 100);

  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = `$${withCommas}.${String(cents).padStart(2, "0")}`;
  return neg ? `(${core})` : core;
}

export default function CategoryReviewPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    (async () => {
      try { await getCurrentUser(); setAuthReady(true); } catch { router.replace("/login"); }
    })();
  }, [router]);

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");
  const accountIdFromUrl = sp.get("accountId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);

  const selectedAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    if (accountIdFromUrl) return accountIdFromUrl;
    return list.find((a) => !a.archived_at)?.id ?? "";
  }, [accountsQ.data, accountIdFromUrl]);

  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;

    if (!sp.get("businessId")) {
      router.replace(`/category-review?businessId=${selectedBusinessId}`);
      return;
    }

    if (accountsQ.isLoading) return;

    if (selectedAccountId && !accountIdFromUrl) {
      router.replace(`/category-review?businessId=${selectedBusinessId}&accountId=${selectedAccountId}`);
    }
  }, [authReady, businessesQ.isLoading, selectedBusinessId, accountsQ.isLoading, selectedAccountId, accountIdFromUrl, router, sp]);

  // NOTE: Do not early-return before hooks (Rules of Hooks). Render gating is handled below.

  const opts = (accountsQ.data ?? [])
    .filter((a) => !a.archived_at)
    .map((a) => ({ value: a.id, label: a.name }));

  const capsule = (
    <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
      <CapsuleSelect
        variant="flat"
        loading={accountsQ.isLoading}
        value={selectedAccountId || (opts[0]?.value ?? "")}
        onValueChange={(v) => router.replace(`/category-review?businessId=${selectedBusinessId}&accountId=${v}`)}
        options={opts}
        placeholder="Select account"
      />
    </div>
  );

  const qc = useQueryClient();

  // Load entries for selected account (Phase 3: functional Category Review)
  const entriesLimit = 500;
  const entriesKey = useMemo(
    () => ["entries", selectedBusinessId, selectedAccountId, entriesLimit, false] as const,
    [selectedBusinessId, selectedAccountId, entriesLimit]
  );

  const entriesQ = useEntries({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    limit: entriesLimit,
    includeDeleted: false,
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of (entriesQ.data ?? []) as Entry[]) {
      const c = String((e as any).memo ?? "").trim();
      if (c && c.toLowerCase() !== "uncategorized") set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [entriesQ.data]);

  const uncategorized = useMemo(() => {
    return ((entriesQ.data ?? []) as Entry[]).filter((e) => {
      const c = String((e as any).memo ?? "").trim();
      return !c || c.toLowerCase() === "uncategorized";
    });
  }, [entriesQ.data]);

  // Local per-entry category draft (UI-only)
  const [draftById, setDraftById] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const applyMut = useMutation({
    mutationFn: async (p: { entryId: string; category: string }) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");

      const memoStr =
        p.category === "__UNCATEGORIZED__" ? undefined : (p.category || "").trim() || undefined;

      return updateEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        entryId: p.entryId,
        updates: memoStr === undefined ? {} : { memo: memoStr },
      });
    },
    onMutate: async (p) => {
      setErr(null);

      // Optimistic: update entry memo in cache so it disappears from uncategorized list immediately
      const prev = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
      const memoValue =
        p.category === "__UNCATEGORIZED__"
          ? ""
          : (p.category || "").trim();

      const next = prev.map((e: any) => (e.id === p.entryId ? { ...e, memo: memoValue } : e));
      qc.setQueryData(entriesKey, next);

      return { prev };
    },
    onError: (e: any, _p, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(entriesKey, ctx.prev);
      setErr(e?.message || "Update failed");
    },
    onSuccess: () => {
      // Update sidebar attention badge immediately (UI-only)
      try {
        if (selectedBusinessId && selectedAccountId) {
          const key = `bynkbook:attn:uncat:${selectedBusinessId}:${selectedAccountId}`;
          const current = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
          const remaining = current.filter((e: any) => {
            const c = String(e.memo ?? "").trim();
            return !c || c.toLowerCase() === "uncategorized";
          }).length;

          localStorage.setItem(key, String(remaining));
          window.dispatchEvent(new CustomEvent("bynkbook:attnCountsUpdated"));
        }
      } catch {
        // ignore
      }
    },
  });

return (
    <div className="space-y-6 max-w-6xl">
      {/* Unified header container (match Ledger/Issues) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<Tags className="h-4 w-4" />} title="Category Review" afterTitle={capsule} />
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      <Card>
        <CHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="inline-flex items-center gap-2">
              Uncategorized
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-violet-50 px-1.5 text-[11px] font-semibold text-violet-800 border border-violet-200">
                {uncategorized.length}
              </span>
            </CardTitle>

            <Button
              variant="outline"
              disabled
              className="h-7 px-2 text-xs opacity-50 cursor-not-allowed"
              title="Coming soon"
            >
              Bulk confirm (Coming soon)
            </Button>
          </div>
        </CHeader>

        <CardContent className="space-y-3">
          {err ? (
            <div className="text-sm text-red-600" role="alert">
              {err}
            </div>
          ) : null}

          {entriesQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : uncategorized.length === 0 ? (
            <div className="text-sm text-muted-foreground">No uncategorized entries for this account.</div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-[110px_1fr_130px_220px_220px_90px] gap-0 bg-slate-50 border-b border-slate-200">
                <div className="px-2 py-0.5 text-xs font-semibold text-slate-600 text-center">Date</div>
                <div className="px-2 py-0.5 text-xs font-semibold text-slate-600">Payee</div>
                <div className="px-2 py-0.5 text-xs font-semibold text-slate-600 text-center">Amount</div>
                <div className="px-2 py-0.5 text-xs font-semibold text-slate-600 text-center">AI Suggestion</div>
                <div className="px-2 py-0.5 text-xs font-semibold text-slate-600 text-center">Category</div>
                <div className="px-2 py-0.5 text-xs font-semibold text-slate-600 text-center">Apply</div>
              </div>

              {uncategorized.map((e: any) => {
                const id = e.id as string;
                const payee = String(e.payee ?? "");
                const date = String(e.date ?? "").slice(0, 10);
                const amount = String(e.amount_cents ?? "");
                const amountNum = Number(amount) / 100;
                const amountText = Number.isFinite(amountNum) ? amountNum.toFixed(2) : "";

                const currentDraft = draftById[id] ?? "__UNCATEGORIZED__";

                return (
                  <div key={id} className="grid grid-cols-[110px_1fr_130px_220px_220px_90px] gap-0 border-b border-slate-200 last:border-b-0">
                    <div className="px-2 py-0.5 text-xs text-slate-700 text-center flex items-center justify-center">
                      {date}
                    </div>

                    <div className="px-2 py-0.5 text-xs text-slate-900 truncate flex items-center font-medium">
                      {payee}
                    </div>

                    <div
                      className={
                        "px-2 py-0.5 text-xs text-center tabular-nums flex items-center justify-center " +
                        (Number(e.amount_cents) < 0 ? "text-red-700" : "text-slate-900")
                      }
                    >
                      {formatUsdAccountingFromCents(e.amount_cents)}
                    </div>

                    {/* AI Suggestion (Phase 3: gated) */}
                    <div className="px-2 py-0.5 flex items-center justify-center">
                      <Button
                        variant="outline"
                        disabled
                        className="h-6 px-3 text-xs opacity-50 cursor-not-allowed"
                        title="Coming soon"
                      >
                        Coming soon
                      </Button>
                    </div>

                    <div className="px-2 py-0.5 flex items-center justify-center">
                      <div className="w-full max-w-[180px]">
                        <Select value={currentDraft} onValueChange={(v) => setDraftById((m) => ({ ...m, [id]: v }))}>
                          <SelectTrigger className={selectTriggerClass + " !h-6 !min-h-0 w-full px-2 !py-0 text-xs"}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent side="bottom" align="start">
                            <SelectItem value="__UNCATEGORIZED__">Uncategorized</SelectItem>
                            {categories.map((c, idx) => (
                              <SelectItem key={`${c}__${idx}`} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="px-2 py-0.5 flex items-center justify-center">
                      <Button
                        className="h-6 px-4 text-xs min-w-[72px]"
                        disabled={applyMut.isPending}
                        title="Apply category"
                        onClick={() => applyMut.mutate({ entryId: id, category: currentDraft })}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
