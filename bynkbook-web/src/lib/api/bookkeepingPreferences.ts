import { apiFetch } from "./client";

export type BookkeepingPreferences = {
  ok: true;
  businessId: string;
  amountToleranceCents: string; // bigint as string
  daysTolerance: number;
  duplicateWindowDays: number;
  staleThresholdDays: number;
  autoSuggest: boolean;
};

export async function getBookkeepingPreferences(businessId: string): Promise<BookkeepingPreferences> {
  return apiFetch(`/v1/businesses/${businessId}/bookkeeping/preferences`);
}

export async function updateBookkeepingPreferences(
  businessId: string,
  patch: {
    amountToleranceCents: string;
    daysTolerance: number;
    duplicateWindowDays: number;
    staleThresholdDays: number;
    autoSuggest: boolean;
  }
): Promise<BookkeepingPreferences> {
  return apiFetch(`/v1/businesses/${businessId}/bookkeeping/preferences`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}
