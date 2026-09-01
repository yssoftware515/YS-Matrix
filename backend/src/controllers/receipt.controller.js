'use strict';
// ============================================================
// YS-MATRIX ERP — Receipt Controller (Phase C.1)
//
// Renders an installment-payment receipt as a server-side HTML
// document (printable / PDF-ready), mirroring the invoice print
// flow exactly:
//   • tenant-scoped lookup (findFirst on showroom_id) — a foreign
//     tenant's installment resolves to 404, never to a leak
//   • every dynamic string goes through escapeHtml (shared helper)
//   • numbers through fmtMoney/fmtDate only
//   • per-response nonce + document-scoped CSP (no inline handlers,
//     no unsafe-inline for script-src) — same pattern as the invoice
//   • explicit A4 page geometry via @page
// No token ever reaches the URL: the route sits behind the normal
// auth chain and the frontend fetches it through the authenticated
// axios client (see frontend lib/print.ts).
// ============================================================

const prisma = require('../config/database');
const logger = require('../config/logger');
const { escapeHtml, fmtMoney, fmtDate, newNonce, documentCSP } = require('../utils/html');

const getInstallmentReceiptHTML = async (req, res) => {
  try {
    // Tenant scope: Installment has no showroom_id column — it belongs
    // to a showroom through its sale, so the scope filter rides the
    // relation. findFirst with the sale.showroom_id match: a foreign
    // tenant's installment resolves to null → 404, never to a leak.
    const installment = await prisma.installment.findFirst({
      where: { id: req.params.installment_id, sale: { showroom_id: req.showroomId } },
      include: {
        sale: {
          select: {
            id:             true,
            invoice_number: true,
            sale_type:      true,
            status:         true,
            customer:       { select: { name: true, phone: true } },
            showroom:       { select: { name: true, phone: true, address: true } },
          },
        },
      },
    });

    if (!installment) return res.status(404).send('<h1>Receipt not found</h1>');

    const remainingCount = await prisma.installment.count({
      where: { sale_id: installment.sale.id, is_paid: false },
    });

    const nonce = newNonce();

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>إيصال سداد قسط — ${escapeHtml(installment.sale.invoice_number)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Cairo', sans-serif; background: #f8f9fa; color: #2d3436; direction: rtl; }
    .receipt-wrapper { max-width: 700px; margin: 20px auto; background: white; box-shadow: 0 4px 24px rgba(0,0,0,0.1); border-radius: 12px; overflow: hidden; }

    .header { background: linear-gradient(135deg, #020408 0%, #071220 100%); color: white; padding: 28px 36px; display: flex; justify-content: space-between; align-items: flex-start; }
    .header-brand h1 { font-size: 24px; font-weight: 900; color: #00D4FF; letter-spacing: 4px; text-transform: uppercase; }
    .header-brand p { font-size: 11px; color: #4A7A9B; letter-spacing: 3px; margin-top: 2px; }
    .header-brand .shop-line { margin-top: 10px; font-size: 12px; color: #C8E6F5; line-height: 1.7; }
    .header-title { text-align: left; }
    .header-title .receipt-title { font-size: 20px; font-weight: 700; color: #00FF88; }
    .header-title .receipt-date { font-size: 12px; color: #4A7A9B; margin-top: 4px; }

    .body { padding: 28px 36px; }
    .section { margin-bottom: 24px; }
    .section h3 { font-size: 13px; color: #6c757d; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #f1f3f5; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .info-box { background: #f8f9fa; border-radius: 8px; padding: 16px; border: 1px solid #e9ecef; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px; }
    .info-row span:first-child { color: #6c757d; }
    .info-row span:last-child { font-weight: 600; }

    .amount-box { background: linear-gradient(135deg, #020408 0%, #071220 100%); color: white; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px; }
    .amount-box .amount-label { font-size: 11px; color: #4A7A9B; letter-spacing: 2px; text-transform: uppercase; }
    .amount-box .amount-value { font-size: 34px; font-weight: 900; color: #00FF88; margin-top: 8px; }

    .paid-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; background: rgba(0,255,136,0.15); color: #00b894; border: 1px solid rgba(0,255,136,0.3); }

    .footer { background: #f8f9fa; border-top: 1px solid #e9ecef; padding: 16px 36px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #adb5bd; }

    @media print {
      body { background: white; }
      .receipt-wrapper { box-shadow: none; margin: 0; border-radius: 0; }
      .no-print { display: none; }
    }
    @page { size: A4; margin: 12mm; }
  </style>
</head>
<body>
  <div class="receipt-wrapper">
    <div class="header">
      <div class="header-brand">
        <h1>YS-MATRIX</h1>
        <p>ERP SYSTEM — نظام إدارة المعارض</p>
        <div class="shop-line">
          <div>${escapeHtml(installment.sale.showroom.name)}</div>
          ${installment.sale.showroom.phone ? `<div>${escapeHtml(installment.sale.showroom.phone)}</div>` : ''}
          ${installment.sale.showroom.address ? `<div>${escapeHtml(installment.sale.showroom.address)}</div>` : ''}
        </div>
      </div>
      <div class="header-title">
        <div class="receipt-title">إيصال سداد قسط</div>
        <div class="receipt-date">${installment.paid_at ? fmtDate(installment.paid_at) : fmtDate(new Date())}</div>
      </div>
    </div>

    <div class="body">
      <div class="amount-box">
        <div class="amount-label">مبلغ القسط</div>
        <div class="amount-value">${fmtMoney(installment.amount)}</div>
      </div>

      <div class="section">
        <h3>بيانات السداد</h3>
        <div class="info-grid">
          <div class="info-box">
            <div class="info-row"><span>رقم الفاتورة</span><span>${escapeHtml(installment.sale.invoice_number)}</span></div>
            <div class="info-row"><span>تاريخ استحقاق القسط</span><span>${fmtDate(installment.due_date)}</span></div>
            <div class="info-row"><span>تاريخ السداد</span><span>${installment.paid_at ? fmtDate(installment.paid_at) : '—'}</span></div>
            <div class="info-row"><span>الحالة</span><span class="paid-badge">✓ مدفوع</span></div>
          </div>
          <div class="info-box">
            <div class="info-row"><span>اسم العميل</span><span>${escapeHtml(installment.sale.customer?.name || 'بدون عميل')}</span></div>
            ${installment.sale.customer?.phone ? `<div class="info-row"><span>هاتف العميل</span><span>${escapeHtml(installment.sale.customer.phone)}</span></div>` : ''}
            <div class="info-row"><span>الأقساط المتبقية</span><span>${remainingCount}</span></div>
          </div>
        </div>
      </div>

      ${installment.note && installment.note !== 'SALE_CANCELLED' ? `
      <div class="section">
        <h3>ملاحظة</h3>
        <p style="font-size:13px;color:#6c757d;padding:12px;background:#f8f9fa;border-radius:8px">${escapeHtml(installment.note)}</p>
      </div>` : ''}
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
    logger.error('Receipt HTML error:', err);
    res.status(500).send('<h1>Error generating receipt</h1>');
  }
};

module.exports = { getInstallmentReceiptHTML };