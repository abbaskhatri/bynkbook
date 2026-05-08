export type UploadType = "RECEIPT" | "INVOICE" | "BANK_STATEMENT" | "BUSINESS_LOGO";

export type UploadContext = {
  businessId?: string;
  accountId?: string; // required for BANK_STATEMENT in Phase 4A wiring
};

export const uploadTypeLabel: Record<UploadType, string> = {
  RECEIPT: "Receipt",
  INVOICE: "Invoice",
  BANK_STATEMENT: "Bank statement",
  BUSINESS_LOGO: "Business logo",
};

export const uploadAccept: Record<UploadType, string> = {
  RECEIPT: "image/*,application/pdf",
  INVOICE: "image/*,application/pdf",
  BANK_STATEMENT: ".csv,text/csv,application/pdf",
  BUSINESS_LOGO: "image/*",
};

export const uploadAllowMultiple: Record<UploadType, boolean> = {
  RECEIPT: true,
  INVOICE: true,
  BANK_STATEMENT: false,
  BUSINESS_LOGO: false,
};

export const uploadHelperText: Record<UploadType, string> = {
  RECEIPT: "Upload images or PDFs. We'll extract vendor, date, and amount for review. Ledger entries are created only when you choose Create ledger entries.",
  INVOICE: "Upload PDFs or images. Invoices are saved for review first. No ledger/payment entry is created until you approve/post it.",
  BANK_STATEMENT: "Upload a bank statement (CSV preferred; PDF supported).",
  BUSINESS_LOGO: "Upload a logo image (PNG/JPG/SVG).",
};
