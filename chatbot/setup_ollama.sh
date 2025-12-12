#!/bin/bash
# chatbot/setup_ollama.sh
# Ollama Installation und Modell-Download

echo "=== Ollama Setup für EINFO Chatbot ==="

# Ollama installieren falls nicht vorhanden
if ! command -v ollama &> /dev/null; then
    echo "Ollama wird installiert..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

# Ollama starten
echo "Starte Ollama-Dienst..."
sudo systemctl start ollama 2>/dev/null || ollama serve &
sleep 3

# Modelle laden
echo ""
echo "Lade Llama 3.1 8B..."
ollama pull llama3.1:8b

echo ""
echo "Lade mxbai-embed-large..."
ollama pull mxbai-embed-large

echo ""
echo "=== Installierte Modelle ==="
ollama list

echo ""
echo "=== GPU-Status ==="
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv 2>/dev/null || echo "Keine NVIDIA GPU gefunden"

echo ""
echo "Setup abgeschlossen!"
