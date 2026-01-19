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

## 🚀 Quick Start

### Prerequisites

- Node.js 20.x LTS or higher
- npm 10.x or higher

### Installation

```bash
# Clone repository
git clone <repository-url>
cd coffeel

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
nano .env

# Initialize database
npm run db:init

# (Optional) Seed test users
npm run db:seed

# Start development server
npm run dev
```

The kiosk interface will be available at `http://localhost:3000`  
The admin panel will be at `http://localhost:3000/admin.html`

## ⚙️ Configuration

### Environment Variables (`.env`)

```env
# Server
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

# Admin Authentication
ADMIN_USER=admin
ADMIN_PASS=your-secure-password

# SMTP Configuration (for payment emails)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM="CofFeEL System <coffee@example.com>"

# Bank Details (shown in payment emails)
BANK_IBAN=DE89370400440532013000
BANK_BIC=COBADEFFXXX
BANK_OWNER="CFEL Coffee Fund"

# Coffee Settings
COFFEE_PRICE=0.50
ADMIN_EMAIL=admin@example.com
```

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

HTTP Basic Auth using credentials from `.env`:
- Username: `ADMIN_USER`
- Password: `ADMIN_PASS`

### Tabs

1. **Active Users**: View all active users, confirm payments, adjust coffee counts
2. **Deleted Users**: View soft-deleted users, restore them, confirm pending payments
3. **Payment History**: Filterable list of all payment transactions, export to CSV
4. **Settings**: Manage coffee price, bank details, admin email

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
curl -X POST http://localhost:3000/api/users/1/confirm-payment \
  -u admin:password \
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
npm start          # Production mode
npm run dev        # Development with auto-reload
npm run db:init    # Initialize/reset database
npm run db:seed    # Add test users
npm run db:backup  # Create backup
npm test           # Run tests
npm run lint       # Run ESLint
```

## 🔒 Security

- HTTPS required for production
- HTTP Basic Auth for admin panel
- Prepared statements (SQL injection prevention)
- Rate limiting: 60 requests/minute per IP
- Input validation on client and server

## 🚨 Troubleshooting

### Server won't start

1. Check if port 3000 is already in use: `lsof -i:3000`
2. Verify Node.js version: `node --version` (should be 20.x+)
3. Check `.env` file exists and is properly configured
4. Try removing `node_modules` and reinstalling: `rm -rf node_modules && npm install`

### Database errors

1. Reset database: `npm run db:init`
2. Check write permissions on `data/` directory
3. Verify `DATABASE_PATH` in `.env` is correct

### Email not sending

1. Check SMTP settings in `.env`
2. Test SMTP connection with external tool first
3. Check server logs for SMTP errors
4. **Note:** Payment tracking works even if email fails

### Admin panel not loading

1. Verify `ADMIN_USER` and `ADMIN_PASS` in `.env`
2. Clear browser cache and try incognito mode
3. Check browser console for JavaScript errors

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
