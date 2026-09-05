// ============================================================
// YS-MATRIX ERP - Invoice Controller
// YS Systems & Software
// Generates HTML invoices (printable / PDF-ready)
// ============================================================

const prisma = require('../config/database');
const response = require('../utils/response');
const logger = require('../config/logger');
// Phase C.1: escaping/formatting/CSP helpers moved to the shared
// utils/html.js — used by BOTH this controller and the new receipt
// controller, so the security-critical logic lives in exactly one place.
const { escapeHtml, fmtMoney, fmtDate, newNonce, documentCSP, errorPage } = require('../utils/html');

// ─────────────────────────────────────────
// GET INVOICE DATA (JSON)
// ─────────────────────────────────────────
const getInvoice = async (req, res) => {
  try {
    const sale = await prisma.sale.findFirst({
      where: { id: req.params.id, showroom_id: req.showroomId },
      include: {
        customer: { select: { name: true, phone: true, national_id: true, address: true } },
        user: { select: { id: true, name: true } },
        showroom: { select: { id: true, name: true, phone: true, address: true, email: true } },
        items: {
          select: {
            quantity: true, unit_price: true, total_price: true, profit: true,
            inventory: {
              select: {
                brand: true, model: true, vehicle_type: true,
                color: true, engine_cc: true,
                chassis_number: true, engine_number: true,
              },
            },
          },
        },
        installments: {
          select: { due_date: true, amount: true, is_paid: true },
          orderBy: { due_date: 'asc' },
        },
      },
    });

    if (!sale) return response.notFound(res, 'Sale not found');
    return response.success(res, sale);
  } catch (err) {
    logger.error('Get invoice error:', err);
    return response.error(res, 'Failed to fetch invoice');
  }
};

// ─────────────────────────────────────────
// GET INVOICE HTML (printable)
// ─────────────────────────────────────────
const getInvoiceHTML = async (req, res) => {
  try {
    const sale = await prisma.sale.findFirst({
      where: { id: req.params.id, showroom_id: req.showroomId },
      include: {
        customer: { select: { name: true, phone: true, national_id: true, address: true } },
        user: { select: { name: true } },
        showroom: { select: { name: true, phone: true, address: true, email: true } },
        items: {
          select: {
            quantity: true, unit_price: true, total_price: true,
            inventory: {
              select: { brand: true, model: true, vehicle_type: true, color: true, engine_cc: true, chassis_number: true, engine_number: true },
            },
          },
        },
        installments: {
          select: { due_date: true, amount: true, is_paid: true },
          orderBy: { due_date: 'asc' },
        },
      },
    });

    if (!sale) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(errorPage(404, 'الفاتورة غير موجودة'));
    }

    const vehicleTypeAR = {
      MOTORCYCLE: 'دراجة نارية', CAR: 'سيارة', TUKTUK: 'توك توك',
      TRICYCLE: 'ثلاثية العجلات', SPARE_PART: 'قطعة غيار', OTHER: 'أخرى',
    };

    // Phase A (P1-3) + Phase C.1: escapeHtml/fmtMoney/fmtDate are the
    // shared helpers from utils/html.js. Every dynamic string
    // interpolated into the template is escaped (customer/showroom/
    // user/sale fields are free-text from tenant users — a `<script>`/
    // event-handler payload must render as inert text, never executable
    // markup); numeric values go through fmtMoney/fmtDate only and need
    // no escaping. Preserves Arabic text.

    // Phase C.1 (snapshot correctness): prefer the immutable v1.1
    // SaleItem snapshot (chassis/color captured at sale time) over the
    // live inventory row, so a historic invoice always prints the
    // identity the customer actually bought — even if the inventory
    // record was later modified.
    const itemsHTML = sale.items.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(item.vehicle_model || `${item.inventory?.brand || ''} ${item.inventory?.model || ''}`.trim())}</td>
        <td>${vehicleTypeAR[item.inventory?.vehicle_type] || ''}</td>
        <td>${escapeHtml(item.color || item.inventory?.color || '—')}</td>
        <td>${escapeHtml(item.chassis_number || item.inventory?.chassis_number || '—')}</td>
        <td>${escapeHtml(item.engine_number || item.inventory?.engine_number || '—')}</td>
        <td style="text-align:center">${item.quantity}</td>
        <td>${fmtMoney(item.unit_price)}</td>
        <td style="font-weight:700;color:#00b894">${fmtMoney(item.total_price)}</td>
      </tr>
    `).join('');

    const installmentsHTML = sale.installments.length > 0 ? `
      <div class="section">
        <h3>جدول الأقساط</h3>
        <table>
          <thead><tr><th>#</th><th>تاريخ الاستحقاق</th><th>المبلغ</th><th>الحالة</th></tr></thead>
          <tbody>
            ${sale.installments.map((inst, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${fmtDate(inst.due_date)}</td>
                <td>${fmtMoney(inst.amount)}</td>
                <td style="color:${inst.is_paid ? '#00b894' : '#e17055'}">${inst.is_paid ? '✓ مدفوع' : '○ معلق'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '';

    // Phase B.3 (F4): CSP-safe print. Helmet's production CSP
    // (script-src 'self') blocks inline event handlers, so the legacy
    // onclick="window.print()" button silently stopped working in
    // production. A per-response nonce keeps the single print call
    // functional WITHOUT weakening the global policy: this header only
    // applies to this invoice document, and the nonce is random per
    // request. style-src keeps 'unsafe-inline' (inline <style> block +
    // style attributes are static template content, not user data) and
    // https: for the Google Fonts import.
    const nonce = newNonce();

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>فاتورة ${escapeHtml(sale.invoice_number)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Cairo', sans-serif; background: #f8f9fa; color: #2d3436; direction: rtl; }
    .invoice-wrapper { max-width: 900px; margin: 20px auto; background: white; box-shadow: 0 4px 24px rgba(0,0,0,0.1); border-radius: 12px; overflow: hidden; }

    /* Header */
    .header { background: linear-gradient(135deg, #020408 0%, #071220 100%); color: white; padding: 32px 40px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header-brand h1 { font-size: 28px; font-weight: 900; color: #00D4FF; letter-spacing: 4px; text-transform: uppercase; }
    .header-brand p { font-size: 11px; color: #4A7A9B; letter-spacing: 3px; margin-top: 2px; }
    .header-invoice { text-align: left; }
    .header-invoice .inv-number { font-size: 22px; font-weight: 700; color: #00FF88; }
    .header-invoice .inv-date { font-size: 12px; color: #4A7A9B; margin-top: 4px; }
    .type-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-top: 8px; }
    .type-cash { background: rgba(0,255,136,0.15); color: #00FF88; border: 1px solid rgba(0,255,136,0.3); }
    .type-installment { background: rgba(155,93,229,0.15); color: #9B5DE5; border: 1px solid rgba(155,93,229,0.3); }

    /* Body */
    .body { padding: 32px 40px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
    .info-box { background: #f8f9fa; border-radius: 8px; padding: 16px; border: 1px solid #e9ecef; }
    .info-box h3 { font-size: 11px; color: #6c757d; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px; }
    .info-row span:first-child { color: #6c757d; }
    .info-row span:last-child { font-weight: 600; }

    /* Table */
    .section { margin-bottom: 28px; }
    .section h3 { font-size: 13px; color: #6c757d; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #f1f3f5; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead { background: #020408; color: white; }
    thead th { padding: 10px 12px; text-align: right; font-weight: 600; font-size: 11px; letter-spacing: 1px; }
    tbody tr { border-bottom: 1px solid #f1f3f5; transition: background 0.15s; }
    tbody tr:hover { background: #f8f9fa; }
    tbody td { padding: 10px 12px; }

    /* Totals */
    .totals { background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 28px; max-width: 320px; margin-right: auto; }
    .total-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
    .total-row span:first-child { color: #6c757d; }
    .total-final { border-top: 2px solid #2d3436; padding-top: 10px; margin-top: 10px; font-size: 16px; font-weight: 900; }
    .total-final span:last-child { color: #00b894; }

    /* Footer */
    .footer { background: #f8f9fa; border-top: 1px solid #e9ecef; padding: 20px 40px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #adb5bd; }
    .status-active { color: #00b894; }
    .status-cancelled { color: #e17055; }
    .status-completed { color: #00b894; font-weight: 700; }

    @media print {
      body { background: white; }
      .invoice-wrapper { box-shadow: none; margin: 0; border-radius: 0; }
      .no-print { display: none; }
    }

    /* Phase C.1: explicit A4 page geometry — the browser default was
       relied on before; declaring it makes pagination deterministic. */
    @page { size: A4; margin: 12mm; }
  </style>
</head>
<body>
  <div class="invoice-wrapper">
    <div class="header">
      <div class="header-brand">
        <h1>YS-MATRIX</h1>
        <p>ERP SYSTEM — نظام إدارة المعارض</p>
        <div style="margin-top:12px;font-size:12px;color:#C8E6F5">
          <div>${escapeHtml(sale.showroom.name)}</div>
          ${sale.showroom.phone ? `<div>${escapeHtml(sale.showroom.phone)}</div>` : ''}
          ${sale.showroom.address ? `<div>${escapeHtml(sale.showroom.address)}</div>` : ''}
        </div>
      </div>
      <div class="header-invoice">
        <div class="inv-number">${escapeHtml(sale.invoice_number)}</div>
        <div class="inv-date">${fmtDate(sale.sold_at)}</div>
        <div class="${sale.sale_type === 'CASH' ? 'type-badge type-cash' : 'type-badge type-installment'}">
          ${sale.sale_type === 'CASH' ? '✓ نقدي' : '⟳ تقسيط'}
        </div>
        <div style="margin-top:8px;font-size:11px;color:${sale.status === 'CANCELLED' ? '#FF2D55' : sale.status === 'COMPLETED' ? '#00FF88' : '#4A7A9B'}">
          ${sale.status === 'ACTIVE' ? 'نشط' : sale.status === 'COMPLETED' ? 'مكتمل ✓' : 'ملغى ✗'}
        </div>
      </div>
    </div>

    <div class="body">
      <div class="info-grid">
        <div class="info-box">
          <h3>بيانات العميل</h3>
          <div class="info-row"><span>الاسم</span><span>${escapeHtml(sale.customer?.name || 'بدون عميل')}</span></div>
          ${sale.customer?.phone ? `<div class="info-row"><span>الهاتف</span><span>${escapeHtml(sale.customer.phone)}</span></div>` : ''}
          ${sale.customer?.national_id ? `<div class="info-row"><span>الهوية</span><span>${escapeHtml(sale.customer.national_id)}</span></div>` : ''}
          ${sale.customer?.address ? `<div class="info-row"><span>العنوان</span><span>${escapeHtml(sale.customer.address)}</span></div>` : ''}
        </div>
        <div class="info-box">
          <h3>بيانات الفاتورة</h3>
          <div class="info-row"><span>رقم الفاتورة</span><span>${escapeHtml(sale.invoice_number)}</span></div>
          <div class="info-row"><span>التاريخ</span><span>${fmtDate(sale.sold_at)}</span></div>
          <div class="info-row"><span>الموظف</span><span>${escapeHtml(sale.user?.name || '—')}</span></div>
          <div class="info-row"><span>نوع البيع</span><span>${sale.sale_type === 'CASH' ? 'نقدي' : 'تقسيط'}</span></div>
          ${sale.sale_type === 'INSTALLMENT' ? `
          <div class="info-row"><span>الدفعة الأولى</span><span>${fmtMoney(sale.down_payment)}</span></div>
          <div class="info-row"><span>القسط الشهري</span><span>${fmtMoney(sale.monthly_amount)}</span></div>
          <div class="info-row"><span>عدد الأشهر</span><span>${sale.installment_months} شهر</span></div>
          ` : ''}
        </div>
      </div>

      <div class="section">
        <h3>المنتجات المباعة</h3>
        <table>
          <thead>
            <tr>
              <th>#</th><th>المنتج</th><th>النوع</th><th>اللون</th>
              <th>رقم الهيكل</th><th>رقم المحرك</th><th style="text-align:center">الكمية</th>
              <th>سعر الوحدة</th><th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>${itemsHTML}</tbody>
        </table>
      </div>

      <div class="totals">
        <div class="total-row"><span>المجموع الفرعي:</span><span>${fmtMoney(sale.subtotal)}</span></div>
        ${parseFloat(sale.discount) > 0 ? `<div class="total-row"><span>الخصم:</span><span style="color:#e17055">- ${fmtMoney(sale.discount)}</span></div>` : ''}
        <div class="total-row total-final"><span>الإجمالي:</span><span>${fmtMoney(sale.total)}</span></div>
      </div>

      ${installmentsHTML}

      ${sale.notes ? `<div class="section"><h3>ملاحظات</h3><p style="font-size:13px;color:#6c757d;padding:12px;background:#f8f9fa;border-radius:8px">${escapeHtml(sale.notes)}</p></div>` : ''}
    </div>

    <div class="footer">
      <div>YS-MATRIX ERP © ${new Date().getFullYear()} — Powered by YS Systems &amp; Software</div>
      <div style="display:flex;gap:16px;align-items:center">
        <button id="printBtn" class="no-print" style="background:#020408;color:#00D4FF;border:1px solid #00D4FF;padding:8px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px">
          🖨 طباعة
        </button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    document.getElementById('printBtn').addEventListener('click', function () { window.print(); });
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', documentCSP(nonce));
    res.send(html);
  } catch (err) {
    logger.error('Invoice HTML error:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(errorPage(500, 'خطأ في إنشاء الفاتورة'));
  }
};

module.exports = { getInvoice, getInvoiceHTML };
