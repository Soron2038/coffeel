# CofFeEL Refactoring Plan

> **Scope:** 31 issues across 7 phases (accessibility and security deferred per user decision)
> **Approach:** Correctness first, then DRY/maintainability
> **JS strategy:** Separate `<script>` tags (no build step)
> **Generated:** 2026-02-09

---

## Phase 1 — Critical Correctness Fixes

_Fix broken things before reorganizing. No dependencies on other phases._

### Step 1.1 — Fix seed script column name
- **File:** `scripts/seed-db.js`
- **Line:** 28
- **Change:** Replace `coffee_count` → `current_tab` in the INSERT statement
- **Also:** Change the seed values from integer counts (e.g., `5`) to EUR amounts (e.g., `12.50`) to match the actual data model
- **Verify:** Run `npm run db:seed` against a fresh `:memory:` database

### Step 1.2 — Fix theme-color meta tags
- **File:** `public/index.html` line 8
- **Change:** `content="#2563eb"` → `content="#3a2a1d"` (matches brown theme from `--color-gray-800`)
- **File:** `public/admin.html` line 6
- **Change:** `content="#1f2937"` → `content="#3a2a1d"` (same)

### Step 1.3 — Update README.md authentication section
- **File:** `README.md`
- **Lines:** ~113-116
- **Change:** Replace Basic Auth description with session-based auth description:
  - Login page at `/login.html`
  - Admin users stored in `admin_users` table with bcrypt-hashed passwords
  - Session-based with configurable secret via `SESSION_SECRET` env var
  - Default admin created on first run (username: `admin`)

### Step 1.4 — Fix README.md API endpoint name
- **File:** `README.md`
- **Line:** ~160
- **Change:** `PUT /users/:id/coffee-count` → `PUT /users/:id/current-tab`
- **Also:** Update the description from "coffee count" to "current tab (EUR amount)"

### Step 1.5 — Fix README.md schema description
- **File:** `README.md`
- **Line:** ~211
- **Change:** Replace `coffee_count INTEGER` → `current_tab REAL` in the users table description

### Step 1.6 — Update .env.example
- **File:** `.env.example`
- **Lines:** 10-11
- **Change:** Remove `ADMIN_USER` and `ADMIN_PASS` lines
- **Add:** Comment explaining admin users are managed via the admin panel

### Step 1.7 — Update OPTIMIZE.md stale items
- **File:** `OPTIMIZE.md`
- **Item #3** (express-basic-auth): Mark as ✅ resolved
- **Item #7** (backup path validation): Mark as ✅ resolved
- **Item #8** (timestamp formatting): Mark as ✅ resolved

### Step 1.8 — Fix unused variable
- **File:** `src/services/userService.js`
- **Line:** 299
- **Change:** Remove `const oldTab = user.currentTab;` (unused)

### Step 1.9 — Update PRD.md data model references
- **File:** `PRD.md`
- **Sections:** 3.3, 3.4, 5.1, 6.2, 6.3, 7.1.1
- **Change:** Replace all `coffee_count` (integer, count of coffees) references with `current_tab` (REAL, EUR amount)
- **Note:** This is a documentation-only change reflecting the actual implementation

**Phase 1 deliverable:** All broken references fixed, docs match reality.
**Estimated effort:** ~1 hour
**Risk:** Very low — documentation and one-liner fixes only

---

## Phase 2 — CSS Variable Consolidation

_Move shared variables to `variables.css` so both stylesheets can use them. Must complete before Phase 3._

### Step 2.1 — Move spacing variables to variables.css
- **From:** `public/css/main.css` lines 10-16 (the `:root` block with `--space-1` through `--space-6`)
- **To:** `public/css/variables.css` — append to existing `:root` block
- **Variables to move:**
  ```
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 40px;
  --space-6: 48px;
  ```
- **Verify:** `main.css` already imports `variables.css`, so these remain accessible

### Step 2.2 — Move typography extension variables to variables.css
- **From:** `public/css/main.css` lines 19-24
- **To:** `public/css/variables.css` `:root` block
- **Variables to move:**
  ```
  --font-size-sm: 14px;
  --font-size-base: 16px;
  --font-size-lg: 18px;
  --font-size-xl: 24px;
  --font-size-2xl: 32px;
  ```

### Step 2.3 — Add missing hover/accent color variables to variables.css
- **File:** `public/css/variables.css`
- **Add to `:root` block:**
  ```
  --color-success-hover: #4a6b3a;
  --color-danger-hover: #8b3535;
  --color-warning-hover: #a87830;
  --color-primary-dark: #5c3d1e;
  ```
  _(Derive these from the existing palette — darken the base colors to match the warm brown theme rather than using the current blue/green hex values that clash)_

### Step 2.4 — Add touch-target variable to variables.css
- **File:** `public/css/variables.css`
- **Add:** `--touch-min: 44px;` (currently only in main.css, needed for shared button base)

### Step 2.5 — Replace hardcoded hex colors in main.css
- **File:** `public/css/main.css`
- Replace all ~8 hardcoded hex values with the new CSS variables:
  - Line 215: `#059669` → `var(--color-success-hover)`
  - Line 224: `#dc2626` → `var(--color-danger-hover)`
  - Line 322: `#047857` → `var(--color-success)`
  - Line 327: `#b91c1c` → `var(--color-danger)`
  - Line 396: `#059669` → `var(--color-success-hover)`
  - _(and similar instances)_

### Step 2.6 — Replace hardcoded hex colors in admin.css
- **File:** `public/css/admin.css`
- Replace all ~7 hardcoded hex values:
  - Line 265: `#b45309` → `var(--color-warning)`
  - Line 270: `#047857` → `var(--color-success)`
  - Lines 466, 475, 484: hover colors → use CSS variables
  - _(and similar instances)_

### Step 2.7 — Replace hardcoded pixel spacing in admin.css
- **File:** `public/css/admin.css`
- Replace common pixel values with spacing variables throughout:
  - `16px` → `var(--space-2)`
  - `24px` → `var(--space-3)`
  - `32px` → `var(--space-4)`
  - `8px` → `var(--space-1)`
  - `4px` → keep as-is (below spacing grid)
- **Note:** Only replace padding/margin/gap values, NOT border-width, font-size, etc.

**Phase 2 deliverable:** All CSS uses variables consistently. `variables.css` is the single source of truth.
**Estimated effort:** ~1.5 hours
**Risk:** Low — visual regression possible, verify in browser after each step

---

## Phase 3 — CSS Component Extraction

_Extract shared components into a new base stylesheet. Depends on Phase 2 (variables consolidated)._

### Step 3.1 — Create `public/css/base.css`
- **New file:** `public/css/base.css`
- **Content:** Extract these shared patterns into it:
  ```
  @import 'variables.css';

  /* Universal Reset */
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font-family: var(--font-family); }

  /* Shared Button System */
  .btn { ... }           /* base button from main.css:164-180 */
  .btn-primary { ... }
  .btn-secondary { ... }
  .btn-success { ... }
  .btn-danger { ... }

  /* Shared Modal System */
  .modal-overlay { ... }  /* from main.css:462-555 */
  .modal { ... }
  .modal-header { ... }
  .modal-close { ... }
  .modal-body { ... }
  .modal-actions { ... }

  /* Shared Toast System */
  .toast-container { ... } /* from main.css:605-692 */
  .toast { ... }
  @keyframes slideIn { ... }
  @keyframes fadeOut { ... }

  /* Shared Form Elements */
  .form-group { ... }
  .form-group label { ... }
  .form-group input { ... }
  .form-group select { ... }
  ```

### Step 3.2 — Update main.css to import base.css
- **File:** `public/css/main.css`
- **Change:** Replace `@import 'variables.css';` → `@import 'base.css';`
- **Remove:** Duplicated reset, button, modal, toast, and form-group rules
- **Keep:** Kiosk-specific overrides (touch targets, card layout, etc.)

### Step 3.3 — Update admin.css to import base.css
- **File:** `public/css/admin.css`
- **Change:** Replace `@import 'variables.css';` → `@import 'base.css';`
- **Remove:** Duplicated reset (lines 9-13), buttons (lines 409-495), modals (lines 500-587), toasts (lines 592-651)
- **Keep:** Admin-specific overrides (sidebar, tables, tabs, etc.)
- **Add:** Modifier classes where admin needs different values:
  ```css
  /* Admin button overrides */
  .admin-panel .btn { font-weight: 500; border-radius: var(--radius-sm); }
  ```

### Step 3.4 — Extract login.html inline styles to login.css
- **New file:** `public/css/login.css`
- **From:** `public/login.html` lines 8-122 (the `<style>` block)
- **To:** Move all styles to `login.css`
- **File:** `public/login.html`
  - Replace `<style>...</style>` with `<link rel="stylesheet" href="/css/login.css">`
  - Change `<link rel="stylesheet" href="css/main.css">` → `<link rel="stylesheet" href="/css/base.css">` (login only needs base, not full kiosk styles)

### Step 3.5 — Remove inline styles from admin.html
- **File:** `public/admin.html`
- **Lines:** 42-44 (filter group inline styles) → add `.filter-group`, `.filter-label`, `.filter-select` classes to admin.css
- **Lines:** 334-338 (upload section inline styles) → add `.upload-section` class to admin.css

**Phase 3 deliverable:** ~200+ lines of CSS deduplication. Three clean layers: variables → base → page-specific.
**Estimated effort:** ~2.5 hours
**Risk:** Medium — visual regressions likely. Test all three pages (kiosk, admin, login) after each step.

---

## Phase 4 — JavaScript Shared Utilities

_Extract duplicated JS functions into shared files. Depends on nothing but should follow Phase 3 for clean commits._

### Step 4.1 — Create `public/js/utils/api.js`
- **New file:** `public/js/utils/api.js`
- **Extract from:** `kiosk.js:49-68` and `admin.js:130-150`
- **Content:** Shared API wrapper object
  ```javascript
  const api = {
    async request(method, url, data = null) { ... },
    async get(url) { ... },
    async post(url, data) { ... },
    async put(url, data) { ... },
    async delete(url) { ... }
  };
  ```
- **Difference to handle:** admin.js version has 401 redirect logic → make this configurable:
  ```javascript
  // api.js accepts an optional config
  const api = createApi({ on401: null }); // kiosk: no redirect
  const api = createApi({ on401: () => window.location.href = '/login.html' }); // admin: redirect
  ```

### Step 4.2 — Create `public/js/utils/toast.js`
- **New file:** `public/js/utils/toast.js`
- **Extract from:** `kiosk.js:471-493` and `admin.js:929-936`
- **Content:** `showToast(message, type, duration)` function
- **Note:** Both implementations are near-identical; use the kiosk version (more complete with animation handling)

### Step 4.3 — Create `public/js/utils/helpers.js`
- **New file:** `public/js/utils/helpers.js`
- **Extract from:** `kiosk.js:499-503` and `admin.js:908-912`
- **Content:** `escapeHtml(str)` function
- **Also consider adding:** Any other tiny shared utilities that emerge

### Step 4.4 — Create `public/js/utils/poller.js`
- **New file:** `public/js/utils/poller.js`
- **Extract from:** `kiosk.js:560-581` and `admin.js:1052-1070`
- **Content:** `startPolling(fetchFn, compareFn, onChangeFn, interval)` function
- **Enhancement:** Add `document.visibilitychange` listener to pause polling when tab is hidden:
  ```javascript
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(pollId);
    else pollId = setInterval(pollFn, interval);
  });
  ```

### Step 4.5 — Update index.html to load shared utils
- **File:** `public/index.html`
- **Before** the `<script src="/js/kiosk.js">` tag, add:
  ```html
  <script src="/js/utils/helpers.js"></script>
  <script src="/js/utils/toast.js"></script>
  <script src="/js/utils/api.js"></script>
  <script src="/js/utils/poller.js"></script>
  ```

### Step 4.6 — Update admin.html to load shared utils
- **File:** `public/admin.html`
- **Before** the `<script src="/js/admin.js">` tag, add same four script tags

### Step 4.7 — Remove duplicated code from kiosk.js
- **File:** `public/js/kiosk.js`
- **Remove:** `api` object definition (lines ~49-68)
- **Remove:** `showToast()` (lines ~471-493)
- **Remove:** `escapeHtml()` (lines ~499-503)
- **Remove:** `startPolling()` (lines ~560-581)
- **Update:** Initialize api with `const api = createApi({})` at top
- **Update:** Polling call to use new `startPolling()` signature

### Step 4.8 — Remove duplicated code from admin.js
- **File:** `public/js/admin.js`
- **Remove:** `api` object definition (lines ~130-150)
- **Remove:** `showToast()` (lines ~929-936)
- **Remove:** `escapeHtml()` (lines ~908-912)
- **Remove:** `startPolling()` (lines ~1052-1070)
- **Remove:** Window exports for these functions (lines ~1073-1082, selectively)
- **Update:** Initialize api with `const api = createApi({ on401: () => window.location.href = '/login.html' })`

**Phase 4 deliverable:** ~150 lines removed from duplication. Shared utils loaded via script tags.
**Estimated effort:** ~2 hours
**Risk:** Medium — must verify all API calls, toasts, and polling still work on both pages

---

## Phase 5 — Admin.js Event Delegation Refactor

_Replace inline onclick handlers with data-attribute event delegation (matching kiosk.js pattern). Depends on Phase 4._

### Step 5.1 — Update admin.js HTML template strings
- **File:** `public/js/admin.js`
- **Lines:** ~356-456 (render functions)
- **Change all** `onclick="functionName(${id})"` to `data-action="action-name" data-user-id="${id}"`:
  ```html
  <!-- Before -->
  <button onclick="restoreUser(${user.id})">Restore</button>

  <!-- After -->
  <button data-action="restore-user" data-user-id="${user.id}">Restore</button>
  ```
- **Actions to convert:** `restoreUser`, `openPaymentModal`, `confirmPermanentDelete`, `openAdjustModal`, `sendPaymentRequest`

### Step 5.2 — Add event delegation to admin.js
- **File:** `public/js/admin.js`
- **Add:** Single event listener on the user list container:
  ```javascript
  document.getElementById('userTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const userId = parseInt(btn.dataset.userId);
    switch(action) {
      case 'restore-user': restoreUser(userId); break;
      case 'open-payment': openPaymentModal(userId); break;
      // ... etc
    }
  });
  ```

### Step 5.3 — Remove window exports for converted functions
- **File:** `public/js/admin.js`
- **Lines:** ~1073-1082
- **Remove:** `window.restoreUser`, `window.openPaymentModal`, etc. that are no longer called via inline onclick

**Phase 5 deliverable:** Cleaner event handling, no more `window.` pollution for user actions.
**Estimated effort:** ~1 hour
**Risk:** Low-medium — test every button in the admin users table

---

## Phase 6 — Backend Cleanup

_Independent of frontend phases. Can run in parallel with Phases 2-5._

### Step 6.1 — Resolve circular dependency
- **File:** `src/services/userService.js` lines 5-21
- **Approach:** Create `src/services/events.js` with a shared EventEmitter:
  ```javascript
  // events.js
  const EventEmitter = require('events');
  module.exports = new EventEmitter();
  ```
- **File:** `src/services/userService.js`
  - Replace lazy `require()` calls with event emissions:
    ```javascript
    const events = require('./events');
    // Instead of: getEmailService().sendWelcomeEmail(user)
    events.emit('user:created', user);
    ```
- **File:** `src/services/emailService.js`
  - Listen for events:
    ```javascript
    const events = require('./events');
    events.on('user:created', (user) => sendWelcomeEmail(user));
    ```
- **File:** `src/services/paymentService.js`
  - Similar event-based decoupling

### Step 6.2 — Add bulk settings endpoint
- **File:** `src/routes/api.js`
- **Add:** `PUT /api/settings` endpoint that accepts `{ settings: { key: value, ... } }`
- **Uses:** Existing `settingsService.updateSettings()` (line 124) which already handles batch updates in a transaction
- **File:** `public/js/admin.js`
- **Update:** `saveSettings()` function (line ~624) to use single bulk PUT instead of for-of loop

### Step 6.3 — Consolidate backup scripts
- **File:** `scripts/daily-db-backup.js`
- **Change:** Import and reuse backup logic from `scripts/backup-db.js` instead of duplicating it
- **Change:** Import email sending from `src/services/emailService.js` instead of duplicating the template

### Step 6.4 — Fix ESLint configuration
- **File:** `.eslintrc.json`
- **Change:** Set `"sourceType": "commonjs"` for the root (backend) config
- **File:** `public/.eslintrc.json`
- **Change:** Set `"sourceType": "script"` (for script-tag loaded files)

### Step 6.5 — Fix Jest configuration
- **File:** `jest.config.js`
- **Add:** `setupFiles: ['./tests/setup.js']`
- **Consider:** Raising coverage thresholds from 20-30% to at least 50%

### Step 6.6 — Expand lint scope
- **File:** `package.json`
- **Change:** `"lint": "eslint src/**/*.js"` → `"lint": "eslint src/**/*.js tests/**/*.js public/js/**/*.js"`

### Step 6.7 — Remove PSD from public directory
- **Move:** `public/images/favicon.psd` → `design/favicon.psd` (or delete if source file isn't needed)
- **Update:** `.gitignore` if needed

**Phase 6 deliverable:** Cleaner backend architecture, fixed tooling config.
**Estimated effort:** ~2.5 hours
**Risk:** Medium for Step 6.1 (circular dependency) — requires careful testing of email/payment flows. Low for everything else.

---

## Phase 7 — Performance Quick Wins

_Optional improvements. Independent, can be done in any order._

### Step 7.1 — Visibility-based polling pause
- **Already covered in Phase 4, Step 4.4** — the shared poller will include this
- **Verify:** Polling stops when tab is hidden, resumes when visible

### Step 7.2 — Compression middleware
- **File:** `src/server.js`
- **Add:** `const compression = require('compression');` and `app.use(compression());`
- **Add:** `compression` to `package.json` dependencies
- **Note:** Only beneficial when not behind Nginx; skip if always proxied

### Step 7.3 — ETag/cache headers for static assets
- **File:** `src/server.js`
- **Change:** Update `express.static()` options to include `maxAge` and `etag`:
  ```javascript
  app.use(express.static('public', { maxAge: '1h', etag: true }));
  ```

**Phase 7 deliverable:** Reduced unnecessary network traffic.
**Estimated effort:** ~30 minutes
**Risk:** Very low

---

## Dependency Graph

```
Phase 1 (Correctness)     ──→ can start immediately
Phase 2 (CSS Variables)   ──→ can start immediately (parallel with Phase 1)
Phase 3 (CSS Components)  ──→ depends on Phase 2
Phase 4 (JS Utilities)    ──→ can start after Phase 1
Phase 5 (Event Delegation)──→ depends on Phase 4
Phase 6 (Backend)         ──→ can start immediately (parallel with all)
Phase 7 (Performance)     ──→ partially covered by Phase 4; rest independent
```

**Optimal parallel execution:**
- **Track A:** Phase 1 → Phase 4 → Phase 5
- **Track B:** Phase 2 → Phase 3
- **Track C:** Phase 6 (independent)
- **Track D:** Phase 7 (after Phase 4 completes)

---

## Verification Checklist

After ALL phases complete:

- [ ] `npm run db:seed` succeeds on fresh database
- [ ] `npm test` passes with no regressions
- [ ] `npm run lint` passes (with expanded scope)
- [ ] Kiosk page: user cards render, increment/decrement work, toasts appear, polling updates
- [ ] Admin page: all tabs load, user actions work, settings save, backup/restore works
- [ ] Login page: renders correctly, login flow works
- [ ] All three pages visually match pre-refactoring appearance
- [ ] No console errors on any page
- [ ] README.md accurately describes current auth and API

---

## Summary

| Phase | Effort | Lines Saved | Risk |
|-------|--------|-------------|------|
| 1. Correctness | ~1h | 0 (fixes only) | Very low |
| 2. CSS Variables | ~1.5h | ~30 | Low |
| 3. CSS Components | ~2.5h | ~200+ | Medium |
| 4. JS Utilities | ~2h | ~150 | Medium |
| 5. Event Delegation | ~1h | ~20 | Low-medium |
| 6. Backend | ~2.5h | ~80 | Medium |
| 7. Performance | ~30min | 0 (behavior) | Very low |
| **Total** | **~11h** | **~480+ lines** | |

**Deferred (per user decision):**
- Accessibility (ARIA, focus trapping) — separate effort
- Security hardening (CSRF, passwords) — low risk given kiosk context
