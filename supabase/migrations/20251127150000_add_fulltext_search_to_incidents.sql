-- Add full-text search to incidents table
-- PostgreSQL built-in feature, no extension needed!

-- Step 1: Add tsvector column for search
ALTER TABLE incidents
ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Step 2: Create function to update search vector
-- Combines title (weight A - highest) and description (weight B)
CREATE OR REPLACE FUNCTION incidents_search_vector_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.severity, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create trigger to auto-update search_vector
DROP TRIGGER IF EXISTS incidents_search_vector_update ON incidents;
CREATE TRIGGER incidents_search_vector_update
  BEFORE INSERT OR UPDATE OF title, description, severity
  ON incidents
  FOR EACH ROW
  EXECUTE FUNCTION incidents_search_vector_trigger();

-- Step 4: Populate existing data
UPDATE incidents SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(severity, '')), 'C')
WHERE search_vector IS NULL;

-- Step 5: Create GIN index for fast search (this is THE KEY!)
CREATE INDEX IF NOT EXISTS idx_incidents_search_vector
  ON incidents
  USING gin(search_vector);

-- Step 6: Add helper function for searching
CREATE OR REPLACE FUNCTION search_incidents(
  search_query text,
  limit_count int DEFAULT 20,
  offset_count int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  status text,
  severity text,
  created_at timestamptz,
  rank real
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.title,
    i.description,
    i.status,
    i.severity,
    i.created_at,
    ts_rank(i.search_vector, plainto_tsquery('english', search_query)) as rank
  FROM incidents i
  WHERE i.search_vector @@ plainto_tsquery('english', search_query)
  ORDER BY rank DESC, i.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create index for common filters + search
CREATE INDEX IF NOT EXISTS idx_incidents_status_created
  ON incidents(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_severity_created
  ON incidents(severity, created_at DESC);

COMMENT ON COLUMN incidents.search_vector IS 'Full-text search vector (auto-updated by trigger)';
COMMENT ON FUNCTION search_incidents IS 'Search incidents using full-text search with ranking';
