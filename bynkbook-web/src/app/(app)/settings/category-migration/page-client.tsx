"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { listCategories, type CategoryRow } from "@/lib/api/categories";
import {
  getCategoryMigrationPreview,
  postCategoryMigrationApply,
  type MigrationPreviewRow,
} from "@/lib/api/categoryMigration";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FilterBar } from "@/components/primitives/FilterBar";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Tags } from "lucide-react";

type MappingChoice = { mode: "CREATE_SAME" } | { mode: "EXISTING"; categoryId: string };

export default function CategoryMigrationPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  // Auth gate (match other pages)
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

  const myBusinessRole = useMemo(() => {
    const list = businessesQ.data ?? [];
    const b = list.find((x: any) => x?.id === selectedBusinessId);
    return String(b?.role ?? "").toUpperCase();
  }, [businessesQ.data, selectedBusinessId]);

  const isOwner = myBusinessRole === "OWNER";

  const accountsQ = useAccounts(selectedBusinessId);
  const activeAccountOptions = useMemo(() => {
    return (accountsQ.data ?? []).filter((a: any) => !a.archived_at);
  }, [accountsQ.data]);

  const accountIdFromUrl = sp.get("accountId");
  const selectedAccountId = useMemo(() => {
    const v = accountIdFromUrl;
    if (!v) return "all";
    return String(v);
  }, [accountIdFromUrl]);

  // Keep URL consistent
  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;

    const params = new URLSearchParams(sp.toString());
    if (!params.get("businessId")) params.set("businessId", selectedBusinessId);
    if (!params.get("accountId")) params.set("accountId", "all");

    const next = params.toString();
    const cur = sp.toString();
    if (next !== cur) router.replace(`/settings/category-migration?${next}`);
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  // Categories list (for mapping)
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  useEffect(() => {
    (async () => {
      if (!selectedBusinessId) return;
      try {
        const res = await listCategories(selectedBusinessId, { includeArchived: false });
        setCategories(res.rows ?? []);
      } catch {
        setCategories([]);
      }
    })();
  }, [selectedBusinessId]);

  const catNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  const [minCount, setMinCount] = useState<number>(2);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [rows, setRows] = useState<MigrationPreviewRow[]>([]);
  const [choiceByMemo, setChoiceByMemo] = useState<Record<string, MappingChoice>>({});

  // Dry run summary
  const [dryRunSummary, setDryRunSummary] = useState<{ memoCount: number; wouldUpdate: number } | null>(null);

  async function loadPreview() {
    if (!selectedBusinessId) return;
    setLoading(true);
    setErr(null);
    setDryRunSummary(null);

    try {
      const res = await getCategoryMigrationPreview(selectedBusinessId, {
        accountId: selectedAccountId || "all",
        minCount,
      });
      setRows(res.rows ?? []);

      // Default mapping: if exact category exists -> use it, else create same name
      const nextChoice: Record<string, MappingChoice> = {};
      for (const r of res.rows ?? []) {
        if (r.existingCategoryId) nextChoice[r.memoValue] = { mode: "EXISTING", categoryId: r.existingCategoryId };
        else nextChoice[r.memoValue] = { mode: "CREATE_SAME" };
      }
      setChoiceByMemo(nextChoice);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load preview");
      setRows([]);
      setChoiceByMemo({});
    } finally {
      setLoading(false);
    }
  }

  function buildMappings() {
    const mappings: { memoValue: string; categoryName: string }[] = [];
    for (const r of rows) {
      const choice = choiceByMemo[r.memoValue];
      if (!choice) continue;

      if (choice.mode === "CREATE_SAME") {
        mappings.push({ memoValue: r.memoValue, categoryName: r.memoValue });
      } else {
        const name = catNameById.get(choice.categoryId);
        if (name) mappings.push({ memoValue: r.memoValue, categoryName: name });
      }
    }
    return mappings;
  }

  async function runDryRun() {
    if (!selectedBusinessId) return;
    setLoading(true);
    setErr(null);
    setDryRunSummary(null);

    try {
      const mappings = buildMappings();
      if (mappings.length === 0) {
        setErr("No mappings selected");
        return;
      }

      const res = await postCategoryMigrationApply(selectedBusinessId, {
        accountId: selectedAccountId || "all",
        dryRun: true,
        mappings,
      });

      const wouldUpdate = (res.results ?? []).reduce((sum: number, r: any) => sum + Number(r.wouldUpdate ?? 0), 0);
      setDryRunSummary({ memoCount: mappings.length, wouldUpdate });
    } catch (e: any) {
      setErr(e?.message ?? "Dry run failed");
    } finally {
      setLoading(false);
    }
  }

  const [confirmOpen, setConfirmOpen] = useState(false);

  async function applyForReal() {
    if (!selectedBusinessId) return;
    setLoading(true);
    setErr(null);
    setDryRunSummary(null);

    try {
      const mappings = buildMappings();
      if (mappings.length === 0) {
        setErr("No mappings selected");
        return;
      }

      await postCategoryMigrationApply(selectedBusinessId, {
        accountId: selectedAccountId || "all",
        dryRun: false,
        mappings,
      });

      setConfirmOpen(false);
      // Refresh preview after apply
      await loadPreview();
    } catch (e: any) {
      setErr(e?.message ?? "Apply failed");
    } finally {
      setLoading(false);
    }
  }

  if (!authReady) return null;

  const accountCapsule = (
    <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
      <CapsuleSelect
        variant="flat"
        loading={accountsQ.isLoading}
        value={selectedAccountId || "all"}
        onValueChange={(v) => {
          if (!selectedBusinessId) return;
          const params = new URLSearchParams(sp.toString());
          params.set("businessId", selectedBusinessId);
          params.set("accountId", v);
          router.replace(`/settings/category-migration?${params.toString()}`);
        }}
        options={[
          { value: "all", label: "All accounts" },
          ...activeAccountOptions.map((a: any) => ({ value: a.id, label: a.name })),
        ]}
        placeholder="All accounts"
      />
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<Tags className="h-4 w-4" />} title="Category Migration" afterTitle={accountCapsule} />
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      <Card>
        <CHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">Migration Wizard (Owner only)</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-7 px-3 text-xs"
                disabled={!isOwner || loading}
                title={!isOwner ? "Owner only" : "Load preview"}
                onClick={loadPreview}
              >
                Load preview
              </Button>

              <Button
                variant="outline"
                className="h-7 px-3 text-xs"
                disabled={!isOwner || loading || rows.length === 0}
                title={!isOwner ? "Owner only" : "Dry run"}
                onClick={runDryRun}
              >
                Dry run
              </Button>

              <Button
                className="h-7 px-3 text-xs"
                disabled={!isOwner || loading || rows.length === 0}
                title={!isOwner ? "Owner only" : "Apply"}
                onClick={() => setConfirmOpen(true)}
              >
                Apply
              </Button>
            </div>
          </div>
        </CHeader>

        <CardContent className="space-y-3">
          {!isOwner ? (
            <div className="text-sm text-slate-600">Only the business owner can run migration.</div>
          ) : null}

          <FilterBar
            left={
              <>
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">Min count</div>
                  <Input
                    type="number"
                    className="h-7 w-[120px] text-xs"
                    value={String(minCount)}
                    onChange={(e) => setMinCount(Math.max(2, Math.min(50, Number(e.target.value || 2))))}
                    min={2}
                    max={50}
                  />
                </div>
                <div className="ml-2 flex flex-col justify-end">
                  <div className="text-[11px] text-slate-500">Source: entry memo</div>
                  <div className="text-[11px] text-slate-400">Only entries with category_id = null are eligible</div>
                </div>
              </>
            }
            right={<div />}
          />

          {err ? (
            <div className="text-sm text-red-600" role="alert">
              {err}
            </div>
          ) : null}

          {dryRunSummary ? (
            <div className="text-sm text-slate-700">
              Dry run: {dryRunSummary.memoCount} mappings • would update{" "}
              <span className="font-semibold">{dryRunSummary.wouldUpdate}</span> entries
            </div>
          ) : null}

          {loading ? <div className="text-sm text-slate-600">Working…</div> : null}

          {!loading && rows.length === 0 ? (
            <div className="text-sm text-slate-600">Load preview to see candidates.</div>
          ) : null}

          {rows.length > 0 ? (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-[1fr_90px_220px] gap-0 bg-slate-50 border-b border-slate-200">
                <div className="px-3 py-2 text-[11px] font-semibold text-slate-600">Memo value</div>
                <div className="px-3 py-2 text-[11px] font-semibold text-slate-600 text-right">Count</div>
                <div className="px-3 py-2 text-[11px] font-semibold text-slate-600">Mapping</div>
              </div>

              {rows.map((r) => {
                const choice = choiceByMemo[r.memoValue] ?? { mode: "CREATE_SAME" as const };
                return (
                  <div key={r.memoValue} className="grid grid-cols-[1fr_90px_220px] gap-0 border-b border-slate-200 last:border-b-0">
                    <div className="px-3 py-2 text-sm text-slate-900 truncate">{r.memoValue}</div>
                    <div className="px-3 py-2 text-sm text-slate-900 text-right tabular-nums">{r.count}</div>

                    <div className="px-3 py-2">
                      <select
                        className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
                        value={choice.mode === "CREATE_SAME" ? "__CREATE_SAME__" : choice.categoryId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setChoiceByMemo((m) => {
                            if (v === "__CREATE_SAME__") return { ...m, [r.memoValue]: { mode: "CREATE_SAME" } };
                            return { ...m, [r.memoValue]: { mode: "EXISTING", categoryId: v } };
                          });
                        }}
                      >
                        <option value="__CREATE_SAME__">Create "{r.memoValue}"</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            Use "{c.name}"
                          </option>
                        ))}
                      </select>
                      {r.existingCategoryName ? (
                        <div className="mt-1 text-[11px] text-slate-500">Exact match exists: {r.existingCategoryName}</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AppDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm migration apply"
        size="md"
        disableOverlayClose={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyForReal} disabled={loading}>
              Apply
            </Button>
          </div>
        }
      >
        <div className="text-sm text-slate-700">
          This will assign categories to entries where the <span className="font-medium">memo</span> matches the selected mapping and{" "}
          <span className="font-medium">category_id is currently empty</span>. Memo text will not be removed.
        </div>
      </AppDialog>
    </div>
  );
}
