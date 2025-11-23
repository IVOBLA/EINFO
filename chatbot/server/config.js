// KANBAN47/chatbot/server/config.js
// Zentrale Konfiguration für den Chatbot

export const CONFIG = {
  // Gemeinsames Datenverzeichnis mit EINFO/Kanban
  // Von chatbot/server aus: ../../server/data
  dataDir: "../../server/data",

  // Wissensbasis (RAG) – Ordner liegen direkt in /chatbot
  // Von chatbot/server aus: ../knowledge usw.
  knowledgeDir: "../knowledge",
  knowledgeIndexDir: "../knowledge_index",

  // LLM-Backend (Ollama o.ä.)
  llmBaseUrl: "http://127.0.0.1:11434",

  // CPU-Modell verwenden (z.B. phi3_cpu, qwen2_5_7b_cpu, deepseek_r1_7b_cpu)
  model: "phi3_cpu",

  defaultTemperature: 0.3,
  defaultSeed: 42,

  // Zeitschritte in der Simulation (in Minuten pro Schritt)
  minutesPerStep: 10,

  // Logging – Logs landen in KANBAN47/chatbot/logs
  logDir: "../logs",
  enableDebugLogging: true
};
