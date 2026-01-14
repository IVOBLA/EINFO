#!/bin/bash
#
# run_tests.sh - Unified Test Runner for EINFO
#
# Usage: ./run_tests.sh [options]
#   Options:
#     --chatbot    Run only chatbot tests
#     --server     Run only server tests
#     --coverage   Run chatbot tests with coverage report
#     --help       Show this help message
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Track results
CHATBOT_RESULT=0
SERVER_RESULT=0
RUN_CHATBOT=true
RUN_SERVER=true
COVERAGE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --chatbot)
            RUN_SERVER=false
            shift
            ;;
        --server)
            RUN_CHATBOT=false
            shift
            ;;
        --coverage)
            COVERAGE=true
            shift
            ;;
        --help)
            echo "EINFO Test Runner"
            echo ""
            echo "Usage: ./run_tests.sh [options]"
            echo ""
            echo "Options:"
            echo "  --chatbot    Run only chatbot tests (Vitest)"
            echo "  --server     Run only server tests (Node.js native)"
            echo "  --coverage   Run chatbot tests with coverage report"
            echo "  --help       Show this help message"
            echo ""
            echo "Without options, all tests will be run."
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Header
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    EINFO Test Runner                         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Run chatbot tests
if [ "$RUN_CHATBOT" = true ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  Chatbot Tests (Vitest)${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    cd "$PROJECT_ROOT/chatbot"

    if [ "$COVERAGE" = true ]; then
        if npm run test:coverage; then
            echo -e "\n${GREEN}✓ Chatbot tests passed with coverage${NC}\n"
        else
            CHATBOT_RESULT=1
            echo -e "\n${RED}✗ Chatbot tests failed${NC}\n"
        fi
    else
        if npm test; then
            echo -e "\n${GREEN}✓ Chatbot tests passed${NC}\n"
        else
            CHATBOT_RESULT=1
            echo -e "\n${RED}✗ Chatbot tests failed${NC}\n"
        fi
    fi
fi

# Run server tests
if [ "$RUN_SERVER" = true ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  Server Tests (Node.js native)${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    cd "$PROJECT_ROOT/server"

    if npm test; then
        echo -e "\n${GREEN}✓ Server tests passed${NC}\n"
    else
        SERVER_RESULT=1
        echo -e "\n${RED}✗ Server tests failed${NC}\n"
    fi
fi

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

TOTAL_FAILED=0

if [ "$RUN_CHATBOT" = true ]; then
    if [ $CHATBOT_RESULT -eq 0 ]; then
        echo -e "  Chatbot:  ${GREEN}PASSED${NC}"
    else
        echo -e "  Chatbot:  ${RED}FAILED${NC}"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
    fi
fi

if [ "$RUN_SERVER" = true ]; then
    if [ $SERVER_RESULT -eq 0 ]; then
        echo -e "  Server:   ${GREEN}PASSED${NC}"
    else
        echo -e "  Server:   ${RED}FAILED${NC}"
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
    fi
fi

echo ""

if [ $TOTAL_FAILED -eq 0 ]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                  All tests passed!                           ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                  Some tests failed!                          ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi
