# EINFO Chatbot – Bezirksstab-Simulation

Dieses Modul ergänzt EINFO um einen lokalen Feuerwehr-Chatbot, der
Einsatzszenarien für den Bezirkseinsatzstab (S1–S6) simuliert.

- Läuft komplett lokal (Windows / Ubuntu, keine GPU nötig).
- Nutzt ein lokales LLM (z. B. Ollama mit CPU-Modell).
- RAG (Knowledge Retrieval) auf Basis der Dateien in `knowledge/` (PDF, TXT, MD, JSON, JSONL, Video-Metadaten/Sidecar).
- Kommuniziert mit EINFO ausschließlich über JSON-Dateien im gemeinsamen
  `data`-Verzeichnis (`../server/data`).

## Installation

```bash
cd EINFO/chatbot
npm install
```

## Knowledge-Formate

Unterstützte Formate in `knowledge/`:
- PDF, TXT, MD, JSON
- JSONL (ein Record pro Zeile)
- Video-Dateien (Metadaten; Sidecar bevorzugt: `.txt`, `.jsonl`, `.json`)

### JSONL-Standard (EINFO)

Empfohlenes Schema für konsistente Suche/Filter:
- Pflichtfelder: `schema_version`, `doc_id`, `doc_type`, `source`, `region`, `title`, `content`
- `content` ist der bevorzugte Embedding-Text (1–25 Zeilen)
- Optional: `category`, `name`, `address.*`, `geo.*`, `tags`, `ids.*`, `stats`, `updated_at`

Für Geo/OSM-Use-Cases werden `address.*`, `geo.*`, `category` sowie
`doc_type`-Records wie `street_stats` und `municipality_index` empfohlen.
