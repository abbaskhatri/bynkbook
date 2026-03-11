import { normalizeMerchant } from "./categoryMerchantNormalize";
import { directionFromEntryTypeOrAmount } from "./categoryMemory";

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function computeConfidence(args: { accept_count: number; override_count: number }) {
  const accepts = Number(args.accept_count ?? 0);
  const overrides = Number(args.override_count ?? 0);
  const total = accepts + overrides;

  if (total <= 0) return 60;

  const ratio = accepts / Math.max(1, total);
  const volumeBoost = Math.min(12, accepts * 2);
  const penalty = Math.min(18, overrides * 3);

  return clampInt(68 + ratio * 18 + volumeBoost - penalty, 60, 99);
}

async function upsertMemoryRow(args: {
  prisma: any;
  business_id: string;
  merchant_normalized: string;
  direction: "INCOME" | "EXPENSE";
  category_id: string;
  accept_delta: number;
  override_delta: number;
}) {
  const {
    prisma,
    business_id,
    merchant_normalized,
    direction,
    category_id,
    accept_delta,
    override_delta,
  } = args;

  if (!business_id || !merchant_normalized || !direction || !category_id) return;

  const existing = await prisma.categoryMemory.findFirst({
    where: {
      business_id,
      merchant_normalized,
      direction,
      category_id,
    },
    select: {
      id: true,
      accept_count: true,
      override_count: true,
    },
  });

  const nextAccept = Math.max(0, Number(existing?.accept_count ?? 0) + Number(accept_delta ?? 0));
  const nextOverride = Math.max(0, Number(existing?.override_count ?? 0) + Number(override_delta ?? 0));
  const nextConfidence = computeConfidence({
    accept_count: nextAccept,
    override_count: nextOverride,
  });

  if (existing?.id) {
    await prisma.categoryMemory.update({
      where: { id: existing.id },
      data: {
        accept_count: nextAccept,
        override_count: nextOverride,
        confidence_score: nextConfidence,
        last_used_at: new Date(),
        updated_at: new Date(),
      },
    });
    return;
  }

  await prisma.categoryMemory.create({
    data: {
      business_id,
      merchant_normalized,
      direction,
      category_id,
      accept_count: nextAccept,
      override_count: nextOverride,
      confidence_score: nextConfidence,
      last_used_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    },
  });
}

export async function writeCategoryMemoryFeedback(args: {
  prisma: any;
  business_id: string;
  entry: {
    id?: string;
    payee?: string | null;
    memo?: string | null;
    amount_cents?: bigint | string | number | null;
    type?: string | null;
  };
  selected_category_id?: string | null;
  suggested_category_id?: string | null;
}) {
  const prisma = args.prisma;
  const business_id = String(args.business_id ?? "").trim();
  const selected_category_id = String(args.selected_category_id ?? "").trim();
  const suggested_category_id = String(args.suggested_category_id ?? "").trim();

  if (!business_id || !selected_category_id) return;

  const amountRaw = args.entry?.amount_cents ?? 0;
  let amount: bigint = 0n;
  try {
    amount = typeof amountRaw === "bigint" ? amountRaw : BigInt(String(amountRaw ?? "0"));
  } catch {
    amount = 0n;
  }

  const direction = directionFromEntryTypeOrAmount(args.entry?.type, amount);
  const merchant_normalized = normalizeMerchant(args.entry?.payee ?? "", args.entry?.memo ?? "");

  if (!merchant_normalized) return;

  await upsertMemoryRow({
    prisma,
    business_id,
    merchant_normalized,
    direction,
    category_id: selected_category_id,
    accept_delta: 1,
    override_delta: 0,
  });

  if (suggested_category_id && suggested_category_id !== selected_category_id) {
    await upsertMemoryRow({
      prisma,
      business_id,
      merchant_normalized,
      direction,
      category_id: suggested_category_id,
      accept_delta: 0,
      override_delta: 1,
    });
  }
}