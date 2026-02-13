-- 06_create_views.sql
-- Erstellt Views im Schema einfo aus osm2pgsql-Tabellen + municipalities
-- Ausführung: psql -d $EINFO_DB_NAME -U $EINFO_DB_USER -f 06_create_views.sql

-- ============================================================
-- 1) einfo.poi_src — Points of Interest (Punkte + Polygon-Centroide)
-- ============================================================
DROP VIEW IF EXISTS einfo.poi_src CASCADE;

CREATE OR REPLACE VIEW einfo.poi_src AS

-- 1a) Aus planet_osm_point
SELECT
  p.osm_id,
  'node' AS osm_type,
  COALESCE(p.name, '') AS name,
  -- category_norm: Priorität amenity → healthcare → emergency → shop → tourism → leisure → office → craft → industrial → power → man_made
  COALESCE(
    CASE WHEN p.amenity IS NOT NULL     THEN 'amenity:' || p.amenity END,
    CASE WHEN p.tags->'healthcare' IS NOT NULL THEN 'healthcare:' || (p.tags->'healthcare') END,
    CASE WHEN p.tags->'emergency' IS NOT NULL  THEN 'emergency:' || (p.tags->'emergency') END,
    CASE WHEN p.shop IS NOT NULL        THEN 'shop:' || p.shop END,
    CASE WHEN p.tourism IS NOT NULL     THEN 'tourism:' || p.tourism END,
    CASE WHEN p.leisure IS NOT NULL     THEN 'leisure:' || p.leisure END,
    CASE WHEN p.tags->'office' IS NOT NULL     THEN 'office:' || (p.tags->'office') END,
    CASE WHEN p.tags->'craft' IS NOT NULL      THEN 'craft:' || (p.tags->'craft') END,
    CASE WHEN p.tags->'industrial' IS NOT NULL THEN 'industrial:' || (p.tags->'industrial') END,
    CASE WHEN p.tags->'power' IS NOT NULL      THEN 'power:' || (p.tags->'power') END,
    CASE WHEN p.tags->'man_made' IS NOT NULL   THEN 'man_made:' || (p.tags->'man_made') END
  ) AS category_norm,
  -- Adresse
  p.tags->'addr:street'      AS street,
  p.tags->'addr:housenumber'  AS housenumber,
  p.tags->'addr:postcode'     AS postcode,
  p.tags->'addr:city'         AS city,
  NULLIF(
    CONCAT_WS(' ', p.tags->'addr:street', p.tags->'addr:housenumber')
    || CASE WHEN (p.tags->'addr:postcode') IS NOT NULL OR (p.tags->'addr:city') IS NOT NULL
            THEN ', ' || CONCAT_WS(' ', p.tags->'addr:postcode', p.tags->'addr:city')
            ELSE '' END,
    ', '
  ) AS address_full,
  -- Gemeinde (Join)
  COALESCE(m.name, p.tags->'addr:city', '') AS municipality,
  -- Geometrie
  p.way AS geom,
  ST_Y(p.way) AS lat,
  ST_X(p.way) AS lon,
  -- Tags Whitelist als JSON
  jsonb_strip_nulls(jsonb_build_object(
    'phone',          p.tags->'phone',
    'website',        p.tags->'website',
    'opening_hours',  p.tags->'opening_hours',
    'operator',       p.tags->'operator',
    'brand',          p.tags->'brand'
  )) AS tags_json
FROM planet_osm_point p
LEFT JOIN einfo.municipalities m ON ST_Contains(m.geom, p.way)
WHERE
  p.amenity IS NOT NULL
  OR p.tags ? 'healthcare'
  OR p.tags ? 'emergency'
  OR p.shop IS NOT NULL
  OR p.tourism IS NOT NULL
  OR p.leisure IS NOT NULL
  OR p.tags ? 'office'
  OR p.tags ? 'craft'
  OR p.tags ? 'industrial'
  OR p.tags ? 'power'
  OR p.tags ? 'man_made'

UNION ALL

-- 1b) Aus planet_osm_polygon (Centroid via ST_PointOnSurface)
SELECT
  p.osm_id,
  'way' AS osm_type,
  COALESCE(p.name, '') AS name,
  COALESCE(
    CASE WHEN p.amenity IS NOT NULL     THEN 'amenity:' || p.amenity END,
    CASE WHEN p.tags->'healthcare' IS NOT NULL THEN 'healthcare:' || (p.tags->'healthcare') END,
    CASE WHEN p.tags->'emergency' IS NOT NULL  THEN 'emergency:' || (p.tags->'emergency') END,
    CASE WHEN p.shop IS NOT NULL        THEN 'shop:' || p.shop END,
    CASE WHEN p.tourism IS NOT NULL     THEN 'tourism:' || p.tourism END,
    CASE WHEN p.leisure IS NOT NULL     THEN 'leisure:' || p.leisure END,
    CASE WHEN p.tags->'office' IS NOT NULL     THEN 'office:' || (p.tags->'office') END,
    CASE WHEN p.tags->'craft' IS NOT NULL      THEN 'craft:' || (p.tags->'craft') END,
    CASE WHEN p.tags->'industrial' IS NOT NULL THEN 'industrial:' || (p.tags->'industrial') END,
    CASE WHEN p.tags->'power' IS NOT NULL      THEN 'power:' || (p.tags->'power') END,
    CASE WHEN p.tags->'man_made' IS NOT NULL   THEN 'man_made:' || (p.tags->'man_made') END
  ) AS category_norm,
  p.tags->'addr:street'      AS street,
  p.tags->'addr:housenumber'  AS housenumber,
  p.tags->'addr:postcode'     AS postcode,
  p.tags->'addr:city'         AS city,
  NULLIF(
    CONCAT_WS(' ', p.tags->'addr:street', p.tags->'addr:housenumber')
    || CASE WHEN (p.tags->'addr:postcode') IS NOT NULL OR (p.tags->'addr:city') IS NOT NULL
            THEN ', ' || CONCAT_WS(' ', p.tags->'addr:postcode', p.tags->'addr:city')
            ELSE '' END,
    ', '
  ) AS address_full,
  COALESCE(m.name, p.tags->'addr:city', '') AS municipality,
  ST_PointOnSurface(p.way) AS geom,
  ST_Y(ST_PointOnSurface(p.way)) AS lat,
  ST_X(ST_PointOnSurface(p.way)) AS lon,
  jsonb_strip_nulls(jsonb_build_object(
    'phone',          p.tags->'phone',
    'website',        p.tags->'website',
    'opening_hours',  p.tags->'opening_hours',
    'operator',       p.tags->'operator',
    'brand',          p.tags->'brand'
  )) AS tags_json
FROM planet_osm_polygon p
LEFT JOIN einfo.municipalities m ON ST_Contains(m.geom, ST_PointOnSurface(p.way))
WHERE
  (p.amenity IS NOT NULL
  OR p.tags ? 'healthcare'
  OR p.tags ? 'emergency'
  OR p.shop IS NOT NULL
  OR p.tourism IS NOT NULL
  OR p.leisure IS NOT NULL
  OR p.tags ? 'office'
  OR p.tags ? 'craft'
  OR p.tags ? 'industrial'
  OR p.tags ? 'power'
  OR p.tags ? 'man_made')
  AND p.building IS NULL  -- Vermeide Duplikate mit building_src
;


-- ============================================================
-- 2) einfo.building_src — Gebäude
-- ============================================================
DROP VIEW IF EXISTS einfo.building_src CASCADE;

CREATE OR REPLACE VIEW einfo.building_src AS
SELECT
  p.osm_id,
  COALESCE(p.building, p.tags->'building', 'yes') AS building,
  COALESCE(p.name, '') AS name,
  p.tags->'addr:street'      AS street,
  p.tags->'addr:housenumber'  AS housenumber,
  p.tags->'addr:postcode'     AS postcode,
  p.tags->'addr:city'         AS city,
  NULLIF(
    CONCAT_WS(' ', p.tags->'addr:street', p.tags->'addr:housenumber')
    || CASE WHEN (p.tags->'addr:postcode') IS NOT NULL OR (p.tags->'addr:city') IS NOT NULL
            THEN ', ' || CONCAT_WS(' ', p.tags->'addr:postcode', p.tags->'addr:city')
            ELSE '' END,
    ', '
  ) AS address_full,
  COALESCE(m.name, p.tags->'addr:city', '') AS municipality,
  ST_PointOnSurface(p.way) AS geom,
  ST_Y(ST_PointOnSurface(p.way)) AS lat,
  ST_X(ST_PointOnSurface(p.way)) AS lon,
  -- Optional: Stockwerke + Fläche
  (p.tags->'building:levels')::int AS levels,
  ST_Area(ST_Transform(p.way, 3857)) AS area_m2
FROM planet_osm_polygon p
LEFT JOIN einfo.municipalities m ON ST_Contains(m.geom, ST_PointOnSurface(p.way))
WHERE
  p.building IS NOT NULL
  OR p.tags ? 'building'
;


-- ============================================================
-- 3) einfo.addr_src — Adressen (Points + Polygone mit addr:housenumber + addr:street)
-- ============================================================
DROP VIEW IF EXISTS einfo.addr_src CASCADE;

CREATE OR REPLACE VIEW einfo.addr_src AS

-- 3a) Adressen aus Points
SELECT
  p.osm_id,
  'node' AS osm_type,
  p.tags->'addr:street'       AS street,
  p.tags->'addr:housenumber'   AS housenumber,
  p.tags->'addr:postcode'      AS postcode,
  p.tags->'addr:city'          AS city,
  LOWER(TRIM(
    COALESCE(p.tags->'addr:street','') || ' ' || COALESCE(p.tags->'addr:housenumber','')
  )) AS addr_key,
  NULLIF(
    CONCAT_WS(' ', p.tags->'addr:street', p.tags->'addr:housenumber')
    || CASE WHEN (p.tags->'addr:postcode') IS NOT NULL OR (p.tags->'addr:city') IS NOT NULL
            THEN ', ' || CONCAT_WS(' ', p.tags->'addr:postcode', p.tags->'addr:city')
            ELSE '' END,
    ', '
  ) AS address_full,
  COALESCE(m.name, p.tags->'addr:city', '') AS municipality,
  p.way AS geom,
  ST_Y(p.way) AS lat,
  ST_X(p.way) AS lon
FROM planet_osm_point p
LEFT JOIN einfo.municipalities m ON ST_Contains(m.geom, p.way)
WHERE
  p.tags ? 'addr:housenumber'
  AND p.tags ? 'addr:street'

UNION ALL

-- 3b) Adressen aus Polygonen
SELECT
  p.osm_id,
  'way' AS osm_type,
  p.tags->'addr:street'       AS street,
  p.tags->'addr:housenumber'   AS housenumber,
  p.tags->'addr:postcode'      AS postcode,
  p.tags->'addr:city'          AS city,
  LOWER(TRIM(
    COALESCE(p.tags->'addr:street','') || ' ' || COALESCE(p.tags->'addr:housenumber','')
  )) AS addr_key,
  NULLIF(
    CONCAT_WS(' ', p.tags->'addr:street', p.tags->'addr:housenumber')
    || CASE WHEN (p.tags->'addr:postcode') IS NOT NULL OR (p.tags->'addr:city') IS NOT NULL
            THEN ', ' || CONCAT_WS(' ', p.tags->'addr:postcode', p.tags->'addr:city')
            ELSE '' END,
    ', '
  ) AS address_full,
  COALESCE(m.name, p.tags->'addr:city', '') AS municipality,
  ST_PointOnSurface(p.way) AS geom,
  ST_Y(ST_PointOnSurface(p.way)) AS lat,
  ST_X(ST_PointOnSurface(p.way)) AS lon
FROM planet_osm_polygon p
LEFT JOIN einfo.municipalities m ON ST_Contains(m.geom, ST_PointOnSurface(p.way))
WHERE
  p.tags ? 'addr:housenumber'
  AND p.tags ? 'addr:street'
;


-- ============================================================
-- 4) einfo.provider_src — Provider/Ressourcen (Bagger, Busse, Baufirmen, etc.)
-- ============================================================
DROP VIEW IF EXISTS einfo.provider_src CASCADE;

CREATE OR REPLACE VIEW einfo.provider_src AS
WITH raw_providers AS (
  -- 4a) Points
  SELECT
    p.osm_id,
    'node' AS osm_type,
    COALESCE(p.name, '') AS name,
    p.tags->'office'      AS office,
    p.tags->'craft'       AS craft,
    p.tags->'industrial'  AS industrial,
    p.tags->'operator'    AS operator,
    p.tags->'brand'       AS brand,
    p.tags->'description' AS description,
    p.tags->'website'     AS website,
    p.tags->'phone'       AS phone,
    p.tags->'addr:street'      AS street,
    p.tags->'addr:housenumber'  AS housenumber,
    p.tags->'addr:postcode'     AS postcode,
    p.tags->'addr:city'         AS city,
    p.way AS geom_raw,
    p.way AS geom_pt
  FROM planet_osm_point p
  WHERE
    p.tags ? 'office' OR p.tags ? 'craft' OR p.tags ? 'industrial'
    OR (
      LOWER(COALESCE(p.name,'') || ' ' || COALESCE(p.tags->'operator','') || ' ' || COALESCE(p.tags->'description',''))
      ~* '(bau|bauunternehmen|tiefbau|erdbau|bagger|kran|transporte|logistik|spedition|bus|omnibus|reisen|fuhrpark|verleih|vermiet)'
    )

  UNION ALL

  -- 4b) Polygons
  SELECT
    p.osm_id,
    'way' AS osm_type,
    COALESCE(p.name, '') AS name,
    p.tags->'office'      AS office,
    p.tags->'craft'       AS craft,
    p.tags->'industrial'  AS industrial,
    p.tags->'operator'    AS operator,
    p.tags->'brand'       AS brand,
    p.tags->'description' AS description,
    p.tags->'website'     AS website,
    p.tags->'phone'       AS phone,
    p.tags->'addr:street'      AS street,
    p.tags->'addr:housenumber'  AS housenumber,
    p.tags->'addr:postcode'     AS postcode,
    p.tags->'addr:city'         AS city,
    p.way AS geom_raw,
    ST_PointOnSurface(p.way) AS geom_pt
  FROM planet_osm_polygon p
  WHERE
    p.tags ? 'office' OR p.tags ? 'craft' OR p.tags ? 'industrial'
    OR (
      LOWER(COALESCE(p.name,'') || ' ' || COALESCE(p.tags->'operator','') || ' ' || COALESCE(p.tags->'description',''))
      ~* '(bau|bauunternehmen|tiefbau|erdbau|bagger|kran|transporte|logistik|spedition|bus|omnibus|reisen|fuhrpark|verleih|vermiet)'
    )
)
SELECT
  rp.osm_id,
  rp.osm_type,
  rp.name,
  -- provider_type_norm
  CASE
    WHEN LOWER(rp.match_text) ~* '(erdbau|bagger|erdarbeiten)'       THEN 'earthworks'
    WHEN LOWER(rp.match_text) ~* '(bau|bauunternehmen|tiefbau|abbruch)' THEN 'construction'
    WHEN LOWER(rp.match_text) ~* '(kran|kranverleih)'                THEN 'crane'
    WHEN LOWER(rp.match_text) ~* '(bus|omnibus|reisen|reisebus)'     THEN 'bus_company'
    WHEN LOWER(rp.match_text) ~* '(transporte|spedition|logistik|fuhrpark|lkw)' THEN 'transport'
    WHEN LOWER(rp.match_text) ~* '(verleih|vermiet)'                 THEN 'rental'
    ELSE 'unknown'
  END AS provider_type_norm,
  rp.match_text,
  rp.street,
  rp.housenumber,
  rp.postcode,
  rp.city,
  NULLIF(
    CONCAT_WS(' ', rp.street, rp.housenumber)
    || CASE WHEN rp.postcode IS NOT NULL OR rp.city IS NOT NULL
            THEN ', ' || CONCAT_WS(' ', rp.postcode, rp.city)
            ELSE '' END,
    ', '
  ) AS address_full,
  COALESCE(m.name, rp.city, '') AS municipality,
  rp.geom_pt AS geom,
  ST_Y(rp.geom_pt) AS lat,
  ST_X(rp.geom_pt) AS lon,
  rp.phone,
  rp.website
FROM (
  SELECT *,
    LOWER(CONCAT_WS(' ',
      name, operator, brand, office, craft, industrial, description, website, phone
    )) AS match_text
  FROM raw_providers
) rp
LEFT JOIN einfo.municipalities m ON ST_Contains(m.geom, rp.geom_pt)
;


-- ============================================================
-- 5) einfo.municipality_index_src — Gemeinde-Überblick (BBox + Counts)
-- ============================================================
DROP VIEW IF EXISTS einfo.municipality_index_src CASCADE;

CREATE OR REPLACE VIEW einfo.municipality_index_src AS
SELECT
  m.id,
  m.name,
  -- BBox der Gemeinde
  ST_XMin(ST_Extent(m.geom)) AS bbox_min_lon,
  ST_YMin(ST_Extent(m.geom)) AS bbox_min_lat,
  ST_XMax(ST_Extent(m.geom)) AS bbox_max_lon,
  ST_YMax(ST_Extent(m.geom)) AS bbox_max_lat,
  -- Counts (via Subqueries, um die Views nicht nochmal zu joinen)
  (SELECT count(*) FROM planet_osm_polygon b
   WHERE (b.building IS NOT NULL OR b.tags ? 'building')
     AND ST_Contains(m.geom, ST_PointOnSurface(b.way))) AS building_count,
  (SELECT count(*) FROM planet_osm_point pp
   WHERE (pp.amenity IS NOT NULL OR pp.shop IS NOT NULL OR pp.tourism IS NOT NULL
          OR pp.leisure IS NOT NULL OR pp.tags ? 'healthcare' OR pp.tags ? 'emergency')
     AND ST_Contains(m.geom, pp.way)) AS poi_count,
  (SELECT count(*) FROM planet_osm_point pa
   WHERE pa.tags ? 'addr:housenumber' AND pa.tags ? 'addr:street'
     AND ST_Contains(m.geom, pa.way)) AS address_count
FROM einfo.municipalities m
GROUP BY m.id, m.name, m.geom
;
