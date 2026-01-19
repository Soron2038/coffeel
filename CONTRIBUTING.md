# Contributing to CofFeEL

## Development Setup

### Prerequisites
- Node.js 20.x LTS or higher
- npm 10.x or higher

### Initial Setup
```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your configuration

# Initialize database
npm run db:init

# (Optional) Seed test data
npm run db:seed
```

## Project Structure

```
coffeel/
├── src/                    # Backend source code
│   ├── server.js          # Express app entry point
│   ├── db/                # Database layer
│   │   ├── database.js    # SQLite connection
│   │   ├── schema.sql     # Database schema
│   │   └── seed.sql       # Test data
│   ├── routes/            # Express routes
│   │   ├── api.js         # API endpoints
│   │   └── admin.js       # Admin auth middleware
│   ├── services/          # Business logic
│   │   ├── userService.js
│   │   ├── paymentService.js
│   │   └── emailService.js
│   └── utils/             # Utilities
│       ├── logger.js      # Logging
│       └── validation.js  # Input validation
├── public/                # Frontend static files
│   ├── index.html         # Kiosk interface
│   ├── admin.html         # Admin panel
│   ├── css/               # Stylesheets
│   └── js/                # Client-side JavaScript
├── data/                  # SQLite database location
├── tests/                 # Test files
├── scripts/               # Utility scripts
└── [config files]
```

## Development Workflow

### Running the Server
```bash
# Development mode (auto-reload on changes)
npm run dev

# Production mode
npm start
```

### Database Management
```bash
# Initialize/reset database
npm run db:init

# Seed test data
npm run db:seed

# Create backup
npm run db:backup
```

### Code Quality
```bash
# Run linter
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Run tests
npm test

# Run tests in watch mode
npm test:watch
```

## Code Style

- **JavaScript**: ES6+ syntax, CommonJS modules
- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Line length**: Max 100 characters

ESLint and Prettier are configured to enforce these rules automatically.

## Testing

### Test Structure
- Unit tests: `tests/services/`
- Integration tests: `tests/api/`
- Mock SMTP in tests (never send real emails)

### Writing Tests
- Use Jest framework
- Aim for 70%+ code coverage
- Test all critical payment logic scenarios
- Test edge cases (duplicates, negative values, etc.)

## Dependencies Philosophy

**Keep dependencies minimal (<10 production packages)** to ensure:
- Long-term maintainability (5+ years)
- Minimal breaking changes
- Security (smaller attack surface)

Only add a dependency if:
1. It solves a complex problem (e.g., SMTP, SQLite driver)
2. It's actively maintained
3. It's widely used and trusted

## Git Workflow

### Commit Messages
Follow conventional commits format:
```
feat: add user soft delete functionality
fix: prevent negative coffee count
docs: update README with deployment steps
test: add payment calculation tests
```

### Branches
- `main`: Production-ready code
- Feature branches: `feature/description`
- Bugfix branches: `fix/description`

## Key Implementation Notes

### Payment Logic
Payment tracking is **critical** - always use transactions:
- Calculate credit application correctly
- Never reset payment fields on SMTP error
- Always use atomic database operations

### Soft Delete
Users are **never** hard-deleted by default:
- Preserves payment history
- Can be restored by admin
- Only admin can permanently delete

### Security
- Always use prepared statements (SQL injection prevention)
- Validate input on both client and server
- Sanitize all user input
- Rate limit API endpoints
- Require HTTPS in production

### UI Language
All user-facing text must be in **English** (not German):
- Toast notifications
- Error messages
- Email templates
- Admin panel

## Questions?

Check the PRD.md and WARP.md files for detailed requirements and guidance.
