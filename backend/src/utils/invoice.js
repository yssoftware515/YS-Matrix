// ============================================================
// YS-MATRIX ERP - Invoice Number Generator
// Author: Yahya Al-Sulami 🦅
// v1.2 — FIX: Race condition using PostgreSQL advisory locks
//         بدل SELECT MAX() + 1 اللي بيتكرر في concurrent requests
// v1.3 — Phase C.2 (STK-1 concurrency): the advisory lock used to
//         cover ONLY the counter read — the sale row was created in a
//         LATER, separate transaction. Two concurrent createSale calls
//         could therefore both read the same last-seq inside their own
//         serialized lock windows, then both create the same invoice
//         number → unique-constraint 500 (reproduced by the C.2
//         concurrency tests). The lock must cover the ROW CREATION
//         too, so generateInvoiceNumber now accepts an open
//         transaction (`client`) and runs inline inside it; createSale
//         calls it as the FIRST step of its own $transaction. When no
//         client is passed, the old standalone behavior (own
//         baseClient transaction) is preserved for other callers.
// ============================================================

const { baseClient: db } = require('../config/database');

// ─────────────────────────────────────────────────────────────
// generateInvoiceNumber
//
// FORMAT: INV-{SHOWROOM_SHORT}-{YEAR}-{SEQ:05d}
// مثال:   INV-ALN-2026-00042
//
// الـ advisory lock بيضمن إن request واحد بس يقدر يولد
// رقم في نفس الوقت لنفس المعرض — zero race condition.
// ─────────────────────────────────────────────────────────────
const generateInvoiceNumber = async (showroomId, client = null) => {
  // حوّل الـ showroomId لـ integer للـ advisory lock
  // pg_try_advisory_lock بياخد bigint
  const lockId = BigInt(
    showroomId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  );

  const run = async (db) => {
    // 1. اقفل على مستوى الـ showroom — transaction-scoped, so the
    //    lock lives exactly as long as the caller's transaction.
    await db.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock($1)`, Number(lockId)
    );

    // 2. احسب آخر رقم لهذا المعرض في السنة الحالية
    const year = new Date().getFullYear();
    const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
    const yearEnd   = new Date(`${year + 1}-01-01T00:00:00.000Z`);

    const lastSale = await db.sale.findFirst({
      where: {
        showroom_id:    showroomId,
        invoice_number: { startsWith: `INV-` },
        created_at:     { gte: yearStart, lt: yearEnd },
      },
      orderBy: { created_at: 'desc' },
      select:  { invoice_number: true },
    });

    // 3. استخرج آخر sequence number
    let seq = 1;
    if (lastSale?.invoice_number) {
      const parts = lastSale.invoice_number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1]);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }

    // 4. جيب اختصار المعرض (أول 3 حروف من الـ slug)
    const showroom = await db.showroom.findUnique({
      where:  { id: showroomId },
      select: { slug: true },
    });
    const shortCode = (showroom?.slug || 'SHW')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3);

    // 5. ولّد الرقم النهائي
    return `INV-${shortCode}-${year}-${String(seq).padStart(5, '0')}`;
  };

  // When an open transaction is supplied, run INSIDE it (the caller's
  // lock window then covers its row creation too). Otherwise preserve
  // the standalone behavior with the generator's own transaction.
  if (client) return run(client);
  return db.$transaction((tx) => run(tx));
};

module.exports = { generateInvoiceNumber };
