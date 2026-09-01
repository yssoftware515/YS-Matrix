# YS-MATRIX ERP — Business & Strategy Document

---

## EXECUTIVE SUMMARY

YS-MATRIX ERP is a full-stack, multi-tenant SaaS platform purpose-built for vehicle dealerships in the Arabic-speaking world. It provides end-to-end management of inventory, sales (cash and installment), customers, suppliers, expenses, installments, and business analytics — all wrapped in a premium cyberpunk-inspired interface. The system supports multi-branch operations (showrooms) under a single SuperAdmin, with role-based access control, comprehensive audit logging, and automated notifications.

Currently in active development (v2.0.0), the system is deployed in production on Vercel + Neon PostgreSQL, serving real dealerships.

---

## BUSINESS VISION

To become the dominant ERP platform for vehicle dealerships across the Middle East and North Africa, starting with the Yemeni and Saudi markets. The vision is to digitize and professionalize dealership operations — replacing paper-based or fragmented digital tools with a unified, real-time, mobile-friendly, and visually premium management system.

---

## BUSINESS VALUE PROPOSITION

**"One system. One dashboard. Complete dealership control."**

YS-MATRIX ERP eliminates the chaos of managing a vehicle dealership through scattered Excel sheets, sticky notes, and WhatsApp messages. It provides:

1. **Real-time inventory visibility** — Know exactly what's in stock, what's sold, what's low, and where every vehicle is.
2. **Frictionless sales processing** — Create cash or installment sales in seconds, with automatic installment schedule generation.
3. **Automated financial tracking** — Profit calculations, expense tracking, supplier balances, and installment follow-ups — all computed automatically.
4. **Data-driven decisions** — 14+ KPI widgets, revenue charts, profit breakdowns, top-selling items, and monthly comparisons.
5. **Operational control** — Role-based access ensures only authorized staff can modify or delete data.
6. **Never miss a payment** — Automated installment overdue detection and license expiry warnings via in-app notifications.
7. **Full audit trail** — Every action is logged. Know who did what and when.
8. **Multi-branch from day one** — Built as a multi-tenant system, ready for dealership chains.

---

## TARGET CUSTOMERS

| Persona | Description | Pain Points | Value to Them |
|---------|-------------|-------------|---------------|
| **Small Vehicle Dealer** | Owner-operator with 1-2 employees, selling cars/motorcycles | Paper records, lost customer data, can't track expenses vs profit | One dashboard for entire business, instant profit visibility |
| **Growing Dealership Chain** | 3-10 showrooms, multiple sales teams | Can't consolidate data across branches, no unified reporting | Multi-tenant architecture, cross-branch visibility for owner |
| **Installment-Based Dealer** | High percentage of installment sales | Manual payment tracking, missed payments, no overdue alerts | Automated installment schedules, overdue detection, payment tracking |
| **Spare Parts Trader** | Import and sell vehicle spare parts | Inventory chaos, supplier debt tracking, low stock surprises | Barcode-ready (part_number), supplier balance tracking, low stock alerts |
| **Fleet Operator** | Manages fleet of vehicles for transport | Vehicle lifecycle tracking, expense per vehicle | Inventory management + expense tracking + profit analysis |
| **SuperAdmin / Franchisor** | Manages multiple independent dealerships | No visibility into franchisee operations, can't enforce standards | SuperAdmin panel with cross-showroom KPIs, impersonation, subscription/license management |

---

## INDUSTRIES SERVED

1. **Car Dealerships** — New and used car sales (CASH and INSTALLMENT)
2. **Motorcycle Dealerships** — Motorcycle sales with varied models/brands
3. **TukTuk / Tricycle Dealers** — Three-wheeler vehicle sales (common in Yemen, Egypt, South Asia)
4. **Spare Parts Importers & Traders** — Barcode-ready parts inventory, supplier tracking
5. **Multi-Branch Dealership Groups** — Unified management across locations
6. **Vehicle Fleet Operators** — Vehicle lifecycle management (future expansion)

---

## COMPETITIVE ADVANTAGES

| Advantage | Detail | Competitor Weakness |
|-----------|--------|-------------------|
| **Arabic-first (RTL)** | Full RTL support, Arabic labels, Arabic error messages | Most ERP systems are English-first with poor Arabic support |
| **Cyberpunk Matrix UI** | Premium dark theme with neon accents, glass panels, animations | Competitors look dated and "enterprise-boring" |
| **Installment-native** | Built for the installment culture prevalent in MENA markets | Most systems treat installment as an afterthought |
| **Multi-tenant from day one** | No expensive re-architecture needed for multi-branch | Many competitors started single-tenant and struggle with multi-branch |
| **Soft delete everywhere** | Full restore capability for inventory, customers, suppliers | Some systems hard-delete, causing data loss |
| **Audit log on every action** | Complete traceability without performance cost | Many competitors lack detailed audit trails |
| **Free-tier ready pricing** | Cost-effective for small dealers | Competitors are expensive for small businesses |
| **Modern tech stack** | Node.js + React + Next.js + TypeScript | Many competitors run on legacy PHP/Java stacks |
| **Mobile-responsive** | Works on phones (PWA manifest ready) | Some competitors are desktop-only |
| **SuperAdmin impersonation** | Remotely troubleshoot without sharing passwords | Unique feature for SaaS support |

---

## UNIQUE SELLING POINTS

1. **"السيستم اللي يفهمك"** — The system that understands you (Arabic-first)
2. **Premium Matrix design** — Not your grandfather's ERP
3. **Installment management built-in** — Not an add-on, not a plugin
4. **30-second sale creation** — Inventory picker, customer picker, one-click sale
5. **Automatic installment schedule** — Enter down payment + monthly amount, system generates the rest
6. **Supplier balance tracking** — Know exactly what you owe vs what you've paid
7. **Low stock alerts** — Never run out of hot-selling items
8. **License management** — For SaaS operators, enforce renewals
9. **Onboarding wizard** — Get started in 5 minutes, not 5 days
10. **Global search (Cmd+K)** — Find anything in 2 keystrokes
11. **Activity timeline** — Full visual history of every business event
12. **Multi-vehicle type support** — Cars, motorcycles, tuktuks, tricycles, spare parts, everything
13. **Bulk inventory import** — Add 100 items at once
14. **Invoice printing** — Generate printable/PDF-ready invoices
15. **Role-based dashboards** — Staff see what they need, owners see everything

---

## FEATURE CATALOG

### 1. Authentication & Security
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| JWT Auth | Access (15min) + Refresh (7d) tokens, bcrypt(12) hashing | Secure login with auto-logout | Never worry about unauthorized access | Prevents data breach liability | Industry standard security |
| Role-Based Access | SUPER_ADMIN > OWNER > STAFF hierarchy | Control who can do what | Staff can't delete sales, owners have full control | Reduces employee fraud risk | Many competitors lack granular RBAC |
| Rate Limiting | Per-route rate limits (auth: 10/15min) | Prevents brute force attacks | Account stays safe | Prevents credential theft | Standard security practice |
| Password Reset | Email-based reset with SHA-256 hashed tokens | Secure self-service password reset | No IT support needed to reset password | Reduces support costs | Expected feature |
| Impersonation | 30-min session swap for SuperAdmin | Support without sharing passwords | Faster support, no password sharing | Reduces support friction | Unique competitive advantage |

### 2. Dashboard & Analytics
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| KPI Cards | 14+ live metrics with period comparison | See business health at a glance | Know revenue, profit, costs in 1 second | Instant performance awareness | Premium dashboard UX |
| Revenue Chart | Daily revenue with profit overlay | Track money flow over time | Spot trends, good days vs bad | Data-driven inventory buying | Standard but well-executed |
| Profit Breakdown | Pie chart by vehicle type | Know what makes you money | Focus on most profitable vehicle types | Increase margin by focusing on winners | Actionable analytics |
| Top Selling Items | Batch-optimized query (N+1 fixed) | Know your best sellers | Stock what sells | Reduce dead inventory | Performance matters at scale |
| Monthly Comparison | 12-month bar chart | Year-over-year performance | See growth trajectory | Strategic planning | Essential for business owners |
| Net Profit Calculation | Revenue - Expenses = Net Profit | True profitability | Know if you're actually making money | Prevent hidden losses | Often overlooked by competitors |

### 3. Inventory Management
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Vehicle Catalog | Type, brand, model, year, color, engine, chassis | Complete vehicle specs | Find any vehicle instantly | Faster sales cycles | Comprehensive specs |
| Spare Parts Support | part_number field, barcode-ready | Track individual parts | Never lose a part | Reduce parts shrinkage | Specialized support |
| Soft Delete | is_active flag, full restore | Never permanently lose data | Recover from mistakes | Prevent loss of valuable records | Better than hard delete |
| Low Stock Alerts | Auto-detection at <= 2 units, notification | Know when to reorder | Never run out of stock | Prevent lost sales | Automated, not manual |
| Bulk Import | CSV-style bulk creation (up to 100) | Add inventory fast | Save hours of data entry | Reduced labor cost | Time saver |
| Supplier Linking | Each item can link to supplier | Know who supplies what | Reorder from right supplier | Efficient procurement | Supply chain visibility |
| Status Tracking | IN_STOCK, RESERVED, SOLD, RETURNED | Know every item's state | No confusion about availability | Prevent double-selling | Full lifecycle |
| Price Validation | Selling price >= cost price forced | Protect your margin | Can't accidentally sell at loss | Protect profitability | Prevents costly mistakes |

### 4. Sales Management
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Cash Sales | Immediate payment processing | Standard vehicle purchase | Simple, fast checkout | Immediate revenue recognition | Core functionality |
| Installment Sales | Auto-generated monthly payment schedule | Buy now, pay later | Attract more buyers | Increase sales volume | Built-in, not add-on |
| Profit per Sale | Per-item profit = (price - cost) * qty - discount | Know margin per transaction | Make informed pricing decisions | Optimize pricing strategy | Actionable per-sale data |
| Sale Cancellation | Atomic restore: inventory back, installments marked | Undo mistakes safely | Fix errors without data loss | Account accuracy | Safer than simple delete |
| Invoice Generation | HTML invoice with print/PDF support | Professional documentation | Give customers receipts | Legal compliance | Professional presentation |
| Invoice Numbering | PostgreSQL advisory lock for race-free sequence | Sequential invoices across branches | Organized financial records | Audit-ready | Scalable numbering |
| Customer History | Per-customer last 10 sales | Know your customer | Personalized service | Increase repeat sales | CRM integration |

### 5. Installment Tracking
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Schedule Generation | Monthly installments from first_due_date | Plan payments automatically | No manual calculation | Save admin time | Built-in, automated |
| Payment Recording | Single installment payment with note | Record payments fast | Update customer status | Realistic cash flow view | Quick payment entry |
| Overdue Detection | Daily cron: unpaid + past due = OVERDUE | Find late payments automatically | Never miss a follow-up | Reduce bad debt | Automated collection |
| Status Progression | ACTIVE → (all paid) → COMPLETED / (overdue) → OVERDUE | Know exact state of every sale | Clear pipeline visibility | Better receivables management | State machine accuracy |
| Cancel Blocking | Cannot cancel if any installment paid | Protect revenue | Prevents chargeback abuse | Revenue protection | Fail-closed safety |

### 6. Supplier Management
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Balance Tracking | total_due - total_paid = balance | Know what you owe | Never miss a supplier payment | Maintain supplier relationships | Automated balance |
| Payment Recording | Add payment with type, reference, note | Record supplier payments | Organized payables | Accurate debt tracking | Payment history |
| Payment Validation | Cannot exceed outstanding balance | Prevent overpayment | Accounting accuracy | Fraud prevention | Built-in safeguard |
| Supplier Stats | Top 5 highest balances, aggregates | Know your biggest debts | Negotiate better terms | Cash flow management | Actionable insights |

### 7. Customer Management
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Searchable CRM | Search by name, phone, national ID | Find customers instantly | Fast lookup | Save time | Essential for sales |
| Purchase History | Last 10 sales per customer | Know customer preferences | Upsell and cross-sell | Increase revenue per customer | CRM integration |
| Soft Delete | is_active with reactivate | Keep all data | Restore by mistake | Prevent data loss | Better than hard delete |
| Deactivate Guard | Blocks deactivation if customer has sales | Protect data integrity | Can't accidentally break sales history | Data consistency | Referential integrity |

### 8. Expense Management
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Category Tracking | Free-text category, groupable | Organize expenses by type | Know where money goes | Cost control | Essential accounting |
| Date Range Filtering | Today/week/month/year/custom | Analyze expenses by period | Spot spending trends | Budget planning | Standard feature |
| Integration with Net Profit | Expenses subtracted from gross profit | True profit calculation | Know real profitability | Prevent hidden losses | Connected financials |

### 9. Audit & Activity Logs
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Full Audit Trail | Every CREATE/UPDATE/DELETE recorded | Complete accountability | Know who changed what | Fraud investigation | Regulatory compliance |
| Old/New Data Capture | JSON snapshots before/after changes | See exactly what changed | Undo mistakes with confidence | Operational transparency | Detailed forensics |
| Activity Timeline | Visual timeline with filters | Easy investigation | Spot suspicious activity | Risk management | Premium UX on audit data |
| 7-Day Summary | Top actions, top users weekly | Weekly operations review | Identify busy periods | Productivity insights | Actionable metrics |

### 10. Notifications
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Sale Notifications | SALE_CREATED, SALE_CANCELLED | Know every sale immediately | Real-time awareness | Never miss a big sale | Instant alerts |
| Overdue Alerts | Auto-detected at 08:00 daily | Automatically notified of late payments | Follow up faster | Reduce bad debt | Automated collections |
| License Warnings | Warn at 30, 7, 1 day before expiry | Never let your SaaS expire | Service continuity | Prevent revenue loss (for SaaS operator) | Proactive retention |
| Low Stock Alerts | Triggered on inventory update/sale | Reorder when stock runs low | Never miss a sale opportunity | Revenue protection | Real-time inventory intelligence |

### 11. SuperAdmin Console
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| System-Wide KPIs | Cross-showroom revenue, sales, inventory | Global business health | See all branches at once | Strategic visibility | Essential for chains |
| Showroom Management | Create, update, activate/deactivate showrooms | Manage branch lifecycle | Add new branches instantly | Scalable growth | Multi-tenant control |
| Impersonation | 30-min scoped session | Support without password sharing | Troubleshoot user issues | Reduced support friction | Unique premium feature |
| User Management | Create/edit/reset passwords for any user | Manage all employees | Centralized user control | HR efficiency | Enterprise feature |
| Subscription/License | Renew, expire, track all subscriptions | Monetize the SaaS | Generate recurring revenue | Predictable income | SaaS operator essential |

### 12. Global Search
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Cross-Entity Search | Inventory, customers, suppliers, sales | Find anything fast | Cmd+K, type, enter | Save 5+ minutes per search | Premium UX |
| Min 2 Characters | Prevents unnecessary DB load | Only search when meaningful | Fast results, no noise | Reduced server cost | Smart UX design |
| Route Integration | Click result → navigate directly | Instant access to records | Faster workflows | Reduced navigation time | Seamless UX |

### 13. Multi-Tenancy
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| Prisma Extension Isolation | Auto-inject showroom_id, fail-closed | Each showroom sees only its data | Complete data privacy | Compliance | SaaS-ready from day one |
| AsyncLocalStorage | Per-request context, no thread leaks | Zero-config tenancy | No setup needed | Reduced deployment cost | Enterprise-grade isolation |
| BaseClient for Auth | Cross-tenant lookups for auth only | Single login across system | One email, one password | Reduced IT overhead | Smart architecture |

### 14. Onboarding Wizard
| Aspect | Technical Description | Business Description | User Benefit | Financial Value | Competitive Value |
|--------|---------------------|---------------------|--------------|----------------|-------------------|
| 3-Step Setup | Showroom info → Contact → Review | Get started in 5 minutes | No training needed | Faster time-to-value | Reduces churn |
| Guided UX | Step indicator, progress tracking | Clear path to completion | Less confusion, faster setup | Increased activation rate | Conversion-focused UX |

---

## USER JOURNEYS

### Journey 1: Owner — Daily Operations Review

1. **Login** → `/auth/login` → JWT issued
2. **Dashboard** → `/dashboard` → See 8 KPIs: today's revenue, profit, inventory count, customers, overdue installments
3. **Revenue Chart** → Daily revenue trend → "Good day today"
4. **Overdue Installments** → 5 items shown → Call those customers
5. **Inventory Check** → `/dashboard/inventory` → See low stock alerts → Order more
6. **Sales Review** → `/dashboard/sales` → Today's sales, check margins
7. **Expenses** → `/dashboard/expenses` → Record today's expenses
8. **Logout** → Session ends

**Time:** 10-15 minutes  
**Value:** Complete business status in 10 minutes instead of 2 hours of manual counting

### Journey 2: Sales Employee — Making a Sale

1. **Login** → See personalized dashboard
2. **Customer arrives** → Global Search (Cmd+K) → Search customer name → Found
3. **Or create customer** → `/dashboard/customers` → Add new → Name, phone, national ID
4. **Select vehicle** → `/dashboard/sales` → Click "New Sale" → Pick inventory item from search dropdown
5. **Choose sale type** → CASH or INSTALLMENT
6. **If INSTALLMENT** → Enter down payment, monthly amount, months, first due date
7. **Review total** → System computes: subtotal - discount = total
8. **Confirm** → Sale created → Invoice generated
9. **Print invoice** → `/dashboard/invoices/[id]` → Click print

**Time:** 2-3 minutes per sale  
**Value:** 10x faster than manual invoice writing

### Journey 3: Accountant — Installment & Supplier Management

1. **Login** → Go to `/dashboard/installments`
2. **Overdue tab** → See all overdue installments with customer info
3. **Customer pays** → Click "Pay" → Enter note → Installment marked paid
4. **Check status** → If all paid → Sale auto-completes
5. **Supplier Payment** → `/dashboard/suppliers` → Select supplier → See balance
6. **Record payment** → Click "Add Payment" → Amount, method, reference
7. **Verify balance** → Balance updates automatically

**Value:** No more Excel tracking, no more missed payments

### Journey 4: SuperAdmin — Managing the SaaS Platform

1. **Login** → System-wide dashboard with all showroom KPIs
2. **Check health** → Total showrooms, active vs expiring, total revenue
3. **Showroom expiring** → `/dashboard/subscriptions` → Renew for 12 months
4. **New client** → `/dashboard/showrooms` → Create showroom with owner account
5. **Support request** → Impersonate showroom → Fix issue → Exit impersonation
6. **User management** → `/dashboard/superadmin/users` → Reset password, edit role
7. **Monitor activity** → `/dashboard/activity` → Review system-wide audit log

**Value:** Manage 100+ dealerships from one dashboard

---

## WORKFLOWS

### Workflow 1: Vehicle Purchase-to-Sale

```
Supplier delivers vehicle
  → CREATE inventory item (brand, model, chassis, etc.)
  → Status: IN_STOCK
  → Vehicle sits in inventory
  → Customer wants to buy
  → Sale created (CASH or INSTALLMENT)
  → Inventory deducted (quantity-- or status=SOLD)
  → If qty <= 2: LOW_STOCK notification
  → Profit calculated automatically
  → Invoice generated
```

### Workflow 2: Installment Lifecycle

```
Sale created (INSTALLMENT type)
  → Installments generated: N months starting first_due_date
  → Status: ACTIVE
  → [Daily cron] Check for overdue installments
  → If overdue found: set sale.OVERDUE + notify
  → Customer pays installment → mark paid
  → Check if all paid → if yes, sale.COMPLETED
  → If sale is CANCELLED with paid installments → BLOCK (refund required)
```

### Workflow 3: License/Subscription Management

```
Showroom created with license_expiry date
  → [Daily cron] Check license_expiry for all showrooms
  → If within 30/7/1 days: warn (track smallest threshold sent)
  → Showroom license expires → block all operations (except SuperAdmin)
  → SuperAdmin renews → license_expiry extended, warning counter reset
  → Showroom unblocked
```

### Workflow 4: Employee Onboarding

```
SuperAdmin creates showroom
  → Onboarding wizard presented to first user
  → Step 1: Showroom name + logo
  → Step 2: Phone, email, address
  → Step 3: Review + confirm
  → is_onboarded = true
  → Access to all operational routes granted
```

---

## CODEBASE METRICS

| Metric | Count |
|--------|-------|
| **Total Lines of Code (estimated)** | ~35,000 |
| **Frontend LOC** | ~18,000 |
| **Backend LOC** | ~15,000 |
| **Configuration LOC** | ~1,000 |
| **Test Lines of Code** | 0 |
| **Frontend Pages** | 25 |
| **Frontend Components** | 12 (UI) + 2 (sales) = 14 |
| **Frontend Hooks** | 5 |
| **Frontend Services (lib)** | 3 |
| **Backend API Endpoints** | ~80 |
| **Backend Controllers** | 17 |
| **Backend Services** | 11 |
| **Backend Middleware** | 8 |
| **Backend Route Files** | 16 |
| **Database Tables** | 17 |
| **Database Migrations** | 7 |
| **Database Enums** | 8 |
| **Business Modules** | 14 |
| **User Roles** | 3 |
| **Notification Types** | 8 |

### Complexity Scores (1-10)

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Frontend Complexity | 7/10 | 25 pages, RTL, animations, multiple data-fetching patterns, responsive |
| Backend Complexity | 8/10 | Multi-tenant isolation, installment state machine, race-condition safety, distributed cron |
| Database Complexity | 7/10 | 17 models, 8 enums, composite indexes, advisory locks, soft delete patterns |
| Business Complexity | 8/10 | Installment math, profit calculation, supplier balances, SaaS licensing, multi-tenancy |
| Infrastructure Complexity | 4/10 | Vercel-only, single database, no Docker, no CDN, no Redis |
| **Overall** | **7/10** | Well-architected for its scope, infrastructure is the weakest area |

---

## KEY ARCHITECTURAL DECISIONS

1. **Multi-tenancy via Prisma Extension over separate databases** — Better for SaaS operations, single DB to manage, Prisma handles isolation efficiently. Risk: noise neighbors.

2. **Zustand + TanStack Query over Redux** — Auth state is small (one user), server state is large. TanStack Query's caching, deduplication, and invalidation patterns fit perfectly.

3. **Fire-and-forget audit + notifications** — Never block the primary operation for side effects. Logging and notifications are async and failure-tolerant.

4. **PostgreSQL advisory lock for invoice numbering** — No external dependencies, race-condition-free sequential numbers in concurrent environment.

5. **ScheduledJobRun for distributed cron** — Prevents duplicate execution without Redis. Works across any number of serverless instances.

6. **Arabic-first design** — Market differentiation. Most ERP systems are English-to-Arabic translations; this is built for Arabic from the ground up.

7. **Soft delete everywhere** — Business data is valuable. Users should never permanently lose data. Reactivation is always available.

8. **Fail-closed security** — Any missing tenant context throws an error. Any expired license blocks operations. Any missing validation rejects the request. Safety over convenience.
