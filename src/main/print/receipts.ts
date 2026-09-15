/**
 * Print templates — receipt (57mm/80mm thermal) and A4 invoice.
 *
 * Templates are rendered in the MAIN process from domain data (never from
 * renderer-side state), so a printed document always matches the record.
 * Money uses the shared BDT formatter (৳ 1,250.00), dates use local-time
 * Bangla formatting.
 */
import { formatBdt, type Paise } from '../../shared/money';
import { formatDateTimeBn, toBanglaDigits } from '../../shared/dates';
import { paymentMethodLabel } from '../../shared/payments';
import type { DB } from '../../domain/db/connection';
import { getSale } from '../../domain/services/saleService';
import { getBusiness } from '../../domain/services/setupService';
import { getSetting } from '../../domain/repos/settings';
import { NotFoundError } from '../../domain/errors';

interface SaleDoc {
  id: string;
  business_id: string;
  reference_no: string;
  date: number;
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  paid_paise: number;
  due_paise: number;
  status: string;
  note: string;
  customer_name?: string | null;
  user_name?: string | null;
  items: {
    product_name_snapshot: string;
    quantity: number;
    unit_price_paise: number;
    discount_paise: number;
    line_total_paise: number;
  }[];
  payments: { amount_paise: number; payment_method: string }[];
}

function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadSale(db: DB, saleId: string): SaleDoc {
  const sale = getSale(db, saleId) as unknown as SaleDoc | undefined;
  if (!sale) throw new NotFoundError('সেলে', saleId);
  return sale;
}

interface BusinessInfo {
  name: string;
  owner_name: string;
  phone: string;
  address: string;
}

function businessInfo(db: DB, businessId: string): BusinessInfo {
  const b = getBusiness(db, businessId) as unknown as BusinessInfo | undefined;
  if (!b) throw new NotFoundError('ব্যবসা', businessId);
  return b;
}

/* ---------------- thermal receipt ---------------- */

export function receiptHtml(db: DB, saleId: string, paper: '57mm' | '80mm' | 'A4' = '80mm'): string {
  const sale = loadSale(db, saleId);
  const biz = businessInfo(db, sale.business_id);
  const footer = getSetting<string>(db, sale.business_id, 'invoice', 'footer', 'ধন্যবাদ! আবার আসবেন।');
  const widthMm = paper === '57mm' ? 57 : paper === 'A4' ? 210 : 80;
  const fontPx = paper === '57mm' ? 10.5 : paper === 'A4' ? 12 : 11.5;

  const rows = sale.items
    .map(
      (i) => `
      <tr>
        <td class="name">${escapeHtml(i.product_name_snapshot)}</td>
        <td class="num">${toBanglaDigits(String(i.quantity))}</td>
        <td class="num">${formatBdt(i.unit_price_paise as Paise)}</td>
        <td class="num total">${formatBdt(i.line_total_paise as Paise)}</td>
      </tr>`
    )
    .join('');

  const payments = sale.payments.length
    ? sale.payments
        .map((p) => `<div class="pay"><span>${escapeHtml(paymentMethodLabel(p.payment_method))}</span><span>${formatBdt(p.amount_paise as Paise)}</span></div>`)
        .join('')
    : '<div class="pay"><span>বকেয়া</span><span>—</span></div>';

  const statusLine =
    sale.status === 'voided' ? '<div class="void">বিলগা করা হয়েছে</div>' : '';

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    width: ${widthMm}mm; margin: 0; padding: 3mm 2mm;
    font-family: "Nirmala UI", "Noto Sans Bengali", "Segoe UI", sans-serif;
    font-size: ${fontPx}px; color: #1c2430; line-height: 1.45;
  }
  .center { text-align: center; }
  h1 { font-size: ${fontPx * 1.35}px; margin: 0 0 1mm; font-weight: 700; }
  .sub { margin: 0 0 0.5mm; color: #46536b; font-size: ${fontPx * 0.92}px; }
  hr { border: none; border-top: 1px dashed #9aa7bd; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: ${fontPx * 0.85}px; color: #46536b; font-weight: 600; padding: 0 0 1mm; }
  td { padding: 0.8mm 0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .total { font-weight: 600; }
  .line { display: flex; justify-content: space-between; margin: 1mm 0; }
  .line .label { color: #46536b; }
  .grand { font-size: ${fontPx * 1.2}px; font-weight: 700; margin-top: 1mm; }
  .pay { display: flex; justify-content: space-between; margin: 0.5mm 0; font-size: ${fontPx * 0.92}px; }
  .void {
    margin-top: 2mm; padding: 1.5mm; border: 1.5px solid #b3261e; color: #b3261e;
    text-align: center; font-weight: 700; font-size: ${fontPx * 1.1}px;
  }
  .footer { margin-top: 2mm; color: #46536b; }
</style></head><body>
  <div class="center">
    <h1>${escapeHtml(biz.name)}</h1>
    ${biz.address ? `<div class="sub">${escapeHtml(biz.address)}</div>` : ''}
    ${biz.phone ? `<div class="sub">ফোন: ${escapeHtml(biz.phone)}</div>` : ''}
  </div>
  <hr>
  <div class="line"><span class="label">বিল নং</span><span>${escapeHtml(sale.reference_no)}</span></div>
  <div class="line"><span class="label">তারিখ</span><span>${escapeHtml(formatDateTimeBn(sale.date))}</span></div>
  ${sale.customer_name ? `<div class="line"><span class="label">কাস্টমার</span><span>${escapeHtml(sale.customer_name)}</span></div>` : ''}
  ${sale.user_name ? `<div class="line"><span class="label">ক্যাশিয়ার</span><span>${escapeHtml(sale.user_name)}</span></div>` : ''}
  <hr>
  <table>
    <thead><tr><th>পণ্য</th><th class="num">পরিমাণ</th><th class="num">দাম</th><th class="num">মোট</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr>
  <div class="line"><span class="label">সাবটোটাল</span><span>${formatBdt(sale.subtotal_paise as Paise)}</span></div>
  ${sale.discount_paise ? `<div class="line"><span class="label">ছাড়</span><span>− ${formatBdt(sale.discount_paise as Paise)}</span></div>` : ''}
  ${sale.tax_paise ? `<div class="line"><span class="label">কর</span><span>${formatBdt(sale.tax_paise as Paise)}</span></div>` : ''}
  <div class="line grand"><span class="label">সর্বমোট</span><span>${formatBdt(sale.total_paise as Paise)}</span></div>
  <div class="line"><span class="label">প্রদত্ত</span><span>${formatBdt(sale.paid_paise as Paise)}</span></div>
  ${sale.due_paise ? `<div class="line"><span class="label">বকেয়া</span><span>${formatBdt(sale.due_paise as Paise)}</span></div>` : ''}
  <hr>
  ${payments}
  ${statusLine}
  <hr>
  <div class="center footer">${escapeHtml(footer)}</div>
</body></html>`;
}

/* ---------------- A4 invoice ---------------- */

export function invoiceHtml(db: DB, saleId: string): string {
  const sale = loadSale(db, saleId);
  const biz = businessInfo(db, sale.business_id);
  const footer = getSetting<string>(db, sale.business_id, 'invoice', 'footer', 'ধন্যবাদ! আবার আসবেন।');

  const rows = sale.items
    .map(
      (i, idx) => `
      <tr>
        <td>${toBanglaDigits(String(idx + 1))}</td>
        <td>${escapeHtml(i.product_name_snapshot)}</td>
        <td class="num">${toBanglaDigits(String(i.quantity))}</td>
        <td class="num">${formatBdt(i.unit_price_paise as Paise)}</td>
        ${i.discount_paise ? `<td class="num">− ${formatBdt(i.discount_paise as Paise)}</td>` : '<td class="num">—</td>'}
        <td class="num strong">${formatBdt(i.line_total_paise as Paise)}</td>
      </tr>`
    )
    .join('');

  const payments = sale.payments.length
    ? sale.payments
        .map((p) => `<div class="payrow"><span>${escapeHtml(paymentMethodLabel(p.payment_method))}</span><span>${formatBdt(p.amount_paise as Paise)}</span></div>`)
        .join('')
    : '';

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Nirmala UI", "Noto Sans Bengali", "Segoe UI", sans-serif; color: #1c2430; font-size: 12.5px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { font-size: 22px; margin: 0; font-weight: 700; color: #0f7a5c; }
  .meta { color: #46536b; font-size: 12px; margin-top: 4px; line-height: 1.5; }
  .title { font-size: 26px; font-weight: 700; letter-spacing: 1px; color: #1c2430; }
  .no { font-size: 14px; color: #46536b; margin-top: 2px; }
  .box { display: flex; justify-content: space-between; margin: 14px 0; }
  .box .card { background: #f4f7f5; border-radius: 10px; padding: 10px 14px; min-width: 220px; }
  .box .label { font-size: 11px; color: #46536b; text-transform: uppercase; letter-spacing: .4px; }
  .box .value { font-size: 14px; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 11.5px; color: #46536b; border-bottom: 2px solid #0f7a5c; padding: 6px 8px; }
  td { padding: 7px 8px; border-bottom: 1px solid #e3e9e6; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  .strong { font-weight: 600; }
  .totals { margin-top: 12px; margin-left: auto; width: 280px; }
  .tline { display: flex; justify-content: space-between; padding: 4px 0; }
  .tline .label { color: #46536b; }
  .tline.grand { font-size: 16px; font-weight: 700; border-top: 2px solid #0f7a5c; margin-top: 4px; padding-top: 8px; }
  .payrow { display: flex; justify-content: space-between; padding: 3px 0; }
  .stamp {
    margin-top: 18px; display: inline-block; border: 2px solid ${sale.status === 'voided' ? '#b3261e' : '#0f7a5c'};
    color: ${sale.status === 'voided' ? '#b3261e' : '#0f7a5c'}; border-radius: 8px; padding: 6px 18px;
    font-weight: 700; font-size: 13px; transform: rotate(-3deg);
  }
  .footer { margin-top: 26px; color: #46536b; text-align: center; font-size: 12px; }
  .sig { display: flex; justify-content: space-between; margin-top: 40px; font-size: 12px; color: #46536b; }
  .sig .line { border-top: 1px solid #9aa7bd; width: 180px; padding-top: 4px; text-align: center; }
</style></head><body>
  <div class="head">
    <div>
      <h1>${escapeHtml(biz.name)}</h1>
      ${biz.address ? `<div class="meta">${escapeHtml(biz.address)}</div>` : ''}
      ${biz.phone ? `<div class="meta">ফোন: ${escapeHtml(biz.phone)}</div>` : ''}
      ${biz.owner_name ? `<div class="meta">মালিক: ${escapeHtml(biz.owner_name)}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div class="title">ইনভয়েস</div>
      <div class="no">নং ${escapeHtml(sale.reference_no)}</div>
      <div class="meta">${escapeHtml(formatDateTimeBn(sale.date))}</div>
    </div>
  </div>
  <div class="box">
    <div class="card">
      <div class="label">কাস্টমার</div>
      <div class="value">${escapeHtml(sale.customer_name ?? 'হেঁচারি কাস্টমার')}</div>
    </div>
    <div class="card">
      <div class="label">ক্যাশিয়ার</div>
      <div class="value">${escapeHtml(sale.user_name ?? '—')}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr><th>নং</th><th>পণ্য</th><th class="num">পরিমাণ</th><th class="num">দাম</th><th class="num">ছাড়</th><th class="num">মোট</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="tline"><span class="label">সাবটোটাল</span><span>${formatBdt(sale.subtotal_paise as Paise)}</span></div>
    ${sale.discount_paise ? `<div class="tline"><span class="label">মোট ছাড়</span><span>− ${formatBdt(sale.discount_paise as Paise)}</span></div>` : ''}
    ${sale.tax_paise ? `<div class="tline"><span class="label">কর</span><span>${formatBdt(sale.tax_paise as Paise)}</span></div>` : ''}
    <div class="tline grand"><span class="label">সর্বমোট</span><span>${formatBdt(sale.total_paise as Paise)}</span></div>
    <div class="tline"><span class="label">প্রদত্ত</span><span>${formatBdt(sale.paid_paise as Paise)}</span></div>
    ${sale.due_paise ? `<div class="tline"><span class="label">বকেয়া</span><span>${formatBdt(sale.due_paise as Paise)}</span></div>` : ''}
  </div>
  ${payments ? `<div style="margin-top:10px">${payments}</div>` : ''}
  ${sale.status === 'voided' ? '<div class="stamp">বিলগা</div>' : ''}
  ${sale.note ? `<div class="meta" style="margin-top:10px">নোট: ${escapeHtml(sale.note)}</div>` : ''}
  <div class="sig">
    <div class="line">স্বাক্ষর (ক্যাশিয়ার)</div>
    <div class="line">স্বাক্ষর (মালিক)</div>
  </div>
  <div class="footer">${escapeHtml(footer)}</div>
</body></html>`;
}
