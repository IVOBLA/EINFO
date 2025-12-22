// chatbot/server/llm_feedback.js
//
// LLM Feedback & Rating System: Sammelt Bewertungen von LLM-Antworten
// und nutzt sie für kontinuierliches Lernen

import fsPromises from "fs/promises";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "./config.js";
import { logDebug, logError, logInfo } from "./logger.js";
import { embedText } from "./rag/embedding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pfade für Feedback-Storage
const FEEDBACK_DIR = path.resolve(__dirname, "../../server/data/llm_feedback");
const LEARNED_RESPONSES_FILE = path.resolve(FEEDBACK_DIR, "learned_responses.json");
const LEARNED_EMBEDDINGS_FILE = path.resolve(FEEDBACK_DIR, "learned_embeddings.json");

/**
 * Feedback-Struktur:
 * {
 *   feedbackId: "feedback_timestamp_random",
 *   timestamp: number,
 *
 *   // Context
 *   disasterId: string | null,
 *   disasterType: string | null,
 *   disasterPhase: string | null,
 *
 *   // LLM-Interaction
 *   interactionType: "operations" | "chat" | "suggestion",
 *   question: string,          // User-Frage oder Context
 *   llmResponse: string,        // LLM-Antwort
 *   llmModel: string,
 *
 *   // Rating
 *   rating: 1 | 2 | 3 | 4 | 5,  // 1=sehr schlecht, 5=sehr gut
 *   helpful: boolean,
 *   accurate: boolean,
 *   actionable: boolean,
 *
 *   // User Feedback
 *   userId: string | null,
 *   userRole: string | null,
 *   comment: string | null,
 *
 *   // Outcome
 *   implemented: boolean,       // Wurde die Antwort umgesetzt?
 *   outcome: string | null      // Was war das Ergebnis?
 * }
 */

/**
 * Learned Response Struktur:
 * {
 *   learnedId: string,
 *   originalFeedbackId: string,
 *   timestamp: number,
 *
 *   // Question & Context
 *   question: string,
 *   questionEmbedding: Float32Array,
 *   context: {
 *     disasterType: string,
 *     disasterPhase: string,
 *     situationSummary: string
 *   },
 *
 *   // Response
 *   response: string,
 *
 *   // Quality Metrics
 *   avgRating: number,
 *   timesReferenced: number,
 *   successRate: number,
 *
 *   // Metadata
 *   tags: string[],
 *   category: string
 * }
 */

// In-Memory-Cache
let learnedResponses = [];
let learnedEmbeddings = [];
let cacheLoaded = false;

/**
 * Initialisiert das Feedback-System
 */
async function initFeedbackSystem() {
  try {
    await fsPromises.mkdir(FEEDBACK_DIR, { recursive: true });

    // Lade Learned Responses in Memory
    if (fs.existsSync(LEARNED_RESPONSES_FILE)) {
      const raw = await fsPromises.readFile(LEARNED_RESPONSES_FILE, "utf8");
      learnedResponses = JSON.parse(raw);
    } else {
      learnedResponses = [];
    }

    // Lade Embeddings
    if (fs.existsSync(LEARNED_EMBEDDINGS_FILE)) {
      const raw = await fsPromises.readFile(LEARNED_EMBEDDINGS_FILE, "utf8");
      const data = JSON.parse(raw);
      learnedEmbeddings = data.vectors || [];
    } else {
      learnedEmbeddings = [];
    }

    cacheLoaded = true;
    logInfo("LLM Feedback System initialisiert", {
      learnedResponsesCount: learnedResponses.length
    });
  } catch (err) {
    logError("Fehler beim Initialisieren des Feedback-Systems", {
      error: String(err)
    });
  }
}

/**
 * Speichert ein Feedback
 */
export async function saveFeedback({
  disasterId,
  disasterType,
  disasterPhase,
  interactionType,
  question,
  llmResponse,
  llmModel,
  rating,
  helpful,
  accurate,
  actionable,
  userId,
  userRole,
  comment,
  implemented,
  outcome
}) {
  const feedbackId = `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const feedback = {
    feedbackId,
    timestamp: Date.now(),

    disasterId,
    disasterType,
    disasterPhase,

    interactionType,
    question,
    llmResponse,
    llmModel,

    rating,
    helpful: helpful !== false,
    accurate: accurate !== false,
    actionable: actionable !== false,

    userId,
    userRole,
    comment,

    implemented: implemented === true,
    outcome
  };

  // Speichere Feedback
  try {
    await fsPromises.mkdir(FEEDBACK_DIR, { recursive: true });

    const feedbackFile = path.join(FEEDBACK_DIR, `${feedbackId}.json`);
    await fsPromises.writeFile(
      feedbackFile,
      JSON.stringify(feedback, null, 2),
      "utf8"
    );

    logInfo("Feedback gespeichert", { feedbackId, rating });

    // Wenn Rating >= 4 → In Learned Responses aufnehmen
    if (rating >= 4 && helpful && accurate) {
      await addToLearnedResponses(feedback);
    }

    return feedback;
  } catch (err) {
    logError("Fehler beim Speichern des Feedbacks", {
      feedbackId,
      error: String(err)
    });
    return null;
  }
}

/**
 * Fügt eine gut bewertete Antwort zu Learned Responses hinzu
 */
async function addToLearnedResponses(feedback) {
  if (!cacheLoaded) {
    await initFeedbackSystem();
  }

  try {
    // Prüfe ob ähnliche Antwort bereits existiert
    const existingIndex = learnedResponses.findIndex(
      lr => similarity(lr.question, feedback.question) > 0.85
    );

    if (existingIndex >= 0) {
      // Update existing
      const existing = learnedResponses[existingIndex];
      existing.timesReferenced++;
      existing.avgRating = (existing.avgRating + feedback.rating) / 2;

      logDebug("Learned Response aktualisiert", {
        learnedId: existing.learnedId,
        timesReferenced: existing.timesReferenced
      });
    } else {
      // Erstelle neuen Learned Response
      const learnedId = `learned_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Erstelle Embedding für Frage
      const questionEmbedding = await embedText(feedback.question);

      const learned = {
        learnedId,
        originalFeedbackId: feedback.feedbackId,
        timestamp: Date.now(),

        question: feedback.question,
        questionEmbedding: Array.from(questionEmbedding),

        context: {
          disasterType: feedback.disasterType,
          disasterPhase: feedback.disasterPhase,
          situationSummary: ""
        },

        response: feedback.llmResponse,

        avgRating: feedback.rating,
        timesReferenced: 1,
        successRate: feedback.implemented ? 1.0 : 0.5,

        tags: extractTags(feedback.question),
        category: categorizeQuestion(feedback.question)
      };

      learnedResponses.push(learned);
      learnedEmbeddings.push(questionEmbedding);

      logInfo("Neue Learned Response erstellt", {
        learnedId,
        category: learned.category
      });
    }

    // Speichere Updates
    await saveLearnedResponses();
  } catch (err) {
    logError("Fehler beim Hinzufügen zur Learned Responses", {
      error: String(err)
    });
  }
}

/**
 * Speichert Learned Responses & Embeddings
 */
async function saveLearnedResponses() {
  try {
    await fsPromises.writeFile(
      LEARNED_RESPONSES_FILE,
      JSON.stringify(learnedResponses, null, 2),
      "utf8"
    );

    await fsPromises.writeFile(
      LEARNED_EMBEDDINGS_FILE,
      JSON.stringify({
        dim: CONFIG.rag.dim,
        vectors: learnedEmbeddings.map(v => Array.from(v))
      }, null, 2),
      "utf8"
    );

    logDebug("Learned Responses gespeichert", {
      count: learnedResponses.length
    });
  } catch (err) {
    logError("Fehler beim Speichern der Learned Responses", {
      error: String(err)
    });
  }
}

/**
 * Sucht nach ähnlichen gelernten Antworten
 */
export async function findSimilarLearnedResponses(question, { topK = 3, minScore = 0.6 } = {}) {
  if (!cacheLoaded) {
    await initFeedbackSystem();
  }

  if (learnedResponses.length === 0) {
    return [];
  }

  try {
    // Erstelle Embedding für Frage
    const queryEmbedding = await embedText(question);

    // Berechne Similarities
    const results = [];
    for (let i = 0; i < learnedResponses.length; i++) {
      const learned = learnedResponses[i];
      const embedding = new Float32Array(learned.questionEmbedding);

      const score = cosineSimilarity(queryEmbedding, embedding);

      if (score >= minScore) {
        results.push({
          learned,
          score
        });
      }
    }

    // Sortiere nach Score
    results.sort((a, b) => b.score - a.score);

    // Nimm Top-K
    const topResults = results.slice(0, topK);

    logDebug("Ähnliche Learned Responses gefunden", {
      count: topResults.length,
      scores: topResults.map(r => r.score.toFixed(3))
    });

    return topResults;
  } catch (err) {
    logError("Fehler bei der Suche nach Learned Responses", {
      error: String(err)
    });
    return [];
  }
}

/**
 * Erstellt Context-String aus Learned Responses für LLM-Prompt
 */
export async function getLearnedResponsesContext(question, { maxLength = 1000 } = {}) {
  const similar = await findSimilarLearnedResponses(question, { topK: 3, minScore: 0.65 });

  if (similar.length === 0) {
    return "";
  }

  let context = "### GELERNTE ANTWORTEN (aus positiv bewerteten Interaktionen) ###\n\n";

  for (const { learned, score } of similar) {
    context += `[Relevanz: ${(score * 100).toFixed(0)}%] [Rating: ${learned.avgRating.toFixed(1)}/5] [${learned.timesReferenced}x verwendet]\n`;
    context += `Frage: ${learned.question}\n`;
    context += `Antwort: ${learned.response}\n\n`;
  }

  // Kürze falls zu lang
  if (context.length > maxLength) {
    context = context.substring(0, maxLength) + "\n... (gekürzt)";
  }

  return context;
}

/**
 * Listet alle Feedbacks
 */
export async function listFeedbacks({ limit = 50, minRating = null } = {}) {
  try {
    await fsPromises.mkdir(FEEDBACK_DIR, { recursive: true });
    const files = await fsPromises.readdir(FEEDBACK_DIR);

    const feedbacks = [];
    for (const file of files) {
      if (file.startsWith("feedback_") && file.endsWith(".json")) {
        const filePath = path.join(FEEDBACK_DIR, file);
        const raw = await fsPromises.readFile(filePath, "utf8");
        const feedback = JSON.parse(raw);

        if (minRating === null || feedback.rating >= minRating) {
          feedbacks.push(feedback);
        }
      }
    }

    // Sortiere nach Timestamp (neueste zuerst)
    feedbacks.sort((a, b) => b.timestamp - a.timestamp);

    return feedbacks.slice(0, limit);
  } catch (err) {
    logError("Fehler beim Auflisten der Feedbacks", {
      error: String(err)
    });
    return [];
  }
}

/**
 * Gibt Feedback-Statistiken zurück
 */
export async function getFeedbackStatistics() {
  const feedbacks = await listFeedbacks({ limit: 1000 });

  const stats = {
    total: feedbacks.length,
    byRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    avgRating: 0,
    helpfulCount: 0,
    accurateCount: 0,
    actionableCount: 0,
    implementedCount: 0,
    byCategory: {},
    byDisasterType: {}
  };

  let totalRating = 0;

  for (const fb of feedbacks) {
    stats.byRating[fb.rating]++;
    totalRating += fb.rating;

    if (fb.helpful) stats.helpfulCount++;
    if (fb.accurate) stats.accurateCount++;
    if (fb.actionable) stats.actionableCount++;
    if (fb.implemented) stats.implementedCount++;

    const category = categorizeQuestion(fb.question);
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;

    if (fb.disasterType) {
      stats.byDisasterType[fb.disasterType] = (stats.byDisasterType[fb.disasterType] || 0) + 1;
    }
  }

  stats.avgRating = feedbacks.length > 0 ? totalRating / feedbacks.length : 0;

  return stats;
}

/**
 * Hilfsfunktionen
 */

function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function similarity(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1.0;

  const len = Math.max(s1.length, s2.length);
  const dist = levenshteinDistance(s1, s2);

  return 1 - (dist / len);
}

function levenshteinDistance(str1, str2) {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

function extractTags(question) {
  const tags = [];
  const lowerQ = question.toLowerCase();

  // Einsatztypen
  if (lowerQ.includes("hochwasser") || lowerQ.includes("überflutung")) tags.push("hochwasser");
  if (lowerQ.includes("sturm") || lowerQ.includes("wind")) tags.push("sturm");
  if (lowerQ.includes("schnee") || lowerQ.includes("lawine")) tags.push("schnee");
  if (lowerQ.includes("mure") || lowerQ.includes("erdrutsch")) tags.push("mure");
  if (lowerQ.includes("brand") || lowerQ.includes("feuer")) tags.push("brand");

  // Rollen
  if (lowerQ.includes("s1")) tags.push("s1");
  if (lowerQ.includes("s2")) tags.push("s2");
  if (lowerQ.includes("s3")) tags.push("s3");
  if (lowerQ.includes("s4")) tags.push("s4");
  if (lowerQ.includes("s5")) tags.push("s5");
  if (lowerQ.includes("s6")) tags.push("s6");

  // Themen
  if (lowerQ.includes("evakuierung")) tags.push("evakuierung");
  if (lowerQ.includes("ressource") || lowerQ.includes("fahrzeug")) tags.push("ressourcen");
  if (lowerQ.includes("kommunikation")) tags.push("kommunikation");
  if (lowerQ.includes("lage")) tags.push("lage");

  return tags;
}

function categorizeQuestion(question) {
  const lowerQ = question.toLowerCase();

  if (lowerQ.includes("was ist") || lowerQ.includes("was sind") || lowerQ.includes("erkläre")) {
    return "definition";
  }

  if (lowerQ.includes("wie") || lowerQ.includes("vorgehen")) {
    return "procedure";
  }

  if (lowerQ.includes("sollte") || lowerQ.includes("empfehlen") || lowerQ.includes("vorschlag")) {
    return "recommendation";
  }

  if (lowerQ.includes("warum") || lowerQ.includes("grund")) {
    return "explanation";
  }

  return "general";
}

// Auto-Init beim Import
initFeedbackSystem();
