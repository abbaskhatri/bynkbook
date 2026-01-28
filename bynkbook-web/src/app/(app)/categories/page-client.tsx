"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tags } from "lucide-react";

import { createCategory, listCategories, updateCategory, type CategoryRow } from "@/lib/api/categories";

export default function CategoriesPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const businessId = bizIdFromUrl ?? (businessesQ.data?.[0]?.id ?? null);

  const activeBusinessName = useMemo(() => {
    if (!businessId) return null;
    const list = businessesQ.data ?? [];
    const b = list.find((x: any) => x?.id === businessId);
    return b?.name ?? "Business";
  }, [businessId, businessesQ.data]);

  const [includeArchived, setIncludeArchived] = useState(false);
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [editNameById, setEditNameById] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    if (!businessId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await listCategories(businessId, { includeArchived });
      setRows(res.rows ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!businessId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, includeArchived]);

  async function onCreate() {
    if (!businessId) return;
    const name = newName.trim().replace(/\s+/g, " ");
    if (!name) return;

    setSavingId("create");
    setErr(null);
    try {
      await createCategory(businessId, name);
      setNewName("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Create failed");
    } finally {
      setSavingId(null);
    }
  }

  async function onRename(id: string) {
    if (!businessId) return;
    const name = String(editNameById[id] ?? "").trim().replace(/\s+/g, " ");
    if (!name) return;

    setSavingId(id);
    setErr(null);
    try {
      await updateCategory(businessId, id, { name });
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Rename failed");
    } finally {
      setSavingId(null);
    }
  }

  async function onToggleArchive(id: string, nextArchived: boolean) {
    if (!businessId) return;
    setSavingId(id);
    setErr(null);
    try {
      await updateCategory(businessId, id, { archived: nextArchived });
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Update failed");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<Tags className="h-4 w-4" />} title="Categories" />
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      <Card>
        <CHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">
              {activeBusinessName ?? "Business"} • Categories
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => setIncludeArchived((v) => !v)}
                title="Toggle archived"
              >
                {includeArchived ? "Hide archived" : "Show archived"}
              </Button>
            </div>
          </div>
        </CHeader>

        <CardContent className="space-y-3">
          {err ? (
            <div className="text-sm text-red-600" role="alert">
              {err}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Input
              className="h-7 text-xs max-w-sm"
              placeholder="New category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button className="h-7 px-3 text-xs" onClick={onCreate} disabled={!businessId || savingId === "create"}>
              {savingId === "create" ? "Creating…" : "Create"}
            </Button>
          </div>

          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-[1fr_220px_120px] bg-slate-50 border-b border-slate-200">
              <div className="px-3 py-2 text-[11px] font-semibold text-slate-600">Name</div>
              <div className="px-3 py-2 text-[11px] font-semibold text-slate-600 text-center">Rename</div>
              <div className="px-3 py-2 text-[11px] font-semibold text-slate-600 text-center">Archive</div>
            </div>

            {loading ? (
              <div className="px-3 py-3 text-sm text-slate-600">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-600">No categories yet.</div>
            ) : (
              rows.map((c) => {
                const draft = editNameById[c.id] ?? c.name;
                const isArchived = !!c.archived_at;

                return (
                  <div
                    key={c.id}
                    className="grid grid-cols-[1fr_220px_120px] items-center border-b border-slate-200 last:border-b-0"
                  >
                    <div className="px-3 py-2 text-sm text-slate-900 truncate">
                      {c.name} {isArchived ? <span className="text-[11px] text-slate-500">(archived)</span> : null}
                    </div>

                    <div className="px-3 py-2 flex items-center gap-2 justify-center">
                      <Input
                        className="h-7 text-xs"
                        value={draft}
                        onChange={(e) => setEditNameById((m) => ({ ...m, [c.id]: e.target.value }))}
                      />
                      <Button
                        variant="outline"
                        className="h-7 px-3 text-xs"
                        onClick={() => onRename(c.id)}
                        disabled={!businessId || savingId === c.id || draft.trim() === c.name}
                        title={draft.trim() === c.name ? "No changes" : "Rename"}
                      >
                        {savingId === c.id ? "Saving…" : "Save"}
                      </Button>
                    </div>

                    <div className="px-3 py-2 flex justify-center">
                      <Button
                        variant="outline"
                        className="h-7 px-3 text-xs"
                        onClick={() => onToggleArchive(c.id, !isArchived)}
                        disabled={!businessId || savingId === c.id}
                      >
                        {isArchived ? "Unarchive" : "Archive"}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
