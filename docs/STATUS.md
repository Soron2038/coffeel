# CofFeEL — Projektstatus

Letzte Aktualisierung: 2026-02-23 (Commit 08ba5bb)

## Übersicht

CofFeEL ist ein selbst-gehostetes Kaffee-Tracking-System für das CFEL (Center for Free-Electron Laser Science). Es ersetzt eine papierbasierte Strichlisten-Lösung durch eine moderne, touch-optimierte Webanwendung, die im iPad-Kiosk-Modus betrieben wird.

**Tech Stack:** Node.js 20.x + Express.js + SQLite3 (better-sqlite3) · Vanilla JS + CSS · Nodemailer · Jest

---

## Aktueller Stand: Fertiggestellt & Produktionsbereit

Die Kernfunktionalität ist vollständig implementiert und getestet. Das System kann deployed werden.

### Implementiert ✅

**Backend**
- Express-Server mit Rate Limiting, Session-Auth, graceful shutdown
- SQLite-Datenbank (WAL-Mode, Foreign Keys) mit vollständigem Schema
- Automatische Datenbankinitialisierung und Default-Settings beim Start
- Session-basierte Admin-Authentifizierung (bcrypt-Passwörter)

**Datenbankschema**
- `users` — Nutzer mit `current_tab`, `pending_payment`, `account_balance`, Soft-Delete
- `payments` — Zahlungshistorie (type: `request` / `received`)
- `settings` — Key-Value-Store für Laufzeitkonfiguration
- `audit_log` — Vollständiges Audit-Trail aller Aktionen
- `admin_users` — Separate Admin-Tabelle mit bcrypt-Hashes

**API** (`/api/`)
- User CRUD (inkl. Soft-Delete, Restore, Hard-Delete)
- Tab-Tracking: increment/decrement per Kaffeepreis, direktes Setzen (Admin)
- Zahlungsfluss: `requestPayment` + `confirmPayment` mit Kredit-Logik
- Settings CRUD (coffee_price, SMTP, Bankdaten)
- Export: CSV + JSON (mit UTF-8 BOM)
- Backup-Management: List, Create, Download, Upload, Restore, Delete
- Admin User Management (create, password change, delete)
- Wartung: Inactive-User-Cleanup (>365 Tage)

**Payment Flow**
- Nutzer klickt "Pay" → Tab × Kaffeepreis wird berechnet
- Vorhandenes Guthaben (account_balance > 0) wird automatisch angerechnet
- Zahlungsanfrage-E-Mail an Nutzer + CC an Admin
- E-Mail-Fehler beeinflussen die Buchung NICHT (getrennte Concerns)
- Admin bestätigt Eingang → pending_payment sinkt, account_balance steigt
- Überzahlungen werden automatisch als Guthaben geführt

**E-Mail-Service** (Nodemailer)
- Willkommens-E-Mail bei Neuregistrierung & Reaktivierung
- Zahlungsanfrage-E-Mail (amount-basiert)
- Test-E-Mail via Admin-Panel
- SMTP-Config aus DB-Settings (mit .env-Fallback), Transporter wird bei Konfigurationsänderung neu erstellt

**Frontend**
- Kiosk-Ansicht (`/`) — Touch-optimiert, Echtzeit-Suche (150ms Debounce) mit Clear-Button, +/−/Pay/Delete-Buttons
- Admin-Panel (`/admin.html`) — Login-geschützt, Tabs: Active Users, Deleted Users, Payment History, Settings
- Login-Seite (`/login.html`)
- Responsives CSS mit CSS-Variablen (`variables.css`)

**Deployment**
- PM2 ecosystem config (Beispiel), systemd service (Beispiel), Nginx-Reverse-Proxy-Config
- Deploy-Script (`DEPLOY.sh`), Update-Script (`UPDATE.sh`), DB-Reset-Script (`RESET_DB.sh`)
- Tägliches Backup-Script (`deploy/daily-backup.sh`)

---

## Bekannte Bugs 🐛

Keine bekannten Bugs.

---

## Offene Aufgaben (TODO.md)

### High Priority
- [ ] E-Mail-Template-Konsolidierung — `generatePaymentRequestEmail()` und `generatePaymentRequestEmailByAmount()` zusammenführen (~150 Zeilen Einsparung)

### Medium Priority
- [ ] Frontend API-Wrapper — gemeinsames `public/js/utils/api.js` für kiosk.js + admin.js
- [ ] Toast-Notification-Utility — gemeinsames `public/js/utils/toast.js`
- [ ] Polling-Mechanismus-Utility — gemeinsames `public/js/utils/poller.js`
- [ ] E-Mail-HTML-Styling extrahieren (geteilte Styles/Template)
- [ ] CSV-Export: korrektes Escaping oder `csv-stringify` Library

### Low Priority
- [ ] Session-Secret-Warnung wenn `SESSION_SECRET` fehlt
- [ ] Modal-Handling-Utility Frontend
- [ ] Geteilte `escapeHtml()` Funktion
- [ ] Lazy-Loading-Pattern-Cleanup (zirkuläre Dependency-Gerüche)
- [ ] Error-Handling-Middleware für Service-Result-Pattern

### Future Features
- [ ] E-Mail-Template-Editor (admin-editierbar)
- [ ] Statistik-Dashboard (Charts)
- [ ] User-Self-Service-Portal (eigene Zahlungshistorie)
- [ ] Multiple Kaffeepreise / verschiedene Getränke
- [ ] Dark Mode

---

## Nächste Schritte

1. **Deployment:** Auf Ziel-VM deployen, Nginx + PM2 konfigurieren, SSL einrichten (`npm run db:migrate` nach Update ausführen)
2. **Testen:** E2E-Tests für Payment-Flow + Soft-Delete + Restore-Flow ergänzen
3. **Refactoring (optional):** E-Mail-Templates zusammenführen, Frontend-Utilities extrahieren
