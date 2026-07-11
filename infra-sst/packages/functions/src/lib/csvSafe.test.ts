import { describe, expect, test } from "vitest";
import { safeCsvCell, safeCsvRow } from "./csvSafe";

describe("safe CSV export", () => {
  test.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@IMPORTXML(\"x\")", "  =cmd", "\t@cmd"])(
    "neutralizes spreadsheet formula input %s",
    (value) => {
      expect(safeCsvCell(value)).toContain("'");
      expect(safeCsvCell(value).replace(/^\"/, "").startsWith("'")).toBe(true);
    },
  );

  test("still quotes commas, quotes, and line breaks", () => {
    expect(safeCsvCell('hello,"world"\nnext')).toBe('"hello,""world""\nnext"');
    expect(safeCsvRow(["safe", "a,b"])).toBe('safe,"a,b"');
  });
});
