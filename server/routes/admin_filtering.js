// server/routes/admin_filtering.js
//
// Admin-Endpunkte für Filter-Regeln Verwaltung und Monitoring

import express from "express";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const RULES_FILE = path.resolve(__dirname, "../data/conf/filtering_rules.json");
const LEARNED_FILE = path.resolve(__dirname, "../data/llm_feedback/learned_filters.json");

// Cache für letzten Analyse-Status
let lastAnalysisStatus = null;

/**
 * Speichert den letzten Analyse-Status (wird von disaster_context.js aufgerufen)
 */
export function setLastAnalysisStatus(status) {
  lastAnalysisStatus = {
    ...status,
    timestamp: Date.now()
  };
}

/**
 * GET /api/admin/filtering-rules/status
 * Gibt Status der Filterregeln und letzte Analyse zurück
 */
router.get("/status", async (req, res) => {
  try {
    // Lade Regelwerk
    const rulesRaw = await fsPromises.readFile(RULES_FILE, "utf8");
    const rules = JSON.parse(rulesRaw);

    // Lade gelernte Filter
    let learned = null;
    try {
      const learnedRaw = await fsPromises.readFile(LEARNED_FILE, "utf8");
      learned = JSON.parse(learnedRaw);
    } catch (err) {
      // Datei existiert noch nicht - OK
      learned = null;
    }

    // Erstelle Status-Übersicht
    const status = {
      rules: {
        version: rules.version,
        limits: rules.limits,
        definitions: Object.entries(rules.rules || {}).map(([id, rule]) => ({
          id,
          enabled: rule.enabled,
          description: rule.description,
          applies_to: rule.applies_to
        }))
      },

      learned: learned ? {
        version: learned.version,
        last_updated: learned.last_updated,
        contexts_analyzed: learned.context_effectiveness?.contexts_analyzed || 0,
        feedback_received: learned.context_effectiveness?.feedback_received || 0,
        avg_helpfulness: learned.context_effectiveness?.avg_helpfulness || 0,

        protocol_factors: Object.entries(learned.learned_weights?.protocol_factors || {}).map(([name, data]) => ({
          name,
          initial_weight: data.initial_weight,
          current_weight: data.current_weight,
          feedback_count: data.feedback_count,
          helpful_count: data.helpful_count,
          success_rate: data.success_rate
        }))
      } : null,

      last_analysis: lastAnalysisStatus || {
        timestamp: null,
        disaster_type: null,
        message: "Noch keine Analyse durchgeführt"
      }
    };

    res.json(status);
  } catch (err) {
    console.error("Fehler beim Laden des Filter-Status:", err);
    res.status(500).json({
      error: "Fehler beim Laden des Filter-Status",
      details: String(err)
    });
  }
});

/**
 * GET /api/admin/filtering-rules
 * Gibt vollständige Regel-Definition zurück
 */
router.get("/", async (req, res) => {
  try {
    const rulesRaw = await fsPromises.readFile(RULES_FILE, "utf8");
    const rules = JSON.parse(rulesRaw);
    res.json(rules);
  } catch (err) {
    console.error("Fehler beim Laden der Regeln:", err);
    res.status(500).json({
      error: "Fehler beim Laden der Regeln",
      details: String(err)
    });
  }
});

/**
 * PUT /api/admin/filtering-rules
 * Aktualisiert Regel-Definition (komplettes Überschreiben)
 */
router.put("/", async (req, res) => {
  try {
    const newRules = req.body;

    // Validierung
    if (!newRules.version || !newRules.rules) {
      return res.status(400).json({
        error: "Ungültige Regel-Struktur",
        details: "Fehlende Felder: version oder rules"
      });
    }

    // Speichern
    await fsPromises.writeFile(
      RULES_FILE,
      JSON.stringify(newRules, null, 2),
      "utf8"
    );

    // Invalidiere Cache (damit neue Regeln geladen werden)
    const { invalidateRulesCache } = await import("../../chatbot/server/filtering_engine.js");
    invalidateRulesCache();

    res.json({
      success: true,
      message: "Regeln erfolgreich aktualisiert"
    });
  } catch (err) {
    console.error("Fehler beim Speichern der Regeln:", err);
    res.status(500).json({
      error: "Fehler beim Speichern der Regeln",
      details: String(err)
    });
  }
});

/**
 * GET /api/admin/filtering-rules/learned
 * Gibt gelernte Filter zurück
 */
router.get("/learned", async (req, res) => {
  try {
    const learnedRaw = await fsPromises.readFile(LEARNED_FILE, "utf8");
    const learned = JSON.parse(learnedRaw);
    res.json(learned);
  } catch (err) {
    // Datei existiert noch nicht
    res.json({
      version: "1.0.0",
      learned_weights: {},
      context_effectiveness: {
        contexts_analyzed: 0,
        feedback_received: 0
      }
    });
  }
});

/**
 * POST /api/admin/filtering-rules/reset-learned
 * Setzt gelernte Gewichte zurück
 */
router.post("/reset-learned", async (req, res) => {
  try {
    const { confirmReset } = req.body;

    if (!confirmReset) {
      return res.status(400).json({
        error: "Reset muss bestätigt werden",
        details: "Sende { confirmReset: true }"
      });
    }

    // Initialer Zustand
    const initialState = {
      version: "1.0.0",
      last_updated: Date.now(),
      learned_weights: {
        protocol_factors: {
          "Offene Fragen": {
            initial_weight: 1.2,
            current_weight: 1.2,
            adjustment_history: [],
            feedback_count: 0,
            helpful_count: 0,
            success_rate: 0
          },
          "Ressourcen-Anfrage": {
            initial_weight: 0.8,
            current_weight: 0.8,
            adjustment_history: [],
            feedback_count: 0,
            helpful_count: 0,
            success_rate: 0
          },
          "Statusmeldung": {
            initial_weight: 0.5,
            current_weight: 0.5,
            adjustment_history: [],
            feedback_count: 0,
            helpful_count: 0,
            success_rate: 0
          }
        }
      },
      context_effectiveness: {
        contexts_analyzed: 0,
        feedback_received: 0,
        avg_helpfulness: 0
      },
      disaster_type_preferences: {}
    };

    await fsPromises.writeFile(
      LEARNED_FILE,
      JSON.stringify(initialState, null, 2),
      "utf8"
    );

    res.json({
      success: true,
      message: "Gelernte Gewichte wurden zurückgesetzt"
    });
  } catch (err) {
    console.error("Fehler beim Reset:", err);
    res.status(500).json({
      error: "Fehler beim Reset",
      details: String(err)
    });
  }
});

export default router;
