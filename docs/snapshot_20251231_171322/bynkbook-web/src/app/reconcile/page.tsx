"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader as THead, TableRow } from "@/components/ui/table";

function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch {}
  return 0n;
}

function formatUsdFromCents(cents: bigint) {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = abs / 100n;
  const pennies = abs % 100n;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = `${withCommas}.${pennies.toString().padStart(2, "0")}`;
  return neg ? `(${core})` : core;
}

export default function ReconcilePage() {
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
      router.replace(`/reconcile?businessId=${selectedBusinessId}`);
      return;
    }

    if (accountsQ.isLoading) return;

    if (selectedAccountId && !accountIdFromUrl) {
      router.replace(`/reconcile?businessId=${selectedBusinessId}&accountId=${selectedAccountId}`);
    }
  }, [authReady, businessesQ.isLoading, selectedBusinessId, accountsQ.isLoading, selectedAccountId, accountIdFromUrl, router, sp]);

  const entriesQ = useEntries({ businessId: selectedBusinessId, accountId: selectedAccountId, limit: 50 });

  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Record<string, string>>({});

  function onMatch() {
    if (!selectedBankId || !selectedLedgerId) return;
    setMatches((m) => ({ ...m, [selectedBankId]: selectedLedgerId }));
    setSelectedBankId(null);
    setSelectedLedgerId(null);
  }

  function onUnmatch() {
    if (!selectedBankId) return;
    setMatches((m) => {
      const copy = { ...m };
      delete copy[selectedBankId];
      return copy;
    });
  }

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  const opts = (accountsQ.data ?? [])
    .filter((a) => !a.archived_at)
    .map((a) => ({ value: a.id, label: a.name }));

  const accountCapsule = (
    <CapsuleSelect
      loading={accountsQ.isLoading}
      value={selectedAccountId || (opts[0]?.value ?? "")}
      onValueChange={(v) => router.replace(`/reconcile?businessId=${selectedBusinessId}&accountId=${v}`)}
      options={opts}
      placeholder="Select account"
    />
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader title="Reconcile" subtitle="Account-scoped (MVP)" inlineAfterTitle={accountCapsule} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CHeader className="flex flex-row items-center justify-between">
            <CardTitle>Bank transactions</CardTitle>
            <div className="text-xs text-muted-foreground">Coming soon</div>
          </CHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground mb-3">
              No bank transaction endpoint is available yet in Phase 3.
            </div>

            <Table>
              <THead>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Match</TableHead>
                </TableRow>
              </THead>
              <TableBody>
                {[1, 2, 3].map((i) => {
                  const bankId = `bank_${i}`;
                  const matched = matches[bankId];
                  return (
                    <TableRow key={bankId} className={selectedBankId === bankId ? "bg-muted" : ""} onClick={() => setSelectedBankId(bankId)}>
                      <TableCell>—</TableCell>
                      <TableCell>Sample transaction {i}</TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell className="text-right">{matched ? "Matched" : "Unmatched"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex items-center gap-2 mt-4">
              <Button onClick={onMatch} disabled={!selectedBankId || !selectedLedgerId}>Match</Button>
              <Button variant="outline" onClick={onUnmatch} disabled={!selectedBankId || !matches[selectedBankId]}>Unmatch</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CHeader><CardTitle>Ledger entries</CardTitle></CHeader>
          <CardContent>
            {entriesQ.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <Table>
                <THead>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Memo</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </THead>
                <TableBody>
                  {(entriesQ.data ?? []).map((e) => {
                    const amt = toBigIntSafe(e.amount_cents);
                    const cls = amt < 0n ? "text-right text-red-600" : "text-right";
                    return (
                      <TableRow key={e.id} className={selectedLedgerId === e.id ? "bg-muted" : ""} onClick={() => setSelectedLedgerId(e.id)}>
                        <TableCell>{e.date}</TableCell>
                        <TableCell className="font-medium">{e.payee ?? ""}</TableCell>
                        <TableCell>{e.memo ?? ""}</TableCell>
                        <TableCell className={cls}>{formatUsdFromCents(amt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
