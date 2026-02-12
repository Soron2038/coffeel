# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CofFeEL is a self-hosted coffee tracking system for iPad kiosk mode, replacing a paper tally system at CFEL (Center for Free-Electron Laser Science). Built with intentionally minimal dependencies for 5+ year maintenance-free operation.

**Stack:** Node.js 20.x + Express.js + SQLite3 (better-sqlite3) + Vanilla JS frontend (no frameworks)

## Development Commands

```bash
npm install                # Install dependencies
cp .env.example .env       # First-time setup: create env file
npm run db:init            # Initialize/reset database schema
npm run db:seed            # Seed test users

npm run dev                # Development server (nodemon auto-reload, port 3000)
npm start                  # Production mode

npm test                   # Run Jest tests with coverage
npm run test:watch         # Watch mode
npm test -- tests/services/payment.test.js  # Run single test file

npm run lint               # ESLint check
npm run lint:fix           # Auto-fix lint issues
npm run db:backup          # Create database backup
```

## Architecture

Layered backend with vanilla JS frontend, all served from a single Express app:

```
src/
├── server.js              # Express entry point
├── db/
│   ├── database.js        # SQLite singleton (WAL mode, prepared statements)
│   ├── schema.sql         # Full schema with indexes/triggers
│   └── defaults.sql       # Default settings initialization
├── routes/
│   ├── api.js             # All API endpoints under /api/
│   └── admin.js           # Admin auth middleware (requireAdmin)
├── services/              # Business logic layer
│   ├── userService.js     # User CRUD, soft/hard delete, restore
│   ├── paymentService.js  # Payment request/confirmation logic
│   ├── emailService.js    # SMTP email generation and sending
│   ├── settingsService.js # Runtime settings (no restart needed)
│   └── adminUserService.js # Admin authentication
└── utils/
    ├── logger.js          # Structured logging
    └── validation.js      # Input validation (RFC 5322 email)

public/
├── index.html             # Kiosk interface (/)
├── admin.html             # Admin panel (/admin)
├── login.html             # Admin login
├── js/kiosk.js            # Kiosk UI logic
├── js/admin.js            # Admin panel JS
└── css/                   # variables.css (shared), main.css, admin.css
```

**Database tables:** `users`, `payments`, `settings` (key-value), `audit_log`, `admin_users`

**Key user fields:** `current_tab` (unpaid coffees as amount), `pending_payment` (awaiting admin confirmation), `account_balance` (credit +/debt -)

## Critical Domain Logic

### Payment Flow
1. User clicks Pay → `amount = current_tab`
2. Apply credit: `amountToPay = max(0, amount - account_balance)`
3. If `amountToPay > 0`: send email with bank details, move `current_tab → pending_payment`, create payment record (type='request')
4. If credit covers everything: just deduct from `account_balance`, no email
5. Admin confirms → reduce `pending_payment`, increase `account_balance`; overpayments become credit

### Soft Delete
Users are never hard-deleted by default. Soft delete (`deleted_by_user = 1`) preserves payment history. Only admin can hard-delete or restore.

## Key Conventions

- **All UI text in English** (international staff, not German)
- **Always use database transactions** for payment operations
- **Never reset payment fields on SMTP failure** — payment tracking and email are independent
- **Always use prepared statements** for SQL queries
- **Services use lazy loading** to avoid circular dependencies
- **Consistent return format** from services: `{ success: true/false, data/error }`
- **Git commits:** conventional format (`feat:`, `fix:`, `docs:`, `test:`)
- **Minimal dependencies philosophy** — only add packages that solve complex problems and are widely trusted

## Code Style

ESLint + Prettier enforced: 2-space indent, single quotes, semicolons, max 100 char lines, ES6+ with CommonJS modules.

## Frontend Patterns

- Optimistic UI updates with rollback on error
- Event debouncing: search 150ms, buttons 300ms
- Toast notifications (top-right, 3s auto-dismiss)
- Touch-optimized: min 44×44px tap targets (iPad kiosk mode)
- No frameworks — vanilla JS with direct DOM manipulation

## Testing

Tests in `tests/` — `api/` for integration, `services/` for unit tests. Mock SMTP in tests. Critical areas: payment calculation logic, credit application, soft delete + restore flow.

## Deployment

Production runs behind Nginx (reverse proxy) → Node.js on port 3000, managed by PM2. SQLite database in `data/coffee.db`. See `DEPLOY.sh` for automated deployment and `DEPLOYMENT.md` for full guide.
