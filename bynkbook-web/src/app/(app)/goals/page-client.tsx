"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { listCategories, type CategoryRow } from "@/lib/api/categories";
import { listGoals, createGoal, type GoalRow } from "@/lib/api/goals";

import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppDialog } from "@/components/primitives/AppDialog";

import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";

import { Target } from "lucide-react";

function ymNow(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
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

function inputToCents(raw: string) {
  const cleaned = String(raw ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

export default function GoalsPageClient() {
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
    if (!sp.get("businessId")) router.replace(`/goals?businessId=${selectedBusinessId}`);
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [rows, setRows] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      setLoading(true);
      setErr(null);
      try {
        const [cats, goals] = await Promise.all([
          listCategories(selectedBusinessId, { includeArchived: false }),
          listGoals(selectedBusinessId),
        ]);
        if (!alive) return;
        setCategories(cats.rows ?? []);
        setRows(goals.rows ?? []);
        if (!createCategoryId && (cats.rows?.[0]?.id ?? "")) setCreateCategoryId(String(cats.rows?.[0]?.id ?? ""));
      } catch (e: any) {
        if (!alive) return;
        setCategories([]);
        setRows([]);
        setErr(e?.message ?? "Failed to load goals");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, selectedBusinessId]);

  const kpi = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => String(r.status).toUpperCase() === "ACTIVE").length;
    const paused = rows.filter((r) => String(r.status).toUpperCase() === "PAUSED").length;
    const archived = rows.filter((r) => String(r.status).toUpperCase() === "ARCHIVED").length;
    return { total, active, paused, archived };
  }, [rows]);

  async function onCreate() {
    if (!selectedBusinessId) return;
    setErr(null);

    const name = createName.trim();
    if (!name) return setErr("Name is required.");
    if (!createCategoryId) return setErr("Category is required.");
    if (!/^\d{4}-\d{2}$/.test(createMonthStart)) return setErr("Start month must be YYYY-MM.");
    if (createMonthEnd && !/^\d{4}-\d{2}$/.test(createMonthEnd)) return setErr("End month must be YYYY-MM.");
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
      setRows(fresh.rows ?? []);

      setCreateOpen(false);
      setCreateName("");
      setCreateTarget("0.00");
      setCreateMonthStart(ymNow());
      setCreateMonthEnd("");
    } catch (e: any) {
      setErr(e?.message ?? "Create failed");
    } finally {
      setCreating(false);
    }
  }

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2 flex items-center justify-between">
          <PageHeader icon={<Target className="h-4 w-4" />} title="Goals" />
          <Button type="button" className="h-7 px-3 text-xs" onClick={() => setCreateOpen(true)} disabled={!selectedBusinessId}>
            New goal
          </Button>
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[
          { label: "Total", value: String(kpi.total) },
          { label: "Active", value: String(kpi.active) },
          { label: "Paused", value: String(kpi.paused) },
          { label: "Archived", value: String(kpi.archived) },
        ].map((x) => (
          <Card key={x.label} className="border-slate-200 bg-white">
            <CardContent className="py-3 text-center">
              <div className="text-2xl font-semibold leading-none">{x.value}</div>
              <div className="mt-0.5 text-xs text-slate-600">{x.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-0">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">Goals</div>
            {loading ? <div className="text-xs text-slate-500">Loading…</div> : null}
          </div>

          {err ? <div className="px-3 py-2 text-xs text-red-700 border-b border-slate-200">{err}</div> : null}

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
              rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-sm text-slate-600">
                    No goals yet.
                  </td>
                </tr>
              ) : (
                <>
                  {rows.map((g) => {
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
        </CardContent>
      </Card>

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
            <Button type="button" onClick={onCreate} disabled={creating}>
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
