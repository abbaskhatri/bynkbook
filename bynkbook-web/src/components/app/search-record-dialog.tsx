"use client";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { listEntriesPage } from "@/lib/api/entries";
import { listBankTransactions } from "@/lib/api/bankTransactions";
import { formatUsdFromCents } from "@/lib/ledger/helpers";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";

export default function SearchRecordDialog() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const businessId = params.get("businessId") ?? "";
  const accountId = params.get("accountId") ?? "";
  const entryId = params.get("focusEntryId");
  const bankId = params.get("focusBankTxnId");
  const id = entryId || bankId || "";
  const query = useQuery({
    queryKey: ["searchRecord", businessId, accountId, entryId ? "entry" : "bank", id],
    enabled: !!businessId && !!accountId && !!id,
    queryFn: async ({ signal }) => {
      const response = entryId
        ? await listEntriesPage({ businessId, accountId, entryId, limit: 1, signal })
        : await listBankTransactions({ businessId, accountId, transactionId: id, status: "all", limit: 1, signal });
      // Never present a different record if an older API ignores the ID filter.
      return response.items.find((row) => row.id === id) ?? null;
    },
  });
  const row = query.data;
  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("focusEntryId"); next.delete("focusBankTxnId");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  return <AppDialog open={!!id} onClose={close} title={entryId ? "Ledger search result" : "Bank search result"} size="sm"
    footer={<Button variant="outline" onClick={close}>Back to list</Button>}>
    {query.isLoading ? <p role="status" className="text-sm">Loading record…</p> : query.isError ? <div role="alert" className="space-y-3 text-sm"><p>We could not load this record.</p><Button onClick={() => void query.refetch()}>Try again</Button></div> : !row ? <p className="text-sm">This record is no longer available in this account.</p> : <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 text-sm font-semibold"><span>{row.payee ?? row.name ?? "Transaction"}</span><span className="whitespace-nowrap">{formatUsdFromCents(BigInt(row.amount_cents ?? "0"))}</span></div>
      <dl className="grid grid-cols-2 gap-2 text-sm"><dt className="text-bb-text-muted">Date</dt><dd>{String(row.date ?? row.posted_date ?? "").slice(0, 10)}</dd><dt className="text-bb-text-muted">Status</dt><dd>{row.status ?? (row.is_pending ? "Pending" : "Posted")}</dd>{entryId ? <><dt className="text-bb-text-muted">Category</dt><dd>{row.category_name || "Uncategorized"}</dd></> : null}</dl>
      {row.memo ? <p className="whitespace-pre-wrap break-words text-sm text-bb-text-muted">{row.memo}</p> : null}
    </div>}
  </AppDialog>;
}
