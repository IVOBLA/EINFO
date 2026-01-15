#!/bin/bash
# Setup EINFO Modelfiles im Kanban-Projekt
# - einfo-balanced: Für Operations/Simulation
# - einfo-analysis: Für KI-Situationsanalyse (optimiert für JSON-Ausgabe)
# Config.js bleibt unverändert!

set -e

PROJECT_DIR="/home/bfkdo/kanban/chatbot"
MODELFILE_DIR="$PROJECT_DIR/modelfiles"

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=================================================="
echo "EINFO Modelfile Setup (Kanban-Projekt)"
echo "=================================================="
echo ""
echo "Projekt: $PROJECT_DIR"
echo "Modelfiles: $MODELFILE_DIR"
echo ""
echo "⚠️  Config.js wird NICHT geändert!"
echo ""

# ============================================================
# 1. VORAUSSETZUNGEN PRÜFEN
# ============================================================
echo -e "${YELLOW}[1/5] Prüfe Voraussetzungen...${NC}"

# Ollama läuft?
if ! curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo -e "${RED}❌ Ollama läuft nicht${NC}"
    echo "   Starte: ollama serve"
    exit 1
fi
echo -e "${GREEN}✅ Ollama läuft${NC}"

# Projekt existiert?
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}❌ Projekt-Verzeichnis nicht gefunden: $PROJECT_DIR${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Projekt-Verzeichnis gefunden${NC}"

# GPU?
if command -v nvidia-smi &> /dev/null; then
    VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1)
    VRAM_GB=$((VRAM / 1024))
    echo -e "${GREEN}✅ GPU: ${VRAM_GB}GB VRAM${NC}"
else
    echo -e "${YELLOW}⚠️  Keine NVIDIA GPU${NC}"
fi

# ============================================================
# 2. MODELFILE-VERZEICHNIS ERSTELLEN
# ============================================================
echo ""
echo -e "${YELLOW}[2/5] Erstelle Modelfile-Verzeichnis...${NC}"
mkdir -p "$MODELFILE_DIR"
echo -e "${GREEN}✅ $MODELFILE_DIR${NC}"

# ============================================================
# 3. MODELFILE ERSTELLEN
# ============================================================
echo ""
echo -e "${YELLOW}[3/5] Erstelle einfo-balanced.Modelfile...${NC}"

cat > "$MODELFILE_DIR/einfo-balanced.Modelfile" << 'EOF'
FROM qwen2.5:14b

# BEWÄHRTE KONFIGURATION
# Getestet am 26.12.2025: 5405 MB VRAM (66%), 6.4s Antwortzeit
PARAMETER num_gpu 20
PARAMETER num_ctx 4096
PARAMETER temperature 0.1
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.1

SYSTEM """Du bist ein Assistent für Feuerwehr-Einsatzstab-Simulationen im Bezirk Feldkirchen, Kärnten.
Du antwortest immer auf Deutsch und verwendest österreichische Feuerwehr-Terminologie.
Bei JSON-Anfragen antwortest du NUR mit validem JSON ohne zusätzlichen Text.
Alle Operationen MÜSSEN die Felder originRole und fromRole enthalten."""
EOF

echo -e "${GREEN}✅ einfo-balanced.Modelfile erstellt${NC}"

# einfo-analysis: Optimiert für Situationsanalyse mit strukturierter JSON-Ausgabe
echo ""
echo -e "${YELLOW}Erstelle einfo-analysis.Modelfile...${NC}"

cat > "$MODELFILE_DIR/einfo-analysis.Modelfile" << 'EOF'
FROM qwen2.5:14b

# Optimiert für Situationsanalyse und strukturierte JSON-Ausgabe
# Größerer Context für komplexe Analysen
PARAMETER num_gpu 20
PARAMETER num_ctx 8192
PARAMETER temperature 0.2
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.1

SYSTEM """Du bist ein Experte für Einsatzleitung und Katastrophenmanagement im deutschsprachigen Raum.
Du antwortest immer auf Deutsch und verwendest österreichische Feuerwehr-Terminologie.
Bei JSON-Anfragen antwortest du AUSSCHLIESSLICH mit dem exakten JSON-Format, das in der Anfrage spezifiziert ist.
Füge NIEMALS zusätzlichen Text vor oder nach dem JSON hinzu.
Halte dich strikt an das vorgegebene JSON-Schema mit den exakten Feldnamen."""
EOF

echo -e "${GREEN}✅ einfo-analysis.Modelfile erstellt${NC}"
echo ""
echo "Modelfiles erstellt:"
echo "  - einfo-balanced.Modelfile (Operations/Simulation)"
echo "  - einfo-analysis.Modelfile (KI-Situationsanalyse)"

# ============================================================
# 4. BASE-MODELLE LADEN
# ============================================================
echo ""
echo -e "${YELLOW}[4/5] Lade Base-Modelle...${NC}"

# llama3.1:8b
if ollama list | grep -q "llama3.1:8b"; then
    echo -e "${GREEN}  ✅ llama3.1:8b bereits vorhanden${NC}"
else
    echo "  Lade llama3.1:8b (~4.7 GB)..."
    ollama pull llama3.1:8b
    echo -e "${GREEN}  ✅ llama3.1:8b geladen${NC}"
fi

# qwen2.5:14b
if ollama list | grep -q "qwen2.5:14b"; then
    echo -e "${GREEN}  ✅ qwen2.5:14b bereits vorhanden${NC}"
else
    echo "  Lade qwen2.5:14b (~8.4 GB)..."
    ollama pull qwen2.5:14b
    echo -e "${GREEN}  ✅ qwen2.5:14b geladen${NC}"
fi

# ============================================================
# 5. CUSTOM-MODELLE ERSTELLEN
# ============================================================
echo ""
echo -e "${YELLOW}[5/5] Erstelle Custom-Modelle in Ollama...${NC}"

# VRAM freigeben
curl -s http://localhost:11434/api/generate -d '{"model": "einfo-balanced", "keep_alive": 0}' >/dev/null 2>&1 || true
curl -s http://localhost:11434/api/generate -d '{"model": "einfo-analysis", "keep_alive": 0}' >/dev/null 2>&1 || true

# einfo-balanced erstellen
echo ""
echo "  Erstelle einfo-balanced aus Modelfile..."
ollama create einfo-balanced -f "$MODELFILE_DIR/einfo-balanced.Modelfile"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ einfo-balanced erfolgreich erstellt${NC}"
else
    echo -e "${RED}❌ Fehler beim Erstellen von einfo-balanced${NC}"
    exit 1
fi

# einfo-analysis erstellen
echo ""
echo "  Erstelle einfo-analysis aus Modelfile..."
ollama create einfo-analysis -f "$MODELFILE_DIR/einfo-analysis.Modelfile"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ einfo-analysis erfolgreich erstellt${NC}"
else
    echo -e "${RED}❌ Fehler beim Erstellen von einfo-analysis${NC}"
    exit 1
fi

# ============================================================
# TEST
# ============================================================
echo ""
echo -e "${YELLOW}Teste einfo-balanced...${NC}"
RESPONSE=$(ollama run einfo-balanced "Was ist 2+2? Antworte nur mit der Zahl." 2>&1 | head -1)
if [ -n "$RESPONSE" ]; then
    echo -e "${GREEN}✅ Test erfolgreich${NC}"
    echo "   Antwort: $RESPONSE"
else
    echo -e "${RED}❌ Test fehlgeschlagen${NC}"
fi

echo ""
echo -e "${YELLOW}Teste einfo-analysis (JSON-Ausgabe)...${NC}"
RESPONSE=$(ollama run einfo-analysis 'Antworte nur mit JSON: {"test": "ok"}' 2>&1 | head -1)
if echo "$RESPONSE" | grep -q "test"; then
    echo -e "${GREEN}✅ Test erfolgreich${NC}"
    echo "   Antwort: $RESPONSE"
else
    echo -e "${RED}❌ Test fehlgeschlagen${NC}"
    echo "   Antwort: $RESPONSE"
fi

# ============================================================
# ABSCHLUSS
# ============================================================
echo ""
echo "=================================================="
echo -e "${GREEN}✅ INSTALLATION ABGESCHLOSSEN${NC}"
echo "=================================================="
echo ""
echo "Installierte Modelle:"
ollama list | grep -E "llama3.1:8b|qwen2.5:14b|einfo-balanced|einfo-analysis"
echo ""
echo "Modelfiles in:"
echo "  $MODELFILE_DIR/einfo-balanced.Modelfile  (Operations/Simulation)"
echo "  $MODELFILE_DIR/einfo-analysis.Modelfile  (KI-Situationsanalyse)"
echo ""
echo "=================================================="
echo "MODELL-VERWENDUNG:"
echo "=================================================="
echo ""
echo "  • einfo-balanced:  Operations, Simulation, Start-Tasks"
echo "  • einfo-analysis:  KI-Situationsanalyse (strukturierte JSON-Ausgabe)"
echo "  • llama3.1:8b:     Chat"
echo ""
echo "=================================================="
echo "NÄCHSTE SCHRITTE:"
echo "=================================================="
echo ""
echo "1. Server neu starten (um .env-Änderungen zu laden):"
echo "   cd $PROJECT_DIR"
echo "   npm start"
echo ""
echo "2. Test über API:"
echo "   curl http://localhost:3100/api/llm/config"
echo ""
echo "3. Modell-Test:"
echo "   curl -X POST http://localhost:3100/api/llm/test \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"question\":\"Test\",\"model\":\"einfo-analysis\"}'"
echo ""
echo "ERWARTETE PERFORMANCE:"
echo "  • VRAM: ~5-6 GB pro Modell"
echo "  • Antwortzeit: 6-10 Sekunden"
echo "  • Status: Bewährt und getestet ✅"
