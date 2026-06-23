import { describe, expect, test } from "vitest";
import { computeImportHash } from "./importHash";
import { parseBankStatementCsv } from "./parseBankStatementCsv";

describe("Bank of America CSV parsing", () => {
  test("parses quoted amount and running balance fields with thousands separators", () => {
    const parsed = parseBankStatementCsv(
      [
        ",,,",
        "Date,Description,Amount,Running Bal.",
        '1/1/2026,Beginning balance as of 01/01/2026,,"55,390.74"',
        '1/2/2026,Preencoded Deposit,"4,697.75","60,088.49"',
        '1/2/2026,Worldwide Expres DES:PAYMENTS ID:100000000793584 INDN:NOVELTY WHOLESALE CO ID:1000991662 CCD PMT INFO:NTE*ZZZ*Worldwide Express payment\\,"-1,228.82","48,646.04"',
        '3/31/2026,"Zelle payment to HUZAIFA SHAIKH for Biryani tray""; Conf# d0pr81jmx""",-85,"53,426.49"',
      ].join("\n")
    );

    expect(parsed.parser).toBe("BANK_OF_AMERICA");
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        postedDate: "2026-01-02",
        description: "Preencoded Deposit",
        amountCents: 469775n,
        sourceRowIndex: 4,
      }),
      expect.objectContaining({
        postedDate: "2026-01-02",
        description:
          "Worldwide Expres DES:PAYMENTS ID:100000000793584 INDN:NOVELTY WHOLESALE CO ID:1000991662 CCD PMT INFO:NTE*ZZZ*Worldwide Express payment\\",
        amountCents: -122882n,
        sourceRowIndex: 5,
      }),
      expect.objectContaining({
        postedDate: "2026-03-31",
        description: 'Zelle payment to HUZAIFA SHAIKH for Biryani tray"; Conf# d0pr81jmx"',
        amountCents: -8500n,
        sourceRowIndex: 6,
      }),
    ]);
  });
});

describe("CSV import hash occurrence handling", () => {
  test("keeps first occurrence hash compatible and separates repeated identical bank rows", () => {
    const base = {
      businessId: "biz-1",
      accountId: "acct-1",
      postedDate: "2026-03-03",
      amountCents: "-3000",
      description: "Wire Transfer Fee",
      parser: "BANK_OF_AMERICA",
    };

    const legacy = computeImportHash(base);
    const first = computeImportHash({ ...base, occurrence: 1 });
    const second = computeImportHash({ ...base, occurrence: 2 });
    const third = computeImportHash({ ...base, occurrence: 3 });

    expect(first).toBe(legacy);
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect(third).not.toBe(first);
  });
});
