#!/usr/bin/env bash
#===============================================================================
# EINFO Deployment Script
# Holt den neuesten Code von Git, installiert Dependencies, baut das Projekt
# und startet den Service neu.
#===============================================================================

set -euo pipefail

# Farben für Ausgabe
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

#===============================================================================
# KONFIGURATION - Hier anpassen!
#===============================================================================

# Git Repository URL (HTTPS oder SSH)
GIT_REPO_URL="${GIT_REPO_URL:-https://github.com/IVOBLA/EINFO.git}"

# Service-Namen
SERVICE_NAME="${SERVICE_NAME:-kanban-server}"
CHATBOT_SERVICE_NAME="${CHATBOT_SERVICE_NAME:-chatbot}"

# Git Branch
GIT_BRANCH="${GIT_BRANCH:-main}"

# Port für manuellen Start
PORT="${PORT:-4000}"

#===============================================================================

# Dynamische Pfade - Deployment erfolgt immer in das Verzeichnis aus dem das Skript gestartet wurde
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="/tmp/einfo-backup-$(date +%Y%m%d-%H%M%S)"
CONFIG_FILE="${CONFIG_FILE:-/etc/einfo/deploy.conf}"

# Optionen
SKIP_GIT=false
SKIP_BUILD=false
RESTART_CHATBOT=false
DRY_RUN=false

#-------------------------------------------------------------------------------
# Hilfsfunktionen
#-------------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

load_config() {
    # Lade Konfigurationsdatei, falls vorhanden
    if [[ -f "$CONFIG_FILE" ]]; then
        log_info "Lade Konfiguration aus $CONFIG_FILE"
        # shellcheck source=/dev/null
        source "$CONFIG_FILE"
    fi
}

show_help() {
    cat << EOF
Verwendung: $(basename "$0") [OPTIONEN]

EINFO Deployment Script - Aktualisiert und startet den Service neu.
Das Deployment erfolgt in das Verzeichnis, aus dem das Skript gestartet wird.

Aktuelles Projektverzeichnis: $PROJECT_DIR

Optionen:
    -h, --help          Diese Hilfe anzeigen
    -r, --repo URL      Git Repository URL (für frische Installation)
    -b, --branch NAME   Git-Branch (Standard: main)
    -s, --skip-git      Git pull überspringen
    -n, --skip-build    Build überspringen (nur Restart)
    -c, --chatbot       Chatbot-Service auch neu starten
    -d, --dry-run       Nur anzeigen, was gemacht würde

Umgebungsvariablen (alternativ zu Optionen):
    GIT_REPO_URL        Repository URL (Standard: $GIT_REPO_URL)
    GIT_BRANCH          Git Branch (Standard: $GIT_BRANCH)
    SERVICE_NAME        Systemd Service Name (Standard: $SERVICE_NAME)
    PORT                Server Port (Standard: $PORT)

Konfigurationsdatei:
    $CONFIG_FILE
    Alle Umgebungsvariablen können dort definiert werden.

Beispiele:
    # Standard-Deployment
    $(basename "$0")

    # Von develop-Branch deployen
    $(basename "$0") -b develop

    # Mit Chatbot-Restart
    $(basename "$0") -c

    # Nur Service neu starten (kein Git, kein Build)
    $(basename "$0") -n -s

EOF
}

check_prerequisites() {
    log_info "Prüfe Voraussetzungen..."

    # Prüfe ob wir im richtigen Verzeichnis sind
    if [[ ! -f "$PROJECT_DIR/package.json" ]]; then
        log_error "package.json nicht gefunden in $PROJECT_DIR"
        exit 1
    fi

    # Prüfe Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js ist nicht installiert"
        exit 1
    fi

    # Prüfe npm
    if ! command -v npm &> /dev/null; then
        log_error "npm ist nicht installiert"
        exit 1
    fi

    # Prüfe git
    if ! command -v git &> /dev/null; then
        log_error "git ist nicht installiert"
        exit 1
    fi

    log_success "Alle Voraussetzungen erfüllt"
    log_info "Node.js: $(node --version)"
    log_info "npm: $(npm --version)"
}

backup_data() {
    log_info "Erstelle Backup der Daten..."

    if [[ -d "$PROJECT_DIR/server/data" ]]; then
        mkdir -p "$BACKUP_DIR"
        cp -r "$PROJECT_DIR/server/data" "$BACKUP_DIR/"
        log_success "Backup erstellt: $BACKUP_DIR"
    else
        log_warn "Kein data-Verzeichnis gefunden, überspringe Backup"
    fi
}

git_pull() {
    if [[ "$SKIP_GIT" == true ]]; then
        log_warn "Git pull übersprungen (--skip-git)"
        return
    fi

    log_info "Hole neuesten Code von Git (Branch: $GIT_BRANCH)..."

    cd "$PROJECT_DIR"

    # Prüfe auf lokale Änderungen
    if [[ -n "$(git status --porcelain)" ]]; then
        log_warn "Lokale Änderungen gefunden:"
        git status --short

        read -p "Fortfahren und Änderungen überschreiben? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_error "Abgebrochen"
            exit 1
        fi

        # Stash lokale Änderungen
        git stash push -m "Auto-stash vor Deployment $(date +%Y%m%d-%H%M%S)"
        log_info "Lokale Änderungen wurden gestasht"
    fi

    # Fetch und Pull
    git fetch origin "$GIT_BRANCH"
    git checkout "$GIT_BRANCH"
    git pull origin "$GIT_BRANCH"

    log_success "Code aktualisiert auf $(git rev-parse --short HEAD)"
}

install_dependencies() {
    log_info "Installiere Abhängigkeiten..."

    cd "$PROJECT_DIR"

    # Clean install mit Workspaces
    npm ci --workspaces

    log_success "Abhängigkeiten installiert"
}

build_client() {
    if [[ "$SKIP_BUILD" == true ]]; then
        log_warn "Build übersprungen (--skip-build)"
        return
    fi

    log_info "Baue Client..."

    cd "$PROJECT_DIR"

    export NODE_ENV=production
    npm run build

    log_success "Client erfolgreich gebaut"
}

restart_service() {
    log_info "Starte $SERVICE_NAME Service neu..."

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        systemctl restart "$SERVICE_NAME"
        log_success "$SERVICE_NAME Service neu gestartet"
    elif systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        systemctl start "$SERVICE_NAME"
        log_success "$SERVICE_NAME Service gestartet"
    else
        log_warn "Service $SERVICE_NAME nicht als systemd Service gefunden"
        log_info "Versuche manuellen Start..."

        cd "$PROJECT_DIR"
        export NODE_ENV=production
        export PORT="${PORT:-4000}"

        # Im Hintergrund starten mit nohup
        nohup npm run start > /tmp/kanban.log 2>&1 &
        log_success "Server manuell gestartet (Log: /tmp/kanban.log)"
    fi
}

restart_chatbot() {
    if [[ "$RESTART_CHATBOT" != true ]]; then
        return
    fi

    log_info "Starte Chatbot Service neu..."

    if systemctl is-active --quiet "$CHATBOT_SERVICE_NAME"; then
        systemctl restart "$CHATBOT_SERVICE_NAME"
        log_success "Chatbot Service neu gestartet"
    else
        log_warn "Chatbot Service nicht als systemd Service gefunden"
        log_info "Starte Chatbot manuell..."

        if [[ -f "$PROJECT_DIR/chatbot/start_ubuntu.sh" ]]; then
            cd "$PROJECT_DIR/chatbot"
            nohup bash start_ubuntu.sh > /tmp/chatbot.log 2>&1 &
            log_success "Chatbot manuell gestartet (Log: /tmp/chatbot.log)"
        else
            log_error "Chatbot start_ubuntu.sh nicht gefunden"
        fi
    fi
}

show_status() {
    echo ""
    log_info "=== Deployment Status ==="

    # Git Status
    cd "$PROJECT_DIR"
    echo -e "${BLUE}Git Commit:${NC} $(git rev-parse --short HEAD)"
    echo -e "${BLUE}Git Branch:${NC} $(git branch --show-current)"
    echo -e "${BLUE}Letzter Commit:${NC} $(git log -1 --format='%s (%cr)')"

    # Service Status
    echo ""
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        echo -e "${GREEN}$SERVICE_NAME Service:${NC} Läuft"
    else
        echo -e "${YELLOW}$SERVICE_NAME Service:${NC} Nicht aktiv (systemd)"
    fi

    if [[ "$RESTART_CHATBOT" == true ]]; then
        if systemctl is-active --quiet "$CHATBOT_SERVICE_NAME" 2>/dev/null; then
            echo -e "${GREEN}Chatbot Service:${NC} Läuft"
        else
            echo -e "${YELLOW}Chatbot Service:${NC} Nicht aktiv (systemd)"
        fi
    fi

    echo ""
    log_success "Deployment abgeschlossen!"
}

#-------------------------------------------------------------------------------
# Hauptprogramm
#-------------------------------------------------------------------------------

# Argumente parsen
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -r|--repo)
            GIT_REPO_URL="$2"
            shift 2
            ;;
        -b|--branch)
            GIT_BRANCH="$2"
            shift 2
            ;;
        -s|--skip-git)
            SKIP_GIT=true
            shift
            ;;
        -n|--skip-build)
            SKIP_BUILD=true
            shift
            ;;
        -c|--chatbot)
            RESTART_CHATBOT=true
            shift
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            log_error "Unbekannte Option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Lade Config (nach Argument-Parsing, damit CLI-Argumente Vorrang haben)
load_config

# Header
echo ""
echo "==============================================="
echo "       EINFO Deployment Script"
echo "==============================================="
echo ""

if [[ "$DRY_RUN" == true ]]; then
    log_warn "DRY-RUN Modus - keine Änderungen werden durchgeführt"
    echo ""
    echo "Konfiguration:"
    echo "  Projektverz.:  $PROJECT_DIR"
    echo "  Branch:        $GIT_BRANCH"
    echo "  Service:       $SERVICE_NAME"
    echo ""
    echo "Geplante Aktionen:"
    echo "  1. Voraussetzungen prüfen"
    [[ "$SKIP_GIT" != true ]] && echo "  2. Git pull von Branch: $GIT_BRANCH"
    echo "  3. Backup der Daten erstellen"
    echo "  4. npm ci --workspaces ausführen"
    [[ "$SKIP_BUILD" != true ]] && echo "  5. Client bauen (npm run build)"
    echo "  6. $SERVICE_NAME Service neu starten"
    [[ "$RESTART_CHATBOT" == true ]] && echo "  7. Chatbot Service neu starten"
    echo ""
    exit 0
fi

# Deployment durchführen
check_prerequisites
git_pull
backup_data
install_dependencies
build_client
restart_service
restart_chatbot
show_status
