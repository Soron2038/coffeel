# CofFeEL - Future Enhancements

Ideas and planned features for future development.

## Email Template Editor

**Priority:** Low  
**Complexity:** Medium

Add an "Email Templates" tab to the Admin Panel where administrators can customize email text without code changes.

### Scope
- Edit text passages only (subject, greeting, body text, closing)
- Layout/HTML structure remains fixed in code
- Templates stored in `settings` table as key-value pairs

### Email Types
1. **Payment Request Email**
   - Subject line
   - Introduction text
   - Payment instructions
   - Closing text

2. **Welcome Email**
   - Subject line
   - Greeting text
   - Explanation of the system
   - Closing text

### Implementation Notes
- Add new settings keys: `email_payment_subject`, `email_payment_intro`, etc.
- Modify `emailService.js` to load text from settings with fallback defaults
- Add UI form in Admin Panel with textarea fields
- Consider adding placeholder documentation (e.g., `{{firstName}}`, `{{amount}}`)

---

## Other Ideas

- **Statistics Dashboard**: Charts showing coffee consumption over time
- **User Self-Service Portal**: Let users view their own payment history
- **Multiple Coffee Prices**: Support different beverages/prices
- **Dark Mode**: Theme toggle for the kiosk interface
