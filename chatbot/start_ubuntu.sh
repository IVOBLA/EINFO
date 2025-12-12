#!/bin/bash
# chatbot/start_ubuntu.sh
# Startskript für Ubuntu mit RTX 4070

export OLLAMA_NUM_GPU=99
export CUDA_VISIBLE_DEVICES=0

export LLM_BASE_URL=http://127.0.0.1:11434
export LLM_CHAT_MODEL=llama3.1:8b
export LLM_EMBED_MODEL=mxbai-embed-large

export LLM_CHAT_TIMEOUT_MS=60000
export LLM_SIM_TIMEOUT_MS=300000
export LLM_EMBED_TIMEOUT_MS=30000

export LLM_NUM_CTX=8192
export LLM_NUM_BATCH=512

export RAG_DIM=1024
export RAG_TOP_K=5
export RAG_MAX_CTX=2500
export RAG_SCORE_THRESHOLD=0.35

export CHATBOT_DEBUG=1
export CHATBOT_PROFILE=llama_8b_gpu

cd "$(dirname "$0")"

echo "=== EINFO Chatbot Server ==="
echo "Modell: $LLM_CHAT_MODEL"
echo "Embedding: $LLM_EMBED_MODEL"
echo "RAG-Dim: $RAG_DIM"
echo ""

node server/index.js
