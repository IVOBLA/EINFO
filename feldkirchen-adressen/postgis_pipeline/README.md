# EINFO PostGIS Pipeline

Native Installation & Import Pipeline für ortsbezogene Abfragen aus `karnten-latest.osm.pbf`.

## Übersicht

Die Pipeline importiert OpenStreetMap-Daten direkt in PostGIS und erstellt SQL-Views
für Live-Abfragen durch den EINFO-Chatbot. Keine JSONL-Zwischenschritte nötig.

**Architektur: Hybrid**
- Geo-Fragen → PostGIS live SQL (diese Pipeline)
- Nicht-Geo-Fragen → bestehendes RAG Knowledge (unverändert)

## Voraussetzungen

- Ubuntu 22.04 oder 24.04
- Root-Zugriff (für apt install)
- `karnten-latest.osm.pbf` (Download: https://download.geofabrik.de/europe/austria/kaernten.html)

## Quick Start

```bash
# 1. EINFO_DB_PASS setzen
export EINFO_DB_PASS="mein_sicheres_passwort"

# 2. One-Command Runner
./run_all.sh --pbf /pfad/zu/karnten-latest.osm.pbf

# Optional: Mehr Cache für schnelleren Import
./run_all.sh --pbf /pfad/zu/karnten-latest.osm.pbf --cache-mb 8000

# Optional: Bestehende Tabellen überschreiben
./run_all.sh --pbf /pfad/zu/karnten-latest.osm.pbf --reimport

# Optional: Installation überspringen (PostGIS + Tools bereits vorhanden)
./run_all.sh --pbf /pfad/zu/karnten-latest.osm.pbf --skip-install
```

## Einzelschritte

| Script | Beschreibung |
|--------|-------------|
| `00_install_postgis.sh` | PostgreSQL + PostGIS + hstore installieren |
| `01_install_tools.sh` | osm2pgsql + osmium-tool + gdal-bin installieren |
| `02_init_db.sh` | DB + User + Extensions + Schema erstellen (idempotent) |
| `03_import_osm2pgsql.sh` | PBF in PostGIS importieren (classic mode, slim + hstore) |
| `04_extract_municipalities_from_pbf.sh` | Gemeindegrenzen (admin_level=8) aus PBF extrahieren |
| `05_load_municipalities.sh` | Gemeindegrenzen nach PostGIS laden |
| `06_create_views.sql` | SQL-Views erstellen (poi_src, building_src, addr_src, provider_src) |
| `07_create_indices.sql` | Performance-Indices anlegen |

## Umgebungsvariablen

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `EINFO_DB_NAME` | `einfo_osm` | Datenbankname |
| `EINFO_DB_USER` | `einfo` | DB-Benutzer |
| `EINFO_DB_PASS` | **erforderlich** | DB-Passwort |
| `EINFO_DB_HOST` | `localhost` | DB-Host |
| `EINFO_DB_PORT` | `5432` | DB-Port |
| `CACHE_MB` | `4000` | osm2pgsql Cache in MB |

## Erzeugte Views

### `einfo.poi_src`
Points of Interest (Amenities, Healthcare, Emergency, Shops, Tourism, etc.)
- Quelle: `planet_osm_point` + `planet_osm_polygon`
- Polygon → Point via `ST_PointOnSurface`
- Municipality-Join auf `einfo.municipalities`

### `einfo.building_src`
Gebäude mit Adressen
- Quelle: `planet_osm_polygon` (building IS NOT NULL)
- Optionale Felder: `levels`, `area_m2`

### `einfo.addr_src`
Adressen (alle Objekte mit `addr:housenumber` + `addr:street`)
- `addr_key` für schnellen Join (lower/trim)

### `einfo.provider_src`
Provider/Ressourcen (Bagger, Busse, Baufirmen, Kran, etc.)
- Quellen: `office`, `craft`, `industrial` Tags + Keyword-Match
- `provider_type_norm`: construction, earthworks, transport, bus_company, crane, rental, unknown

### `einfo.municipality_index_src`
Gemeinde-Übersicht mit BBox und Counts

## Gemeindegrenzen

Gemeinde-Polygone werden aus dem PBF extrahiert (`admin_level=8`).

**Hinweis:** Einige Gemeinden können fehlende oder kaputte Multipolygone haben;
der Import erfolgt best-effort mit `ST_MakeValid`.

## EINFO Chatbot starten

```bash
# Umgebungsvariablen setzen
export EINFO_DB_NAME=einfo_osm
export EINFO_DB_USER=einfo
export EINFO_DB_PASS=mein_passwort
export EINFO_DB_HOST=localhost
export EINFO_DB_PORT=5432

# Oder als Connection-URL
export EINFO_PG_URL=postgresql://einfo:mein_passwort@localhost:5432/einfo_osm

# Chatbot starten
cd chatbot && npm start
```

## Healthcheck

```sql
-- Basischecks
SELECT count(*) FROM einfo.poi_src;
SELECT count(*) FROM einfo.building_src;
SELECT count(*) FROM einfo.provider_src;
SELECT count(*) FROM einfo.addr_src;
SELECT count(*) FROM einfo.municipalities;

-- Nächstes Krankenhaus zu Feldkirchen
SELECT name, address_full, municipality,
       ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(14.0947, 46.7239), 4326)::geography) AS dist_m
FROM einfo.poi_src
WHERE category_norm = 'amenity:hospital'
ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint(14.0947, 46.7239), 4326)::geography
LIMIT 5;

-- Gebäude im Bereich
SELECT count(*)
FROM einfo.building_src
WHERE geom && ST_MakeEnvelope(14.05, 46.70, 14.15, 46.75, 4326);

-- Provider in Gemeinde
SELECT name, provider_type_norm, address_full
FROM einfo.provider_src
WHERE municipality ILIKE '%feldkirchen%'
LIMIT 10;
```

## Performance-Hinweise

- Views können nicht direkt indexiert werden
- Bei Performance-Problemen: Materialized Views + REFRESH verwenden
- KNN-Suche (`<->` Operator) funktioniert direkt auf den osm2pgsql-Tabellen
- Für häufige Abfragen: `07_create_indices.sql` ergänzen
