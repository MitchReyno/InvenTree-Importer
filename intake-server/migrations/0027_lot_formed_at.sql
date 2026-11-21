-- When each lot was formed. Lots formed before this have no known time and stay null.
ALTER TABLE capture_lot ADD COLUMN formed_at timestamptz;

-- The database sets it on every insert, so no writer can choose it; the identity trigger keeps it.
CREATE FUNCTION capture_lot_formed_now() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.formed_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER capture_lot_formed_now BEFORE INSERT ON capture_lot
  FOR EACH ROW EXECUTE FUNCTION capture_lot_formed_now();
