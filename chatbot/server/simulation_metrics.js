// chatbot/server/simulation_metrics.js
// Metriken-System für Simulation (Prometheus-kompatibel)

import { logDebug } from "./logger.js";

/**
 * Metriken-Manager für Simulation
 */
export class SimulationMetrics {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
  }

  /**
   * Erhöht einen Counter
   * @param {string} name - Metrik-Name
   * @param {Object} labels - Labels
   * @param {number} value - Wert (default: 1)
   */
  incrementCounter(name, labels = {}, value = 1) {
    const key = this.makeKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  /**
   * Zeichnet Wert in Histogram auf
   * @param {string} name - Metrik-Name
   * @param {Object} labels - Labels
   * @param {number} value - Wert
   */
  recordHistogram(name, labels = {}, value) {
    const key = this.makeKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push({ value, timestamp: Date.now() });
  }

  /**
   * Setzt Gauge-Wert
   * @param {string} name - Metrik-Name
   * @param {Object} labels - Labels
   * @param {number} value - Wert
   */
  setGauge(name, labels = {}, value) {
    const key = this.makeKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
   * Erstellt Cache-Key aus Name und Labels
   * @param {string} name - Metrik-Name
   * @param {Object} labels - Labels
   * @returns {string}
   */
  makeKey(name, labels) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  /**
   * Zerlegt einen Key in Name und Labels
   * @param {string} key - Metrik-Key
   * @returns {{ name: string, labels: Object }}
   */
  parseKey(key) {
    const match = key.match(/^([^{}]+)(?:\{([^}]*)\})?$/);
    if (!match) {
      return { name: key, labels: {} };
    }
    const [, name, labelStr] = match;
    const labels = {};
    if (labelStr) {
      const regex = /(\w+)="([^"]*)"/g;
      let labelMatch;
      while ((labelMatch = regex.exec(labelStr)) !== null) {
        labels[labelMatch[1]] = labelMatch[2];
      }
    }
    return { name, labels };
  }

  /**
   * Formatiert Labels für Prometheus
   * @param {Object} labels - Labels
   * @returns {string}
   */
  formatLabels(labels) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `{${labelStr}}` : "";
  }

  /**
   * Summiert Counter nach Label-Filter
   * @param {string} name - Metrik-Name
   * @param {Object} labelFilter - Label-Filter
   * @returns {number}
   */
  getCounterSum(name, labelFilter = {}) {
    let sum = 0;
    for (const [key, value] of this.counters.entries()) {
      const parsed = this.parseKey(key);
      if (parsed.name !== name) continue;
      const matches = Object.entries(labelFilter).every(
        ([label, expected]) => parsed.labels[label] === expected
      );
      if (matches) {
        sum += value;
      }
    }
    return sum;
  }

  /**
   * Gibt Statistiken für ein Histogram zurück
   * @param {string} name - Metrik-Name
   * @returns {Object|null}
   */
  getStats(name) {
    const histogram = Array.from(this.histograms.entries())
      .filter(([key]) => key.startsWith(name))
      .flatMap(([, values]) => values.map(v => v.value));

    if (histogram.length === 0) return null;

    const sorted = histogram.sort((a, b) => a - b);
    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  /**
   * Exportiert Metriken im Prometheus-Format
   * @returns {string}
   */
  exportPrometheus() {
    const lines = [];

    // Counters
    for (const [key, value] of this.counters.entries()) {
      lines.push(`${key} ${value}`);
    }

    // Gauges
    for (const [key, value] of this.gauges.entries()) {
      lines.push(`${key} ${value}`);
    }

    // Histograms als Summary
    for (const [key, values] of this.histograms.entries()) {
      if (values.length === 0) continue;

      const { name, labels } = this.parseKey(key);
      const sorted = values.map(v => v.value).sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);

      const labelSuffix = this.formatLabels(labels);
      lines.push(`${name}_count${labelSuffix} ${sorted.length}`);
      lines.push(`${name}_sum${labelSuffix} ${sum}`);

      // Quantile
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];

      lines.push(`${name}${this.formatLabels({ ...labels, quantile: "0.5" })} ${p50}`);
      lines.push(`${name}${this.formatLabels({ ...labels, quantile: "0.95" })} ${p95}`);
      lines.push(`${name}${this.formatLabels({ ...labels, quantile: "0.99" })} ${p99}`);
    }

    return lines.join('\n');
  }

  /**
   * Gibt alle Metriken als JSON zurück
   * @returns {Object}
   */
  toJSON() {
    const histogramStats = {};
    for (const [key, values] of this.histograms.entries()) {
      if (values.length === 0) continue;
      const sorted = values.map(v => v.value).sort((a, b) => a - b);
      histogramStats[key] = {
        count: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)]
      };
    }

    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histogramStats
    };
  }

  /**
   * Setzt alle Metriken zurück
   */
  reset() {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
    logDebug("Metriken zurückgesetzt");
  }

  /**
   * Bereinigt alte Histogram-Einträge (älter als maxAgeMs)
   * @param {number} maxAgeMs - Maximales Alter in Millisekunden
   */
  cleanupOldHistograms(maxAgeMs = 3600000) {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [key, values] of this.histograms.entries()) {
      const filtered = values.filter(v => v.timestamp > cutoff);
      const removedCount = values.length - filtered.length;

      if (removedCount > 0) {
        this.histograms.set(key, filtered);
        removed += removedCount;
      }
    }

    if (removed > 0) {
      logDebug("Alte Histogram-Einträge entfernt", { removed });
    }

    return removed;
  }
}

// Singleton-Instanz
export const metrics = new SimulationMetrics();

// Automatisches Cleanup alle 30 Minuten
setInterval(() => {
  metrics.cleanupOldHistograms(3600000); // 1 Stunde
}, 30 * 60 * 1000);

/**
 * Timer-Helper für Dauer-Messungen
 */
export class Timer {
  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Stoppt den Timer und gibt Dauer zurück
   * @returns {number} - Dauer in Millisekunden
   */
  stop() {
    return Date.now() - this.startTime;
  }

  /**
   * Stoppt Timer und zeichnet in Histogram auf
   * @param {string} metricName - Metrik-Name
   * @param {Object} labels - Labels
   */
  recordHistogram(metricName, labels = {}) {
    const duration = this.stop();
    metrics.recordHistogram(metricName, labels, duration);
    return duration;
  }
}

/**
 * Erstellt einen neuen Timer
 * @returns {Timer}
 */
export function startTimer() {
  return new Timer();
}
