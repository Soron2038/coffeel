-- CofFeEL Default Settings
-- Insert default settings if they don't exist

INSERT OR IGNORE INTO settings (key, value) VALUES 
  ('coffee_price', '0.50'),
  ('admin_email', 'admin@example.com'),
  ('bank_iban', 'DE89370400440532013000'),
  ('bank_bic', 'COBADEFFXXX'),
  ('bank_owner', 'CFEL Coffee Fund');
