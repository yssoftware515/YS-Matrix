-- Enable pg_trgm extension for trigram-based search acceleration
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN indexes on columns used by globalSearch with ILIKE (contains)
-- pg_trgm accelerates LIKE / ILIKE / ~ / similarity queries
CREATE INDEX idx_inventory_brand_trgm
  ON inventory USING gin (brand gin_trgm_ops);

CREATE INDEX idx_inventory_model_trgm
  ON inventory USING gin (model gin_trgm_ops);

CREATE INDEX idx_inventory_color_trgm
  ON inventory USING gin (color gin_trgm_ops);

CREATE INDEX idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);

CREATE INDEX idx_customers_phone_trgm
  ON customers USING gin (phone gin_trgm_ops);

CREATE INDEX idx_suppliers_name_trgm
  ON suppliers USING gin (name gin_trgm_ops);

CREATE INDEX idx_suppliers_phone_trgm
  ON suppliers USING gin (phone gin_trgm_ops);

CREATE INDEX idx_suppliers_email_trgm
  ON suppliers USING gin (email gin_trgm_ops);

CREATE INDEX idx_sales_invoice_number_trgm
  ON sales USING gin (invoice_number gin_trgm_ops);
