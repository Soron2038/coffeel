# CofFeEL — TODO

Tracked items for code improvements and future features.

## Usability Review Findings (2026-07-09)

Usability and accessibility review of the kiosk UI (`/`) and admin panel (`/admin`),
conducted as a live Playwright walkthrough (iPad 1024×768 + 768×1024 for the kiosk,
desktop 1280×800 for admin) against a seeded database. Every finding was verified
against code, DB state, or the accessibility tree.

### Critical (fix before relying on it in production)

- [ ] **1. Failed payment emails are invisible end-to-end**
  (Nielsen 9: error recovery; 1: visibility of system status)
  When SMTP fails, the kiosk toast still says "Payment request sent (€6.00)" — only the
  color (yellow) and a ⚠️ hint at a problem; no explanation, no recovery action. The text
  comes unchanged from `src/services/paymentService.js:137-139`; `public/js/kiosk.js:286`
  only switches the toast type. On the admin side the failure is nearly invisible too:
  the bounce badge and the "With Bounces" filter only count `bounced_hard/soft`, not
  `send_failed` (`src/services/userService.js:51`) — the status only appears inside the
  collapsed "Recent email activity" expander of the user-edit modal.
  Consequence: the user waits for an email that never arrives; the admin sees "Pending"
  and assumes the email went out; the payment loop dies silently.
  **Fix:** honest toast when `emailSent: false` ("Your tab was recorded, but the email
  could not be sent — please contact the admin") + include `send_failed` in the
  badge/filter of the Active Users table.

### Major (next iteration)

- [ ] **2. Admin timestamps are 2 h off (UTC shown as local time)** (Nielsen 2)
  A payment triggered at 14:45 CEST shows as "12:45" in Last Request / Payment History /
  admin last login, while the Backups tab correctly shows local time. Cause:
  `new Date("2026-07-09 12:45:02")` in `public/js/admin.js:1622-1626` parses the SQLite
  UTC string as local time. Wrong times are risky for payment reconciliation.
  **Fix:** mark UTC strings as such before parsing (e.g. `replace(' ', 'T') + 'Z'`).

- [ ] **3. Kiosk card vs. pay dialog show contradictory amounts for pending payments**
  (Nielsen 4)
  A user with a pending payment sees €15.00 on the card
  (`public/js/kiosk.js:139`: `currentTab + pendingPayment`), clicks Pay and is asked
  "Send payment request for €1.50?" (`public/js/kiosk.js:268`: `currentTab` only).
  Without a breakdown this looks like a calculation error.
  **Fix:** show tab and pending separately on the card (e.g. "€1.50 + €13.50 pending")
  or make the dialog explain why only €1.50 is requested.

- [ ] **4. Pay dialog always promises an email — even when credit covers everything**
  (Nielsen 2)
  A user with €10 credit and a €2.50 tab gets "Send payment request for €2.50? You will
  receive an email with payment instructions." — in reality nothing is requested and no
  email is sent (credit path in `src/services/paymentService.js:82-99`); the static text
  lives in `public/js/kiosk.js:273`. Credit is also invisible on the kiosk card, so the
  user cannot know no transfer is needed.
  **Fix:** context-dependent dialog ("€2.50 will be deducted from your credit — no
  payment needed") and show the credit balance on the card.

- [ ] **5. `/admin` returns a raw Express 404 ("Cannot GET /admin")** (Nielsen 9)
  Only `/admin.html` is registered (`src/server.js:109`). The intuitive URL — which
  README/CLAUDE.md advertise as "Admin panel (/admin)" — ends in a cryptic error page.
  **Fix:** redirect `/admin` → `/admin.html` (one line).

- [ ] **6. Default login `admin`/`admin` with no prompt to change it**
  (error prevention / security)
  `src/services/adminUserService.js:181-190` creates the default admin; nothing in the
  UI urges changing the password. On the institute network the panel is reachable by
  anyone who knows the URL.
  **Fix:** show a banner in the admin panel as long as `admin` still uses the default
  password.

- [ ] **7. Settings don't show the effective SMTP configuration** (Nielsen 1;
  state fidelity)
  The SMTP fields show the DB value (empty), but the server falls back to `.env`
  (`src/services/emailService.js:12-21`) — proven live: the `.env.example` placeholder
  `{{smtp_host}}` counted as "configured" and produced real `send_failed` attempts while
  the settings page suggested "not configured". Also: the empty password field looks
  filled because of its `••••••••` placeholder — you can't tell whether a password is
  stored.
  **Fix:** display effective values (including source, e.g. "from environment"); replace
  the password placeholder with "(not set)" / "(unchanged)".

### Minor (backlog)

- [ ] **8.** Kiosk list sorts by last name but displays "FirstName LastName"
  (`src/services/userService.js:73`) — looks unsorted when scanning. Fix: display
  "LastName, FirstName" or sort by first name.
- [ ] **9.** Coffee price is not shown anywhere on the kiosk — new users must infer it
  from the €0.50 steps. Fix: "1 coffee = €0.50" in the header.
- [ ] **10.** "⏳ Pending" badge: 12px at ~3.7:1 contrast (AA requires 4.5:1), measured
  `rgb(154,123,91)` on a light background — hard to read on the kiosk display.
- [ ] **11.** Kiosk delete dialog doesn't name the user ("delete your entry?") — on a
  shared device "delete the entry of Max Mustermann?" prevents mix-ups. The admin
  hard-delete dialog already does this right.
- [ ] **12.** Admin button "Adjust" opens a modal titled "Edit User"
  (`public/admin.html:493`) — the label suggests amount correction, but it edits
  name/email/tab. Fix: rename the button to "Edit".
- [ ] **13.** Credit-covered payments are missing from Payment History — the credit path
  only writes to the UI-less `audit_log`, with `amount = 0`
  (`src/services/paymentService.js:94-99`); consuming €2.50 of credit is not traceable
  anywhere.
- [ ] **14.** Kiosk a11y bundle: toasts without `aria-live`, modals without
  `role="dialog"`/`aria-modal`, +/−/🗑️ buttons without per-user accessible names
  ("plus button" ×11 for screen readers). Low reach on a touch kiosk, but cheap to fix.
- [ ] **15.** Idle screen (logo) has no "Tap to start" hint; names truncate in portrait
  ("Peter Anders…"); favicon missing (404 in every console); the Delete button for the
  last remaining admin is clickable even though the server rejects it.

### Side findings (dev tooling, not UI)

- [ ] **`npm run db:seed` is broken:** uses the removed column `coffee_count` instead of
  `current_tab` (`scripts/seed-db.js:28`) — fails with SQLITE_ERROR.
- [ ] **`.env.example` placeholders like `{{smtp_host}}` are truthy** — a copied `.env`
  creates a phantom SMTP configuration with real DNS failures instead of triggering the
  "not configured" guard.

### What's working well (don't change)

- All touch targets ≥ 44×44px (measured) — consistently iPad-ready.
- Optimistic UI with instant feedback on +/−, − as a natural undo, disabled states at €0.00.
- Confirm dialogs before all money/delete actions; the hard-delete dialog is exemplary
  (names the user + "cannot be undone").
- Empty states everywhere, with guidance (search, backups, broadcast history, email log).
- Broadcasts tab: placeholder docs, recipient count, preview rendered with a real sample
  user, "Test send to me" before "Send to all" — a clean escalation ladder.
- Confirm-payment modal with pre-filled amount; overpayment clearly communicated as
  credit ("Payment confirmed. Credit: €6.50").
- Clear login errors shown in place; session redirects work in both directions.

### Top priority fix

**Finding 1 (silent email failures) first.** The app's purpose is to replace the paper
tally with a trustworthy, maintenance-free payment loop. Exactly this loop breaks
silently when SMTP misbehaves: the user believes the payment request is on its way, the
admin sees no signal at all. Two small changes (honest toast text on
`emailSent: false`, `send_failed` in badge/filter) close the gap — and finding 7
(settings showing a phantom configuration) removes the most likely root cause along the
way.

## Code Optimizations

### High Priority

- [x] CSS variable consolidation → `public/css/variables.css`
- [x] Remove unused `express-basic-auth` dependency
- [x] Backup path validation helper → `src/routes/api.js`
- [x] Timestamp formatting helper → `src/routes/api.js`
- [ ] Email template consolidation — merge `generatePaymentRequestEmail()` and `generatePaymentRequestEmailByAmount()` in `src/services/emailService.js` (~150 lines savings)

### Medium Priority

- [ ] Frontend API wrapper — shared `public/js/utils/api.js` for kiosk.js + admin.js
- [ ] Toast notification utility — shared `public/js/utils/toast.js`
- [ ] Polling mechanism utility — shared `public/js/utils/poller.js`
- [ ] Email HTML styling — extract shared styles/template in emailService.js (~100 lines savings)
- [ ] CSV export — consider proper escaping or `csv-stringify` library

### Low Priority

- [ ] Session secret warning when `SESSION_SECRET` env var is missing (`src/server.js`)
- [ ] Modal handling utility for frontend
- [ ] Shared `escapeHtml()` function across frontends
- [ ] Lazy-loading pattern cleanup in services (circular dependency smell)
- [ ] Error handling middleware for service result pattern
- [ ] Form validation rule sharing between client/server
- [ ] Database wrapper evaluation (recommend keeping as-is)

## Future Features

- [ ] Email template editor — admin-editable email text (subject, greeting, body, closing) stored in settings table
- [ ] Statistics dashboard — charts for coffee consumption over time
- [ ] User self-service portal — users view own payment history
- [ ] Multiple coffee prices — support different beverages
- [ ] Dark mode — theme toggle for kiosk interface
