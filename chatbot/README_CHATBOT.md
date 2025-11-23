# EINFO Chatbot – Bezirksstab-Simulation

Dieses Modul ergänzt EINFO um einen lokalen Feuerwehr-Chatbot, der
Einsatzszenarien für den Bezirkseinsatzstab (S1–S6) simuliert.

- Läuft komplett lokal (Windows / Ubuntu, keine GPU nötig).
- Nutzt ein lokales LLM (z. B. Ollama mit CPU-Modell).
- RAG (Knowledge Retrieval) auf Basis der Dateien in `knowledge/`.
- Kommuniziert mit EINFO ausschließlich über JSON-Dateien im gemeinsamen
  `data`-Verzeichnis (`../server/data`).

## Installation

```bash
cd EINFO/chatbot
npm install
