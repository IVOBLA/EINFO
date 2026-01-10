// server/chatbotRunner.js
// Runner für Chatbot-Server und Worker (ähnlich wie ffRunner.js)

import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chatbot-Verzeichnis
const CHATBOT_DIR = path.resolve(__dirname, "..", "chatbot");
const CHATBOT_SERVER_SCRIPT = path.join(CHATBOT_DIR, "server", "index.js");
const WORKER_SCRIPT = path.join(__dirname, "chatbot_worker.js");
// RAG index_builder.js erstellt meta.json + embeddings.json (korrektes Format für RAG-System)
const INGEST_SCRIPT = path.join(CHATBOT_DIR, "server", "rag", "index_builder.js");
const KNOWLEDGE_DIR = path.join(CHATBOT_DIR, "knowledge");

// Prozess-Referenzen
let chatbotProcess = null;
let workerProcess = null;
let chatbotStarting = false;
let workerStarting = false;
let chatbotStopping = false;
let workerStopping = false;
let lastChatbotStart = null;
let lastWorkerStart = null;

const CHATBOT_BASE_URL = process.env.CHATBOT_BASE_URL
  || `http://127.0.0.1:${process.env.CHATBOT_PORT || "3100"}`;

// Health-Check: Prüft ob der Chatbot-Server tatsächlich auf Port 3100 antwortet
async function checkChatbotHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${CHATBOT_BASE_URL}/api/llm/models`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function processIsAlive(proc) {
  if (!proc) return false;

  // Prüfe zuerst ob der Prozess bereits als beendet markiert ist
  if (proc.killed || proc.exitCode !== null) return false;

  try {
    // Signal 0 sendet kein Signal, prüft nur ob Prozess existiert
    // Funktioniert auf Unix-Systemen zuverlässig
    process.kill(proc.pid, 0);
    return true;
  } catch (err) {
    // ESRCH: Prozess existiert nicht
    // EPERM: Keine Berechtigung (Prozess existiert aber)
    if (err.code === "EPERM") return true;
    return false;
  }
}

// ===================== STATUS =====================

export function chatbotStatus() {
  return {
    chatbot: {
      running: processIsAlive(chatbotProcess),
      starting: chatbotStarting,
      stopping: chatbotStopping,
      pid: chatbotProcess?.pid || null,
      lastStart: lastChatbotStart,
    },
    worker: {
      running: processIsAlive(workerProcess),
      starting: workerStarting,
      stopping: workerStopping,
      pid: workerProcess?.pid || null,
      lastStart: lastWorkerStart,
    },
  };
}

// Async version mit Health-Check
export async function chatbotStatusWithHealth() {
  const status = chatbotStatus();
  status.chatbot.ready = status.chatbot.running ? await checkChatbotHealth() : false;
  return status;
}

// ===================== CHATBOT SERVER =====================

export async function chatbotServerStart() {
  if (chatbotStarting) throw new Error("Chatbot-Start läuft bereits…");
  if (chatbotStopping) throw new Error("Chatbot-Stop läuft noch – bitte kurz warten.");
  if (processIsAlive(chatbotProcess)) throw new Error("Chatbot läuft bereits.");

  chatbotStarting = true;
  try {
    const childEnv = {
      ...process.env,
      OLLAMA_NUM_GPU: process.env.OLLAMA_NUM_GPU || "99",
      CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES || "0",
      LLM_BASE_URL: process.env.LLM_BASE_URL || "http://127.0.0.1:11434",
      LLM_CHAT_MODEL: process.env.LLM_CHAT_MODEL || "llama3.1:8b",
      LLM_EMBED_MODEL: process.env.LLM_EMBED_MODEL || "mxbai-embed-large",
      LLM_CHAT_TIMEOUT_MS: process.env.LLM_CHAT_TIMEOUT_MS || "60000",
      LLM_SIM_TIMEOUT_MS: process.env.LLM_SIM_TIMEOUT_MS || "300000",
      LLM_EMBED_TIMEOUT_MS: process.env.LLM_EMBED_TIMEOUT_MS || "30000",
      LLM_NUM_CTX: process.env.LLM_NUM_CTX || "8192",
      LLM_NUM_BATCH: process.env.LLM_NUM_BATCH || "512",
      RAG_DIM: process.env.RAG_DIM || "1024",
      RAG_TOP_K: process.env.RAG_TOP_K || "5",
      RAG_MAX_CTX: process.env.RAG_MAX_CTX || "2500",
      RAG_SCORE_THRESHOLD: process.env.RAG_SCORE_THRESHOLD || "0.35",
      CHATBOT_DEBUG: process.env.CHATBOT_DEBUG || "1",
      CHATBOT_PROFILE: process.env.CHATBOT_PROFILE || "llama_8b_gpu",
      CHATBOT_PORT: process.env.CHATBOT_PORT || "3100",
    };

    chatbotProcess = spawn(process.execPath, [CHATBOT_SERVER_SCRIPT], {
      env: childEnv,
      cwd: path.join(CHATBOT_DIR, "server"),
      stdio: ["ignore", "inherit", "inherit"],
      detached: false,
      windowsHide: true,
    });

    lastChatbotStart = new Date().toISOString();

    chatbotProcess.once("exit", (code, signal) => {
      chatbotProcess = null;
      chatbotStarting = false;
      chatbotStopping = false;
      console.log(`[CHATBOT] Server beendet (code=${code}, sig=${signal})`);
    });

    console.log(`[CHATBOT] Server gestartet (PID=${chatbotProcess.pid})`);
    return chatbotStatus();
  } finally {
    chatbotStarting = false;
  }
}

export async function chatbotServerStop() {
  if (!processIsAlive(chatbotProcess)) {
    chatbotProcess = null;
    return { ok: true, note: "Chatbot läuft nicht." };
  }
  if (chatbotStopping) return { ok: true, note: "Stop läuft bereits…" };

  chatbotStopping = true;
  const pid = chatbotProcess.pid;

  const waitForExit = (ms) =>
    new Promise((resolve) => {
      const done = () => resolve(true);
      const to = setTimeout(() => resolve(false), ms);
      chatbotProcess.once("exit", () => {
        clearTimeout(to);
        done();
      });
    });

  try {
    try {
      chatbotProcess.kill("SIGTERM");
    } catch {}
    const soft = await waitForExit(2000);
    if (soft) {
      chatbotProcess = null;
      chatbotStopping = false;
      return { ok: true, mode: "soft" };
    }

    // Hard kill
    if (process.platform === "win32") {
      await new Promise((res) => {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("close", () => res());
        killer.on("error", () => res());
      });
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }

    await waitForExit(500);
    return { ok: true, mode: "hard" };
  } finally {
    chatbotProcess = null;
    chatbotStopping = false;
  }
}

// ===================== WORKER =====================

export async function workerStart() {
  if (workerStarting) throw new Error("Worker-Start läuft bereits…");
  if (workerStopping) throw new Error("Worker-Stop läuft noch – bitte kurz warten.");
  if (processIsAlive(workerProcess)) throw new Error("Worker läuft bereits.");

  workerStarting = true;
  try {
    const childEnv = { ...process.env };

    workerProcess = spawn(process.execPath, [WORKER_SCRIPT], {
      env: childEnv,
      cwd: __dirname,
      stdio: ["ignore", "inherit", "inherit"],
      detached: false,
      windowsHide: true,
    });

    lastWorkerStart = new Date().toISOString();

    workerProcess.once("exit", (code, signal) => {
      workerProcess = null;
      workerStarting = false;
      workerStopping = false;
      console.log(`[CHATBOT-WORKER] beendet (code=${code}, sig=${signal})`);
    });

    console.log(`[CHATBOT-WORKER] gestartet (PID=${workerProcess.pid})`);
    return chatbotStatus();
  } finally {
    workerStarting = false;
  }
}

export async function workerStop() {
  if (!processIsAlive(workerProcess)) {
    workerProcess = null;
    return { ok: true, note: "Worker läuft nicht." };
  }
  if (workerStopping) return { ok: true, note: "Stop läuft bereits…" };

  workerStopping = true;
  const pid = workerProcess.pid;

  const waitForExit = (ms) =>
    new Promise((resolve) => {
      const done = () => resolve(true);
      const to = setTimeout(() => resolve(false), ms);
      workerProcess.once("exit", () => {
        clearTimeout(to);
        done();
      });
    });

  try {
    try {
      workerProcess.kill("SIGTERM");
    } catch {}
    const soft = await waitForExit(2000);
    if (soft) {
      workerProcess = null;
      workerStopping = false;
      return { ok: true, mode: "soft" };
    }

    // Hard kill
    if (process.platform === "win32") {
      await new Promise((res) => {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("close", () => res());
        killer.on("error", () => res());
      });
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }

    await waitForExit(500);
    return { ok: true, mode: "hard" };
  } finally {
    workerProcess = null;
    workerStopping = false;
  }
}

// ===================== BEIDE ZUSAMMEN =====================

export async function syncAiAnalysisLoop() {
  const status = chatbotStatus();
  if (!status.chatbot.running || !status.worker.running) {
    return { ok: false, skipped: "Chatbot oder Worker läuft nicht.", status };
  }
  try {
    const res = await fetch(`${CHATBOT_BASE_URL}/api/situation/analysis-loop/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: text || `HTTP ${res.status}`, status };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, data, status };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), status };
  }
}

export async function startAll() {
  const results = { chatbot: null, worker: null };

  // Chatbot zuerst starten
  if (!processIsAlive(chatbotProcess)) {
    try {
      results.chatbot = await chatbotServerStart();
    } catch (err) {
      results.chatbot = { error: err.message };
    }
  } else {
    results.chatbot = { note: "Chatbot läuft bereits" };
  }

  // Kurz warten, dann Worker starten
  await new Promise((r) => setTimeout(r, 1000));

  if (!processIsAlive(workerProcess)) {
    try {
      results.worker = await workerStart();
    } catch (err) {
      results.worker = { error: err.message };
    }
  } else {
    results.worker = { note: "Worker läuft bereits" };
  }

  await syncAiAnalysisLoop();

  return { ok: true, results, status: chatbotStatus() };
}

export async function stopAll() {
  const results = { chatbot: null, worker: null };

  // Worker zuerst stoppen
  try {
    results.worker = await workerStop();
  } catch (err) {
    results.worker = { error: err.message };
  }

  // Dann Chatbot stoppen
  try {
    results.chatbot = await chatbotServerStop();
  } catch (err) {
    results.chatbot = { error: err.message };
  }

  return { ok: true, results, status: chatbotStatus() };
}

// ===================== INGEST =====================

export async function runIngest() {
  return new Promise((resolve, reject) => {
    console.log("[INGEST] Starte Knowledge-Indexierung (RAG index_builder)…");

    const ingestProcess = spawn(process.execPath, [INGEST_SCRIPT], {
      cwd: path.join(CHATBOT_DIR, "server", "rag"),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    ingestProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ingestProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ingestProcess.once("close", (code) => {
      if (code === 0) {
        console.log("[INGEST] Erfolgreich abgeschlossen");
        resolve({
          ok: true,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      } else {
        console.error("[INGEST] Fehlgeschlagen:", stderr || stdout);
        reject(new Error(`Ingest fehlgeschlagen (code=${code}): ${stderr || stdout}`));
      }
    });

    ingestProcess.once("error", (err) => {
      reject(err);
    });
  });
}

// ===================== KNOWLEDGE FILES =====================

export async function listKnowledgeFiles() {
  await fsp.mkdir(KNOWLEDGE_DIR, { recursive: true });
  const entries = await fsp.readdir(KNOWLEDGE_DIR, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      const filePath = path.join(KNOWLEDGE_DIR, entry.name);
      const stat = await fsp.stat(filePath);
      files.push({
        name: entry.name,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }

  return files.sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function saveKnowledgeFile(filename, content) {
  await fsp.mkdir(KNOWLEDGE_DIR, { recursive: true });

  // Sichere Dateinamen
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(KNOWLEDGE_DIR, safeName);

  await fsp.writeFile(filePath, content);
  console.log(`[KNOWLEDGE] Datei gespeichert: ${safeName}`);

  return { ok: true, filename: safeName, path: filePath };
}

export async function deleteKnowledgeFile(filename) {
  const safeName = path.basename(filename);
  const filePath = path.join(KNOWLEDGE_DIR, safeName);

  // Sicherheitscheck
  if (!path.resolve(filePath).startsWith(path.resolve(KNOWLEDGE_DIR))) {
    throw new Error("Ungültiger Dateipfad");
  }

  await fsp.unlink(filePath);
  console.log(`[KNOWLEDGE] Datei gelöscht: ${safeName}`);

  return { ok: true, filename: safeName };
}

export { KNOWLEDGE_DIR };
