import { describe, expect, test } from "vitest";
import { safeCsvCell } from "./csv";

describe("safeCsvCell", () => {
  test.each(["=1+1", "+cmd", "-2+3", "@IMPORTXML", "  =SUM(A:A)", "\t@cmd"])(
    "neutralizes spreadsheet formula input %s",
    (input) => {
      expect(safeCsvCell(input).replace(/^\"/, "").startsWith("'")).toBe(true);
    },
  );

  test("quotes CSV syntax after neutralizing content", () => {
    expect(safeCsvCell('a,"b"\nnext')).toBe('"a,""b""\nnext"');
  });
});
