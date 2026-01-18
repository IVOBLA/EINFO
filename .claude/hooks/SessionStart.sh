#!/bin/bash
# SessionStart Hook für EINFO Projekt
# Installiert automatisch Dependencies wenn node_modules fehlt

set -e

echo "🚀 Starting EINFO project setup..."

# Prüfe ob node_modules existiert
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies (first time setup)..."
    npm install
    echo "✅ Dependencies installed successfully"
else
    echo "✅ Dependencies already installed"
fi

# Prüfe ob alle Workspace Dependencies installiert sind
if [ ! -d "client/node_modules" ] || [ ! -d "server/node_modules" ]; then
    echo "📦 Installing workspace dependencies..."
    npm install
    echo "✅ Workspace dependencies installed"
fi

echo "🎉 EINFO project ready!"
echo ""
echo "Available commands:"
echo "  npm run dev    - Start development server (client + server)"
echo "  npm run build  - Build client for production"
echo "  npm run start  - Start production server"
