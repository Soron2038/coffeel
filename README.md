# ☕ CofFeEL - Coffee Tracking System

A self-hosted coffee tracking system designed for CFEL (Center for Free-Electron Laser Science), optimized for iPad kiosk mode.

## 📋 Overview

CofFeEL replaces a paper-based coffee tally system with a modern, touch-optimized web application. Users can track their coffee consumption and request payments when ready, while administrators manage payments and system settings.

## ✨ Features

- **iPad Kiosk Mode**: Touch-optimized interface (min 44×44px touch targets)
- **Coffee Tracking**: Simple +/- buttons to track consumption
- **Payment System**: Automated email requests with credit/debit tracking
- **Soft Delete**: Users can remove themselves (reversible by admin)
- **Admin Panel**: Payment confirmation, user management, settings
- **Audit Log**: Complete history of all actions
- **Email Notifications**: Automatic payment request emails with bank details

## 🚀 Production Deployment

For a fresh Ubuntu 22.04+ server, the bundled `DEPLOY.sh` does everything end-to-end. Run it as a sudo-capable user (not root):

```bash
curl -fsSL https://raw.githubusercontent.com/Soron2038/coffeel/main/DEPLOY.sh | bash
```

The script walks through 13 steps:

1. System packages (`build-essential`, `git`, `curl`, `sqlite3`)
2. Node.js 20.x LTS
3. PM2 process manager
4. Nginx (with `client_max_body_size 50M` so DB backup uploads via the Admin Panel work)
5. Clone the repo into `/opt/coffeel`
6. `npm install --production`
7. Optional interactive `.env` setup (SMTP, bank details, coffee price) — skip it and configure later in the Admin Panel → Settings
8. Initialize the SQLite database (creates default admin user `admin` / `admin`)
9. Configure Nginx as reverse proxy to port 3000
10. Start the app under PM2
11. Optional UFW firewall (ports 22, 80, 443)
12. Optional Let's Encrypt SSL via Certbot
13. Optional daily 3 AM backup cron (runs `scripts/daily-db-backup.js`, emails the admin a stats report with the `.db` attached, prunes anything older than 30 days)

After install:

- Kiosk UI: `http://<server-ip>/`
- Admin Panel: `http://<server-ip>/admin.html`
- Default login: `admin` / `admin` — **change immediately** in Admin Panel → Admin Users.

For manual step-by-step instructions, troubleshooting, and disaster recovery, see [DEPLOYMENT.md](DEPLOYMENT.md).

## 💻 Local Development

### Prerequisites

- Node.js 20.x LTS or higher
- npm 10.x or higher

### Setup

```bash
git clone https://github.com/Soron2038/coffeel.git
cd coffeel

npm install
cp .env.example .env
# Edit .env with your SMTP / bank settings (or configure later in the Admin Panel)

npm run db:init        # Initialize database schema + default admin user
npm run db:seed        # (Optional) seed test users

npm run dev            # Start dev server with auto-reload
```

The kiosk interface will be available at `http://localhost:3000`
The admin panel will be at `http://localhost:3000/admin.html`

## 🔄 Updates

On the production server, run the bundled `UPDATE.sh`:

```bash
cd /opt/coffeel
./UPDATE.sh
```

The script does the following automatically:

1. **Pre-update DB backup** to `data/backups/coffeel_preupdate_<timestamp>.db`
2. **Pull from GitHub** (auto-detects `main` / `master`, auto-stashes uncommitted local changes and restores them after)
3. **Reinstall dependencies** — only if `package.json` or `package-lock.json` actually changed
4. **Restart PM2** — only if files under `src/` changed
5. **Configuration drift check** — scans the live server for outdated server config and offers to repair it; each item is prompted separately (default: no), so nothing is changed without explicit approval. Currently detects:
   - missing `client_max_body_size` in the Nginx site config (would otherwise reject DB uploads with HTML 413)
   - the legacy bash backup cron, replacing it with the current `scripts/daily-db-backup.js`-based one

### Flags

| Flag | Effect |
|------|--------|
| _(none)_ | Standard update — restarts / installs only when needed |
| `--restart` | Force a PM2 restart even if no code changed |
| `--deps` | Force `npm install` even if `package.json` didn't change |
| `--help` | Show usage |

If the update finishes with no changes pending (no remote commits, no force flags), the script exits early and leaves the running service alone.

## ⚙️ Configuration

### Environment Variables (`.env`)

`DEPLOY.sh` generates this file for you. For manual setup, here is the full schema:

```env
# Server
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Session secret for the admin login cookie (any random 32+ byte hex string)
SESSION_SECRET=<openssl rand -hex 32>

# Database
DB_PATH=./data/coffee.db

# SMTP (for payment request and broadcast emails)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM="CofFeEL System <coffee@example.com>"

# Admin email — receives CC of payment requests, daily backup reports, etc.
ADMIN_EMAIL=admin@example.com

# Bank details (shown in payment emails)
BANK_IBAN=DE89370400440532013000
BANK_BIC=COBADEFFXXX
BANK_OWNER="CFEL Coffee Fund"

# Coffee price in EUR (also editable in Admin Panel → Settings)
COFFEE_PRICE=0.50

# Rate limiting (per IP)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

# Logging
LOG_LEVEL=info
```

> Admin credentials are **not** stored in `.env` — they live in the `admin_users` table. `npm run db:init` seeds a default `admin` / `admin` user; change the password from Admin Panel → Admin Users on first login.

## 📱 Kiosk Interface (`/`)

### User Actions

1. **Add Coffee** (+): Increment coffee count
2. **Remove Coffee** (−): Decrement coffee count (minimum 0)
3. **Pay**: Send payment request email
   - Automatically applies existing credit
   - Creates payment record
   - Sends email with bank details
4. **Delete**: Soft-delete yourself from kiosk (reversible by admin)

### Search

Real-time search with 150ms debouncing - searches name and email.

### Adding Users

Click "Add User" button and fill in:
- First Name (min 2 characters)
- Last Name (min 2 characters)
- Email (must be unique)

## 🔧 Admin Panel (`/admin.html`)

### Authentication

Session-based login via `/login.html`. Credentials are stored in the `admin_users` database table (bcrypt-hashed). `npm run db:init` seeds a default `admin` / `admin` account — change it on first login.

### Tabs

1. **Active Users** — view active users, confirm payments, adjust tabs
2. **Deleted Users** — view soft-deleted users, restore them, confirm pending payments
3. **Payment History** — filterable list of all payment transactions, export to CSV
4. **Settings** — coffee price, SMTP, bank details, admin email
5. **Broadcasts** — compose and send announcement emails to all active users
6. **Admin Users** — manage admin accounts, change passwords
7. **Backups** — create / download / upload / restore database backups

### Admin Actions

- **Confirm Payment**: Enter amount received, reduces pending payment, increases balance
- **Adjust Coffee Count**: Manually set coffee count for a user
- **Send Payment Request**: Trigger payment email for users with outstanding coffees
- **Restore User**: Reactivate soft-deleted user
- **Permanent Delete**: Remove user and all history (use with caution)
- **Export CSV**: Download all user and payment data

## 📡 API Reference

### Base URL

```
http://localhost:3000/api
```

### User Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/users` | List all users | No |
| GET | `/users?includeDeleted=true` | Include soft-deleted users | No |
| GET | `/users/:id` | Get single user | No |
| POST | `/users` | Create new user | No |
| DELETE | `/users/:id` | Soft delete user | No |
| POST | `/users/:id/restore` | Restore deleted user | Admin |
| DELETE | `/users/:id/permanent` | Hard delete user | Admin |

### Coffee Tracking

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/users/:id/increment` | Add one coffee | No |
| POST | `/users/:id/decrement` | Remove one coffee | No |
| PUT | `/users/:id/coffee-count` | Set coffee count | Admin |

### Payments

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/users/:id/pay` | Request payment (send email) | No |
| POST | `/users/:id/confirm-payment` | Confirm payment received | Admin |
| GET | `/payments` | Get payment history | Admin |
| GET | `/payments/summary` | Get payment statistics | Admin |

### Settings

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/settings` | Get all settings | Admin |
| PUT | `/settings/:key` | Update a setting | Admin |

### Export

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/export/csv` | Export all data as CSV | Admin |
| GET | `/export/json` | Export all data as JSON | Admin |

### Health Check

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/health` | Server health status | No |

### Request/Response Examples

**Create User:**
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"firstName": "John", "lastName": "Doe", "email": "john@example.com"}'
```

**Confirm Payment (Admin):**
```bash
# Admin endpoints require a session cookie from POST /api/admin/login.
# Easiest path: store the cookie and reuse it.
curl -c cookies.txt -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "yourpassword"}'

curl -b cookies.txt -X POST http://localhost:3000/api/users/1/confirm-payment \
  -H "Content-Type: application/json" \
  -d '{"amount": 5.00, "notes": "Bank transfer received"}'
```

## 💾 Database Schema

### users
- `coffee_count`: Current unconsumed coffees
- `pending_payment`: Amount awaiting admin confirmation
- `account_balance`: Running balance (negative = debt, positive = credit)
- `deleted_by_user`: Soft delete flag

### payments
- `type`: 'request' or 'received'
- `confirmed_by_admin`: Boolean flag

## 💰 Payment Flow

### User Clicks "Pay"

1. Calculate amount: `coffee_count × coffee_price`
2. Apply existing credit if available
3. Send email with payment request (if amount > 0)
4. Reset coffee count to 0

### Admin Confirms Payment

1. Reduce `pending_payment`
2. Increase `account_balance`
3. Overpayments automatically become credit

## 🛠 Development

### Available Scripts

```bash
npm start           # Production mode
npm run dev         # Development with auto-reload
npm run db:init     # Initialize/reset database
npm run db:seed     # Add test users
npm run db:backup   # Create backup
npm run db:migrate  # Apply pending schema migrations
npm test            # Run tests with coverage
npm run lint        # Run ESLint
npm run lint:fix    # Auto-fix lint issues
```

## 🔒 Security

- HTTPS required for production (Let's Encrypt automated by `DEPLOY.sh`)
- Session-based admin login with bcrypt-hashed passwords in DB — change the default `admin` / `admin` immediately
- Prepared statements (SQL injection prevention)
- Rate limiting: 60 requests/minute per IP
- Input validation on client and server
- `.env` file permissions set to `600` by `DEPLOY.sh`
- Nginx security headers (`X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`)

## 🚨 Troubleshooting

### Server won't start

1. Check if port 3000 is already in use: `lsof -i:3000`
2. Verify Node.js version: `node --version` (should be 20.x+)
3. Check `.env` file exists and is properly configured
4. Try removing `node_modules` and reinstalling: `rm -rf node_modules && npm install`

### Database errors

1. Reset database: `npm run db:init`
2. Check write permissions on `data/` directory
3. Verify `DB_PATH` in `.env` is correct

### Email not sending

1. Check SMTP settings in `.env`
2. Test SMTP connection with external tool first
3. Check server logs for SMTP errors
4. **Note:** Payment tracking works even if email fails

### Admin panel not loading

1. Visit `/login.html` directly and sign in with the credentials from the `admin_users` table (default `admin` / `admin` after `db:init`).
2. If you forgot the password and another admin user still exists, log in as that user and reset the password under Admin Panel → Admin Users.
3. If no admin login works, reset on the server with sqlite3 + bcrypt — generate a hash and update the row:
   ```bash
   cd /opt/coffeel
   node -e "console.log(require('bcryptjs').hashSync('newpass', 10))"
   sqlite3 data/coffee.db "UPDATE admin_users SET password_hash = '<hash from above>' WHERE username = 'admin';"
   ```
4. Clear browser cache and try incognito mode.
5. Check browser console for JavaScript errors.

### iPad kiosk issues

1. Ensure Safari is in fullscreen mode
2. Enable "Guided Access" in iOS settings for true kiosk mode
3. Check network connectivity
4. Clear Safari cache if UI looks broken

### Performance issues

1. Check SQLite database size: `ls -lh data/coffee.db`
2. Run vacuum: `sqlite3 data/coffee.db "VACUUM;"`
3. Check server memory with `pm2 monit` (if using PM2)

## 📝 License

MIT

## 👥 Credits

Developed for CFEL (Center for Free-Electron Laser Science)

Co-Authored-By: Warp <agent@warp.dev>
