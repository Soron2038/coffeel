-- CofFeEL Default Settings
-- Insert default settings if they don't exist

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('coffee_price', '0.50'),
  ('admin_email', 'admin@example.com'),
  ('bank_iban', 'DE89370400440532013000'),
  ('bank_bic', 'COBADEFFXXX'),
  ('bank_owner', 'CFEL Coffee Fund'),
  -- IMAP polling for bounce detection. Worker stays idle while imap_host is empty.
  -- imap_user/imap_pass empty → falls back to smtp_user/smtp_pass.
  ('imap_host', ''),
  ('imap_port', '993'),
  ('imap_secure', 'true'),
  ('imap_user', ''),
  ('imap_pass', ''),
  ('imap_inbox_folder', 'INBOX'),
  ('imap_processed_folder', 'Processed-Bounces'),
  ('imap_poll_interval_minutes', '5');
