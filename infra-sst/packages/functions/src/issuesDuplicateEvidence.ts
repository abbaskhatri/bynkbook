type DuplicateIssueRow = {
  id: string;
  entry_id: string;
  issue_type: string;
  group_key?: string | null;
  details?: string | null;
};

type DuplicateEntryRow = {
  id: string;
  date: Date | string;
  payee?: string | null;
  amount_cents: bigint | number | string;
  method?: string | null;
  memo?: string | null;
};

export type DuplicateEvidenceItem = {
  issue_id: string;
  entry_id: string;
  issue_type: "DUPLICATE";
  group_key: string | null;
  date: string | null;
  payee: string;
  normalized_payee: string;
  amount_cents: string;
  method: string | null;
  memo: string;
  descriptor_present: boolean;
  peer_count: number;
  peer_entry_ids: string[];
  peer_dates: string[];
  peer_amount_cents: string[];
  peer_methods: string[];
  peer_payees: string[];
  signals: {
    exact_amount_match: boolean;
    exact_signed_amount_match: boolean;
    exact_normalized_payee_match: boolean;
    exact_method_match: boolean;
    descriptor_present: boolean;
    min_date_distance_days: number | null;
  };
};

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function toYmd(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function ymdToDay(ymd: string | null): number | null {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 86400000);
}

function absBigIntString(value: bigint | number | string) {
  const raw =
    typeof value === "bigint"
      ? value
      : typeof value === "number"
        ? BigInt(Math.trunc(value))
        : BigInt(String(value || "0"));
  const abs = raw < 0n ? -raw : raw;
  return abs.toString();
}

function signedBigIntString(value: bigint | number | string) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return BigInt(Math.trunc(value)).toString();
  return BigInt(String(value || "0")).toString();
}

export function buildDuplicateEvidence(params: {
  issues: DuplicateIssueRow[];
  entries: DuplicateEntryRow[];
}) {
  const issues = (params.issues ?? []).filter(
    (it) => String(it.issue_type || "").toUpperCase() === "DUPLICATE"
  );
  const entries = params.entries ?? [];

  const entryById = new Map<string, DuplicateEntryRow>(
    entries.map((e) => [String(e.id), e])
  );

  const groupMembers = new Map<string, Array<{ issue: DuplicateIssueRow; entry: DuplicateEntryRow }>>();

  for (const issue of issues) {
    const entry = entryById.get(String(issue.entry_id));
    if (!entry) continue;

    const key = String(
      issue.group_key ||
      `entry:${issue.entry_id}`
    );

    const arr = groupMembers.get(key);
    if (arr) arr.push({ issue, entry });
    else groupMembers.set(key, [{ issue, entry }]);
  }

  const items: DuplicateEvidenceItem[] = [];

  for (const [, members] of groupMembers) {
    const normalizedMembers = members.map(({ issue, entry }) => {
      const ymd = toYmd(entry.date);
      return {
        issue,
        entry,
        ymd,
        day: ymdToDay(ymd),
        payee: String(entry.payee || "").trim(),
        normalizedPayee: normalizeText(String(entry.payee || "")),
        amountSigned: signedBigIntString(entry.amount_cents),
        amountAbs: absBigIntString(entry.amount_cents),
        method: entry.method ? String(entry.method).toUpperCase() : "",
        memo: String(entry.memo || "").trim(),
        descriptorPresent: !!normalizeText(String(entry.memo || "")),
      };
    });

    for (const current of normalizedMembers) {
      const peers = normalizedMembers.filter((m) => m.issue.id !== current.issue.id);

      const peerDates = peers.map((p) => p.ymd).filter((v): v is string => !!v);
      const peerAmounts = peers.map((p) => p.amountSigned);
      const peerMethods = peers.map((p) => p.method).filter(Boolean);
      const peerPayees = peers.map((p) => p.payee).filter(Boolean);
      const peerEntryIds = peers.map((p) => String(p.entry.id));

      const currentDay = current.day;

      const minDateDistanceDays =
        currentDay == null || peers.length === 0
          ? null
          : peers.reduce<number | null>((min, peer) => {
              if (peer.day == null) return min;
              const diff = Math.abs(currentDay - peer.day);
              if (min == null) return diff;
              return Math.min(min, diff);
            }, null);

      const exactSignedAmountMatch =
        peers.length > 0 && peers.every((p) => p.amountSigned === current.amountSigned);

      const exactAmountMatch =
        peers.length > 0 && peers.every((p) => p.amountAbs === current.amountAbs);

      const exactNormalizedPayeeMatch =
        peers.length > 0 && peers.every((p) => p.normalizedPayee === current.normalizedPayee);

      const exactMethodMatch =
        peers.length > 0 && peers.every((p) => p.method === current.method);

      items.push({
        issue_id: String(current.issue.id),
        entry_id: String(current.entry.id),
        issue_type: "DUPLICATE",
        group_key: current.issue.group_key ? String(current.issue.group_key) : null,
        date: current.ymd,
        payee: current.payee,
        normalized_payee: current.normalizedPayee,
        amount_cents: current.amountSigned,
        method: current.method || null,
        memo: current.memo,
        descriptor_present: current.descriptorPresent,
        peer_count: peers.length,
        peer_entry_ids: peerEntryIds,
        peer_dates: peerDates,
        peer_amount_cents: peerAmounts,
        peer_methods: peerMethods,
        peer_payees: peerPayees,
        signals: {
          exact_amount_match: exactAmountMatch,
          exact_signed_amount_match: exactSignedAmountMatch,
          exact_normalized_payee_match: exactNormalizedPayeeMatch,
          exact_method_match: exactMethodMatch,
          descriptor_present: current.descriptorPresent,
          min_date_distance_days: minDateDistanceDays,
        },
      });
    }
  }

  return items;
}