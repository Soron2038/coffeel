# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview
CofFeEL is a self-hosted coffee tracking system designed to run on an iPad in kiosk mode. It replaces a paper-based tally system at CFEL (Center for Free-Electron Laser Science).

**Tech Stack:**
- Backend: Node.js 20.x LTS + Express.js + SQLite3
- Frontend: Vanilla JavaScript (ES6+) + Modern CSS
- No frameworks (React/Vue/etc.) - intentionally minimal for long-term maintenance
- Deployment: Linux VM + Nginx + systemd/PM2

**Design Philosophy:**
- Maintenance-free operation (5+ years without code changes)
- Touch-optimized UI for iPad kiosk mode
- All UI text in English (international staff)
- Minimal dependencies (< 10 npm packages)

## Development Commands

### Initial Setup
```bash
# Install dependencies
npm install

# Create .env file from example
cp .env.example .env

# Initialize database (creates schema and default settings)
npm run db:init

# Seed database with test users (optional)
npm run db:seed
```

### Running the Application
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start

# Run with PM2 (production)
pm2 start ecosystem.config.js
```

### Database Management
```bash
# Initialize/reset database
npm run db:init

# Create backup
npm run db:backup

# Restore from backup
npm run db:restore <backup-file>

# Run migrations
npm run db:migrate
```

### Testing
```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/api/users.test.js

# Run with coverage
npm run test:coverage

# Run linting
npm run lint

# Run type checking (if applicable)
npm run typecheck
```

## Architecture

### Core Design Principles
1. **Simplicity Over Complexity**: Vanilla JS over frameworks to minimize breaking changes
2. **Data Integrity**: All payment tracking uses atomic transactions
3. **Soft Deletes**: Users are never hard-deleted to preserve payment history
4. **Optimistic UI**: Immediate feedback with server sync

### Database Schema

**users table:**
- `coffee_count`: Current unconsumed coffees (reset to 0 on Pay)
- `pending_payment`: Amount requested but not yet confirmed by admin
- `account_balance`: Running balance (negative = debt, positive = credit)
- `deleted_by_user`: Soft delete flag (user can self-delete from kiosk)
- `last_payment_request`: Timestamp of last Pay button click

**payments table:**
- `type`: 'request' (user clicked Pay) or 'received' (admin confirmed payment)
- `confirmed_by_admin`: Boolean flag for admin-confirmed payments
- `coffee_count`: Snapshot of coffees at time of payment request

**settings table:**
- Key-value store for runtime config (coffee_price, SMTP settings, bank details)
- Changes take effect immediately without server restart

**audit_log table (optional):**
- Tracks all actions: increment, decrement, payment_request, payment_received, soft_delete, restore, hard_delete

### Payment Flow Logic

**User clicks Pay button:**
1. Calculate amount: `coffee_count × coffee_price`
2. Apply existing credit: `amount -= max(0, account_balance)`
3. If amount > 0 after credit:
   - Send email with payment request
   - Set `coffee_count = 0`
   - Increase `pending_payment += amount`
   - Decrease `account_balance -= amount`
   - Create `payments` entry (type='request')
4. If credit covers all costs:
   - Decrease `account_balance` only
   - Set `coffee_count = 0`
   - No email needed

**Admin confirms payment:**
1. Decrease `pending_payment` by min(amount, pending_payment)
2. Increase `account_balance` by amount
3. Create `payments` entry (type='received', confirmed_by_admin=1)
4. Overpayments automatically become credit

### API Structure

All endpoints under `/api/`:
- `GET /api/users?includeDeleted=true` - List users (admin can see deleted)
- `POST /api/users` - Register new user
- `DELETE /api/users/:id` - Soft delete (self-service)
- `POST /api/users/:id/restore` - Reactivate deleted user (admin only)
- `DELETE /api/users/:id/permanent` - Hard delete (admin only, requires auth)
- `POST /api/users/:id/increment` - Add one coffee
- `POST /api/users/:id/decrement` - Remove one coffee
- `POST /api/users/:id/pay` - Send payment request email
- `POST /api/users/:id/confirm-payment` - Admin confirms payment received

Admin panel at `/admin` (HTTP Basic Auth)

### Frontend Architecture

**Kiosk View** (`/`):
- User list with real-time search (debounced 150ms)
- Only shows active users (`deleted_by_user = 0`)
- +/- buttons for coffee tracking
- Pay button triggers email
- Self-service delete button per user
- Touch-optimized (min 44×44px buttons)

**Admin Panel** (`/admin`):
- Active Users tab: payment confirmation, manual adjustments
- Deleted Users tab: restore, send payment requests, confirm payments
- Settings: coffee price, SMTP config, bank details
- Payment History: filterable, exportable to CSV
- Data Export: full CSV including deleted users

**UI Components:**
- Optimistic updates with rollback on error
- Toast notifications (top-right, 3s auto-dismiss, English text)
- Skeleton screens instead of spinners
- Confirmation dialogs for destructive actions

### Performance Requirements
- Page load: < 1s
- API response: < 200ms
- UI reactivity: < 100ms (perceived)
- Search debounce: 150ms
- Button debounce: 300ms (prevent double-clicks)

## Key Implementation Details

### Input Validation
- Client-side: Instant feedback on form fields
- Server-side: Always validate (never trust client)
- Email validation: RFC 5322 compliant
- Duplicate detection: Case-insensitive on email

### SMTP Error Handling
- Never reset payment state on SMTP failure
- Log errors for admin review
- Retry mechanism recommended
- Show user-friendly error messages in English

### Security Considerations
- HTTPS only (Let's Encrypt)
- Prepared statements for all SQL queries (prevent injection)
- HTTP Basic Auth for admin panel (minimal protection)
- Rate limiting: 60 requests/minute per IP
- Input sanitization on all endpoints

### iPad Kiosk Mode Requirements
- Viewport: `user-scalable=no`
- Orientation: Portrait-locked
- Touch-optimized: Min 44×44px tap targets
- No auto-logout (kiosk stays active)
- Fullscreen mode (no browser chrome)

### Long-Term Maintenance Strategy
- Pin Node.js to LTS 20.x (in .nvmrc)
- Minimal dependencies to reduce breaking changes
- SQLite WAL mode for corruption resistance
- Daily automated backups (cronjob at 3 AM)
- Comprehensive audit logging for troubleshooting

## Common Pitfalls to Avoid

1. **Never hard-delete users**: Always use soft delete to preserve payment history
2. **Never reset payment fields on SMTP error**: Payment tracking and email are separate concerns
3. **Always use transactions**: Payment operations must be atomic
4. **Never expose environment variables**: Use {{placeholder}} syntax in generated code
5. **Locale-aware sorting**: Sort by last name, then first name (case-insensitive)
6. **Credit application**: Always check and apply existing credit before creating payment requests

## Localization
- All UI text: English (not German)
- Toast notifications: English
- Email templates: English
- Admin panel: English
- Error messages: English

Rationale: International staff at CFEL with limited German skills (per PRD requirements)

## Deployment Notes

**Nginx reverse proxy setup:**
- Proxy to `localhost:3000`
- Enable WebSocket upgrade headers if adding real-time features later
- SSL via Let's Encrypt

**PM2 process management:**
- Use `ecosystem.config.js` for PM2 config
- Enable auto-restart on crash
- Set up log rotation

**Backup strategy:**
- Daily automated backup at 3 AM
- SQLite file copy to `/backup/coffeel_YYYYMMDD.db`
- Keep 30 days of backups minimum

**Monitoring:**
- PM2 logs: `pm2 logs coffeel`
- Uptime monitoring: UptimeRobot or similar
- Weekly disk space check (SQLite growth)

## Testing Strategy
- Unit tests for payment calculation logic (critical)
- Integration tests for API endpoints
- E2E tests for payment flow (user clicks Pay → admin confirms)
- Mock SMTP in tests (never send real emails)
- Test soft delete + restore flow thoroughly
- Test credit application logic (overpayment, prepayment scenarios)

## Code Style
- ESLint + Prettier (enforced)
- Modern ES6+ syntax (async/await, not callbacks)
- Descriptive variable names (no abbreviations except standard ones)
- Comments only where logic is non-obvious (e.g., payment calculations)
- Error handling: Always catch and log, never silent failures
