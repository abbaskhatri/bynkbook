import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import OpenAI from "openai";
import type { DuplicateEvidenceItem } from "./issuesDuplicateEvidence";

export type DuplicateReviewClass =
  | "LIKELY_DUPLICATE"
  | "LIKELY_LEGITIMATE_REPEAT"
  | "NEEDS_REVIEW";

export type DuplicateReviewConfidence =
  | "HIGH"
  | "MEDIUM"
  | "REVIEW";

export type DuplicateReviewResult = {
  issue_id: string;
  classification: DuplicateReviewClass;
  confidence_label: DuplicateReviewConfidence;
  explanation: string;
  suggested_next_step: "MARK_LEGITIMATE" | "REVIEW_MANUALLY";
};

const secretsClient = new SecretsManagerClient({});
let cachedApiKey: string | null = null;
let cachedModel: string | null = null;

async function getSecretString(secretId: string) {
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );

  const secret = res.SecretString ?? "";
  if (!secret) {
    throw new Error(`Secret ${secretId} is empty`);
  }

  return secret.trim();
}

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;

  const directApiKey =
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY_BYNKBOOK ||
    "";

  if (directApiKey) {
    cachedApiKey = directApiKey.trim();
    return cachedApiKey;
  }

  const secretId = process.env.OPENAI_API_KEY_SECRET_ID || "";
  if (!secretId) {
    throw new Error("Missing OpenAI API key configuration");
  }

  cachedApiKey = await getSecretString(secretId);
  return cachedApiKey;
}

async function getModelName() {
  if (cachedModel) return cachedModel;

  const directModel =
    process.env.OPENAI_MODEL ||
    process.env.OPENAI_MODEL_BYNKBOOK ||
    "";

  if (directModel) {
    cachedModel = directModel.trim();
    return cachedModel;
  }

  const secretId = process.env.OPENAI_MODEL_SECRET_ID || "";
  if (!secretId) {
    cachedModel = "gpt-4o-mini";
    return cachedModel;
  }

  try {
    cachedModel = await getSecretString(secretId);
    return cachedModel || "gpt-4o-mini";
  } catch {
    cachedModel = "gpt-4o-mini";
    return cachedModel;
  }
}

async function getClient() {
  const apiKey = await getApiKey();
  return new OpenAI({ apiKey });
}

function clampExplanation(value: any) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "Review manually.";

  // Keep explanations short and bookkeeping-oriented.
  if (text.length <= 180) return text;
  return `${text.slice(0, 177).trim()}...`;
}

function normalizeClassification(value: any): DuplicateReviewClass {
  const v = String(value ?? "").trim().toUpperCase();
  if (v === "LIKELY_DUPLICATE") return "LIKELY_DUPLICATE";
  if (v === "LIKELY_LEGITIMATE_REPEAT") return "LIKELY_LEGITIMATE_REPEAT";
  return "NEEDS_REVIEW";
}

function normalizeConfidence(value: any): DuplicateReviewConfidence {
  const v = String(value ?? "").trim().toUpperCase();
  if (v === "HIGH") return "HIGH";
  if (v === "MEDIUM") return "MEDIUM";
  return "REVIEW";
}

function toFallbackResult(item: DuplicateEvidenceItem): DuplicateReviewResult {
  return {
    issue_id: item.issue_id,
    classification: "NEEDS_REVIEW",
    confidence_label: "REVIEW",
    explanation: "Review manually before resolving this duplicate.",
    suggested_next_step: "REVIEW_MANUALLY",
  };
}

function buildPromptItems(items: DuplicateEvidenceItem[]) {
  return items.map((item) => ({
    issue_id: item.issue_id,
    entry_id: item.entry_id,
    group_key: item.group_key,
    date: item.date,
    payee: item.payee,
    normalized_payee: item.normalized_payee,
    amount_cents: item.amount_cents,
    method: item.method,
    memo: item.memo,
    descriptor_present: item.descriptor_present,
    peer_count: item.peer_count,
    peer_entry_ids: item.peer_entry_ids,
    peer_dates: item.peer_dates,
    peer_amount_cents: item.peer_amount_cents,
    peer_methods: item.peer_methods,
    peer_payees: item.peer_payees,
    signals: item.signals,
  }));
}

function buildSystemPrompt() {
  return [
    "You are reviewing bookkeeping duplicate-issue candidates for a CPA-safe accounting product.",
    "Classify each duplicate issue into exactly one class:",
    "- LIKELY_DUPLICATE",
    "- LIKELY_LEGITIMATE_REPEAT",
    "- NEEDS_REVIEW",
    "",
    "Use only the evidence provided.",
    "Be conservative.",
    "Only use LIKELY_LEGITIMATE_REPEAT when the evidence is genuinely strong.",
    "If evidence is mixed or uncertain, return NEEDS_REVIEW.",
    "",
    "Do not suggest deleting, merging, consolidating, editing, or mutating entries.",
    "Merge always remains manual.",
    "",
    "Return short bookkeeping language only.",
    "Each explanation must be evidence-grounded and at most 1-2 short sentences.",
    "No speculation. No verbosity.",
    "",
    "Also return a confidence_label:",
    "- HIGH",
    "- MEDIUM",
    "- REVIEW",
    "",
    "Suggested next step rules:",
    "- LIKELY_LEGITIMATE_REPEAT => MARK_LEGITIMATE",
    "- LIKELY_DUPLICATE => REVIEW_MANUALLY",
    "- NEEDS_REVIEW => REVIEW_MANUALLY",
    "",
    "Return valid JSON only with shape:",
    '{"results":[{"issue_id":"...","classification":"LIKELY_DUPLICATE|LIKELY_LEGITIMATE_REPEAT|NEEDS_REVIEW","confidence_label":"HIGH|MEDIUM|REVIEW","explanation":"...","suggested_next_step":"MARK_LEGITIMATE|REVIEW_MANUALLY"}]}',
  ].join("\n");
}

function buildUserPrompt(items: DuplicateEvidenceItem[]) {
  return JSON.stringify(
    {
      instructions: {
        goal: "Classify duplicate issue candidates conservatively for preview only.",
        note: "Do not assume merge or deletion. Mark legitimate only when evidence is genuinely strong.",
      },
      items: buildPromptItems(items),
    },
    null,
    2
  );
}

function parseResults(rawText: string, items: DuplicateEvidenceItem[]) {
  const fallbackById = new Map<string, DuplicateReviewResult>(
    items.map((item) => [item.issue_id, toFallbackResult(item)])
  );

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return items.map((item) => fallbackById.get(item.issue_id)!);
  }

  const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];
  const byId = new Map<string, DuplicateReviewResult>();

  for (const raw of rawResults) {
    const issueId = String(raw?.issue_id ?? "").trim();
    if (!issueId || !fallbackById.has(issueId)) continue;

    const classification = normalizeClassification(raw?.classification);
    const confidence_label = normalizeConfidence(raw?.confidence_label);

    let suggested_next_step: "MARK_LEGITIMATE" | "REVIEW_MANUALLY";
    if (classification === "LIKELY_LEGITIMATE_REPEAT") {
      suggested_next_step = "MARK_LEGITIMATE";
    } else {
      suggested_next_step = "REVIEW_MANUALLY";
    }

    byId.set(issueId, {
      issue_id: issueId,
      classification,
      confidence_label,
      explanation: clampExplanation(raw?.explanation),
      suggested_next_step,
    });
  }

  return items.map((item) => byId.get(item.issue_id) ?? fallbackById.get(item.issue_id)!);
}

export async function reviewDuplicateEvidenceWithAI(
  items: DuplicateEvidenceItem[]
): Promise<DuplicateReviewResult[]> {
  const limitedItems = (items ?? []).slice(0, 30);
  if (!limitedItems.length) return [];

  try {
    const client = await getClient();
    const model = await getModelName();

    const response = await client.responses.create({
      model,
      temperature: 0.1,
      max_output_tokens: 3000,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: buildSystemPrompt() }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: buildUserPrompt(limitedItems) }],
        },
      ],
    });

    const rawText =
      response.output_text ||
      "";

    if (!rawText.trim()) {
      return limitedItems.map((item) => toFallbackResult(item));
    }

    return parseResults(rawText, limitedItems);
  } catch (err) {
    console.error("issuesDuplicateReviewAI fallback:", err);
    return limitedItems.map((item) => toFallbackResult(item));
  }
}