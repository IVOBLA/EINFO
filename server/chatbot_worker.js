// server/chatbot_worker.js

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

const CHATBOT_STEP_URL = "http://127.0.0.1:3100/api/sim/step";
const WORKER_INTERVAL_MS = 30000;
let isRunning = false; // <--- NEU
// Pfad zu deinen echten Daten:
// Wir gehen davon aus, dass du den Worker IMMER aus dem server-Ordner startest:
//   cd C:\kanban41\server
//   node chatbot_worker.js
const dataDir = path.join(process.cwd(), "data");

// Dateinamen an deine Struktur angepasst
const FILES = {
  roles: "roles.json",
  board: "board.json",
  aufgabenS2: "Aufg_board_S2.json",
  protokoll: "protocol.json"
};

// -------- NEU: Log-Verzeichnis und Worker-Logdatei --------
const LOG_DIR = path.join(process.cwd(), "logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
const WORKER_LOG_FILE = path.join(LOG_DIR, "chatbot_worker.log");

// -------- NEU: zusätzliches Log für verworfene Operationen --------
const OPS_VERWORFEN_LOG_FILE = path.join(LOG_DIR, "ops_verworfen.log");

function appendOpsVerworfenLog(entry) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry
  });
  fsPromises.appendFile(OPS_VERWORFEN_LOG_FILE, line + "\n").catch((err) => {
    console.error(
      "[chatbot-worker] Fehler beim Schreiben in ops_verworfen.log:",
      err
    );
  });
}
// -----------------------------------------------------------



function appendWorkerLog(line) {
  fsPromises.appendFile(WORKER_LOG_FILE, line + "\n").catch((err) => {
    // Wenn das Dateiloggen kaputt ist, nicht den Worker abstürzen lassen:
    console.error("[chatbot-worker] Fehler beim Schreiben in Logdatei:", err);
  });
}

// Zentrale Log-Funktion mit Zeitstempel + File-Log
function log(...args) {
  const ts = new Date().toISOString();
  const textParts = args.map((a) =>
    typeof a === "string" ? a : JSON.stringify(a)
  );
  const line = `[${ts}] ${textParts.join(" ")}`;

  // Konsole wie bisher
  console.log("[chatbot-worker]", ...args);
  // In Datei schreiben
  appendWorkerLog(line);
}
// -----------------------------------------------------------

// Debug
log("Worker dataDir:", dataDir);
log("Worker erwartet roles.json an:", path.join(dataDir, FILES.roles));

async function safeReadJson(filePath, def) {
  try {
    const raw = await fsPromises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return def;
  }
}
async function safeWriteJson(filePath, data) {
  await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function loadRoles() {
  const rolesPath = path.join(dataDir, FILES.roles);
  const rolesRaw = await safeReadJson(rolesPath, {
    roles: { active: [], missing: [] }
  });
  const active = rolesRaw?.roles?.active || [];
  const missing = rolesRaw?.roles?.missing || [];
  return { active, missing };
}

function isAllowedOperation(op, missingRoles) {
  if (!op) return false;
  const originRole = op.originRole;
  const via = op.via;
  const fromRole = op.fromRole || op.assignedBy;
  if (!originRole || !fromRole) return false;
  if (!missingRoles.includes(originRole)) return false;
  if (!missingRoles.includes(fromRole)) return false;
  if (via !== "Meldestelle" && via !== "Meldestelle/S6") return false;
  return true;
}

function explainOperationRejection(op, missingRoles) {
  const reasons = [];
  if (!op) {
    reasons.push("Operation ist leer/undefined.");
    return reasons.join(" ");
  }

  const originRole = op.originRole;
  const via = op.via;
  const fromRole = op.fromRole || op.assignedBy;

  if (!originRole) {
    reasons.push("originRole fehlt.");
  }
  if (!fromRole) {
    reasons.push("fromRole/assignedBy fehlt.");
  }
  if (originRole && !missingRoles.includes(originRole)) {
    reasons.push(
      `originRole "${originRole}" ist nicht in missingRoles (${JSON.stringify(
        missingRoles
      )}).`
    );
  }
  if (fromRole && !missingRoles.includes(fromRole)) {
    reasons.push(
      `fromRole/assignedBy "${fromRole}" ist nicht in missingRoles (${JSON.stringify(
        missingRoles
      )}).`
    );
  }
  if (via !== "Meldestelle" && via !== "Meldestelle/S6") {
    reasons.push(
      `via ist "${via}" – erlaubt ist nur "Meldestelle" oder "Meldestelle/S6".`
    );
  }

  if (!reasons.length) {
    reasons.push("Unbekannter Grund – isAllowedOperation() hat false geliefert.");
  }

  return reasons.join(" ");
}


/**
 * Board-Operations auf Kanban-Struktur anwenden:
 * board.json:
 * {
 *   "columns": {
 *     "neu": { name, items: [...] },
 *     "in-bearbeitung": { ... },
 *     "erledigt": { ... }
 *   }
 * }
 */
function ensureBoardStructure(boardRaw) {
  if (!boardRaw || typeof boardRaw !== "object") boardRaw = {};
  if (!boardRaw.columns || typeof boardRaw.columns !== "object") {
    boardRaw.columns = {};
  }
  if (!boardRaw.columns["neu"]) {
    boardRaw.columns["neu"] = { name: "Neu", items: [] };
  }
  if (!boardRaw.columns["in-bearbeitung"]) {
    boardRaw.columns["in-bearbeitung"] = {
      name: "In Bearbeitung",
      items: []
    };
  }
  if (!boardRaw.columns["erledigt"]) {
    boardRaw.columns["erledigt"] = { name: "Erledigt", items: [] };
  }
  return boardRaw;
}

async function applyBoardOperations(boardOps, missingRoles) {
  const boardPath = path.join(dataDir, FILES.board);
  let boardRaw = await safeReadJson(boardPath, { columns: {} });
  boardRaw = ensureBoardStructure(boardRaw);

  const createOps = boardOps?.createIncidentSites || [];
  const updateOps = boardOps?.updateIncidentSites || [];

  // CREATE → neue Karte in Spalte "neu"
for (const op of createOps) {
if (!isAllowedOperation(op, missingRoles)) {
  const reason = explainOperationRejection(op, missingRoles);
  log("Board-Create verworfen:", { op, reason, missingRoles });

  appendOpsVerworfenLog({
    kind: "board.create",
    op,
    reason,
    missingRoles
  });

  continue;
}
    const id = `cb-incident-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const nowIso = new Date().toISOString();

    const newItem = {
      id,
      content: op.title || "Einsatzstelle (KI)",
      createdAt: nowIso,
      statusSince: nowIso,
      assignedVehicles: [],
      everVehicles: [],
      everPersonnel: 0,
      ort: op.locationHint || "",
      typ: op.description || "",
      externalId: null,
      alerted: "",
      latitude: null,
      longitude: null,
      location: "",
      timestamp: nowIso,
      description: op.description || "",
      everVehicleLabels: {},
      updated: nowIso,
      isArea: false,
      areaCardId: null,
      areaColor: null,
      humanId: null
    };

    boardRaw.columns["neu"].items.push(newItem);
    log("Board-Create angewandt:", id);
  }

  // UPDATE → passende Karte in allen Spalten suchen
  const allItems = [];
  for (const colKey of Object.keys(boardRaw.columns)) {
    const col = boardRaw.columns[colKey];
    if (!col || !Array.isArray(col.items)) continue;
    for (const it of col.items) {
      allItems.push({ colKey, col, it });
    }
  }

for (const op of updateOps) {
if (!isAllowedOperation(op, missingRoles)) {
  const reason = explainOperationRejection(op, missingRoles);
  log("Board-Update verworfen:", { op, reason, missingRoles });

  appendOpsVerworfenLog({
    kind: "board.update",
    op,
    reason,
    missingRoles
  });

  continue;
}

    const target = allItems.find((x) => x.it.id === op.incidentId);
    if (!target) {
      log("Board-Update: Incident nicht gefunden:", op.incidentId);
      continue;
    }

    const changes = op.changes || {};

    // Erlaubte Felder auf der Karte (Schema nicht zerstören)
    if ("title" in changes || "content" in changes) {
      target.it.content = changes.title || changes.content || target.it.content;
    }
    if ("description" in changes) {
      target.it.description = changes.description;
    }
    if ("ort" in changes || "locationHint" in changes) {
      target.it.ort = changes.ort || changes.locationHint;
    }

    // Status-Änderung → Spaltenwechsel?
    if ("status" in changes) {
      const status = changes.status;
      let targetColKey = null;
      if (status === "neu") targetColKey = "neu";
      else if (status === "in-bearbeitung") targetColKey = "in-bearbeitung";
      else if (status === "erledigt") targetColKey = "erledigt";

      if (targetColKey && targetColKey !== target.colKey) {
        // aus alter Spalte entfernen
        target.col.items = target.col.items.filter(
          (card) => card.id !== target.it.id
        );
        // in neue Spalte einfügen
        ensureBoardStructure(boardRaw);
        boardRaw.columns[targetColKey].items.push(target.it);
        target.it.statusSince = new Date().toISOString();
        log(
          "Board-Update: Incident verschoben",
          op.incidentId,
          "->",
          targetColKey
        );
      }
    }

    target.it.updated = new Date().toISOString();
    log("Board-Update angewandt:", op.incidentId);
  }

  await safeWriteJson(boardPath, boardRaw);
}

async function applyAufgabenOperations(taskOps, missingRoles) {
  const tasksPath = path.join(dataDir, FILES.aufgabenS2);
  let tasks = await safeReadJson(tasksPath, []);

  const createOps = taskOps?.create || [];
  const updateOps = taskOps?.update || [];

  // CREATE → neue Aufgabe im S2-Board
for (const op of createOps) {
if (!isAllowedOperation(op, missingRoles)) {
  const reason = explainOperationRejection(op, missingRoles);
  log("Aufgaben-Create verworfen:", { op, reason, missingRoles });

  appendOpsVerworfenLog({
    kind: "aufgaben.create",
    op,
    reason,
    missingRoles
  });

  continue;
}
    const id = `cb-task-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const newTask = {
      id,
      clientId: null,
      title: op.title || "Aufgabe (KI)",
      type: op.type || "Auftrag",
      responsible: op.forRole || "",
      desc: op.description || "",
      status: "Neu",
      dueAt: null,
      createdAt: now,
      updatedAt: now,
      kind: "task",
      meta: {
        source: "chatbot",
        protoNr: op.linkedProtocolId || null
      },
      originProtocolNr: op.linkedProtocolId || null,
      createdBy: "CHATBOT",
      relatedIncidentId: op.linkedIncidentId || null,
      incidentTitle: null,
      linkedProtocolNrs: op.linkedProtocolId ? [op.linkedProtocolId] : [],
      linkedProtocols: []
    };
    tasks.push(newTask);
    log("Aufgabe-Create angewandt:", id);
  }

  // UPDATE → vorhandene Tasks aktualisieren
for (const op of updateOps) {
if (!isAllowedOperation(op, missingRoles)) {
  const reason = explainOperationRejection(op, missingRoles);
  log("Aufgaben-Update verworfen:", { op, reason, missingRoles });

  appendOpsVerworfenLog({
    kind: "aufgaben.update",
    op,
    reason,
    missingRoles
  });

  continue;
}

    const idx = tasks.findIndex((t) => t.id === op.taskId);
    if (idx === -1) {
      log("Aufgabe-Update: Task nicht gefunden:", op.taskId);
      continue;
    }
    const changes = op.changes || {};

    // nur Felder anfassen, die im S2-Board existieren
    const t = tasks[idx];
    if ("title" in changes) t.title = changes.title;
    if ("description" in changes) t.desc = changes.description;
    if ("status" in changes) t.status = changes.status;
    if ("forRole" in changes || "responsible" in changes) {
      t.responsible = changes.forRole || changes.responsible;
    }
    if ("linkedIncidentId" in changes) {
      t.relatedIncidentId = changes.linkedIncidentId;
    }
    if ("linkedProtocolId" in changes) {
      t.originProtocolNr = changes.linkedProtocolId;
      t.meta = t.meta || {};
      t.meta.protoNr = changes.linkedProtocolId;
    }

    t.updatedAt = Date.now();
    log("Aufgabe-Update angewandt:", op.taskId);
  }

  await safeWriteJson(tasksPath, tasks);
}

async function applyProtokollOperations(protoOps, missingRoles) {
  const protPath = path.join(dataDir, FILES.protokoll);
  let prot = await safeReadJson(protPath, []);

  const createOps = protoOps?.create || [];

for (const op of createOps) {
if (!isAllowedOperation(op, missingRoles)) {
  const reason = explainOperationRejection(op, missingRoles);
  log("Protokoll-Create verworfen:", { op, reason, missingRoles });

  appendOpsVerworfenLog({
    kind: "protokoll.create",
    op,
    reason,
    missingRoles
  });

  continue;
}

    const now = new Date();
    const id = `cb-prot-${now.getTime()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const datum = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const zeit = now.toISOString().slice(11, 16); // HH:MM

    const entry = {
      id,
      nr: (prot.length ? prot.length + 1 : 1),
      datum,
      zeit,
      infoTyp: op.category || "Info",
      anvon: op.fromRole || "Chatbot",
      uebermittlungsart: {
        kanalNr: "CHATBOT",
        kanal: "Chatbot",
        art: "intern",
        ein: true,
        aus: false
      },
      information: op.content || "",
      rueckmeldung1: "",
      rueckmeldung2: "",
      ergehtAn: op.toRole ? [op.toRole] : [],
      ergehtAnText: op.toRole || "",
      lagebericht: "",
      massnahmen: [
        {
          massnahme: "",
          verantwortlich: op.toRole || "",
          done: false
        },
        {
          massnahme: "",
          verantwortlich: "",
          done: false
        },
        {
          massnahme: "",
          verantwortlich: "",
          done: false
        },
        {
          massnahme: "",
          verantwortlich: "",
          done: false
        },
        {
          massnahme: "",
          verantwortlich: "",
          done: false
        }
      ],
      printCount: 0,
      history: [
        {
          ts: now.getTime(),
          action: "create",
          by: op.originRole || "CHATBOT",
          after: {} // nicht nötig, kann leer bleiben oder minimal
        }
      ],
      lastBy: op.originRole || "CHATBOT",
      createdBy: "CHATBOT",
      zu: ""
    };

    prot.push(entry);
    log("Protokoll-Create angewandt:", id);
  }

  await safeWriteJson(protPath, prot);
}

async function runOnce() {
  // Verhindert parallele Durchläufe, wenn ein Zyklus länger dauert als WORKER_INTERVAL_MS
  if (isRunning) {
    log("Vorheriger Worker-Durchlauf läuft noch – aktuelles Intervall wird übersprungen.");
    return;
  }

  isRunning = true;
  try {
    const { missing } = await loadRoles();
    if (!missing.length) {
      log("Keine missingRoles – nichts zu tun.");
      return;
    }

    while (true) {
      const res = await fetch(CHATBOT_STEP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "worker" })
      });

      if (!res.ok) {
        // Body als Text lesen (kann JSON oder Plaintext sein)
        let bodyText = "";
        try {
          bodyText = await res.text();
        } catch {
          bodyText = "";
        }

        let errorJson = null;
        try {
          errorJson = JSON.parse(bodyText);
        } catch {
          // nicht schlimm, bleibt null
        }

        const reason = errorJson?.reason || errorJson?.error;

        // SPEZIALFALL: Schritt läuft noch – Worker wartet, bis LLM fertig ist
        if (res.status === 500 && reason === "step_in_progress") {
          log(
            "LLM-Simulationsschritt läuft noch (step_in_progress) – warte 5s und probiere erneut ..."
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue; // nächster Versuch innerhalb dieses runOnce()
        }

        // Andere HTTP-Fehler normal loggen und abbrechen
        log("Chatbot HTTP-Fehler:", res.status, res.statusText, bodyText);
        return;
      }

      // OK-Antwort -> JSON lesen
      const data = await res.json();

      // Falls Backend step_in_progress als ok:false im JSON meldet
      if (!data.ok) {
        if (data.reason === "step_in_progress") {
          log(
            "LLM-Simulationsschritt läuft noch (step_in_progress, JSON) – warte 5s und probiere erneut ..."
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        log("Chatbot-Simulationsschritt nicht ok:", data.error || data.reason);
        return;
      }

      // Ab hier: LLM ist fertig, Operationen anwenden
      const ops = data.operations || {};
	  
	  const boardCreate = (ops.board?.createIncidentSites || []).length;
      const boardUpdate = (ops.board?.updateIncidentSites || []).length;
      const taskCreate = (ops.aufgaben?.create || []).length;
      const taskUpdate = (ops.aufgaben?.update || []).length;
      const protoCreate = (ops.protokoll?.create || []).length;

      log(
        "LLM-Operationen:",
        `board.create=${boardCreate}, board.update=${boardUpdate},` +
          ` aufgaben.create=${taskCreate}, aufgaben.update=${taskUpdate},` +
          ` protokoll.create=${protoCreate}`
      );

      if (
        boardCreate === 0 &&
        boardUpdate === 0 &&
        taskCreate === 0 &&
        taskUpdate === 0 &&
        protoCreate === 0
      ) {
        log(
          "Hinweis: LLM hat keine Operationen geliefert – es wird nichts in den JSON-Dateien geändert."
        );
      }

	  
      await applyBoardOperations(ops.board || {}, missing);
      await applyAufgabenOperations(ops.aufgaben || {}, missing);
      await applyProtokollOperations(ops.protokoll || {}, missing);

      if (data.analysis) {
        log("Chatbot-Analysis:", data.analysis);
      }

      // erfolgreicher Abschluss -> Schleife & runOnce beenden
      return;
    }
  } catch (err) {
    log("Fehler im Worker:", err.message);
  } finally {
    isRunning = false;
  }
}

function startWorker() {
  log("Chatbot-Worker gestartet, Intervall:", WORKER_INTERVAL_MS, "ms");
  runOnce();
  setInterval(runOnce, WORKER_INTERVAL_MS);
}

startWorker();
