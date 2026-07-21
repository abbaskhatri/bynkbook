import { describe, expect, test } from "vitest";

import { amountInWords, buildSslt104Html } from "./sslt104";

describe("SSLT104 check formatting", () => {
  test("writes common dollar amounts in check-safe words", () => {
    expect(amountInWords(0)).toBe("Zero and 00/100 Dollars");
    expect(amountInWords(12_345)).toBe("One Hundred Twenty-Three and 45/100 Dollars");
    expect(amountInWords(1_000_001)).toBe("Ten Thousand and 01/100 Dollars");
  });

  test("escapes user content in the print document", () => {
    const html = buildSslt104Html({
      businessName: "Bynk & Co",
      setting: { account_id: "a", template_code: "SSLT104", next_check_number: "101", offset_x_mils: 0, offset_y_mils: 0 },
      check: {
        id: "c", business_id: "b", account_id: "a", check_number: "100", issued_date: "2026-07-21",
        payee_name: "<script>alert(1)</script>", amount_cents: "1250", purpose: "GENERAL", bill_allocations: [],
        template_code: "SSLT104", status: "DRAFT", stored_status: "DRAFT", print_count: 0, created_at: "", updated_at: "",
      },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("@page { size: letter; margin: 0; }");
  });
});
