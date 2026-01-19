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

// Vordefinierte Standard-Regeln (R1-R5)
const DEFAULT_RULES = {
  version: "1.0.0",
  limits: {
    max_total_tokens: 2500,
    max_context_size_kb: 50
  },
  rules: {
    R1_ABSCHNITTE_PRIORITAET: {
      enabled: true,
      description: "Filtert Abschnitte nach Priorität und zeigt die wichtigsten",
      applies_to: "board",
      priority_factors: [
        { field: "critical_incidents", operator: ">", value: 0, score: 100 },
        { field: "total_incidents", operator: ">=", value: 5, score: 50 },
        { field: "total_personnel", operator: ">=", value: 20, score: 30 },
        { field: "avg_personnel_per_incident", operator: ">=", value: 5, score: 20 }
      ],
      output: {
        max_items: 5
      }
    },
    R2_PROTOKOLL_RELEVANZ: {
      enabled: true,
      description: "Filtert Protokoll-Einträge nach Relevanz",
      applies_to: "protocol",
      scoring: {
        base_score: 0.5,
        factors: [
          { name: "Offene Fragen", pattern: "\\?", weight: 0.3, learnable: true },
          { name: "Ressourcen-Anfrage", keywords: ["anfordern", "anforderung", "benötigt", "brauchen", "verstärkung"], weight: 0.25, learnable: true },
          { name: "Statusmeldung", keywords: ["status", "lage", "situation", "aktuell"], weight: 0.15, learnable: true },
          { name: "Dringend", keywords: ["dringend", "sofort", "kritisch", "notfall", "alarm"], weight: 0.4, learnable: false },
          { name: "Warnung", keywords: ["warnung", "achtung", "gefahr", "vorsicht"], weight: 0.35, learnable: false }
        ]
      },
      output: {
        max_entries: 10,
        min_score: 0.6,
        show_score: false
      }
    },
    R3_TRENDS_ERKENNUNG: {
      enabled: true,
      description: "Erkennt Trends in der Einsatzentwicklung",
      applies_to: "board",
      time_windows: [60, 120],
      output: {
        forecast_horizon_minutes: 120
      }
    },
    R4_RESSOURCEN_STATUS: {
      enabled: true,
      description: "Analysiert den Ressourcen-Status und erkennt Engpässe",
      applies_to: "board",
      aggregation: {
        highlight_threshold: {
          utilization_percent: 80
        }
      }
    },
    R5_STABS_FOKUS: {
      enabled: false,
      description: "Aggregiert Daten für Stabs-Ansicht (nur kritische Einzeleinsätze)",
      applies_to: "all",
      stab_mode: {
        aggregate_to_sections: true,
        max_individual_incidents: 3,
        show_individual_incidents_only_if: [
          { field: "priority", value: "critical" },
          { field: "has_open_questions", value: true }
        ]
      }
    }
  }
};

/**
 * Lädt Regeln aus Datei oder gibt Default zurück
 */
async function loadRulesOrDefault() {
  try {
    const rulesRaw = await fsPromises.readFile(RULES_FILE, "utf8");
    return JSON.parse(rulesRaw);
  } catch (err) {
    // Datei existiert nicht - Default verwenden
    return DEFAULT_RULES;
  }
}

/**
 * Stellt sicher, dass das Verzeichnis existiert
 */
async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  try {
    await fsPromises.mkdir(dir, { recursive: true });
  } catch (err) {
    // Verzeichnis existiert bereits
  }
}

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
    // Lade Regelwerk (mit Fallback auf Default)
    const rules = await loadRulesOrDefault();

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
    const rules = await loadRulesOrDefault();
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

    // Verzeichnis erstellen falls nötig
    await ensureDir(RULES_FILE);

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

    // Verzeichnis erstellen falls nötig
    await ensureDir(LEARNED_FILE);

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
