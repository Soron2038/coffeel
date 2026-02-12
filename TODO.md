# CofFeEL — TODO

Tracked items for code improvements and future features.

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
