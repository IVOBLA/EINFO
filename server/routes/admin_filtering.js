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
const ANALYSIS_STATUS_FILE = path.resolve(__dirname, "../data/last_analysis_status.json");
const SCENARIO_CONFIG_FILE = path.resolve(__dirname, "../data/scenario_config.json");

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
      critical_scoring: {
        base_score: 0.0,
        min_score: 0.6,
        factors: [
          { name: "Personen in Gefahr", keywords: ["verletzt", "eingeschlossen", "eingeklemmt", "vermisst", "reanimation"], weight: 0.4, learnable: false },
          { name: "Brand/Explosion", keywords: ["brand", "feuer", "rauch", "explosion"], weight: 0.35, learnable: false },
          { name: "Evakuierung/Gefahrstoff", keywords: ["evakuierung", "räumung", "gefahrstoff", "austritt", "kontamination"], weight: 0.3, learnable: false },
          { name: "Infrastruktur/Kollaps", keywords: ["einsturz", "kollaps", "brücke", "gas", "stromausfall", "wasser"], weight: 0.25, learnable: false },
          { name: "Unwetter/Umwelt", keywords: ["hochwasser", "überschwemmung", "sturm", "erdrutsch"], weight: 0.2, learnable: false }
        ]
      },
      max_individual_incidents: 3,
      min_required: 3,
      fallback_top_n: 5,
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
 * Lädt Regeln aus Datei. Erstellt die Datei mit Standard-Regeln falls nicht vorhanden.
 */
async function loadRulesOrDefault() {
  try {
    const rulesRaw = await fsPromises.readFile(RULES_FILE, "utf8");
    return JSON.parse(rulesRaw);
  } catch (err) {
    // Datei existiert nicht - Standard-Regeln in Datei schreiben
    console.log("filtering_rules.json nicht gefunden, erstelle mit Standard-Regeln...");
    await ensureDir(RULES_FILE);
    await fsPromises.writeFile(
      RULES_FILE,
      JSON.stringify(DEFAULT_RULES, null, 2),
      "utf8"
    );
    console.log("filtering_rules.json erstellt:", RULES_FILE);
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
 * Speichert den letzten Analyse-Status in eine Datei
 * (wird von disaster_context.js im Chatbot-Server aufgerufen)
 */
export async function setLastAnalysisStatus(status) {
  const statusData = {
    ...status,
    timestamp: Date.now()
  };
  try {
    await ensureDir(ANALYSIS_STATUS_FILE);
    await fsPromises.writeFile(
      ANALYSIS_STATUS_FILE,
      JSON.stringify(statusData, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Fehler beim Speichern des Analyse-Status:", err);
  }
}

/**
 * Lädt den letzten Analyse-Status aus der Datei
 */
async function loadLastAnalysisStatus() {
  try {
    const raw = await fsPromises.readFile(ANALYSIS_STATUS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    // Datei existiert noch nicht - OK
    return null;
  }
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

      lastAnalysis: (await loadLastAnalysisStatus())?.lastAnalysis || null
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

// Pfad für AI-Analyse-Konfiguration
const AI_ANALYSIS_CFG_FILE = path.resolve(__dirname, "../data/conf/ai-analysis.json");

/**
 * GET /api/admin/filtering-rules/ai-analysis-config
 * Gibt die aktuelle AI-Analyse-Konfiguration zurück
 */
router.get("/ai-analysis-config", async (req, res) => {
  try {
    let config;
    try {
      const raw = await fsPromises.readFile(AI_ANALYSIS_CFG_FILE, "utf8");
      config = JSON.parse(raw);
    } catch (err) {
      // Datei existiert noch nicht - Standard-Konfiguration zurückgeben
      config = {
        enabled: true,
        intervalMinutes: 5,
        contextMode: "rules",
        llmSummarization: {
          enabled: false,
          model: "llama3.1:8b",
          maxTokens: 1500,
          temperature: 0.3,
          timeout: 60000
        }
      };
    }
    res.json(config);
  } catch (err) {
    console.error("Fehler beim Laden der AI-Analyse-Konfiguration:", err);
    res.status(500).json({
      error: "Fehler beim Laden der Konfiguration",
      details: String(err)
    });
  }
});

/**
 * PUT /api/admin/filtering-rules/ai-analysis-config
 * Aktualisiert die AI-Analyse-Konfiguration
 */
router.put("/ai-analysis-config", async (req, res) => {
  try {
    const newConfig = req.body;

    // Validierung
    if (typeof newConfig !== "object") {
      return res.status(400).json({
        error: "Ungültige Konfiguration",
        details: "Body muss ein Objekt sein"
      });
    }

    // Bestehende Konfiguration laden
    let existingConfig = {
      enabled: true,
      intervalMinutes: 5,
      contextMode: "rules",
      llmSummarization: {
        enabled: false,
        model: "llama3.1:8b",
        maxTokens: 1500,
        temperature: 0.3,
        timeout: 60000
      }
    };

    try {
      const raw = await fsPromises.readFile(AI_ANALYSIS_CFG_FILE, "utf8");
      existingConfig = JSON.parse(raw);
    } catch (err) {
      // Datei existiert noch nicht - Standard verwenden
    }

    // Merge Konfiguration
    const mergedConfig = {
      ...existingConfig,
      ...newConfig,
      llmSummarization: {
        ...(existingConfig.llmSummarization || {}),
        ...(newConfig.llmSummarization || {})
      }
    };

    // Verzeichnis erstellen falls nötig
    await ensureDir(AI_ANALYSIS_CFG_FILE);

    // Speichern
    await fsPromises.writeFile(
      AI_ANALYSIS_CFG_FILE,
      JSON.stringify(mergedConfig, null, 2),
      "utf8"
    );

    console.log("[ADMIN] AI-Analyse-Konfiguration aktualisiert:", mergedConfig);

    res.json({
      success: true,
      message: "AI-Analyse-Konfiguration aktualisiert",
      config: mergedConfig
    });
  } catch (err) {
    console.error("Fehler beim Speichern der AI-Analyse-Konfiguration:", err);
    res.status(500).json({
      error: "Fehler beim Speichern der Konfiguration",
      details: String(err)
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

/**
 * GET /api/admin/filtering-rules/scenario
 * Gibt aktuelle Szenario-Konfiguration zurück
 */
router.get("/scenario", async (req, res) => {
  try {
    const raw = await fsPromises.readFile(SCENARIO_CONFIG_FILE, "utf8");
    const config = JSON.parse(raw);
    res.json(config);
  } catch (err) {
    // Datei existiert nicht - Default-Werte zurückgeben
    res.json({
      scenarioId: null,
      artDesEreignisses: "Unbekannt",
      geografischerBereich: "Nicht definiert",
      zeit: null,
      wetter: null,
      infrastruktur: null
    });
  }
});

/**
 * PUT /api/admin/filtering-rules/scenario
 * Aktualisiert Szenario-Konfiguration
 */
router.put("/scenario", async (req, res) => {
  try {
    const { artDesEreignisses, geografischerBereich, zeit, wetter, infrastruktur } = req.body;

    // Lade bestehende Config oder erstelle neue
    let config = {};
    try {
      const raw = await fsPromises.readFile(SCENARIO_CONFIG_FILE, "utf8");
      config = JSON.parse(raw);
    } catch {
      // Datei existiert nicht
    }

    // Aktualisiere nur übergebene Felder
    if (artDesEreignisses !== undefined) config.artDesEreignisses = artDesEreignisses;
    if (geografischerBereich !== undefined) config.geografischerBereich = geografischerBereich;
    if (zeit !== undefined) config.zeit = zeit;
    if (wetter !== undefined) config.wetter = wetter;
    if (infrastruktur !== undefined) config.infrastruktur = infrastruktur;

    // Setze scenarioId wenn nicht vorhanden
    if (!config.scenarioId) {
      config.scenarioId = `scenario_${Date.now()}`;
    }

    // Verzeichnis erstellen falls nötig
    await ensureDir(SCENARIO_CONFIG_FILE);

    // Speichern
    await fsPromises.writeFile(
      SCENARIO_CONFIG_FILE,
      JSON.stringify(config, null, 2),
      "utf8"
    );

    res.json({
      success: true,
      message: "Szenario-Konfiguration aktualisiert",
      config
    });
  } catch (err) {
    console.error("Fehler beim Speichern der Szenario-Konfiguration:", err);
    res.status(500).json({
      error: "Fehler beim Speichern",
      details: String(err)
    });
  }
});

export default router;
