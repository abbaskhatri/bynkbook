"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Entry } from "@/lib/api/entries";
import {
  isIssuesPageIssueType,
  listAccountIssues,
  type EntryIssueRow,
} from "@/lib/api/issues";
import { useEntries } from "@/lib/queries/useEntries";

export const MOBILE_UNCATEGORIZED_LIMIT = 200;
export const MOBILE_ISSUES_LIMIT = 200;

export function isMobileReviewableEntry(entry: Entry) {
  const t = String(entry.type ?? "").toUpperCase();
  const payee = String(entry.payee ?? "").trim().toLowerCase();
  return (
    !entry.deleted_at &&
    !entry.category_id &&
    t !== "TRANSFER" &&
    t !== "ADJUSTMENT" &&
    t !== "OPENING" &&
    !payee.startsWith("opening balance")
  );
}

export function filterMobileIssueRows(rows: EntryIssueRow[]) {
  return rows.filter((issue) => isIssuesPageIssueType(issue.issue_type));
}

export function mobileIssuesQueryKey(
  businessId: string | null | undefined,
  accountId: string | null | undefined
) {
  return ["mobileReviewQueues", "issues", businessId ?? "", accountId ?? "", "OPEN", MOBILE_ISSUES_LIMIT] as const;
}

export function useMobileUncategorizedEntries(params: {
  businessId: string | null;
  accountId: string | null;
  enabled?: boolean;
}) {
  const { businessId, accountId, enabled = true } = params;
  const query = useEntries({
    businessId: enabled ? businessId : null,
    accountId: enabled ? accountId : null,
    limit: MOBILE_UNCATEGORIZED_LIMIT,
    includeDeleted: false,
    uncategorized: true,
    excludeOpening: true,
  });

  const rows = useMemo(
    () =>
      (query.data ?? [])
        .filter(isMobileReviewableEntry)
        .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))),
    [query.data]
  );

  return { query, rows };
}

export function useMobileOpenIssues(params: {
  businessId: string | null;
  accountId: string | null;
  enabled?: boolean;
}) {
  const { businessId, accountId, enabled = true } = params;

  const query = useQuery({
    queryKey: mobileIssuesQueryKey(businessId, accountId),
    queryFn: () =>
      listAccountIssues({
        businessId: businessId as string,
        accountId: accountId as string,
        status: "OPEN",
        limit: MOBILE_ISSUES_LIMIT,
      }),
    enabled: enabled && !!businessId && !!accountId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const rows = useMemo(
    () => filterMobileIssueRows(query.data?.issues ?? []),
    [query.data]
  );

  return { query, rows };
}
