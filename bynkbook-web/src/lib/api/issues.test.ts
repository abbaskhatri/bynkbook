import { describe, expect, test } from "vitest";

import { ISSUES_PAGE_TYPES, isIssuesPageIssueType } from "./issueTypes";

describe("Issues page issue types", () => {
  test("keeps missing-category issues visible alongside duplicates and stale checks", () => {
    expect(ISSUES_PAGE_TYPES).toEqual(["DUPLICATE", "MISSING_CATEGORY", "STALE_CHECK"]);
    expect(isIssuesPageIssueType("missing_category")).toBe(true);
  });

  test("rejects issue types that do not belong in the account issue queue", () => {
    expect(isIssuesPageIssueType("UNKNOWN")).toBe(false);
    expect(isIssuesPageIssueType(null)).toBe(false);
  });
});
