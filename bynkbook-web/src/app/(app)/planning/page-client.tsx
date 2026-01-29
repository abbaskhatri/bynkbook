"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { getBudgets, putBudgets, type BudgetRow } from "@/lib/api/budgets";
import { listCategories, type CategoryRow } from "@/lib/api/categories";
import { listGoals, createGoal, type GoalRow } from "@/lib/api/goals";

import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppDialog } from "@/components/primitives/AppDialog";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { inputH7 } from "@/components/primitives/tokens";

import { PieChart, Target } from "lucide-react";

type TabKey = "budgets" | "goals";

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

export default function PlanningPageClient() {
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

  const selectedBiz = useMemo(() => {
    const list: any[] = (businessesQ.data as any[]) ?? [];
    if (!selectedBusinessId) return null;
    return list.find((b) => String(b.id) === String(selectedBusinessId)) ?? null;
  }, [businessesQ.data, selectedBusinessId]);

  // Reuse existing effective canWrite logic (same role allowlist as the rest of the app)
  const canWrite = useMemo(() => {
    const roleRaw =
      (selectedBiz as any)?.role ??
      (selectedBiz as any)?.my_role ??
      (selectedBiz as any)?.user_role ??
      (selectedBiz as any)?.membership_role ??
      null;

    const r = String(roleRaw ?? "").trim().toUpperCase();
    return r === "OWNER" || r === "ADMIN" || r === "BOOKKEEPER" || r === "ACCOUNTANT";
  }, [selectedBiz]);

  const noWriteTitle = "You don’t have permission to edit. Ask an admin for access.";

  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;
    if (!sp.get("businessId")) router.replace(`/planning?businessId=${selectedBusinessId}`);
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  const [tab, setTab] = useState<TabKey>("budgets");

  // ---------------- Budgets state ----------------
  const [month, setMonth] = useState<string>(ymNow());
  const [budgetRows, setBudgetRows] = useState<BudgetRow[]>([]);
  const [budgetsLoading, setBudgetsLoading] = useState(false);

  const [draftByCatId, setDraftByCatId] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [budgetsErr, setBudgetsErr] = useState<string | null>(null);

  const budgetsDirty = useMemo(() => {
    for (const r of budgetRows) {
      const draft = draftByCatId[r.category_id];
      if (draft == null) continue;
      const cents = inputToCents(draft);
      if (String(cents) !== String(r.budget_cents)) return true;
    }
    return false;
  }, [budgetRows, draftByCatId]);

  useEffect(() => {
    if (!authReady) return;
    if (!selectedBusinessId) return;

    let alive = true;
    (async () => {
      setBudgetsLoading(true);
      setBudgetsErr(null);
      try {
        const res = await getBudgets(selectedBusinessId, month);
        if (!alive) return;
        setBudgetRows(res.rows ?? []);
        const nextDraft: Record<string, string> = {};
        for (const r of res.rows ?? []) nextDraft[r.category_id] = centsToInput(r.budget_cents);
        setDraftByCatId(nextDraft);
      } catch (e: any) {
        if (!alive) return;
        setBudgetRows([]);
        setDraftByCatId({});
        setBudgetsErr(e?.message ?? "Failed to load budgets");
      } finally {
        if (alive) setBudgetsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [authReady, selectedBusinessId, month]);

  async function onSaveBudgets() {
    if (!selectedBusinessId) return;
    setSaving(true);
    setBudgetsErr(null);

    try {
      const updates = budgetRows
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
      if (failed.length) setBudgetsErr(`Some rows failed to save (${failed.length}).`);

      const fresh = await getBudgets(selectedBusinessId, month);
      setBudgetRows(fresh.rows ?? []);
      const nextDraft: Record<string, string> = {};
      for (const r of fresh.rows ?? []) nextDraft[r.category_id] = centsToInput(r.budget_cents);
      setDraftByCatId(nextDraft);
    } catch (e: any) {
      setBudgetsErr(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ---------------- Goals state ----------------
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [goalRows, setGoalRows] = useState<GoalRow[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [goalsErr, setGoalsErr] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCategoryId, setCreateCategoryId] = useState("");
  const [createMonthStart, setCreateMonthStart] = useState(ymNow());
  const [createMonthEnd, setCreateMonthEnd] = useState<string>("");
  const [createTarget, setCreateTarget] = useState("0.00");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authReady) return;
    if (!selectedBusinessId) return;

    let alive = true;
    (async () => {
      setGoalsLoading(true);
      setGoalsErr(null);
      try {
        const [cats, goals] = await Promise.all([
          listCategories(selectedBusinessId, { includeArchived: false }),
          listGoals(selectedBusinessId),
        ]);
        if (!alive) return;
        setCategories(cats.rows ?? []);
        setGoalRows(goals.rows ?? []);
        if (!createCategoryId && (cats.rows?.[0]?.id ?? "")) setCreateCategoryId(String(cats.rows?.[0]?.id ?? ""));
      } catch (e: any) {
        if (!alive) return;
        setCategories([]);
        setGoalRows([]);
        setGoalsErr(e?.message ?? "Failed to load goals");
      } finally {
        if (alive) setGoalsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, selectedBusinessId]);

  const goalsKpi = useMemo(() => {
    const total = goalRows.length;
    const active = goalRows.filter((r) => String(r.status).toUpperCase() === "ACTIVE").length;
    const paused = goalRows.filter((r) => String(r.status).toUpperCase() === "PAUSED").length;
    const archived = goalRows.filter((r) => String(r.status).toUpperCase() === "ARCHIVED").length;
    return { total, active, paused, archived };
  }, [goalRows]);

  async function onCreateGoal() {
    if (!selectedBusinessId) return;
    setGoalsErr(null);

    const name = createName.trim();
    if (!name) return setGoalsErr("Name is required.");
    if (!createCategoryId) return setGoalsErr("Category is required.");
    if (!/^\d{4}-\d{2}$/.test(createMonthStart)) return setGoalsErr("Start month must be YYYY-MM.");
    if (createMonthEnd && !/^\d{4}-\d{2}$/.test(createMonthEnd)) return setGoalsErr("End month must be YYYY-MM.");
    const target_cents = inputToCents(createTarget);

    setCreating(true);
    try {
      await createGoal(selectedBusinessId, {
        name,
        category_id: createCategoryId,
        month_start: createMonthStart,
        month_end: createMonthEnd ? createMonthEnd : null,
        target_cents,
        status: "ACTIVE",
      });

      const fresh = await listGoals(selectedBusinessId);
      setGoalRows(fresh.rows ?? []);

      setCreateOpen(false);
      setCreateName("");
      setCreateTarget("0.00");
      setCreateMonthStart(ymNow());
      setCreateMonthEnd("");
    } catch (e: any) {
      setGoalsErr(e?.message ?? "Create failed");
    } finally {
      setCreating(false);
    }
  }

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  return (
    <div className="flex flex-col gap-2 max-w-6xl">
      {/* Header shell (match Reports) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={tab === "budgets" ? <PieChart className="h-4 w-4" /> : <Target className="h-4 w-4" />}
            title="Planning"
            right={
              tab === "budgets" ? (
                <Button
                  type="button"
                  className="h-7 px-3 text-xs"
                  disabled={!canWrite || !budgetsDirty || saving || budgetsLoading}
                  onClick={onSaveBudgets}
                  title={!canWrite ? noWriteTitle : undefined}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-7 px-3 text-xs"
                  onClick={() => setCreateOpen(true)}
                  disabled={!selectedBusinessId || !canWrite}
                  title={!canWrite ? noWriteTitle : undefined}
                >
                  New goal
                </Button>
              )
            }
          />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        {/* Tabs row */}
        <div className="px-3 py-2">
          <div className="flex gap-2 text-sm">
            {[
              { key: "budgets", label: "Budgets" },
              { key: "goals", label: "Goals" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key as TabKey)}
                className={`h-7 px-3 rounded-md text-xs font-medium transition ${
                  tab === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-slate-200" />

        {/* Context row */}
        <div className="px-3 py-2 flex items-center justify-between">
          {tab === "budgets" ? (
            <div className="flex items-center gap-2">
              <div className="text-xs text-slate-600">Month</div>
              <Button type="button" variant="outline" className="h-7 w-7 px-0" onClick={() => setMonth((m) => ymAdd(m, -1))}>
                ‹
              </Button>
              <div className="text-xs text-slate-700 tabular-nums">{month}</div>
              <Button type="button" variant="outline" className="h-7 w-7 px-0" onClick={() => setMonth((m) => ymAdd(m, 1))}>
                ›
              </Button>
              <div className="ml-2 text-[11px] text-slate-500">Expense budgets only</div>
            </div>
          ) : (
            <div className="text-xs text-slate-500">Goals summary</div>
          )}
        </div>
      </div>

      {/* Goals KPIs (outside header box) */}
      {tab === "goals" ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[
            { label: "Total", value: String(goalsKpi.total) },
            { label: "Active", value: String(goalsKpi.active) },
            { label: "Paused", value: String(goalsKpi.paused) },
            { label: "Archived", value: String(goalsKpi.archived) },
          ].map((x) => (
            <Card key={x.label} className="border-slate-200 bg-white">
              <CardContent className="py-2.5 text-center">
                <div className="text-xl font-semibold leading-none">{x.value}</div>
                <div className="mt-0.5 text-xs text-slate-600">{x.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Content */}
      {tab === "budgets" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {budgetsErr ? <div className="px-3 py-2 text-xs text-red-700 border-b border-slate-200">{budgetsErr}</div> : null}

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
                budgetsLoading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-sm text-slate-600">
                      Loading…
                    </td>
                  </tr>
                ) : budgetRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-sm text-slate-600">
                      No categories available for budgets. Budgets use active categories—create or unarchive categories to budget by category.
                    </td>
                  </tr>
                ) : (
                  <>
                    {budgetRows.map((r) => {
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
                              disabled={!canWrite}
                              title={!canWrite ? noWriteTitle : undefined}
                            />
                          </td>

                          <td className="px-3 text-sm text-right tabular-nums text-slate-700">{formatUsdFromCents(r.actual_cents)}</td>

                          <td className="px-3 text-sm text-right tabular-nums font-medium">{formatUsdFromCents(remaining)}</td>
                        </tr>
                      );
                    })}
                  </>
                )
              }
              footer={null}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {goalsErr ? <div className="px-3 py-2 text-xs text-red-700 border-b border-slate-200">{goalsErr}</div> : null}

          <LedgerTableShell
              colgroup={
                <>
                  <col />
                  <col style={{ width: 220 }} />
                  <col style={{ width: 160 }} />
                  <col style={{ width: 160 }} />
                  <col style={{ width: 160 }} />
                </>
              }
              header={
                <tr className="h-9">
                  <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Name</th>
                  <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Category</th>
                  <th className="px-3 text-center text-[11px] font-semibold text-slate-600">Months</th>
                  <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Target</th>
                  <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Progress</th>
                </tr>
              }
              addRow={null}
              body={
                goalRows.length === 0 && !goalsLoading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-3 text-sm text-slate-600">
                      No goals yet. Create an expense goal for a category to track progress month-by-month.
                    </td>
                  </tr>
                ) : (
                  <>
                    {goalRows.map((g) => {
                      const months = g.month_end ? `${g.month_start} → ${g.month_end}` : g.month_start;
                      return (
                        <tr key={g.id} className="h-9 border-b border-slate-100">
                          <td className="px-3 text-sm truncate font-medium">{g.name}</td>
                          <td className="px-3 text-sm truncate text-slate-700">{g.category_name}</td>
                          <td className="px-3 text-center text-xs text-slate-600">{months}</td>
                          <td className="px-3 text-sm text-right tabular-nums">{formatUsdFromCents(g.target_cents)}</td>
                          <td className="px-3 text-sm text-right tabular-nums">{formatUsdFromCents(g.progress_cents)}</td>
                        </tr>
                      );
                    })}
                  </>
                )
              }
              footer={null}
          />
        </div>
      )}

      <AppDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New goal"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="button" onClick={onCreateGoal} disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-[11px] text-slate-600">Name</div>
            <Input value={createName} onChange={(e) => setCreateName(e.target.value)} className="h-8" placeholder="e.g. Keep Marketing under $2,000" />
          </div>

          <div className="space-y-1">
            <div className="text-[11px] text-slate-600">Category (required)</div>
            <select
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={createCategoryId}
              onChange={(e) => setCreateCategoryId(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">Start month (YYYY-MM)</div>
              <Input value={createMonthStart} onChange={(e) => setCreateMonthStart(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">End month (optional)</div>
              <Input value={createMonthEnd} onChange={(e) => setCreateMonthEnd(e.target.value)} className="h-8" placeholder="YYYY-MM" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] text-slate-600">Target (USD)</div>
            <Input value={createTarget} onChange={(e) => setCreateTarget(e.target.value)} className="h-8" inputMode="decimal" />
          </div>

          <div className="text-[11px] text-slate-500">Expense goals only (progress is based on EXPENSE entries).</div>
        </div>
      </AppDialog>
    </div>
  );
}
