import type { CheckPayment, CheckPrintSetting } from "@/lib/api/checks";

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underThousand(value: number) {
  const words: string[] = [];
  let n = value;
  if (n >= 100) {
    words.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    const remainder = n % 10;
    words.push(`${TENS[Math.floor(n / 10)]}${remainder ? `-${ONES[remainder]}` : ""}`);
  } else if (n > 0) {
    words.push(ONES[n]);
  }
  return words.join(" ");
}

export function amountInWords(centsInput: string | number | bigint) {
  const cents = BigInt(centsInput);
  const dollars = cents / 100n;
  const remainder = Number(cents % 100n);
  if (dollars > 999_999_999n) return `${dollars.toString()} and ${String(remainder).padStart(2, "0")}/100 Dollars`;
  if (dollars === 0n) return `Zero and ${String(remainder).padStart(2, "0")}/100 Dollars`;

  const parts: string[] = [];
  let n = Number(dollars);
  const millions = Math.floor(n / 1_000_000);
  if (millions) parts.push(`${underThousand(millions)} Million`);
  n %= 1_000_000;
  const thousands = Math.floor(n / 1_000);
  if (thousands) parts.push(`${underThousand(thousands)} Thousand`);
  n %= 1_000;
  if (n) parts.push(underThousand(n));
  return `${parts.join(" ")} and ${String(remainder).padStart(2, "0")}/100 Dollars`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function usd(centsInput: string | number | bigint) {
  const cents = BigInt(centsInput);
  const dollars = cents / 100n;
  const remainder = cents % 100n;
  return `$${dollars.toLocaleString("en-US")}.${remainder.toString().padStart(2, "0")}`;
}

function voucherRows(check: CheckPayment) {
  const allocations = check.bill_allocations ?? [];
  if (!allocations.length) {
    return `<tr><td colspan="4" class="empty-detail">${escapeHtml(check.vendor_id ? "Payment on account — no invoice allocation" : check.memo || "General payment")}</td></tr>`;
  }
  const visible = allocations.slice(0, 7);
  const rows = visible.map((row) => `<tr>
    <td>${escapeHtml(row.invoice_date || "—")}</td>
    <td>${escapeHtml(row.memo || "Invoice")}</td>
    <td class="money">${escapeHtml(usd(row.bill_amount_cents))}</td>
    <td class="money">${escapeHtml(usd(row.applied_amount_cents))}</td>
  </tr>`).join("");
  return allocations.length > visible.length
    ? `${rows}<tr><td colspan="4" class="empty-detail">+${allocations.length - visible.length} additional bill(s) in Bynkbook</td></tr>`
    : rows;
}

function voucher(check: CheckPayment, businessName: string, recordCopy: boolean) {
  return `<section class="voucher ${recordCopy ? "record" : "payee-copy"}">
    <header>
      <div><strong>${escapeHtml(businessName)}</strong><span>${recordCopy ? "Retain for your records" : "Payee voucher"}</span></div>
      <div class="voucher-meta"><span>Check #${escapeHtml(check.check_number)}</span><span>${escapeHtml(check.issued_date)}</span><strong>${escapeHtml(usd(check.amount_cents))}</strong></div>
    </header>
    <div class="voucher-payee"><span>Payee</span><strong>${escapeHtml(check.payee_name)}</strong></div>
    <table><thead><tr><th>Date</th><th>Invoice / memo</th><th class="money">Bill amount</th><th class="money">Paid</th></tr></thead><tbody>${voucherRows(check)}</tbody></table>
    <footer><span>${escapeHtml(check.memo || "")}</span>${recordCopy ? `<span>${escapeHtml(check.account_name || "Checking account")}${check.category_name ? ` · ${escapeHtml(check.category_name)}` : ""}</span>` : ""}</footer>
  </section>`;
}

export function buildSslt104Html(args: {
  check: CheckPayment;
  businessName: string;
  setting: CheckPrintSetting;
  calibration?: boolean;
}) {
  const { check, businessName, setting, calibration = false } = args;
  const x = Number(setting.offset_x_mils || 0) / 1000;
  const y = Number(setting.offset_y_mils || 0) / 1000;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${calibration ? "SSLT104 alignment test" : `Check ${escapeHtml(check.check_number)}`}</title>
  <style>
    @page { size: letter; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 8.5in; height: 11in; margin: 0; padding: 0; background: #fff; color: #111827; font-family: Arial, Helvetica, sans-serif; }
    .sheet { position: relative; width: 8.5in; height: 11in; overflow: hidden; transform: translate(${x}in, ${y}in); transform-origin: top left; }
    .check { position: relative; height: 3.5in; font-size: 11pt; }
    .date { position: absolute; top: .55in; left: 6.43in; width: 1.25in; text-align: center; }
    .payee { position: absolute; top: 1.27in; left: .72in; width: 5.75in; white-space: nowrap; overflow: hidden; }
    .amount { position: absolute; top: 1.24in; left: 6.75in; width: 1.08in; text-align: right; font-weight: 700; }
    .words { position: absolute; top: 1.72in; left: .55in; width: 7.15in; font-size: 10.5pt; white-space: nowrap; overflow: hidden; }
    .address { position: absolute; top: 2.02in; left: .86in; width: 4.8in; white-space: pre-line; font-size: 9pt; line-height: 1.2; }
    .memo { position: absolute; top: 2.88in; left: .72in; width: 3.2in; font-size: 9.5pt; white-space: nowrap; overflow: hidden; }
    .voucher { height: 3.5in; padding: .28in .48in .18in; border-top: 1px dashed transparent; font-size: 8.5pt; }
    .voucher.record { height: 4in; }
    .voucher header { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: .12in; border-bottom: 1px solid #9ca3af; }
    .voucher header div:first-child { display: flex; flex-direction: column; gap: 3px; }
    .voucher header span { color: #4b5563; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em; }
    .voucher-meta { display: flex; align-items: center; gap: .22in; }
    .voucher-payee { display: flex; gap: .12in; padding: .1in 0; }
    .voucher-payee span { color: #6b7280; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: .055in .06in; border-bottom: 1px solid #d1d5db; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    th { color: #4b5563; font-size: 7.5pt; text-transform: uppercase; }
    th:nth-child(1) { width: 1.05in; } th:nth-child(3), th:nth-child(4) { width: 1.2in; }
    .money { text-align: right; }
    .empty-detail { color: #4b5563; font-style: italic; padding: .14in .06in; }
    .voucher footer { display: flex; justify-content: space-between; gap: .2in; padding-top: .1in; color: #4b5563; }
    .calibration { position: absolute; inset: 0; pointer-events: none; }
    .calibration .line { position: absolute; left: .25in; right: .25in; border-top: 1px dashed #111; }
    .calibration .line.one { top: 3.5in; } .calibration .line.two { top: 7in; }
    .calibration .label { position: absolute; top: .12in; left: .2in; font-size: 8pt; }
    @media screen { body { margin: 20px auto; box-shadow: 0 12px 40px rgba(15, 23, 42, .2); } .voucher { border-color: #cbd5e1; } }
    @media print { .screen-only { display: none !important; } }
  </style></head><body><main class="sheet">
    <section class="check">
      <div class="date">${escapeHtml(check.issued_date)}</div>
      <div class="payee">${escapeHtml(check.payee_name)}</div>
      <div class="amount">${escapeHtml(usd(check.amount_cents))}</div>
      <div class="words">${escapeHtml(amountInWords(check.amount_cents))}</div>
      <div class="address">${escapeHtml(check.payee_address || "")}</div>
      <div class="memo">${escapeHtml(check.memo || "")}</div>
    </section>
    ${voucher(check, businessName, false)}
    ${voucher(check, businessName, true)}
    ${calibration ? `<div class="calibration"><div class="label">Bynkbook SSLT104 alignment test — print at 100% / Actual Size</div><div class="line one"></div><div class="line two"></div></div>` : ""}
  </main></body></html>`;
}

export function reserveSslt104PrintWindow() {
  const win = window.open("", "_blank", "width=950,height=900");
  if (!win) throw new Error("Allow pop-ups to open the check preview.");
  win.opener = null;
  win.document.write("<!doctype html><title>Preparing check…</title><p style='font-family:Arial;padding:32px'>Preparing your check…</p>");
  return win;
}

export function openSslt104PrintWindow(args: Parameters<typeof buildSslt104Html>[0], reservedWindow?: Window | null) {
  const win = reservedWindow ?? reserveSslt104PrintWindow();
  win.document.open();
  win.document.write(buildSslt104Html(args));
  win.document.close();
  window.setTimeout(() => { win.focus(); win.print(); }, 250);
}
