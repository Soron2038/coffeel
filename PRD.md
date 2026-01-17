# Product Requirements Document (PRD)
## CofFeEL - Coffee Tracking System for iPad Kiosk Mode

**Version:** 1.0  
**Datum:** 2026-01-17  
**Autor:** Björn  
**Status:** Draft
**Project Name:** CofFeEL (lowercase: coffeel)

---

## 1. Executive Summary

Digitalisierung des manuellen Kaffee-Tracking-Systems im Institut. Ersetzt papierbasierte Strichliste durch eine selbst-gehostete Web-Applikation, die auf einem fest montierten iPad im Kiosk-Modus läuft.

### Kernziele
- Self-Service Benutzer-Registrierung
- Echtzeit-Konsum-Tracking mit +/- Buttons
- Automatisierte Zahlungsaufforderungen per E-Mail
- Wartungsarm: 5+ Jahre ohne Code-Änderungen
- Schnelle, moderne UI (Snappy & Responsive)

---

## 2. Technischer Stack

### Backend
- **Runtime:** Node.js LTS (Version 20.x, festgepinnt)
- **Framework:** Express.js (minimal)
- **Datenbank:** SQLite3
- **E-Mail:** nodemailer (SMTP)

### Frontend
- **Core:** Vanilla JavaScript (ES6+)
- **Styling:** Modern CSS (Grid/Flexbox, CSS Variables)
- **No Frameworks:** Keine Dependencies (React/Vue/etc.)

### Deployment
- **Server:** Linux VM (Ubuntu 24 LTS empfohlen)
- **Webserver:** Nginx (Reverse Proxy)
- **Process Manager:** systemd oder PM2
- **Backup:** Einfache Datei-basierte SQLite-Backups

---

## 3. Funktionale Anforderungen

### 3.1 Benutzer-Registrierung

**User Story:**  
Als neuer Kaffee-Trinker möchte ich mich selbst registrieren können, ohne Admin-Hilfe zu benötigen.

**Sprache:** **Alle Benutzer-Oberflächen in Englisch** (internationale Mitarbeiter)

**Anforderungen:**
- Formular mit Feldern:
  - First Name (required, min 2 Zeichen)
  - Last Name (required, min 2 Zeichen)
  - Email (required, validiert, unique)
- Client-seitige Validierung (instant feedback)
- Server-seitige Validierung (Duplicate-Check)
- Erfolgs-/Fehlermeldungen (Toast-Notifications, **in Englisch**)
- Automatische Sortierung nach Nachname in der Liste

**Akzeptanzkriterien:**
- Formular-Submit < 500ms Response Time
- E-Mail-Validierung nach RFC 5322
- Duplikat-Erkennung case-insensitive

### 3.2 Benutzer-Liste & Suche

**User Story:**  
Als Kaffee-Trinker möchte ich mich schnell in einer gefilterten Liste finden können.

**Anforderungen:**
- Vollständige Benutzerliste angezeigt (sortiert: Nachname, Vorname)
- **Nur aktive Benutzer** (`deleted_by_user = 0`) werden angezeigt
- Echtzeit-Suchfeld (debounced, 150ms)
- Fuzzy-Matching (Name/Vorname/E-Mail)
- Visuelle Hervorhebung des aktuellen Konsumstands
- Scrollbar nur bei >10 Benutzern

**Akzeptanzkriterien:**
- Suche filtert bei jedem Tastendruck
- Keine Verzögerung spürbar (< 100ms)
- Liste bleibt während Suche scrollbar
- Gelöschte Benutzer werden ausgeblendet

### 3.2.1 Benutzer-Löschung (Self-Service)

**User Story:**  
Als Kaffee-Trinker möchte ich meinen Eintrag selbst löschen können, wenn ich das Institut verlasse oder keinen Kaffee mehr trinke.

**Anforderungen:**
- **Delete-Button** bei jedem eigenen Eintrag (z.B. kleines Trash-Icon)
- Bestätigungs-Dialog vor Löschung (**in Englisch**):
  - "Do you really want to delete your entry?"
  - "You can ask the admin to restore it later."
  - "Outstanding coffees: [X] (not yet paid)"
- Soft-Delete: Setzt `deleted_by_user = 1` und `deleted_at = CURRENT_TIMESTAMP`
- Eintrag verschwindet sofort aus der Kiosk-Ansicht
- **Keine echte Datenlöschung** (Daten bleiben in DB erhalten)
- Toast-Notification: "Your entry has been removed"

**Akzeptanzkriterien:**
- Gelöschte Einträge bleiben in der Datenbank
- `coffee_count` wird NICHT zurückgesetzt (für spätere Abrechnung)
- `pending_payment` und `account_balance` bleiben erhalten
- E-Mail-Adresse bleibt verfügbar (für Wiederherstellung)
- Admin kann gelöschte Einträge noch abrechnen

### 3.3 Konsum-Tracking

**User Story:**  
Als Kaffee-Trinker möchte ich mit einem Klick meinen Konsum erfassen.

**Anforderungen:**
- Drei Buttons pro Benutzer:
  - **[+]** → Erhöht Konsum-Counter um 1
  - **[-]** → Reduziert Konsum-Counter um 1 (min: 0)
  - **[Pay]** → Triggert E-Mail-Versand
- Visuelles Feedback bei Klick (Button-Animation)
- Optimistic UI Update (sofort, dann Server-Sync)
- Konsum-Counter prominent angezeigt (große Zahl)
- Persistierung in SQLite

**Akzeptanzkriterien:**
- Button-Response < 50ms (perceived)
- Keine doppelten Klicks (Debounce 300ms)
- Counter nie negativ
- Rollback bei Server-Fehler

### 3.4 Zahlungsaufforderung per E-Mail

**User Story:**  
Als Kaffee-Trinker möchte ich automatische Zahlungsaufforderungen erhalten und meinen Schuldenstand nachverfolgen können.

**Anforderungen:**
- [Pay]-Button löst E-Mail-Versand aus:
  - **An:** Benutzer-E-Mail
  - **CC:** Kaffee-Verwalter (konfigurierbar)
  - **Betreff:** "Coffee Payment Request - [Anzahl] coffees"
  - **Inhalt:** (Template-basiert, **in Englisch**)
    - Aktuelle Anzahl Kaffees
    - Preis pro Kaffee (konfigurierbar)
    - Gesamtsumme
    - Bankverbindung (konfigurierbar)
    - Zahlungsreferenz (z.B. Name)
- **Payment-Tracking beim Pay-Klick:**
  - `coffee_count` wird auf 0 zurückgesetzt
  - `pending_payment` wird um berechneten Betrag erhöht (z.B. 55 × 0.50€ = 27.50€)
  - `account_balance` wird um Betrag reduziert (z.B. -27.50€)
  - `last_payment_request` wird auf aktuellen Zeitstempel gesetzt
  - Eintrag in `payments`-Tabelle (type='request')
- **UI-Feedback:**
  - Toast-Notification: "Payment request sent (27.50€)"
  - Ausstehender Betrag wird sofort angezeigt (ausgegraut)
- Fehlerbehandlung bei SMTP-Problemen (kein Reset bei Fehler)

**Akzeptanzkriterien:**
- E-Mail wird innerhalb 5 Sekunden versendet
- Fehler-Logging bei SMTP-Fehler
- Payment-Tracking atomar (alles oder nichts)
- User kann weiter Kaffees trinken während Zahlung aussteht

### 3.4.1 Zahlungsbestätigung (Admin)

**User Story:**  
Als Kaffee-Verwalter möchte ich Zahlungseingänge bestätigen und Guthaben verwalten können.

**Anforderungen:**
- Admin-Panel zeigt für jeden User:
  - Aktueller Konsum (`coffee_count`)
  - Ausstehende Zahlung (`pending_payment`)
  - Account-Saldo (`account_balance`)
  - Datum letzter Payment-Request
- **Payment-Confirmation-Formular:**
  - Eingabefeld: Betrag (€)
  - Button: "Confirm Payment"
- **Verarbeitungslogik beim Bestätigen:**
  - `pending_payment` wird um min(Eingabebetrag, pending_payment) reduziert
  - `account_balance` wird um Eingabebetrag erhöht
  - Bei Überzahlung: Differenz wird automatisch als Guthaben verbucht
  - Eintrag in `payments`-Tabelle (type='received', confirmed_by_admin=1)
  - Audit-Log-Eintrag
- **Guthaben-Handling:**
  - Positives `account_balance` = Guthaben (grün angezeigt)
  - Negatives `account_balance` = Schulden (rot angezeigt)
  - Guthaben wird beim nächsten Pay-Request automatisch verrechnet

**Beispiel-Szenarien:**

**Szenario 1: Exakte Zahlung**
```
Vorher:  coffee_count=10, pending_payment=27.50€, balance=-27.50€
Admin bestätigt: 27.50€
Nachher: coffee_count=10, pending_payment=0€, balance=0€
```

**Szenario 2: Überzahlung (Guthaben)**
```
Vorher:  coffee_count=5, pending_payment=27.50€, balance=-27.50€
Admin bestätigt: 30.00€
Nachher: coffee_count=5, pending_payment=0€, balance=+2.50€
```

**Szenario 3: Teilzahlung**
```
Vorher:  coffee_count=0, pending_payment=27.50€, balance=-27.50€
Admin bestätigt: 20.00€
Nachher: coffee_count=0, pending_payment=7.50€, balance=-7.50€
```

**Szenario 4: Vorauszahlung (ohne pending)**
```
Vorher:  coffee_count=15, pending_payment=0€, balance=0€
Admin bestätigt: 50.00€
Nachher: coffee_count=15, pending_payment=0€, balance=+50.00€
```

**Akzeptanzkriterien:**
- Überzahlungen werden automatisch als Guthaben verbucht
- Guthaben wird bei nächstem Pay-Request verrechnet
- Negative Salden (Schulden) werden klar visualisiert
- Payment-History vollständig nachvollziehbar

### 3.5 Admin-Panel

**User Story:**  
Als Kaffee-Verwalter möchte ich Einstellungen ändern und Zahlungen verwalten können.

**Sprache:** **Alle Admin-Oberflächen in Englisch** (internationale Mitarbeiter)

**Anforderungen:**
- Separater `/admin` Endpoint (Basic Auth)
- Konfigurierbare Einstellungen:
  - Coffee Price (€)
  - Bank Details (IBAN, BIC, Account Owner)
  - Admin E-Mail
  - SMTP Settings
- **User Management:**
  - **Active Users Tab:**
    - Liste wie Kiosk-Ansicht
    - Zusätzliche Spalten:
      - Current Coffees
      - Pending Payment (€)
      - Account Balance (€, farbcodiert)
      - Last Payment Request (Datum)
    - Payment Confirmation pro User (siehe 3.4.1)
  - **Deleted Users Tab:**
    - Alle `deleted_by_user = 1` Einträge
    - Button "Restore" → Reaktiviert User
    - Button "Send Payment Request" → E-Mail auch an gelöschte User
    - Payment Confirmation auch für gelöschte User möglich
  - **Manuelle Aktionen:**
    - Coffee Counter manuell anpassen
    - Account Balance manuell korrigieren
    - **Permanent Delete** (echtes DELETE aus DB)
- **Payment History:**
  - Tab mit allen Zahlungen aus `payments`-Tabelle
  - Filter: User, Type (request/received), Date Range
  - Export als CSV
- **Data Export:**
  - Button "Export All Data (CSV)"
  - Inkl. gelöschter Benutzer mit Flag
  - Inkl. Payment-Historie

**Akzeptanzkriterien:**
- Settings in separater Tabelle (`settings`)
- Änderungen sofort wirksam (kein Server-Restart)
- Audit-Log für alle Admin-Aktionen
- Gelöschte Benutzer können abgerechnet werden
- Wiederherstellung reaktiviert Benutzer sofort in Kiosk-Ansicht
- Übersichtliche Darstellung von Guthaben/Schulden

---

## 4. Nicht-Funktionale Anforderungen

### 4.1 Performance
- **Pageload:** < 1 Sekunde (Initial Load)
- **API Response:** < 200ms (CRUD Operations)
- **UI Reactivity:** < 100ms (Button-Klicks)
- **Search Debounce:** 150ms

### 4.2 Zuverlässigkeit
- **Uptime:** 99.5% (Instituts-Öffnungszeiten)
- **Data Persistence:** Kein Datenverlust bei Server-Crash
- **Backup:** Täglich automatisch (SQLite-Datei)

### 4.3 Wartbarkeit
- **Code-Qualität:** ESLint + Prettier
- **Dokumentation:** README.md mit Setup-Anleitung
- **Dependencies:** < 10 npm packages
- **Update-Strategie:** LTS-Versionen, keine Breaking Changes

### 4.4 Sicherheit
- **HTTPS:** Nur verschlüsselte Verbindung (Let's Encrypt)
- **Input Validation:** Client + Server-seitig
- **SQL Injection:** Prepared Statements (Parameterized Queries)
- **Admin-Panel:** HTTP Basic Auth (min. Schutz)
- **Rate Limiting:** Max. 60 Requests/Minute pro IP

### 4.5 Usability (iPad Kiosk-Modus)
- **Touch-Optimiert:** Buttons min. 44x44px
- **Kein Zoom:** `user-scalable=no` im Viewport
- **Fullscreen:** Kein Browser-Chrome sichtbar
- **Orientierung:** Portrait-Mode (locked)
- **Inaktivität:** Kein Auto-Logout (Kiosk bleibt aktiv)

---

## 5. Datenmodell

### 5.1 Tabelle: `users`

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  coffee_count INTEGER DEFAULT 0,
  pending_payment REAL DEFAULT 0,      -- Betrag nach Pay-Request (noch nicht bestätigt)
  account_balance REAL DEFAULT 0,       -- Guthaben (+) / Schulden (-) Saldo
  last_payment_request DATETIME,        -- Zeitstempel letzter Pay-Klick
  deleted_by_user BOOLEAN DEFAULT 0,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_last_name ON users(last_name);
CREATE INDEX idx_users_deleted ON users(deleted_by_user);
CREATE INDEX idx_users_pending ON users(pending_payment);
```

**Payment-Tracking-Logik:**
- `coffee_count`: Aktueller Konsum (wird bei Pay auf 0 gesetzt)
- `pending_payment`: Betrag der angeforderten Zahlung (nach Pay-Klick, vor Admin-Bestätigung)
- `account_balance`: Gesamtsaldo (negativ = Schulden, positiv = Guthaben)
- `last_payment_request`: Wann wurde die letzte Zahlungsaufforderung versendet

**Soft-Delete-Logik:**
- `deleted_by_user = 0`: Aktiver Benutzer (sichtbar in Kiosk-Ansicht)
- `deleted_by_user = 1`: Vom Benutzer gelöscht (nur in Admin-Panel sichtbar)
- `deleted_at`: Zeitstempel der Löschung (NULL bei aktiven Benutzern)

### 5.2 Tabelle: `settings`

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Default-Werte
INSERT INTO settings (key, value) VALUES 
  ('coffee_price', '0.50'),
  ('admin_email', 'admin@example.com'),
  ('bank_iban', 'DE89370400440532013000'),
  ('bank_bic', 'COBADEFFXXX'),
  ('bank_owner', 'Institut Kaffeekasse'),
  ('smtp_host', 'smtp.example.com'),
  ('smtp_port', '587'),
  ('smtp_user', 'kaffee@example.com'),
  ('smtp_pass', 'encrypted_password');
```

### 5.3 Tabelle: `payments`

```sql
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL,              -- 'request' oder 'received'
  coffee_count INTEGER,             -- Anzahl Kaffees bei Payment-Request
  confirmed_by_admin BOOLEAN DEFAULT 0,
  admin_notes TEXT,                 -- Optional: Admin-Notizen zur Zahlung
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_type ON payments(type);
CREATE INDEX idx_payments_confirmed ON payments(confirmed_by_admin);
```

**Payment-Types:**
- `request`: User hat auf Pay geklickt → E-Mail versendet, `pending_payment` erhöht
- `received`: Admin bestätigt Zahlungseingang → `pending_payment` reduziert, `account_balance` aktualisiert

**Beispiel-Flow:**
```sql
-- 1. User trinkt 55 Kaffees, klickt "Pay" (0.50€/Kaffee = 27.50€)
INSERT INTO payments (user_id, amount, type, coffee_count) 
VALUES (1, 27.50, 'request', 55);

-- 2. Admin bestätigt Eingang von 30€ (Überzahlung = 2.50€ Guthaben)
INSERT INTO payments (user_id, amount, type, confirmed_by_admin) 
VALUES (1, 30.00, 'received', 1);
```

### 5.4 Tabelle: `audit_log` (Optional)

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL, -- 'increment', 'decrement', 'payment_request', 'payment_received', 'soft_delete', 'restore', 'hard_delete'
  old_value INTEGER,
  new_value INTEGER,
  amount REAL,                      -- Für Payment-Actions
  performed_by TEXT DEFAULT 'user', -- 'user' or 'admin'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**Action-Types:**
- `increment` / `decrement`: Coffee-Counter-Änderungen
- `payment_request`: User klickt Pay → E-Mail versendet
- `payment_received`: Admin bestätigt Zahlungseingang
- `soft_delete`: Benutzer-Self-Service-Löschung
- `restore`: Admin reaktiviert gelöschten Benutzer
- `hard_delete`: Admin löscht Benutzer permanent

---

## 6. API-Spezifikation

### 6.1 User Management

#### `GET /api/users`
Gibt alle **aktiven** Benutzer zurück (sortiert nach Nachname).

**Query-Parameter:**
- `includeDeleted=true` (optional, nur für Admin-Panel): Gibt auch gelöschte Benutzer zurück

**Response:**
```json
[
  {
    "id": 1,
    "firstName": "Max",
    "lastName": "Mustermann",
    "email": "max@example.com",
    "coffeeCount": 10,
    "pendingPayment": 27.50,
    "accountBalance": -22.50,
    "lastPaymentRequest": "2026-01-15T14:30:00Z",
    "deletedByUser": false,
    "deletedAt": null,
    "createdAt": "2026-01-17T10:00:00Z"
  }
]
```

#### `POST /api/users`
Erstellt neuen Benutzer.

**Request:**
```json
{
  "firstName": "Max",
  "lastName": "Mustermann",
  "email": "max@example.com"
}
```

**Response (201):**
```json
{
  "id": 1,
  "firstName": "Max",
  "lastName": "Mustermann",
  "email": "max@example.com",
  "coffeeCount": 0,
  "pendingPayment": 0,
  "accountBalance": 0
}
```

**Error (400):**
```json
{
  "error": "Email already exists"
}
```

#### `DELETE /api/users/:id`
Soft-Delete: Markiert Benutzer als gelöscht (Self-Service).

**Response (200):**
```json
{
  "id": 1,
  "deletedByUser": true,
  "deletedAt": "2026-01-17T14:30:00Z",
  "message": "User soft-deleted successfully"
}
```

#### `POST /api/users/:id/restore`
Reaktiviert einen gelöschten Benutzer (nur Admin).

**Response (200):**
```json
{
  "id": 1,
  "deletedByUser": false,
  "deletedAt": null,
  "message": "User restored successfully"
}
```

#### `DELETE /api/users/:id/permanent`
Permanente Löschung aus der Datenbank (nur Admin, mit Authentifizierung).

**Response (200):**
```json
{
  "message": "User permanently deleted"
}
```

### 6.2 Coffee Tracking

#### `POST /api/users/:id/increment`
Erhöht Coffee-Counter um 1.

**Response (200):**
```json
{
  "id": 1,
  "coffeeCount": 11,
  "accountBalance": -22.50
}
```

#### `POST /api/users/:id/decrement`
Reduziert Coffee-Counter um 1 (min: 0).

**Response (200):**
```json
{
  "id": 1,
  "coffeeCount": 9,
  "accountBalance": -22.50
}
```

### 6.3 Payment

#### `POST /api/users/:id/pay`
Sendet Zahlungsaufforderung, setzt Counter auf 0, erhöht pending_payment.

**Response (200):**
```json
{
  "id": 1,
  "coffeeCount": 0,
  "pendingPayment": 32.50,
  "accountBalance": -32.50,
  "emailSent": true,
  "paymentId": 15,
  "message": "Payment request sent to max@example.com (5.00€)"
}
```

**Logik:**
1. Berechne Betrag: `coffee_count × coffee_price`
2. Verrechne existierendes Guthaben: `amount -= max(0, account_balance)`
3. Falls nach Verrechnung Betrag > 0:
   - Sende E-Mail
   - Setze `coffee_count = 0`
   - Erhöhe `pending_payment += amount`
   - Reduziere `account_balance -= amount`
   - Erstelle `payments`-Eintrag (type='request')
4. Falls Guthaben alle Kosten deckt:
   - Reduziere nur `account_balance`
   - Setze `coffee_count = 0`
   - Keine E-Mail nötig

**Error (500):**
```json
{
  "error": "SMTP connection failed"
}
```

#### `POST /api/users/:id/confirm-payment`
Admin bestätigt Zahlungseingang (nur mit Admin-Auth).

**Request:**
```json
{
  "amount": 30.00,
  "notes": "Bank transfer received"
}
```

**Response (200):**
```json
{
  "id": 1,
  "pendingPayment": 0,
  "accountBalance": 2.50,
  "paymentId": 16,
  "message": "Payment confirmed. Credit: 2.50€"
}
```

**Logik:**
1. Reduziere `pending_payment` um min(amount, pending_payment)
2. Erhöhe `account_balance` um amount
3. Erstelle `payments`-Eintrag (type='received', confirmed_by_admin=1)
4. Bei Überzahlung: Differenz bleibt als Guthaben in `account_balance`

---

## 7. UI/UX Design-Prinzipien

**Sprache:** Alle UI-Texte in **Englisch** (internationale Mitarbeiter)

### 7.1 Visual Design
- **Farbschema:** Moderne, reduzierte Palette
  - Primary: `#2563eb` (Blue)
  - Success: `#10b981` (Green)
  - Warning: `#f59e0b` (Orange) → für pending payments
  - Danger: `#ef4444` (Red) → für Schulden
  - Credit: `#10b981` (Green) → für Guthaben
  - Background: `#f9fafb` (Light Gray)
- **Typografie:** System-Font-Stack (SF Pro auf iOS)
- **Spacing:** 8px-Grid-System
- **Shadows:** Subtile Elevations (Material Design-inspired)

### 7.1.1 Payment-Status-Visualisierung

**User-Card (Kiosk-Ansicht):**
```
┌─────────────────────────────────────────┐
│ Max Mustermann                          │
│ ☕ Current: 10 coffees                  │
│ 💰 Pending: 27.50€ (grau/orange)       │  ← Nur wenn > 0
│ ✅ Credit: +5.00€ (grün)                │  ← Nur wenn balance > 0
│ ⚠️  Debt: -15.00€ (rot)                 │  ← Nur wenn balance < 0
│                                         │
│  [+]  [-]  [Pay]  [🗑️]                 │
└─────────────────────────────────────────┘
```

**Admin-Panel User-Row:**
```
┌──────────────────────────────────────────────────────────┐
│ Max Mustermann (max@example.com)                         │
│ Current: 10 ☕ (5.00€)                                    │
│ Pending: 27.50€ (sent: 2026-01-15)                       │
│ Balance: -22.50€ (rot hervorgehoben)                     │
│                                                           │
│ [Confirm Payment: _____ €] [Submit]                      │
│ [Adjust Counter] [Send Payment Request] [Delete] [...]   │
└──────────────────────────────────────────────────────────┘
```

### 7.2 Interaktions-Patterns
- **Buttons:** 
  - Hover: Slight scale (1.05)
  - Active: Scale down (0.95)
  - Ripple-Effekt (CSS)
- **Toast-Notifications:** 
  - Top-Right Position
  - Auto-Dismiss nach 3 Sekunden
  - Slide-In Animation
  - **Englische Texte:**
    - "Payment request sent (27.50€)"
    - "Coffee added"
    - "Your entry has been removed"
    - "Payment confirmed (+2.50€ credit)"
- **Loading-States:** 
  - Skeleton-Screens (keine Spinner)
  - Optimistic UI Updates
- **Confirmation-Dialogs:**
  - Modal-Overlay mit Backdrop
  - Clear Call-to-Action
  - **Englische Texte:**
    - "Confirm Payment Request?"
    - "Delete Entry?"
    - "Restore User?"

### 7.3 Responsive Breakpoints
- **iPad Portrait:** 768px (Primär-Target)
- **iPad Landscape:** 1024px (Optional)
- **Desktop:** 1280px+ (Admin-Panel)

---

## 8. Deployment & Operations

### 8.1 Server-Setup
```bash
# Beispiel-Setup auf Ubuntu 24 LTS
sudo apt update
sudo apt install nodejs npm nginx sqlite3
sudo npm install -g pm2

# Repository clonen
git clone <repo-url> /opt/coffeel
cd /opt/coffeel

# Dependencies installieren
npm ci --production

# Umgebungsvariablen setzen
cp .env.example .env
nano .env

# PM2 starten
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 8.2 Nginx-Konfiguration
```nginx
server {
    listen 80;
    server_name coffee.institut.de;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 8.3 Backup-Strategie
```bash
# Cronjob für tägliches Backup (3 Uhr nachts)
0 3 * * * cp /opt/coffeel/data/coffee.db /backup/coffeel_$(date +\%Y\%m\%d).db
```

### 8.4 Monitoring (Optional)
- **Uptime:** Simple Ping-Check (UptimeRobot o.ä.)
- **Logs:** PM2-Logs (`pm2 logs`)
- **Disk-Space:** Wöchentliche Prüfung (SQLite-Größe)

---

## 9. Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| SMTP-Server offline | Mittel | Hoch | Fehler-Logging + Retry-Mechanismus |
| SQLite-DB korrupt | Niedrig | Hoch | Tägliche Backups + WAL-Modus |
| iPad-Kiosk-Crash | Mittel | Mittel | Auto-Restart + Guided Access |
| Doppel-Registrierung | Niedrig | Niedrig | Unique-Constraint auf E-Mail |
| Node.js Breaking Change | Niedrig | Hoch | LTS-Version pinnen |
| Versehentliche Benutzer-Löschung | Mittel | Niedrig | Soft-Delete + Bestätigungs-Dialog + Admin-Restore |
| Zahlungseingang nicht verbucht | Mittel | Mittel | Payment-History + Audit-Log + Pending-Payment-Übersicht |

---

## 10. Erfolgs-Metriken

### Phase 1 (Launch - 3 Monate)
- [ ] 90% der Benutzer registriert
- [ ] < 5 Support-Anfragen pro Monat
- [ ] Keine kritischen Bugs

### Phase 2 (3-12 Monate)
- [ ] 100% der Paper-Liste abgelöst
- [ ] < 1 Stunde Downtime pro Quartal
- [ ] Automatische Backups laufen zuverlässig

### Phase 3 (12+ Monate)
- [ ] System läuft wartungsfrei
- [ ] Keine Code-Änderungen notwendig

---

## 11. Offene Fragen

- [ ] Welcher SMTP-Server steht zur Verfügung? (Office365, Gmail, lokaler Postfix?)
- [ ] Gibt es ein bestehendes Instituts-Branding (Logo, Farben)?
- [ ] Wie viele Benutzer werden erwartet? (< 50, < 100, < 500?)
- [ ] Wer ist der Kaffee-Verwalter? (E-Mail-Adresse benötigt)
- [ ] Soll ein Admin-Panel in v1.0 enthalten sein? → **Ja, für Payment-Confirmation erforderlich**
- [ ] **UI-Sprache bestätigt: Englisch** (internationale Mitarbeiter)

---

## 12. Nächste Schritte

1. **PRD-Review:** Stakeholder-Feedback einholen
2. **Tech-Spike:** SMTP-Konfiguration testen
3. **Design-Mockups:** UI-Screens erstellen (Figma/Sketch)
4. **Development:** Backend → Frontend → Integration
5. **Testing:** User Acceptance Testing mit 5 Testern
6. **Deployment:** Staging → Production
7. **Training:** Kaffee-Verwalter einweisen

---

**Dokument-Ende**
