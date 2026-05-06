export type IssueCountStatus = "OPEN" | "RESOLVED" | "ALL";
export type IssueCountScope = "issuesPageVisible";

export function issueCountKey(
  businessId: string | null | undefined,
  accountId: string | null | undefined,
  status: IssueCountStatus = "OPEN",
  scope: IssueCountScope = "issuesPageVisible"
) {
  return ["issuesCount", businessId || "", accountId || "all", status, scope] as const;
}

export function issueCountBusinessKey(businessId: string | null | undefined) {
  return businessId ? (["issuesCount", businessId] as const) : (["issuesCount"] as const);
}
