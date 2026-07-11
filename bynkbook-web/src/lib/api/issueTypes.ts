export const ISSUES_PAGE_TYPES = ["DUPLICATE", "MISSING_CATEGORY", "STALE_CHECK"] as const;
export type IssuesPageIssueType = (typeof ISSUES_PAGE_TYPES)[number];

export function isIssuesPageIssueType(issueType: unknown): issueType is IssuesPageIssueType {
  const type = String(issueType ?? "").toUpperCase();
  return type === "DUPLICATE" || type === "MISSING_CATEGORY" || type === "STALE_CHECK";
}
