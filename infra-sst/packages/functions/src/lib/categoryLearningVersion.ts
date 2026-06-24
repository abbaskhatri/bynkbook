const versionByBusinessId = new Map<string, number>();

function normalizeBusinessId(businessId: unknown) {
  return String(businessId ?? "").trim();
}

export function getCategoryLearningVersion(businessId: unknown) {
  const key = normalizeBusinessId(businessId);
  if (!key) return 0;
  return versionByBusinessId.get(key) ?? 0;
}

export function bumpCategoryLearningVersion(businessId: unknown) {
  const key = normalizeBusinessId(businessId);
  if (!key) return 0;
  const next = Date.now();
  versionByBusinessId.set(key, next);
  return next;
}
