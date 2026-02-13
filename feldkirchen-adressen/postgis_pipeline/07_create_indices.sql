-- 07_create_indices.sql
-- Performance-Indices für osm2pgsql-Tabellen und einfo.municipalities
-- Ausführung: psql -d $EINFO_DB_NAME -U $EINFO_DB_USER -f 07_create_indices.sql

-- ============================================================
-- GIST Spatial Indices (für Geo-Queries)
-- ============================================================

-- osm2pgsql erstellt standardmäßig bereits einen GIST-Index auf .way
-- Diese Befehle sind daher idempotent und nur als Sicherheit
CREATE INDEX IF NOT EXISTS idx_planet_osm_point_way
  ON planet_osm_point USING GIST (way);

CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_way
  ON planet_osm_polygon USING GIST (way);

CREATE INDEX IF NOT EXISTS idx_planet_osm_line_way
  ON planet_osm_line USING GIST (way);

-- Municipalities (bereits in 05 erstellt, aber zur Sicherheit)
CREATE INDEX IF NOT EXISTS idx_municipalities_geom
  ON einfo.municipalities USING GIST (geom);

-- ============================================================
-- BTREE Indices (für Filter-Queries)
-- ============================================================

-- Amenity, shop, tourism, leisure für schnellen POI-Zugriff
CREATE INDEX IF NOT EXISTS idx_planet_osm_point_amenity
  ON planet_osm_point (amenity) WHERE amenity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_point_shop
  ON planet_osm_point (shop) WHERE shop IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_point_tourism
  ON planet_osm_point (tourism) WHERE tourism IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_point_leisure
  ON planet_osm_point (leisure) WHERE leisure IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_amenity
  ON planet_osm_polygon (amenity) WHERE amenity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_building
  ON planet_osm_polygon (building) WHERE building IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_shop
  ON planet_osm_polygon (shop) WHERE shop IS NOT NULL;

-- Municipalities Name-Lookup
CREATE INDEX IF NOT EXISTS idx_municipalities_name
  ON einfo.municipalities (LOWER(name));

-- ============================================================
-- Hinweis: Views können nicht direkt indexiert werden.
-- Falls Performance ein Problem wird:
-- 1. Materialized Views erstellen (CREATE MATERIALIZED VIEW einfo.poi_mat AS SELECT * FROM einfo.poi_src)
-- 2. Indices auf die Materialized Views setzen
-- 3. REFRESH MATERIALIZED VIEW einfo.poi_mat; nach jedem PBF-Update
-- ============================================================

-- Analyze für den Planner
ANALYZE planet_osm_point;
ANALYZE planet_osm_polygon;
ANALYZE planet_osm_line;
ANALYZE einfo.municipalities;
