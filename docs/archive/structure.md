# YS-MATRIX ERP — Complete Project Structure Map

## TABLE OF CONTENTS
1. Project Overview
2. Complete Folder Tree
3. Frontend Architecture
4. Backend Architecture
5. Database Schema
6. API Map
7. Component Map
8. Service Map
9. Model Map
10. Middleware Map
11. Event/Notification Map
12. Authentication Flow
13. Authorization Flow
14. Data Flow
15. Request Lifecycle
16. Error Handling Flow
17. Environment Variables
18. External Services & Integrations

---

## 1. PROJECT OVERVIEW

**Project:** YS-MATRIX ERP  
**Author:** Yahya Al-Sulami (admin@ys-matrix.com)  
**Repository:** YS-Matrix (Git)  
**Type:** Multi-tenant SaaS ERP for vehicle dealerships  
**Deployment:** Vercel (frontend + backend)  
**Database:** Neon PostgreSQL (serverless)  
**Domain:** https://ys-matrix-frontend.vercel.app  
**API:** https://ys-matrix-backend.vercel.app/api/v1  
**Language:** Arabic-first (RTL), with English secondary  
**Target Market:** Yemen, Saudi Arabia, Arabic-speaking vehicle dealerships

---

## 2. COMPLETE FOLDER TREE

```
YS-Matrix/
├── .git/
├── backend/
│   ├── node_modules/
│   ├── prisma/
│   │   ├── schema.prisma                  # Complete DB schema (17 models, 8 enums)
│   │   ├── stage3_migration.sql            # Standalone SQL for Stage 3
│   │   └── migrations/
│   │       ├── migration_lock.toml
│   │       ├── 20260520064913_init/        # Initial schema (all core tables)
│   │       ├── 20260522191649_v1_1_onboarding_softdelete_snapshot/  # v1.1: onboarding + soft-delete
│   │       ├── 20260607175233_stage3/      # Notifications + Subscriptions
│   │       ├── 20260627195640_add_scheduled_job_run_and_notification_tracking/  # Cron coordination
│   │       ├── 20260628020550_add_password_reset_tokens/  # Password reset
│   │       ├── 20260628125309_add_part_number_and_audit_composite_index/  # Part number + perf
│   │       └── 20260704140031_inventory_soft_delete/  # Inventory soft-delete
│   ├── src/
│   │   ├── index.js                        # Server entry point
│   │   ├── config/
│   │   │   ├── database.js                 # Prisma client + multi-tenant isolation engine
│   │   │   ├── jwt.js                      # Token generation/verification
│   │   │   ├── security.js                 # Centralized security constants
│   │   │   ├── logger.js                   # Winston logger
│   │   │   └── env.validator.js            # Startup environment validation
│   │   ├── middleware/
│   │   │   ├── auth.middleware.js           # JWT verification
│   │   │   ├── tenant.middleware.js         # Zero-trust tenant isolation
│   │   │   ├── roles.middleware.js          # RBAC (SUPER_ADMIN/OWNER/STAFF)
│   │   │   ├── validate.middleware.js       # Zod schema validation
│   │   │   ├── audit.middleware.js          # Fire-and-forget audit logging
│   │   │   ├── license.middleware.js        # License expiry checks
│   │   │   ├── onboarding.middleware.js     # Onboarding completion guard
│   │   │   └── cache.middleware.js          # In-memory response cache (60s TTL)
│   │   ├── routes/
│   │   │   ├── auth.routes.js              # Auth endpoints (login, register, refresh, etc.)
│   │   │   ├── showroom.routes.js           # SuperAdmin showroom management
│   │   │   ├── onboarding.routes.js         # Onboarding wizard
│   │   │   ├── inventory.routes.js          # Inventory CRUD
│   │   │   ├── supplier.routes.js           # Supplier CRUD + payments
│   │   │   ├── customer.routes.js           # Customer CRUD
│   │   │   ├── sales.routes.js              # Sales CRUD + installments
│   │   │   ├── analytics.routes.js          # Dashboard & analytics
│   │   │   ├── invoice.routes.js            # Invoice generation
│   │   │   ├── license.routes.js            # License status & renew
│   │   │   ├── subscription.routes.js       # Subscription management
│   │   │   ├── notification.routes.js       # Notification list & management
│   │   │   ├── search.routes.js             # Global search
│   │   │   ├── activity.routes.js           # Activity audit logs
│   │   │   ├── superadmin.routes.js         # SuperAdmin user/system management
│   │   │   └── cron.routes.js               # Cron trigger endpoint
│   │   ├── controllers/
│   │   │   ├── auth.controller.js           # Authentication & profile
│   │   │   ├── showroom.controller.js       # Showroom CRUD
│   │   │   ├── onboarding.controller.js     # Onboarding wizard
│   │   │   ├── inventory.controller.js      # Inventory CRUD
│   │   │   ├── supplier.controller.js       # Supplier CRUD
│   │   │   ├── customer.controller.js       # Customer CRUD
│   │   │   ├── sales.controller.js          # Sales & installments
│   │   │   ├── analytics.controller.js      # Dashboard KPIs & charts
│   │   │   ├── invoice.controller.js        # Invoice generation
│   │   │   ├── expense.controller.js        # Expense CRUD
│   │   │   ├── license.controller.js        # License management
│   │   │   ├── subscription.controller.js   # Subscription CRUD
│   │   │   ├── notification.controller.js   # Notification management
│   │   │   ├── search.controller.js         # Global search
│   │   │   ├── activity.controller.js       # Activity log viewer
│   │   │   ├── superadmin.controller.js     # SuperAdmin operations
│   │   │   └── superadmin.analytics.js      # System-wide analytics
│   │   ├── services/
│   │   │   ├── sales.service.js             # Sales business logic (680 lines)
│   │   │   ├── inventory.service.js         # Inventory business logic (527 lines)
│   │   │   ├── analytics.service.js         # Analytics & KPIs (369 lines)
│   │   │   ├── notification.service.js      # Notification engine (437 lines)
│   │   │   ├── customer.service.js          # Customer CRUD logic
│   │   │   ├── supplier.service.js          # Supplier CRUD + payments
│   │   │   ├── search.service.js            # Global multi-entity search
│   │   │   ├── subscription.service.js      # Subscription management
│   │   │   ├── activity.service.js          # Activity log queries
│   │   │   ├── email.service.js             # Email via Resend
│   │   │   └── superadmin.analytics.service.js  # System-wide stats
│   │   ├── validations/
│   │   │   ├── auth.validation.js           # Login, register, password schemas
│   │   │   ├── showroom.validation.js       # Showroom & SuperAdmin schemas
│   │   │   ├── sale.validation.js           # Sale creation & payment schemas
│   │   │   ├── search.validation.js         # Search query schema
│   │   │   └── activity.validation.js       # Entity history schema
│   │   ├── utils/
│   │   │   ├── response.js                  # Unified API response helpers
│   │   │   ├── pagination.js                # Pagination utilities
│   │   │   ├── dateRange.js                 # Date range builder
│   │   │   ├── invoice.js                   # Invoice number generator
│   │   │   ├── seed.superadmin.js           # SuperAdmin seed script
│   │   │   └── seed.demo.js                 # Demo data seed script
│   │   └── jobs/
│   │       └── scheduledNotifications.job.js  # Daily notification scans
│   ├── package.json
│   ├── package-lock.json
│   ├── .env                                 # Active production config
│   ├── .env.example
│   ├── vercel.json
│   └── .gitignore
├── frontend/
│   ├── node_modules/
│   ├── public/
│   │   ├── icon.webp                        # Favicon
│   │   ├── logo.webp                        # Brand logo
│   │   ├── logo-full.webp                   # Full logo with text
│   │   ├── logo-minimal.webp                # Minimal logo variant
│   │   ├── loading.webp                     # Loading animation
│   │   ├── opengraph.webp                   # OpenGraph image (1200x630)
│   │   └── manifest.json                    # PWA manifest
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx                   # Root layout (RTL, fonts, SEO, Toaster)
│   │   │   ├── page.tsx                     # Settings/Profile page (/)
│   │   │   ├── providers.tsx                # React Query provider
│   │   │   ├── middleware.ts                # Edge middleware (auth guard)
│   │   │   ├── auth/
│   │   │   │   ├── login/page.tsx           # Login page
│   │   │   │   ├── forgot-password/page.tsx # Password reset request
│   │   │   │   └── reset-password/page.tsx  # Password reset with token
│   │   │   └── dashboard/
│   │   │       ├── page.tsx                 # Dashboard home (KPIs + charts)
│   │   │       ├── sales/page.tsx           # Sales list & management
│   │   │       ├── inventory/
│   │   │       │   ├── page.tsx             # Inventory management
│   │   │       │   └── inactive/page.tsx    # Archived inventory
│   │   │       ├── customers/
│   │   │       │   ├── page.tsx             # Active customers
│   │   │       │   └── inactive/page.tsx    # Inactive customers
│   │   │       ├── suppliers/
│   │   │       │   ├── page.tsx             # Supplier management
│   │   │       │   └── inactive/page.tsx    # Inactive suppliers
│   │   │       ├── analytics/page.tsx       # Full analytics dashboard
│   │   │       ├── expenses/page.tsx        # Expense management
│   │   │       ├── installments/page.tsx    # Installment tracking
│   │   │       ├── invoices/[id]/page.tsx   # Invoice detail/print
│   │   │       ├── notifications/page.tsx   # Notification center
│   │   │       ├── activity/page.tsx        # Activity audit logs
│   │   │       ├── onboarding/page.tsx      # Onboarding wizard
│   │   │       ├── settings/page.tsx        # User settings
│   │   │       ├── subscriptions/page.tsx   # Subscription management (SA)
│   │   │       ├── showrooms/page.tsx       # Showroom management (SA)
│   │   │       └── superadmin/users/page.tsx # User management (SA)
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── DashboardLayout.tsx      # Main dashboard shell
│   │   │   │   ├── Navbar.tsx               # Top nav bar
│   │   │   │   └── Sidebar.tsx              # Navigation sidebar
│   │   │   ├── ui/
│   │   │   │   ├── DataTable.tsx            # Generic data table
│   │   │   │   ├── KpiCard.tsx              # KPI metric card
│   │   │   │   ├── Modal.tsx                # Modal dialog
│   │   │   │   ├── GlobalSearch.tsx         # Command palette (Cmd+K)
│   │   │   │   ├── NotificationCenter.tsx   # Bell dropdown
│   │   │   │   ├── SaveModeBar.tsx          # Auto/manual save toggle
│   │   │   │   └── SplashScreen.tsx         # Loading splash
│   │   │   └── sales/
│   │   │       ├── SaleCreateModal.tsx      # Sale creation modal
│   │   │       └── SaleDetailDrawer.tsx     # Sale detail drawer
│   │   ├── hooks/
│   │   │   ├── useSales.ts                  # Sale queries + mutations
│   │   │   ├── useInventory.ts              # Inventory picker query
│   │   │   ├── useCustomers.ts              # Customer queries + mutations
│   │   │   ├── useNotifications.ts          # Notification queries + mutations
│   │   │   └── useSaveMode.ts              # Auto/manual save state machine
│   │   ├── lib/
│   │   │   ├── api.ts                       # API client (axios) — 1045 lines
│   │   │   ├── auth.ts                      # Zustand auth store
│   │   │   └── utils.ts                     # Formatters, constants, cn()
│   │   ├── types/
│   │   │   ├── sale.types.ts               # Sale-related TypeScript types
│   │   │   └── notification.types.ts       # Notification display config
│   │   └── styles/
│   │       └── globals.css                  # Global styles + Matrix design system
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── .eslintrc.json
│   ├── .env.example
│   ├── .env.local                           # Active production API URL
│   ├── vercel.json
│   ├── next-env.d.ts
│   └── .gitignore
└── docs/                                    # Empty documentation directory
```

---

## 3. FRONTEND ARCHITECTURE

### Framework Stack
| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 14.2 | React framework (App Router) |
| React | 18.3 | UI library |
| TypeScript | 5.4 | Type safety |
| Tailwind CSS | 3.4 | Styling |
| Framer Motion | 11 | Animations |
| TanStack Query | 5.28 | Server state management |
| Zustand | 4.5 | Client state (auth) |
| Axios | ^1.x | HTTP client |
| Recharts | ^2.x | Charts |
| React Hot Toast | ^2.x | Toast notifications |
| Lucide React | ^0.x | Icons |
| Tailwind Merge | ^2.x | Class merging |
| CLSX | ^2.x | Conditional classes |

### Page Routes & Component Hierarchy

| Route | Page Component | Key Sub-components | Hooks | APIs |
|-------|---------------|-------------------|-------|------|
| `/auth/login` | LoginPage | Animated error card, password toggle | useAuthStore | authApi.login |
| `/auth/forgot-password` | ForgotPasswordPage | Animated success/error cards | useState | authApi.forgotPasswordRequest |
| `/auth/reset-password` | ResetPasswordPage | Suspense, animated cards | useSearchParams | authApi.resetPassword |
| `/dashboard` | DashboardPage | KpiCard (8), AreaChart | useQuery (3) | analytics APIs |
| `/dashboard/sales` | SalesPage | SaleCreateModal, SaleDetailDrawer, StatCard, SaleRow | useSales, useCancelSale, useSalesSummary, useOverdueInstallmentCount | sales APIs |
| `/dashboard/inventory` | InventoryPage | DataTable, KpiCard (4), Modal | useQuery, useMutation | inventory APIs |
| `/dashboard/inventory/inactive` | InactiveInventoryPage | DataTable | useQuery, useMutation, useAuthStore | inventory APIs |
| `/dashboard/customers` | CustomersPage | DataTable, Modal | useCustomerList, useCreateCustomer, useUpdateCustomer, useDeactivateCustomer | customers APIs |
| `/dashboard/customers/inactive` | InactiveCustomersPage | DataTable | useCustomerList, useReactivateCustomer | customers APIs |
| `/dashboard/suppliers` | SuppliersPage | DataTable, KpiCard (4), Modal, SupplierFormFields | useQuery, useMutation | suppliers APIs |
| `/dashboard/suppliers/inactive` | InactiveSuppliersPage | DataTable | useQuery, useMutation | suppliers APIs |
| `/dashboard/analytics` | AnalyticsPage | KpiCard (4), AreaChart, BarChart, PieChart | useQuery (6) | analytics APIs |
| `/dashboard/expenses` | ExpensesPage | DataTable, KpiCard (2), Modal, SaveModeBar | useQuery, useMutation, useSaveMode | analytics APIs |
| `/dashboard/installments` | InstallmentsPage | DataTable, KpiCard (4) | useQuery, usePayInstallment | sales APIs |
| `/dashboard/invoices/[id]` | InvoicePage | Invoice template, print button | useQuery | invoices API |
| `/dashboard/notifications` | NotificationsPage | NotificationCard | useNotifications, useMarkAsRead, useMarkAllAsRead, useUnreadCount | notification APIs |
| `/dashboard/activity` | ActivityPage | LogEntry (timeline) | useQuery (3) | activity APIs |
| `/dashboard/onboarding` | OnboardingPage | StepIndicator, Step1/2/3 | useMutation, useAuthStore | onboardingApi.complete |
| `/dashboard/settings` | SettingsPage | SaveModeBar | useMutation, useSaveMode, useAuthStore | authApi |
| `/dashboard/showrooms` | ShowroomsPage | DataTable, Modal | useQuery, useMutation, useAuthStore | showrooms API |
| `/dashboard/subscriptions` | SubscriptionsPage | RenewModal, SubscriptionRow | useQuery, useMutation | subscription APIs |
| `/dashboard/superadmin/users` | SuperAdminUsersPage | Badge, StatusDot, Spinner, Field, ModalShell, ErrBox, CreateUserModal, EditUserModal, ResetPasswordModal | useQuery, useMutation, useAuthStore | superAdmin APIs |

---

## 4. BACKEND ARCHITECTURE

### Technology Stack
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | >= 18 | Runtime |
| Express | 4.18 | Web framework |
| Prisma | 5.10 | ORM + migrations |
| PostgreSQL (Neon) | Serverless | Database |
| JSON Web Token | ^9.x | Auth tokens |
| Bcrypt.js | ^2.4 | Password hashing |
| Zod | ^3.x | Input validation |
| Winston | ^3.x | Logging |
| Helmet | ^7.x | Security headers |
| CORS | ^2.8 | Cross-origin |
| Morgan | ^1.10 | HTTP logging |
| Express Rate Limit | ^7.x | Rate limiting |
| Node Cron | ^3.x | Scheduled tasks |
| Resend | ^3.x | Email API |
| Date FNS | ^3.x | Date utilities |

### Request Lifecycle

```
HTTP Request
  │
  ├── Helmet (security headers)
  ├── CORS (origin validation)
  ├── Rate Limiter (global: 100/15min)
  ├── Body Parser (JSON, 10mb)
  ├── Morgan (request logging)
  │
  └── Route Matching (/api/v1/<resource>)
        │
        ├── [Public Routes]
        │   POST /auth/login
        │   POST /auth/refresh
        │   POST /auth/forgot-password-request  (+ rate limit: 3/15min)
        │   POST /auth/reset-password           (+ rate limit: 3/15min)
        │   GET  /cron/daily-notifications      (+ CRON_SECRET check)
        │
        └── [Protected Routes]
              │
              ├── authenticate (JWT verify)
              │   ├── Extracts Bearer token
              │   ├── verifyAccessToken()
              │   ├── Loads user from DB (baseClient)
              │   ├── Checks user.is_active
              │   ├── Injects req.user, req.showroomId, req.impersonatedBy
              │   └── On failure: TOKEN_MISSING, TOKEN_INVALID, TOKEN_EXPIRED
              │
              ├── checkLicense (unless SuperAdmin)
              │   ├── Checks showroom.is_active
              │   ├── Checks license_expiry
              │   └── On expiry: licenseExpired response + days expired
              │
              ├── tenantGuard (set AsyncLocalStorage)
              │   ├── Resolves showroomId from req.user (zero-trust)
              │   ├── Detects cross-tenant attacks
              │   └── Sets AsyncLocalStorage context for Prisma
              │
              ├── ensureOnboarded (unless SuperAdmin)
              │   └── Blocks if showroom.is_onboarded === false
              │
              ├── requireRole / ownerOnly / superAdminOnly (RBAC)
              │   └── Checks role hierarchy (SUPER_ADMIN:3 > OWNER:2 > STAFF:1)
              │
              ├── validate (Zod schema) [optional per route]
              │   ├── safeParse body/query/params
              │   └── Returns VALIDATION_ERROR with Arabic messages
              │
              ├── cacheResponse [optional, analytics GET only]
              │   └── Checks in-memory cache (60s TTL, key includes showroomId)
              │
              ├── Controller (thin: parse → call service → respond)
              │   ├── Calls service method
              │   ├── Calls auditLog() [on mutations]
              │   └── Sends unified response via response.js helpers
              │
              ├── Service (business logic)
              │   ├── Prisma queries (tenant-scoped or baseClient)
              │   ├── Financial calculations
              │   ├── Inventory deduction/restoration
              │   ├── Notification triggers (fire-and-forget)
              │   └── Installment state machine
              │
              ├── Prisma Client
              │   ├── [Tenant-scoped] for business data
              │   │   └── Auto-injects showroom_id via $allOperations
              │   └── [baseClient] unscoped for auth/cross-tenant
              │
              └── PostgreSQL (Neon)
                    └── Returns data → JSON response envelope
```

### Middleware Pipeline (by route group)

| Route Group | Pipeline |
|-------------|----------|
| Auth (login, refresh, forgot, reset) | rateLimiter → validate |
| Auth (me, logout, changePassword) | authenticate → validate |
| Auth (register, updateProfile) | authenticate → validate + role check |
| Inventory (GET) | authenticate → checkLicense → tenantGuard → ensureOnboarded |
| Inventory (POST/PUT) | + validate |
| Inventory (DELETE/reactivate) | + ownerOnly |
| Sales (GET) | authenticate → checkLicense → tenantGuard → ensureOnboarded + query validate |
| Sales (POST) | + validate (createSaleSchema) |
| Sales (cancel) | + ownerOnly |
| Analytics (GET) | authenticate → checkLicense → tenantGuard → ensureOnboarded → cacheResponse |
| Analytics (expenses POST/PUT) | + validate |
| Analytics (expenses DELETE) | + ownerOnly |
| SuperAdmin | authenticate → tenantGuard (bypass) → superAdminOnly + rate limit |
| Activity | authenticate → checkLicense → tenantGuard → ownerOnly + validate |
| Search | authenticate → checkLicense → tenantGuard → ensureOnboarded + validate |
| Cron | CRON_SECRET Bearer check only |

---

## 5. DATABASE SCHEMA

### Models (17)

| Model | Table | Purpose | Key Relations |
|-------|-------|---------|--------------|
| Showroom | showrooms | Multi-tenant organization | users, inventory, sales, etc. |
| User | users | System users (SUPER_ADMIN/OWNER/STAFF) | showroom, sales, audit_logs |
| RefreshToken | refresh_tokens | JWT refresh token storage | user (Cascade) |
| PasswordResetToken | password_reset_tokens | Password reset (SHA-256 hashed) | user (Cascade) |
| Inventory | inventory | Vehicles & spare parts | showroom, supplier, sale_items |
| Supplier | suppliers | Parts/vehicle suppliers | showroom, inventory, payments |
| SupplierPayment | supplier_payments | Payments to suppliers | supplier (Cascade) |
| Customer | customers | Vehicle buyers | showroom, sales |
| Sale | sales | Completed sales | showroom, customer, user, items, installments |
| SaleItem | sale_items | Line items in sales | sale (Cascade), inventory |
| Installment | installments | Installment payment schedule | sale (Cascade) |
| Expense | expenses | Business expenses | showroom |
| AuditLog | audit_logs | Full audit trail | showroom, user |
| Notification | notifications | System notifications | showroom, user |
| ScheduledJobRun | scheduled_job_runs | Cron coordination | (standalone) |
| Subscription | subscriptions | Subscription plans | showroom, user (renewer) |

### Enums (8)

| Enum | Values | Used By |
|------|--------|---------|
| UserRole | SUPER_ADMIN, OWNER, STAFF | User |
| VehicleType | MOTORCYCLE, CAR, TUKTUK, TRICYCLE, SPARE_PART, OTHER | Inventory |
| SaleType | CASH, INSTALLMENT | Sale |
| SaleStatus | ACTIVE, COMPLETED, CANCELLED, OVERDUE | Sale |
| StockStatus | IN_STOCK, RESERVED, SOLD, RETURNED | Inventory |
| PaymentType | CASH, BANK_TRANSFER, CHEQUE, OTHER | SupplierPayment |
| NotificationType | INSTALLMENT_OVERDUE, INSTALLMENT_DUE_SOON, LICENSE_EXPIRING, LOW_STOCK, SALE_CREATED, SALE_CANCELLED, PAYMENT_RECEIVED, SYSTEM | Notification |
| SubscriptionStatus | ACTIVE, EXPIRED, CANCELLED, TRIAL | Subscription |

### Key Indexes
- `inventory`: [showroom_id], [showroom_id, vehicle_type], [showroom_id, status], [showroom_id, is_active]
- `sales`: [showroom_id], [showroom_id, sold_at], [showroom_id, status], unique [showroom_id, invoice_number]
- `installments`: [sale_id], [due_date, is_paid]
- `audit_logs`: [showroom_id], [showroom_id, entity], [showroom_id, created_at]
- `notifications`: [showroom_id], [showroom_id, is_read]
- `subscriptions`: [showroom_id], [status], [expires_at]
- `customers/suppliers`: [showroom_id], [showroom_id, is_active]
- `users`: [showroom_id], unique [email]

---

## 6. COMPLETE API MAP

### Auth Module (prefix: /auth)

| Method | Endpoint | Controller Method | Service | Validations | Rate Limit | Notes |
|--------|----------|------------------|---------|-------------|------------|-------|
| POST | /login | auth.login | (inline) | loginSchema | 10/15min | Anti-enumeration |
| POST | /register | auth.register | (inline) | registerSchema | - | Owner+ only |
| POST | /refresh | auth.refreshToken | (inline) | refreshTokenSchema | - | Token rotation in transaction |
| POST | /logout | auth.logout | (inline) | - | - | Deletes stored token |
| GET | /me | auth.getMe | (inline) | - | - | Returns current user |
| PATCH | /me | auth.updateProfile | (inline) | updateProfileSchema | - | Narrow destructuring |
| PUT | /change-password | auth.changePassword | (inline) | changePasswordSchema | - | Revokes all refresh tokens |
| POST | /forgot-password-request | (superadmin) | email.service | forgotPasswordRequestSchema | 3/15min | Anti-enumeration |
| POST | /reset-password | auth.resetPasswordWithToken | (inline) | resetPasswordSchema | - | SHA-256 token hash |

### Showroom Module (prefix: /showrooms) — SuperAdmin only

| Method | Endpoint | Controller Method | Service | Models |
|--------|----------|------------------|---------|--------|
| GET | / | showroom.getAllShowrooms | (inline) | Showroom (baseClient) |
| POST | / | showroom.createShowroom | (inline) | Showroom, User |
| PUT | /:id | showroom.updateShowroom | (inline) | Showroom |
| GET | /:id/stats | showroom.getShowroomStats | (inline) | Showroom + related counts |

### Inventory Module (prefix: /inventory)

| Method | Endpoint | Controller Method | Service | Validations | Notes |
|--------|----------|------------------|---------|-------------|-------|
| GET | / | inventory.getAllInventory | inventory.service.listInventory | - | Search, filter, paginate |
| GET | /stats | inventory.getInventoryStats | inventory.service.getStats | - | 7 parallel counts |
| GET | /low-stock | inventory.getLowStockAlerts | inventory.service.getLowStock | - | qty <= 2 |
| GET | /:id | inventory.getInventoryItem | inventory.service.getItem | - | + last 5 sale items |
| POST | / | inventory.createInventoryItem | inventory.service.createItem | - | Price validation |
| POST | /bulk | inventory.bulkCreateInventory | inventory.service.bulkCreateItems | - | Max 100 |
| PUT | /:id | inventory.updateInventoryItem | inventory.service.updateItem | - | Blocks SOLD edits |
| DELETE | /:id | inventory.deleteInventoryItem | inventory.service.deleteItem | - | Soft delete (ownerOnly) |
| PATCH | /:id/reactivate | inventory.reactivateInventoryItem | inventory.service.reactivateItem | - | ownerOnly |

### Supplier Module (prefix: /suppliers)

| Method | Endpoint | Controller Method | Service | Notes |
|--------|----------|------------------|---------|-------|
| GET | / | supplier.getAllSuppliers | supplier.service.listSuppliers | Sortable, searchable |
| GET | /stats | supplier.getSupplierStats | supplier.service.getStats | Top 5 balances |
| GET | /:id | supplier.getSupplier | supplier.service.getSupplier | + inventory + payments |
| GET | /:id/payments | supplier.getPaymentHistory | supplier.service.getPaymentHistory | Paginated |
| POST | / | supplier.createSupplier | supplier.service.createSupplier | - |
| PUT | /:id | supplier.updateSupplier | supplier.service.updateSupplier | - |
| POST | /:id/payments | supplier.addPayment | supplier.service.addPayment | Balance validation |
| DELETE | /:id | supplier.deleteSupplier | supplier.service.deleteSupplier | Soft delete (ownerOnly) |
| PATCH | /:id/reactivate | supplier.reactivateSupplier | supplier.service.reactivateSupplier | ownerOnly |

### Customer Module (prefix: /customers)

| Method | Endpoint | Controller Method | Service |
|--------|----------|------------------|---------|
| GET | / | customer.getAllCustomers | customer.service.listCustomers |
| GET | /:id | customer.getCustomer | customer.service.getCustomer |
| POST | / | customer.createCustomer | customer.service.createCustomer |
| PUT | /:id | customer.updateCustomer | customer.service.updateCustomer |
| DELETE | /:id | customer.deleteCustomer | customer.service.deleteCustomer |
| PATCH | /:id/reactivate | customer.reactivateCustomer | customer.service.reactivateCustomer |

### Sales Module (prefix: /sales)

| Method | Endpoint | Controller Method | Service | Validations |
|--------|----------|------------------|---------|-------------|
| GET | /summary | sales.getSalesSummary | sales.service.getSalesSummary | date range |
| GET | /overdue | sales.getOverdueInstallments | sales.service.getOverdueInstallments | paginated |
| GET | /upcoming | sales.getUpcomingInstallments | sales.service.getUpcomingInstallments | days param |
| GET | / | sales.getAllSales | sales.service.listSales | salesQuerySchema |
| GET | /:id | sales.getSale | sales.service.getSale | - |
| POST | / | sales.createSale | sales.service.createSale | createSaleSchema |
| PATCH | /:id/cancel | sales.cancelSale | sales.service.cancelSale | ownerOnly |
| PATCH | /installments/:installment_id/pay | sales.payInstallment | sales.service.payInstallment | payInstallmentSchema |

### Module: /analytics (prefix: /analytics)

| Method | Endpoint | Controller Method | Cached |
|--------|----------|------------------|--------|
| GET | /dashboard | analytics.getDashboardKPIs | Yes (60s) |
| GET | /net-profit | analytics.getNetProfit | Yes |
| GET | /revenue-chart | analytics.getRevenueChart | Yes |
| GET | /monthly | analytics.getMonthlyComparison | Yes |
| GET | /top-items | analytics.getTopSellingItems | Yes |
| GET | /profit-breakdown | analytics.getProfitBreakdown | Yes |
| GET | /inventory | analytics.getInventoryAnalytics | Yes |
| GET | /expenses | analytics.getExpenses | No |
| POST | /expenses | expense.createExpense | No |
| PUT | /expenses/:id | expense.updateExpense | No |
| DELETE | /expenses/:id | expense.deleteExpense | No |

### Module: /invoices (prefix: /invoices)

| Method | Endpoint | Produces |
|--------|----------|----------|
| GET | /:id | JSON invoice data |
| GET | /:id/print | HTML (styled for print/PDF) |

### Module: /licenses (prefix: /licenses)

| Method | Endpoint | Controller | Notes |
|--------|----------|-----------|-------|
| GET | /status | license.getLicenseStatus | Own showroom |
| GET | /all | license.getAllLicenses | SuperAdmin only |
| POST | /renew | license.renewLicense | SuperAdmin only |

### Module: /subscriptions (prefix: /subscriptions)

| Method | Endpoint | Controller | Notes |
|--------|----------|-----------|-------|
| GET | /current | subscription.getCurrentSubscription | Own showroom |
| GET | /history | subscription.listSubscriptions | Own history |
| GET | /all | subscription.listAllSubscriptions | SuperAdmin |
| GET | /summary | subscription.getSubscriptionSummary | SuperAdmin |
| POST | /renew | subscription.renewSubscription | SuperAdmin |

### Module: /notifications (prefix: /notifications)

| Method | Endpoint | Controller | Notes |
|--------|----------|-----------|-------|
| GET | / | notification.getNotifications | Paginated, filterable |
| GET | /unread | notification.getUnreadCount | Badge count |
| PATCH | /:id/read | notification.markAsRead | Single |
| PATCH | /read-all | notification.markAllAsRead | All users's |
| DELETE | /old | notification.deleteOld | ownerOnly |

### Module: /search (prefix: /search)

| Method | Endpoint | Controller | Validations |
|--------|----------|-----------|-------------|
| GET | / | search.search | searchQuerySchema (min 2 chars) |

### Module: /activity (prefix: /activity) — ownerOnly

| Method | Endpoint | Controller | Notes |
|--------|----------|-----------|-------|
| GET | / | activity.getActivityLogs | Paginated, filterable |
| GET | /filters | activity.getFilters | Distinct actions/entities |
| GET | /summary | activity.getActivitySummary | 7-day stats |
| GET | /:entity/:id | activity.getEntityHistory | Per-record trail |

### Module: /superadmin (prefix: /superadmin) — SuperAdmin only

| Method | Endpoint | Controller | Rate Limit | Notes |
|--------|----------|-----------|------------|-------|
| GET | /system-stats | superadmin.analytics.getSystemStats | 30/15min | System-wide KPIs |
| GET | /showrooms | superadmin.getAllShowroomsGlobal | - | All showrooms |
| POST | /showrooms/:id/impersonate | superadmin.impersonateShowroom | 10/15min | 30-min access token |
| GET | /users | superadmin.getAllUsers | - | All users |
| GET | /users/:id | superadmin.getUserById | - | Single user |
| POST | /users | superadmin.createUserForShowroom | 10/15min | Create user in showroom |
| PATCH | /users/:id | superadmin.updateUser | - | Update user (not SUPER_ADMIN) |
| GET | /password-reset-requests | superadmin.getPendingResetRequests | - | Last 7 days |
| POST | /reset-user-password | superadmin.resetUserPassword | 10/15min | Force reset |

### Module: /onboarding (prefix: /onboarding)

| Method | Endpoint | Controller | Notes |
|--------|----------|-----------|-------|
| GET | /status | onboarding.getOnboardingStatus | Check status |
| PATCH | / | onboarding.onboardShowroom | Complete wizard |

### Module: /cron (prefix: /cron) — Public (CRON_SECRET protected)

| Method | Endpoint | Handler | Schedule |
|--------|----------|---------|----------|
| GET | /daily-notifications | cron.dailyNotifications | Daily 08:00 (Vercel Cron) |

---

## 7. COMPONENT MAP

### Reusable UI Components

| Component | File | Props | Used By |
|-----------|------|-------|---------|
| DashboardLayout | components/layout/DashboardLayout.tsx | children, title | All dashboard pages |
| Sidebar | components/layout/Sidebar.tsx | collapsed, onToggle, mobileOpen, onMobileClose | DashboardLayout |
| Navbar | components/layout/Navbar.tsx | title, onMenuClick | DashboardLayout |
| DataTable | components/ui/DataTable.tsx | data, columns, loading, searchable, pagination | inventory, customers, suppliers, expenses, installments, showrooms, activity |
| KpiCard | components/ui/KpiCard.tsx | title, value, change, icon, color, loading | dashboard, inventory, suppliers, analytics, installments, expenses |
| Modal | components/ui/Modal.tsx | open, onClose, title, children, size, footer | inventory, customers, suppliers, expenses, showrooms |
| GlobalSearch | components/ui/GlobalSearch.tsx | (standalone) | Sidebar trigger |
| NotificationCenter | components/ui/NotificationCenter.tsx | (standalone) | Navbar |
| SaveModeBar | components/ui/SaveModeBar.tsx | mode, status, isDirty, onSave, onDiscard, onToggle | settings, expenses |
| SplashScreen | components/ui/SplashScreen.tsx | label | DashboardLayout, root |

### Business Components

| Component | File | Props | Used By |
|-----------|------|-------|---------|
| SaleCreateModal | components/sales/SaleCreateModal.tsx | onClose | sales page |
| SaleDetailDrawer | components/sales/SaleDetailDrawer.tsx | sale, onClose | sales page |

---

## 8. SERVICE MAP

| Service | Module | Key Functions | Dependencies | Complexity |
|---------|--------|--------------|-------------|------------|
| sales.service | Sales | listSales, getSale, createSale, cancelSale, payInstallment, getOverdueInstallments, getUpcomingInstallments, getSalesSummary | prisma, notificationService, inventory (LOW_STOCK_THRESHOLD), invoice generator | ★★★★★ (680 lines, core business logic) |
| inventory.service | Inventory | listInventory, getItem, getStats, getLowStock, createItem, bulkCreate, updateItem, deleteItem, reactivateItem | prisma, notificationService | ★★★★☆ (527 lines) |
| analytics.service | Analytics | getDashboardKPIs, getNetProfit, getRevenueChart, getMonthlyComparison, getTopSellingItems, getProfitBreakdown, getInventoryAnalytics | prisma, dateRange | ★★★★☆ (369 lines, 14 parallel queries) |
| notification.service | Notifications | createNotification, listNotifications, markAsRead, markAllAsRead, runOverdueInstallmentScan, runLicenseExpiryScan, notify* | prisma, baseClient | ★★★☆☆ (437 lines) |
| customer.service | Customers | listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer, reactivateCustomer | prisma | ★★☆☆☆ (152 lines) |
| supplier.service | Suppliers | listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier, addPayment, getPaymentHistory, getSupplierStats | prisma | ★★★☆☆ (288 lines) |
| search.service | Search | globalSearch | prisma (4 parallel queries) | ★★☆☆☆ (162 lines) |
| subscription.service | Subscriptions | getCurrentSubscription, listSubscriptions, renewSubscription, listAllSubscriptions, getSubscriptionSummary | prisma, baseClient | ★★★☆☆ (260 lines) |
| activity.service | Activity | listActivityLogs, getFilters, getActivitySummary, getEntityHistory | prisma | ★★☆☆☆ (142 lines) |
| email.service | Email | sendPasswordResetEmail | resend | ★☆☆☆☆ (140 lines) |
| superadmin.analytics.service | SuperAdmin | getSystemStats | baseClient | ★★★☆☆ (119 lines) |

---

## 9. NOTIFICATION/EVENT MAP

### Notification Triggers (8 types)

| Type | Trigger Event | Fired By | Delivery |
|------|--------------|----------|----------|
| SALE_CREATED | New sale completed | sales.service.createSale | Fire-and-forget |
| SALE_CANCELLED | Sale cancelled | sales.service.cancelSale | Fire-and-forget |
| PAYMENT_RECEIVED | Supplier payment recorded | supplier.service.addPayment | Fire-and-forget |
| LOW_STOCK | Inventory qty <= 2 | inventory.service.updateItem + sales.service.createSale | Fire-and-forget |
| INSTALLMENT_OVERDUE | Past-due unpaid installment | notification.service.runOverdueInstallmentScan | Cron (daily) |
| INSTALLMENT_DUE_SOON | Upcoming installment (future use) | (not currently triggered) | (future) |
| LICENSE_EXPIRING | License within 30/7/1 days | notification.service.runLicenseExpiryScan | Cron (daily) |
| SYSTEM | Administrative messages | (manual) | Manual |

### Scheduled Jobs (node-cron / Vercel Cron)

| Job | Schedule | What It Does | Multi-Instance Safety |
|-----|----------|-------------|----------------------|
| Overdue Installment Scan | Daily 08:00 | Finds unpaid installments past due, creates notifications, marks sale OVERDUE | ScheduledJobRun (DB unique constraint) |
| License Expiry Scan | Daily 08:00 | Checks showroom licenses, creates expiry warnings at thresholds (30, 7, 1 day) | Same claimRun mechanism |

### Audit Log Events

| Action | Entity | Provider |
|--------|--------|----------|
| LOGIN | user | auth.controller.login |
| CREATE | inventory, supplier, customer, sale, expense, showroom, user | Respective controllers |
| UPDATE | inventory, supplier, customer, showroom, user | Respective controllers |
| DELETE | inventory, supplier, customer, expense | Respective controllers |
| PAYMENT | supplier (payment) | supplier.controller.addPayment |
| CANCEL | sale | sales.controller.cancelSale |

---

## 10. ENVIRONMENT VARIABLES

### Required in production

| Variable | Purpose | Source |
|----------|---------|--------|
| DATABASE_URL | PostgreSQL connection string (Neon) | .env |
| JWT_ACCESS_SECRET | Sign access tokens (>=32 chars, 64+ recommended) | .env |
| JWT_REFRESH_SECRET | Sign refresh tokens (different from access) | .env |
| ALLOWED_ORIGINS | CORS (comma-separated, no localhost in prod) | .env |
| CRON_SECRET | Protect cron endpoint | .env |
| RESEND_API_KEY | Email sending | .env |
| FRONTEND_URL | CORS + email links | .env |
| SUPER_ADMIN_EMAIL | Seed script | .env |
| SUPER_ADMIN_PASSWORD | Seed script (>=8 chars) | .env |
| SUPER_ADMIN_NAME | Seed script | .env |
| NEXT_PUBLIC_API_URL | Frontend API base URL | .env.local |

### Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| PORT | Server port | 5000 |
| NODE_ENV | Environment | development |
| API_VERSION | API version prefix | v1 |
| JWT_ACCESS_EXPIRES | Access token TTL | 15m |
| JWT_REFRESH_EXPIRES | Refresh token TTL | 7d |
| BCRYPT_ROUNDS | Password hashing cost | 12 |
| RATE_LIMIT_WINDOW_MS | Rate limit window | 900000 |
| RATE_LIMIT_MAX | Global rate limit max | 100 |
| SYSTEM_SHOWROOM_ID | System showroom identifier | system-showroom-001 |
| LOG_LEVEL | Winston log level | debug (dev) / warn (prod) |

---

## 11. EXTERNAL SERVICES & INTEGRATIONS

| Service | Purpose | Integration Point |
|---------|---------|------------------|
| Neon PostgreSQL | Database | DATABASE_URL connection string |
| Vercel | Hosting (frontend + backend) | vercel.json config |
| Resend | Email delivery | RESEND_API_KEY |
| Vercel Cron Jobs | Scheduled notifications | vercel.json crons section |
| Prisma | ORM + migrations | schema.prisma, CLI |
| GitHub | Source control | .git |

---

## 12. FRONTEND-BACKEND CONNECTIONS

### Direct API Dependencies

| Frontend Module | Backend Endpoint Group | HTTP Methods | Auth Required |
|----------------|----------------------|--------------|--------------|
| Settings/Profile | /auth | GET, PATCH, PUT | Yes (JWT) |
| Dashboard Home | /analytics | GET | Yes |
| Sales | /sales | CRUD | Yes |
| Inventory | /inventory | CRUD + bulk | Yes |
| Customers | /customers | CRUD | Yes |
| Suppliers | /suppliers | CRUD + payments | Yes |
| Analytics | /analytics (7 endpoints) | GET | Yes |
| Expenses | /analytics/expenses | CRUD | Yes |
| Installments | /sales (overdue, upcoming) | GET + PATCH | Yes |
| Invoices | /invoices | GET | Yes |
| Notifications | /notifications | GET, PATCH, DELETE | Yes |
| Activity | /activity | GET | Yes (ownerOnly) |
| Search | /search | GET | Yes |
| Onboarding | /onboarding | GET, PATCH | Yes |
| Showrooms (SA) | /showrooms | GET, POST, PUT | Yes (SA) |
| Subscriptions (SA) | /subscriptions | GET, POST | Yes (SA) |
| SuperAdmin Users | /superadmin | GET, POST, PATCH | Yes (SA) |
| Licenses | /licenses | GET, POST | Yes |
| Auth | /auth/login, /refresh, /forgot, /reset | POST | Public (limited) |

### Shared Types (TypeScript ↔ Prisma)

| Frontend Type | Backend Model | Alignment |
|--------------|--------------|-----------|
| InventoryItem | Inventory | Full (with is_active) |
| Sale, SaleItem, Installment | Sale, SaleItem, Installment | Full |
| Customer | Customer | Full |
| Supplier, SupplierPayment | Supplier, SupplierPayment | Full |
| Expense | Expense | Full |
| User | User | Partial (no password_hash) |
| Showroom | Showroom | Full |
| Notification | Notification | Full |
| Subscription | Subscription | Full |
| ActivityLogEntry | AuditLog | Full |
| LicenseStatus | Showroom (computed) | Computed |
| DashboardKPIs | Aggregated queries | Matching |
