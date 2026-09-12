import { describe, expect, test, vi } from "vitest";
import { canReadFeatures } from "./authz";
describe("financial read visibility", () => {
  test.each(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT", "MEMBER"])("%s can read ordinary ledger and reports by default", async (role) => {
    expect(await canReadFeatures({}, "business", role, ["ledger", "reports"])).toBe(true);
  });
  test("members cannot access vendor-only data by default", async () => {
    expect(await canReadFeatures({}, "business", "MEMBER", ["vendors"])).toBe(false);
  });
  test("custom NONE denies an alternate financial read even for an administrator", async () => {
    const prisma = { businessRolePolicy: { findFirst: vi.fn(async () => ({ policy_json: { ledger: "NONE", reports: "FULL" } })) } };
    expect(await canReadFeatures(prisma, "business", "ADMIN", ["reports", "ledger"])).toBe(false);
    expect(prisma.businessRolePolicy.findFirst).toHaveBeenCalledWith({ where: { business_id: "business", role: "ADMIN" }, select: { policy_json: true } });
  });
  test("unknown feature names fail closed", async () => {
    expect(await canReadFeatures({}, "business", "OWNER", ["unknown"])).toBe(false);
  });
});
