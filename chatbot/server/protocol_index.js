// chatbot/server/protocol_index.js
// Effiziente Protokoll-Suche (O(n) statt O(n²))

import { logDebug } from "./logger.js";

/**
 * Index für effiziente Protokoll-Suche.
 * Reduziert Komplexität von O(n²) auf O(n).
 */
export class ProtocolIndex {
  constructor(protokoll = []) {
    this.byNr = new Map();
    this.byTime = [];
    this.byRecipient = new Map();
    this.bySender = new Map();
    this.byId = new Map();
    this.timeCache = new Map();

    this.buildIndex(protokoll);
  }

  /**
   * Baut alle Indices auf
   * @param {Array} protokoll - Protokolleinträge
   */
  buildIndex(protokoll) {
    const startTime = Date.now();

    // Zeitlich sortiert
    this.byTime = [...protokoll].sort((a, b) => {
      const timeA = this.parseTimestamp(a.datum, a.zeit);
      const timeB = this.parseTimestamp(b.datum, b.zeit);
      return timeA - timeB;
    });

    // Verschiedene Indices aufbauen
    for (const entry of this.byTime) {
      // Nach ID
      if (entry.id) {
        this.byId.set(entry.id, entry);
      }

      // Nach Nr
      if (entry.nr) {
        this.byNr.set(String(entry.nr), entry);
      }

      // Nach Absender
      if (entry.anvon) {
        const sender = String(entry.anvon).toUpperCase();
        if (!this.bySender.has(sender)) {
          this.bySender.set(sender, []);
        }
        this.bySender.get(sender).push(entry);
      }

      // Nach Empfänger
      const recipients = Array.isArray(entry.ergehtAn) ? entry.ergehtAn : [];
      for (const recipient of recipients) {
        const recipientKey = String(recipient).toUpperCase();
        if (!this.byRecipient.has(recipientKey)) {
          this.byRecipient.set(recipientKey, []);
        }
        this.byRecipient.get(recipientKey).push(entry);
      }
    }

    const duration = Date.now() - startTime;
    logDebug("ProtocolIndex aufgebaut", {
      entries: protokoll.length,
      duration,
      indices: {
        byNr: this.byNr.size,
        byRecipient: this.byRecipient.size,
        bySender: this.bySender.size,
        byId: this.byId.size
      }
    });
  }

  /**
   * Parst Datum/Zeit zu Timestamp (mit Cache)
   * @param {string} datum - DD.MM.YYYY
   * @param {string} zeit - HH:MM
   * @returns {number} - Timestamp
   */
  parseTimestamp(datum, zeit) {
    if (!datum || !zeit) return 0;

    const key = `${datum}_${zeit}`;
    if (this.timeCache.has(key)) {
      return this.timeCache.get(key);
    }

    // Parse "DD.MM.YYYY" und "HH:MM"
    const [day, month, year] = datum.split('.');
    const [hour, minute] = zeit.split(':');

    const timestamp = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    ).getTime();

    this.timeCache.set(key, timestamp);
    return timestamp;
  }

  /**
   * Findet Antwort auf einen Protokolleintrag
   * @param {Object} entry - Ursprüngliche Meldung
   * @returns {Object|null} - Antwort-Eintrag oder null
   */
  findResponseTo(entry) {
    // 1. Direkte Referenz über bezugNr
    if (entry.nr) {
      const entryNr = String(entry.nr);
      for (const p of this.byTime) {
        if (p.id === entry.id) continue;

        const refNr = p.bezugNr || p.referenzNr || p.antwortAuf;
        if (refNr && String(refNr) === entryNr) {
          return p;
        }
      }
    }

    // 2. Nach zeitlicher Reihenfolge und Sender
    const entryTime = this.parseTimestamp(entry.datum, entry.zeit);
    const originalRecipients = Array.isArray(entry.ergehtAn) ? entry.ergehtAn : [];

    for (const recipient of originalRecipients) {
      const recipientKey = String(recipient).toUpperCase();
      const sentByRecipient = this.bySender.get(recipientKey) || [];

      for (const p of sentByRecipient) {
        const pTime = this.parseTimestamp(p.datum, p.zeit);

        // Muss nach Original-Meldung sein
        if (pTime > entryTime) {
          // Prüfe ob Empfänger der Antwort der Absender der Original-Meldung ist
          const pRecipients = Array.isArray(p.ergehtAn) ? p.ergehtAn : [];
          const pRecipientsUpper = pRecipients.map(r => String(r).toUpperCase());

          const originalSender = String(entry.anvon || "").toUpperCase();
          if (pRecipientsUpper.includes(originalSender)) {
            return p;
          }
        }
      }
    }

    return null;
  }

  /**
   * Findet alle Einträge nach einem bestimmten Zeitpunkt
   * @param {string} datum - DD.MM.YYYY
   * @param {string} zeit - HH:MM
   * @returns {Array} - Spätere Einträge
   */
  findEntriesAfter(datum, zeit) {
    const timestamp = this.parseTimestamp(datum, zeit);
    return this.byTime.filter(entry => {
      const entryTime = this.parseTimestamp(entry.datum, entry.zeit);
      return entryTime > timestamp;
    });
  }

  /**
   * Findet alle Einträge von einem Sender
   * @param {string} sender - Sender-Name
   * @returns {Array} - Einträge
   */
  findBySender(sender) {
    const senderKey = String(sender).toUpperCase();
    return this.bySender.get(senderKey) || [];
  }

  /**
   * Findet alle Einträge an einen Empfänger
   * @param {string} recipient - Empfänger-Name
   * @returns {Array} - Einträge
   */
  findByRecipient(recipient) {
    const recipientKey = String(recipient).toUpperCase();
    return this.byRecipient.get(recipientKey) || [];
  }

  /**
   * Findet Eintrag nach ID
   * @param {string} id - Protokoll-ID
   * @returns {Object|null}
   */
  findById(id) {
    return this.byId.get(id) || null;
  }

  /**
   * Findet Eintrag nach Nummer
   * @param {number|string} nr - Protokoll-Nummer
   * @returns {Object|null}
   */
  findByNr(nr) {
    return this.byNr.get(String(nr)) || null;
  }

  /**
   * Gibt die Anzahl indexierter Einträge zurück
   * @returns {number}
   */
  size() {
    return this.byTime.length;
  }
}

/**
 * Erstellt einen ProtocolIndex aus dem Protokoll
 * @param {Array} protokoll - Protokolleinträge
 * @returns {ProtocolIndex}
 */
export function createProtocolIndex(protokoll) {
  return new ProtocolIndex(protokoll);
}
