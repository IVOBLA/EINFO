#!/bin/bash
set -euo pipefail

# SessionStart Hook für EINFO Projekt (Claude Code Web)
# Installiert automatisch alle Dependencies für dev, test und build

# Nur in Claude Code Web-Umgebung ausführen
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "🚀 EINFO SessionStart Hook - Installing dependencies..."

# Skip Puppeteer browser download (not needed in web environment)
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Root-Level Dependencies (workspaces)
if [ ! -d "node_modules" ] || [ ! -d "client/node_modules" ] || [ ! -d "server/node_modules" ]; then
    echo "📦 Installing root workspace dependencies..."
    npm install
    echo "✅ Root workspace dependencies installed"
else
    echo "✅ Root workspace dependencies already installed"
fi

# Chatbot Dependencies (separate module)
if [ ! -d "chatbot/node_modules" ]; then
    echo "📦 Installing chatbot dependencies..."
    cd chatbot
    npm install
    cd ..
    echo "✅ Chatbot dependencies installed"
else
    echo "✅ Chatbot dependencies already installed"
fi

echo ""
echo "🎉 EINFO setup complete!"
echo ""
echo "📋 Available commands:"
echo "  npm run dev           - Start development (client + server)"
echo "  npm run build         - Build client for production"
echo "  npm run start         - Start production server"
echo "  npm test -w server    - Run server tests"
echo "  npm test -w chatbot   - Run chatbot tests (vitest)"
echo ""
echo "🤖 Chatbot commands (from /chatbot):"
echo "  npm start             - Start chatbot server"
echo "  npm run build-index   - Rebuild knowledge index"
echo ""
