"use client";
import { useState } from "react";
import { AppDialog } from "@/components/primitives/AppDialog";
import { userFacingErrorMessage } from "@/lib/errors/app-error";
import { Button } from "@/components/ui/button";

export type MobileEntryDraft = { payee: string; date: string; amountStr: string; type: "EXPENSE" | "INCOME"; categoryId: string; note: string };
export default function MobileEntryDialog({ open, onClose, onSave, categories, today, returnFocusRef }: {
  open: boolean; onClose: () => void; onSave: (draft: MobileEntryDraft) => Promise<void>;
  categories: Array<[string, string]>; today: string;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [draft, setDraft] = useState<MobileEntryDraft>({ payee: "", date: today, amountStr: "", type: "EXPENSE", categoryId: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = "min-h-11 min-w-0 w-full rounded-md border border-bb-border bg-bb-surface-card px-3 text-sm";
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError("");
    try { await onSave(draft); onClose(); }
    catch (error: any) { setError(userFacingErrorMessage(error, "Could not save. Please try again.")); }
    finally { setSaving(false); }
  }
  return <AppDialog open={open} onClose={saving ? undefined : onClose} title="Add entry" size="sm" returnFocusRef={returnFocusRef}
    footer={<Button form="mobile-new-entry" type="submit" disabled={saving}>{saving ? "Saving…" : "Save entry"}</Button>}>
    <form id="mobile-new-entry" onSubmit={save} className="grid gap-3">
      {error ? <p role="alert" className="text-sm text-bb-status-danger-fg">{error}</p> : null}
      <label className="grid gap-1 text-xs">Payee<input required autoFocus className={input} value={draft.payee} onChange={(event) => setDraft({ ...draft, payee: event.target.value })} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-xs">Type<select className={input} value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as MobileEntryDraft["type"] })}><option value="EXPENSE">Expense</option><option value="INCOME">Income</option></select></label>
        <label className="grid gap-1 text-xs">Amount<input required inputMode="decimal" className={input} value={draft.amountStr} onChange={(event) => setDraft({ ...draft, amountStr: event.target.value })} /></label>
      </div>
      <label className="grid gap-1 text-xs">Date<input required type="date" className={input} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
      <label className="grid gap-1 text-xs">Category<select className={input} value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Uncategorized</option>{categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="grid gap-1 text-xs">Memo (optional)<input className={input} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
    </form>
  </AppDialog>;
}
