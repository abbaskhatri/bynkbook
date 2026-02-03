export type UploadType = "RECEIPT" | "INVOICE" | "BANK_STATEMENT";

export type UploadContext = {
  businessId?: string;
  accountId?: string; // required for BANK_STATEMENT in Phase 4A wiring
};

export const uploadTypeLabel: Record<UploadType, string> = {
  RECEIPT: "Receipt",
  INVOICE: "Invoice",
  BANK_STATEMENT: "Bank statement",
};

export const uploadAccept: Record<UploadType, string> = {
  RECEIPT: "image/*,application/pdf",
  INVOICE: "image/*,application/pdf",
  BANK_STATEMENT: ".csv,text/csv,application/pdf",
};

export const uploadAllowMultiple: Record<UploadType, boolean> = {
  RECEIPT: true,
  INVOICE: true,
  BANK_STATEMENT: false,
};

export const uploadHelperText: Record<UploadType, string> = {
  RECEIPT: "Upload images or PDFs. We’ll extract vendor, date, and amount to create an expense entry.",
  INVOICE: "Upload PDFs or images. We’ll extract vendor, invoice number, date, amount, and due date.",
  BANK_STATEMENT: "Upload a bank statement (CSV preferred; PDF supported).",
};