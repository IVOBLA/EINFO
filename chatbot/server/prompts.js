// chatbot/server/prompts.js
// Zentrale Prompt-Definition für den EINFO-Chatbot (Simulationsmodus / Operations)
//
// Ziel:
// - möglichst robuste, kompakte Prompts
// - klare JSON-Constraints
// - erste Initialisierung (firstStep) explizit geregelt

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_DIR = path.join(__dirname, "prompt_templates");

function loadPromptTemplate(fileName) {
  const fullPath = path.join(TEMPLATE_DIR, fileName);
  return fs.readFileSync(fullPath, "utf8").trim();
}

function fillTemplate(template, replacements) {
  return Object.entries(replacements).reduce((acc, [key, value]) => {
    return acc.replaceAll(`{{${key}}}`, value);
  }, template);
}

const defaultStartSystemPrompt = loadPromptTemplate("start_system_prompt.txt");
const operationsSystemPrompt = loadPromptTemplate("operations_system_prompt.txt");
const operationsUserPromptTemplate = loadPromptTemplate(
  "operations_user_prompt.txt"
);
const startUserPromptTemplate = loadPromptTemplate("start_user_prompt.txt");
const chatSystemPromptTemplate = loadPromptTemplate("chat_system_prompt.txt");
const chatUserPromptTemplate = loadPromptTemplate("chat_user_prompt.txt");

/**
 * System-Prompt:
 * - Rollenlogik (activeRoles)
 * - Meldestelle-Pflicht
 * - Operations-Schema
 * - Kompaktheit / JSON-Disziplin
 */
export function buildSystemPrompt({ memorySnippets = [] } = {}) {
  let systemPrompt = operationsSystemPrompt;

  if (memorySnippets && memorySnippets.length > 0) {
    systemPrompt += "\n\nBisher bekannte Lage / Erinnerungen:\n";
    for (const snippet of memorySnippets) {
      systemPrompt += `- ${snippet}\n`;
    }
  }

  return systemPrompt;
}

/**
 * User-Prompt:
 * - Übergibt Rollen, kompaktes Board/Aufgaben/Protokoll und KnowledgeContext.
 * - Beschreibt ganz knapp die Aufgabe im aktuellen Schritt.
 */
export function buildUserPrompt({
  llmInput,
  compressedBoard,
  compressedAufgaben,
  compressedProtokoll,
  knowledgeContext,
  memorySnippets,
  messagesNeedingResponse,  // NEU
  disasterContext = "",      // NEU
  learnedResponses = ""      // NEU
}) {
  const safeMemorySnippets = Array.isArray(memorySnippets)
    ? memorySnippets
    : [];
  const formattedMemorySnippets =
    safeMemorySnippets.length > 0
      ? safeMemorySnippets.map((m) => `- ${m}`).join("\n")
      : "(keine RAG-Erinnerungen gefunden)";
  const rolesPart = JSON.stringify(
    { active: llmInput.roles?.active || [] },
    null,
    2
  );
const taskSection = llmInput.firstStep
    ? `SPEZIALFALL: START DER SIMULATION
- Board, Aufgaben und Protokoll sind komplett leer.
- Du MUSST jetzt ein realistisches Start-Szenario erzeugen.
- Erzeuge 1–3 neue Einsatzstellen (operations.board.createIncidentSites), z.B. Hochwasserbereiche, Sturm-/Vermurungsereignisse.
- Erzeuge dazu passende Protokolleinträge (operations.protokoll.create).
- Erzeuge Aufgaben für S2/S3/S4/S5 (operations.aufgaben.create), damit der Stab arbeiten kann.
- Halte dich streng an das JSON-Schema und die Rollenregeln.`
: `=== KRITISCH: ANTWORTFORMAT ===
Du MUSST exakt dieses JSON-Schema verwenden - KEINE Abweichung!

{
  "operations": {
    "board": {
      "createIncidentSites": [],
      "updateIncidentSites": []
    },
    "aufgaben": {
      "create": [],
      "update": []
    },
    "protokoll": {
      "create": []
    }
  },
  "analysis": "Kurze Lagebeurteilung"
}

VERBOTEN - Diese Formate sind FALSCH:
✗ "protokolle": [...]     ← FALSCH! Muss "operations.protokoll.create" sein
✗ "aufgaben": [...]       ← FALSCH! Muss "operations.aufgaben.create/update" sein
✗ "einsatzstellen": [...]  ← FALSCH! Muss "operations.board.createIncidentSites" sein

=== DEINE AUFGABE ===
Du simulierst KEINE Rollen aus activeRoles. Handle JETZT aktiv!

1. OFFENE AUFGABEN bearbeiten:
   → Erstelle Protokolleintrag in operations.protokoll.create
   → ODER aktualisiere Aufgabe in operations.aufgaben.update

2. LAGEENTWICKLUNG simulieren:
   → Neue Lagemeldungen in operations.protokoll.create
   → Statusänderungen in operations.board.updateIncidentSites

3. STABSARBEIT der fehlenden Rollen:
   → S2: Lageberichte  → S3: Einsatzdisposition
   → S4: Versorgung    → S5: Öffentlichkeitsarbeit
   → LtStb: Koordination

PFLICHT:
- MINDESTENS 1-2 Einträge in operations.protokoll.create
- Absender (av, ab) dürfen NICHT in activeRoles sein
- ALLES unter "operations" verschachteln!`;
// ============================================================
  // NEU: Formatiere Meldungen die Antwort benötigen
  // ============================================================
  let responseRequests = "";
  if (messagesNeedingResponse && messagesNeedingResponse.length > 0) {
    responseRequests = `

═══════════════════════════════════════════════════════════════════════════════
WICHTIG - MELDUNGEN DIE ANTWORT BENÖTIGEN
═══════════════════════════════════════════════════════════════════════════════

Die folgenden AUSGEHENDEN Meldungen wurden verschickt und benötigen JETZT eine 
Antwort von den genannten Empfängern.

Du MUSST für JEDE dieser Meldungen einen Protokolleintrag als Antwort erstellen:
  → operations.protokoll.create

Die Antwort kann sein:
  ✓ POSITIV: zustimmend, bestätigend ("wird erledigt", "verstanden", "OK", "Einheiten unterwegs")
  ✗ NEGATIV: ablehnend, Rückfrage ("nicht möglich", "brauche mehr Info", "keine Kapazität")

Entscheide situationsabhängig basierend auf:
  - Der Rolle/Stelle des Empfängers
  - Der aktuellen Lage
  - Realistischen Einschränkungen (Personal, Zeit, Ressourcen)

EXTERNE STELLEN und ihre typischen Antwortmuster:
───────────────────────────────────────────────────────────────────────────────
  Leitstelle (LAWZ):     Alarmierungsbestätigungen, Einheiten-Verfügbarkeit
                        → "Alarmierung erfolgt, 3 Fahrzeuge ETA 15 Min"
                        → "Alle Einheiten im Einsatz, frühestens in 30 Min"
  
  Polizei (POL):        Absperrungen, Verkehrsregelung, Evakuierungshilfe
                        → "Absperrung Hauptstraße wird eingerichtet"
                        → "Streife erst in 20 Min verfügbar"
  
  Bürgermeister (BM):   Evakuierungsentscheidungen, Gemeinderessourcen
                        → "Evakuierung genehmigt, Turnhalle als Notquartier"
                        → "Muss erst mit Gemeinderat Rücksprache halten"
  
  WLV/Wildbach:         Gefahrenbeurteilung Muren, Wildbäche
                        → "Gutachter wird entsandt"
                        → "Gebiet muss sofort geräumt werden"
  
  Straßenmeisterei:     Straßensperren, Räumung, Streudienst
                        → "Sperre wird errichtet, Umleitungsbeschilderung folgt"
                        → "Räumgerät erst morgen früh verfügbar"
  
  EVN/Energieversorger: Stromabschaltung, Freigaben, Netzstatus
                        → "Abschaltung erfolgt in 10 Min"
                        → "Benötige Freigabe vom Netzmeister"
  
  Rotes Kreuz (RK):     Sanitätsdienst, Rettungstransporte, Evakuierungshilfe
                        → "2 RTW werden disponiert"
                        → "Kapazität erschöpft, keine freien Fahrzeuge"
  
  Bundesheer (BH):      Assistenzeinsatz, schweres Gerät, Personal
                        → "Assistenzanforderung wird geprüft"
                        → "Pionierbataillon kann in 2h vor Ort sein"
───────────────────────────────────────────────────────────────────────────────

ANTWORT-FORMAT für jeden Protokolleintrag:
{
  "i": "[Antworttext der Stelle]",
  "typ": "Rueckmeldung",
  "av": "[Name der antwortenden Stelle]",
  "ea": ["[Original-Absender]"],
  "ri": "ein"
}

`;

    // Einzelne Meldungen auflisten
    for (let i = 0; i < messagesNeedingResponse.length; i++) {
      const msg = messagesNeedingResponse[i];
      responseRequests += `
┌─────────────────────────────────────────────────────────────────────────────
│ MELDUNG ${i + 1} - Protokoll-Nr. ${msg.nr || "?"} (${msg.datum || ""} ${msg.zeit || ""})
├─────────────────────────────────────────────────────────────────────────────
│ Von:     ${msg.anvon}
│ An:      ${msg.allRecipients.join(", ")}`;
      
      if (msg.externalRecipients.length > 0) {
        responseRequests += `
│ ⚠️  EXTERNE: ${msg.externalRecipients.join(", ")}`;
      }
      
      responseRequests += `
│ Typ:     ${msg.infoTyp}
│ Inhalt:  "${msg.information}"
│
│ → Erstelle Antwort von: ${msg.allRecipients.join(" ODER ")}
└─────────────────────────────────────────────────────────────────────────────
`;
    }
    
    responseRequests += `
═══════════════════════════════════════════════════════════════════════════════
`;
  }
return fillTemplate(operationsUserPromptTemplate, {
    rolesPart,
    compressedBoard,
    compressedAufgaben,
    compressedProtokoll,
    formattedMemorySnippets,
    knowledgeContext: knowledgeContext || "(kein Knowledge-Kontext verfügbar)",
    taskSection,
    responseRequests,  // NEU
    disasterContext: disasterContext || "(kein Katastrophen-Kontext verfügbar)",  // NEU
    learnedResponses: learnedResponses || "(keine gelernten Antworten verfügbar)"  // NEU
  });
}

// ----------------------------------------------------------
// Spezieller Start-Prompt für den ALLERERSTEN Simulationsschritt
// (wird bei llmInput.firstStep über llm_client.js verwendet)
// ----------------------------------------------------------
export function buildStartPrompts({ roles, scenario = null }) {
  const rolesJson = JSON.stringify({ active: roles?.active || [] }, null, 2);
  const systemPrompt = defaultStartSystemPrompt.trim();

  // NEU: Wenn ein Szenario vorhanden ist, dieses in den Prompt einbauen
  let scenarioContext = "";
  let initialBoard = "";
  let scenarioHints = "";

  if (scenario) {
    const ctx = scenario.scenario_context || {};
    scenarioContext = `
VORGEGEBENES SZENARIO: ${scenario.title || "Unbekannt"}
═══════════════════════════════════════════════════════════════════════════════
Ereignistyp: ${ctx.event_type || "Katastrophe"}
Region: ${ctx.region || "Bezirk Feldkirchen"}
Wetter: ${ctx.weather || ""}
Ausgangslage: ${ctx.initial_situation || ""}

Betroffene Gebiete:
${(ctx.affected_areas || []).map(a => `  - ${a}`).join("\n")}

Besondere Bedingungen:
${(ctx.special_conditions || []).map(c => `  - ${c}`).join("\n")}
═══════════════════════════════════════════════════════════════════════════════`;

    // Initiale Einsatzstellen aus dem Szenario extrahieren
    const allItems = [];
    const board = scenario.initial_state?.board;
    if (board?.columns) {
      for (const column of Object.values(board.columns)) {
        if (Array.isArray(column.items)) {
          allItems.push(...column.items);
        }
      }
    } else if (Array.isArray(board)) {
      for (const column of board) {
        if (Array.isArray(column?.items)) {
          allItems.push(...column.items);
        }
      }
    }
    if (allItems.length > 0) {
      initialBoard = `
INITIALE EINSATZSTELLEN (aus Szenario vorgegeben):
${allItems.map(item => `  - ${item.humanId || item.id}: ${item.content} (${item.ort || "Ort unbekannt"})
    Typ: ${item.typ || "Unbekannt"}
    Beschreibung: ${item.description || ""}`).join("\n")}

WICHTIG: Du MUSST diese Einsatzstellen mit genau diesen Daten anlegen!`;
    }

    // Hinweise aus dem Szenario
    if (scenario.hints && scenario.hints.length > 0) {
      scenarioHints = `
HINWEISE für dieses Szenario:
${scenario.hints.map(h => `  → ${h}`).join("\n")}`;
    }
  }

  // Template mit Szenario-Kontext füllen
  const userPrompt = fillTemplate(startUserPromptTemplate, {
    rolesJson,
    scenarioContext: scenarioContext || "(Kein Szenario vorgegeben - erstelle ein realistisches Katastrophenszenario)",
    initialBoard: initialBoard || "",
    scenarioHints: scenarioHints || ""
  });

  return { systemPrompt, userPrompt };
}
// --------------------------------------------------------
// Chat-Modus: System- und User-Prompts
// --------------------------------------------------------

/**
 * System-Prompt für den normalen QA-Chat.
 * - Immer Deutsch
 * - Keine personenbezogenen Daten
 * - Fokus auf Richtlinie / E-31 / Feuerwehr-Kontext
 */
export function buildSystemPromptChat() {
  return chatSystemPromptTemplate;
}

/**
 * User-Prompt für den QA-Chat.
 * question: Originalfrage des Benutzers
 * knowledgeContext: zusammengesetzter Text aus RAG (kann leer sein)
 * disasterContext: Katastrophen-Kontext (NEU)
 * learnedResponses: Gelernte Antworten (NEU)
 */
export function buildUserPromptChat(question, knowledgeContext, disasterContext = "", learnedResponses = "") {
  return fillTemplate(chatUserPromptTemplate, {
    question,
    knowledgeContext: knowledgeContext || "(kein KnowledgeContext verfügbar)",
    disasterContext: disasterContext || "(kein Katastrophen-Kontext verfügbar)",
    learnedResponses: learnedResponses || "(keine gelernten Antworten verfügbar)"
  });
}
