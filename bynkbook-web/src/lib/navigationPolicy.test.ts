import { describe, expect, test } from "vitest";
import { isNavigationPathVisible } from "./navigationPolicy";

describe("isNavigationPathVisible", () => {
  test.each(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"])("shows planning to %s", (role) => {
    expect(isNavigationPathVisible("/planning", role)).toBe(true);
  });

  test("hides planning from members while retaining general navigation", () => {
    expect(isNavigationPathVisible("/planning", "MEMBER")).toBe(false);
    expect(isNavigationPathVisible("/reports", "MEMBER")).toBe(true);
  });
});
