# YS-Matrix ERP

Multi-tenant SaaS ERP platform for automotive showrooms with RBAC, real-time notifications, and Arabic-first UX. Built with Next.js 15 (App Router), Express.js, Prisma 5, PostgreSQL, and Tailwind CSS.

---

## Quick Start

### Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- npm or yarn

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/yssoftware515/YS-Matrix.git
cd YS-Matrix

# 2. Install backend dependencies
cd backend
npm install
cp .env.example .env          # Fill in your DATABASE_URL, JWT secrets, etc.

# 3. Run database migrations
npx prisma migrate dev

# 4. Seed the database
npm run db:seed

# 5. Start the backend (port 5000)
npm run dev

# 6. Install frontend dependencies (new terminal)
cd ../frontend
npm install
cp .env.example .env.local    # Set NEXT_PUBLIC_API_URL

# 7. Start the frontend (port 3000)
npm run dev
```

### Running Tests

```bash
# Backend unit tests
cd backend && npm test

# Backend integration tests (requires test PostgreSQL on port 5434)
npm run test:integration

# Frontend build verification
cd frontend && npm run build
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS |
| State | Zustand, React Query (TanStack Query) |
| Charts | Recharts (dynamically imported) |
| Animations | Framer Motion |
| Backend | Express.js 4, Node.js >= 18 |
| Database | PostgreSQL 14+, Prisma 5 ORM |
| Auth | JWT (Access + Refresh), bcryptjs |
| Validation | Zod (request validation), Prisma (schema validation) |
| Security | Helmet, CORS, express-rate-limit, CSRF protection |
| Email | Resend |
| Testing | Node.js test runner (unit), integration test suite |
| CI/CD | GitHub Actions |
| Deployment | Vercel (frontend), Node host (backend) |

---

## Project Structure

```
YS-Matrix/
├── frontend/                  # Next.js 15 App Router
│   ├── src/
│   │   ├── app/               # Route-based pages (App Router)
│   │   ├── components/        # Reusable UI components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # API client, utilities
│   │   ├── providers/         # React Query, auth providers
│   │   ├── stores/            # Zustand state stores
│   │   └── types/             # TypeScript type definitions
│   ├── vercel.json            # Security headers + caching
│   └── tailwind.config.js
├── backend/                   # Express.js API
│   ├── src/
│   │   ├── config/            # Environment, security config
│   │   ├── controllers/       # Route handlers
│   │   ├── middleware/        # Auth, validation, error handling
│   │   ├── routes/            # Express route definitions
│   │   ├── services/          # Business logic
│   │   ├── utils/             # Seed scripts, helpers
│   │   └── index.js           # App entry point
│   ├── prisma/
│   │   └── schema.prisma      # Database schema + migrations
│   └── tests/                 # Unit + integration tests
└── docs/                      # Architecture, security, deployment docs
```

---

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/YS_MATRIX_ARCHITECTURE.md) | System architecture, component diagram, data flow |
| [Security Audit](docs/YS_MATRIX_SECURITY_AUDIT.md) | Full security audit with 19 findings and remediation status |
| [Market Value & USPs](docs/YS_MATRIX_MARKET_VALUE_AND_USPS.md) | 5 core USPs, competitive advantage matrix, business value mapping |
| [Deployment Runbook](docs/DEPLOYMENT_RUNBOOK.md) | Step-by-step Vercel deployment guide with environment variables |
| [API Audit](docs/YS_MATRIX_API_AUDIT.md) | API endpoint inventory and validation audit |
| [Database Schema](docs/YS_MATRIX_DATABASE.md) | Database design, relationships, indexing strategy |
| [Feature Inventory](docs/YS_MATRIX_FEATURE_INVENTORY.md) | Complete feature list with implementation status |
| [Tech Stack](docs/YS_MATRIX_TECH_STACK.md) | Technology choices and rationale |

---

## Environment Variables

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Backend API URL (e.g., `https://api.yourdomain.com/api/v1`) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | No | Support email shown on Settings page |

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Yes | 64-char random secret for access tokens |
| `JWT_REFRESH_SECRET` | Yes | 64-char random secret for refresh tokens |
| `ALLOWED_ORIGINS` | Prod | Comma-separated frontend URLs (no localhost) |
| `CRON_SECRET` | Prod | Secret for cron trigger endpoint |
| `NODE_ENV` | No | Set to `production` for prod (`development` default) |
| `BCRYPT_ROUNDS` | No | Password hash rounds, 4-15 (default: `12`) |
| `EMAIL_TRANSPORT` | No | `resend` or `console` (default: `resend`) |
| `RESEND_API_KEY` | No | Resend API key for email sending |
| `FRONTEND_URL` | No | Frontend URL for password reset links |

See [`.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example) for the full template.

---

## License

Private — YS Software. All rights reserved.
