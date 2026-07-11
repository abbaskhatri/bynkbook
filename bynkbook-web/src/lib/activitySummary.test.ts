import { describe, expect, test } from "vitest";
import { summarizeActivityPayload } from "./activitySummary";

describe("summarizeActivityPayload", () => {
  test("shows only approved human-readable activity fields", () => {
    expect(summarizeActivityPayload({ month: "2026-06", status: "closed", count: 3 })).toEqual([
      { label: "Month", value: "2026-06" },
      { label: "Status", value: "closed" },
      { label: "Count", value: "3" },
    ]);
  });

  test("does not expose identifiers, tokens, nested payloads, or arbitrary keys", () => {
    expect(summarizeActivityPayload({ user_id: "secret", access_token: "token", metadata: { raw: true } })).toEqual([]);
  });
});
