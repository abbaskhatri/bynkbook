"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { getBudgets, putBudgets, type BudgetRow } from "@/lib/api/budgets";

import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { inputH7 } from "@/components/primitives/tokens";

import { PieChart } from "lucide-react";

function ymNow(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function ymAdd(month: string, delta: number): string {
  const [yy, mm] = month.split("-").map((x) => Number(x));
  const d = new Date(Date.UTC(yy, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + delta);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatUsdFromCents(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "$0.00";
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100);
  const cents = Math.round(abs % 100);
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${withCommas}.${String(cents).padStart(2, "0")}`;
}

function centsToInput(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "0.00";
  return (n / 100).toFixed(2);
}

function inputToCents(raw: string) {
  const cleaned = String(raw ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

export default function BudgetsPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        setAuthReady(true);
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;
    if (!sp.get("businessId")) router.replace(`/budgets?businessId=${selectedBusinessId}`);
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  const [month, setMonth] = useState<string>(ymNow());
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [draftByCatId, setDraftByCatId] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = useMemo(() => {
    for (const r of rows) {
      const draft = draftByCatId[r.category_id];
      if (draft == null) continue;
      const cents = inputToCents(draft);
      if (String(cents) !== String(r.budget_cents)) return true;
    }
    return false;
  }, [rows, draftByCatId]);

  useEffect(() => {
    if (!authReady) return;
    if (!selectedBusinessId) return;

    let alive = true;
    (async () => {
      setLoading(true);
      setSaveError(null);
      try {
        const res = await getBudgets(selectedBusinessId, month);
        if (!alive) return;
        setRows(res.rows ?? []);
        const nextDraft: Record<string, string> = {};
        for (const r of res.rows ?? []) nextDraft[r.category_id] = centsToInput(r.budget_cents);
        setDraftByCatId(nextDraft);
      } catch (e: any) {
        if (!alive) return;
        setRows([]);
        setDraftByCatId({});
        setSaveError(e?.message ?? "Failed to load budgets");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [authReady, selectedBusinessId, month]);

  async function onSave() {
    if (!selectedBusinessId) return;
    setSaving(true);
    setSaveError(null);

    try {
      const updates = rows
        .map((r) => {
          const draft = draftByCatId[r.category_id] ?? centsToInput(r.budget_cents);
          const cents = inputToCents(draft);
          if (String(cents) === String(r.budget_cents)) return null;
          return { category_id: r.category_id, budget_cents: cents };
        })
        .filter(Boolean) as Array<{ category_id: string; budget_cents: number }>;

      if (updates.length === 0) {
        setSaving(false);
        return;
      }

      const res = await putBudgets(selectedBusinessId, month, updates);

      const failed = (res.results ?? []).filter((r: any) => !r.ok);
      if (failed.length) {
        setSaveError(`Some rows failed to save (${failed.length}).`);
      }

      // Refresh server truth after save (authoritative backend)
      const fresh = await getBudgets(selectedBusinessId, month);
      setRows(fresh.rows ?? []);
      const nextDraft: Record<string, string> = {};
      for (const r of fresh.rows ?? []) nextDraft[r.category_id] = centsToInput(r.budget_cents);
      setDraftByCatId(nextDraft);
    } catch (e: any) {
      setSaveError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<PieChart className="h-4 w-4" />} title="Budgets" />
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      <Card>
        <CardContent className="pt-0">
          {/* Standard header row (match Reports tables) */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">Budget by Category</div>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <Button type="button" variant="outline" className="h-7 w-7 px-0" onClick={() => setMonth((m) => ymAdd(m, -1))}>
                  ‹
                </Button>
                <span className="px-2">{month}</span>
                <Button type="button" variant="outline" className="h-7 w-7 px-0" onClick={() => setMonth((m) => ymAdd(m, 1))}>
                  ›
                </Button>
              </div>
            </div>

            <Button type="button" className="h-7 px-3 text-xs" disabled={!dirty || saving || loading} onClick={onSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>

          {saveError ? <div className="px-3 py-2 text-xs text-red-700 border-b border-slate-200">{saveError}</div> : null}

          <LedgerTableShell
            colgroup={
              <>
                <col />
                <col style={{ width: 160 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 160 }} />
              </>
            }
            header={
              <tr className="h-9">
                <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Category</th>
                <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Budgeted</th>
                <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Actual</th>
                <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Remaining</th>
              </tr>
            }
            addRow={null}
            body={
              loading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-sm text-slate-600">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-sm text-slate-600">
                    No categories found.
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((r) => {
                    const draft = draftByCatId[r.category_id] ?? centsToInput(r.budget_cents);
                    const budgetCents = inputToCents(draft);
                    const actualCents = Number(r.actual_cents ?? 0);
                    const remaining = Math.max(0, budgetCents - actualCents);

                    return (
                      <tr key={r.category_id} className="h-9 border-b border-slate-100">
                        <td className="px-3 text-sm truncate">{r.category_name}</td>

                        <td className="px-3 text-sm text-right tabular-nums">
                          <input
                            value={draft}
                            onChange={(e) => setDraftByCatId((m) => ({ ...m, [r.category_id]: e.target.value }))}
                            className={inputH7 + " w-[120px] text-right tabular-nums"}
                            inputMode="decimal"
                          />
                        </td>

                        <td className="px-3 text-sm text-right tabular-nums text-slate-700">
                          {formatUsdFromCents(r.actual_cents)}
                        </td>

                        <td className="px-3 text-sm text-right tabular-nums font-medium">
                          {formatUsdFromCents(remaining)}
                        </td>
                      </tr>
                    );
                  })}
                </>
              )
            }
            footer={null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
