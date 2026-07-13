export const ENTRY_CATEGORIES_CHANGED_EVENT = "bynk:entry-categories-changed";

export type EntryCategoriesChangedDetail = {
  businessId: string;
  accountId: string;
};

export function notifyEntryCategoriesChanged(detail: EntryCategoriesChangedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<EntryCategoriesChangedDetail>(ENTRY_CATEGORIES_CHANGED_EVENT, { detail }));
}
