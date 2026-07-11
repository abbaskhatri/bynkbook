import { describe, expect, test } from "vitest";
import { canonicalMobileRedirectTarget } from "./canonicalRedirect";

describe("canonicalMobileRedirectTarget", () => {
  test("preserves business and account context", () => {
    expect(canonicalMobileRedirectTarget("/issues", { businessId: "biz 1", accountId: "acct/2" })).toBe(
      "/issues?businessId=biz+1&accountId=acct%2F2",
    );
  });

  test("accepts the legacy businessesId parameter", () => {
    expect(canonicalMobileRedirectTarget("/dashboard", { businessesId: "biz" })).toBe("/dashboard?businessId=biz");
  });
});
