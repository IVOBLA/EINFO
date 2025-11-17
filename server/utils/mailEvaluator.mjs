import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logMailEvent } from "./mailLogger.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data");

function resolvePath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(__dirname, value);
}

function normalizeAddress(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  const match = str.match(/<([^<>]+)>/);
  const address = match ? match[1] : str;
  const normalized = address.trim().toLowerCase();
  return normalized || null;
}

function normalizeAllowedFrom(value) {
  if (!value) return [];
  const source = Array.isArray(value) ? value : String(value).split(/[\n,;]+/);
  const result = [];
  const seen = new Set();

  for (const entry of source) {
    const normalized = normalizeAddress(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

const DEFAULT_INBOX_DIR = resolvePath(process.env.MAIL_INBOX_DIR, path.join(DATA_DIR, "mail", "inbox"));
const DEFAULT_RULE_FILE = resolvePath(process.env.MAIL_RULE_FILE, path.join(DATA_DIR, "conf", "mail-rules.json"));
const DEFAULT_ALLOWED_FROM = normalizeAllowedFrom(process.env.MAIL_ALLOWED_FROM);

export function getMailInboxConfig() {
  return {
    inboxDir: DEFAULT_INBOX_DIR,
    ruleFile: DEFAULT_RULE_FILE,
    allowedFrom: DEFAULT_ALLOWED_FROM,
  };
}

function parseMailDate(value) {
  if (!value) return null;
  const parsed = new Date(String(value).trim());
  const ts = parsed.getTime();
  return Number.isNaN(ts) ? null : ts;
}

export function parseRawMail(raw, { id = null, file = null } = {}) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const [rawHeaders = "", ...bodyParts] = normalized.split(/\n\n/);
  const headerLines = rawHeaders.split(/\n/);
  const headers = {};

  for (const line of headerLines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    if (!key) continue;
    const value = match[2] ?? "";
    headers[key] = String(value).trim();
  }

  const body = bodyParts.join("\n\n").trim();
  const snippet = body.replace(/\s+/g, " ").slice(0, 240);

  return {
    id,
    file,
    headers,
    subject: headers.subject || "",
    from: headers.from || "",
    to: headers.to || "",
    date: parseMailDate(headers.date),
    body,
    snippet,
  };
}

async function readMailFile(file) {
  const raw = await fsp.readFile(file, "utf8");
  const stats = await fsp.stat(file);
  const parsed = parseRawMail(raw, { id: path.basename(file), file });
  return { ...parsed, mtimeMs: stats.mtimeMs };
}

export async function listInboxFiles(mailDir = DEFAULT_INBOX_DIR) {
  const entries = await fsp.readdir(mailDir, { withFileTypes: true }).catch(async (err) => {
    if (err?.code === "ENOENT") {
      await fsp.mkdir(mailDir, { recursive: true });
      return [];
    }
    throw err;
  });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.join(mailDir, e.name));
}

function normalizePatterns(patterns) {
  if (!patterns) return [];
  const source = Array.isArray(patterns) ? patterns : [patterns];
  return source
    .map((p) => {
      if (!p) return null;
      if (p instanceof RegExp) return p;
      const str = String(p).trim();
      if (!str) return null;
      return new RegExp(str, "i");
    })
    .filter(Boolean);
}

function normalizeFields(fields) {
  if (!fields || (Array.isArray(fields) && fields.length === 0)) {
    return ["subject", "body", "from"];
  }
  const arr = Array.isArray(fields) ? fields : [fields];
  return arr.map((f) => String(f || "").trim()).filter(Boolean);
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  const name = String(rule.name || rule.title || rule.id || "Regel").trim();
  const weight = Number.isFinite(Number(rule.weight)) ? Number(rule.weight) : 1;
  const patterns = normalizePatterns(rule.patterns || rule.match || rule.keywords);
  if (!patterns.length) return null;
  const fields = normalizeFields(rule.fields);
  return { name, weight, patterns, fields };
}

export async function loadRules(ruleFile = DEFAULT_RULE_FILE) {
  try {
    const raw = await fsp.readFile(ruleFile, "utf8");
    const parsed = JSON.parse(raw);
    const rules = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.rules)
        ? parsed.rules
        : [];
    const normalized = rules.map(normalizeRule).filter(Boolean);
    return normalized;
  } catch {
    return [];
  }
}

export function evaluateMail(mail, rules = []) {
  const matches = [];
  let score = 0;

  for (const rule of rules) {
    if (!rule) continue;
    let matchedRule = false;
    for (const pattern of rule.patterns) {
      for (const field of rule.fields) {
        const content = String(mail?.[field] ?? "");
        if (!content) continue;
        if (pattern.test(content)) {
          matchedRule = true;
          matches.push({ rule: rule.name, field, pattern: pattern.source });
          break;
        }
      }
      if (matchedRule) break;
    }
    if (matchedRule) score += rule.weight;
  }

  return { score, matches };
}

export async function readAndEvaluateInbox({
  mailDir = DEFAULT_INBOX_DIR,
  limit = 50,
  rules = null,
  deleteAfterRead = false,
  allowedFrom = DEFAULT_ALLOWED_FROM,
} = {}) {
  const allowedFromNormalized = normalizeAllowedFrom(allowedFrom);
  try {
    await logMailEvent("Starte Inbox-Auswertung", {
      mailDir,
      limit,
      deleteAfterRead,
      customRules: Array.isArray(rules),
      allowedFrom: allowedFromNormalized,
    });

    const files = await listInboxFiles(mailDir).catch((err) => {
      const error = new Error(`Mail-Verzeichnis nicht lesbar: ${err?.message || err}`);
      error.code = err?.code;
      throw error;
    });

    const sortedFiles = files
      .map((file) => ({ file, name: path.basename(file) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .reverse()
      .slice(0, Math.max(1, Number(limit) || 1));

    const activeRules = Array.isArray(rules) ? rules : await loadRules();
    const mails = [];

    for (const entry of sortedFiles) {
      let mailEntry;
      try {
        const mail = await readMailFile(entry.file);
        const sender = normalizeAddress(mail.from);
        const senderAllowed =
          allowedFromNormalized.length === 0 || (sender && allowedFromNormalized.includes(sender));

        if (!senderAllowed) {
          const filteredEntry = { ...mail, evaluation: { score: 0, matches: [] }, filtered: true };
          if (deleteAfterRead) {
            try {
              await fsp.unlink(entry.file);
              filteredEntry.deleted = true;
            } catch (deleteErr) {
              filteredEntry.deleted = false;
              filteredEntry.deleteError = deleteErr?.message || String(deleteErr);
            }
          }

          await logMailEvent("Mail verworfen", {
            file: filteredEntry.file,
            id: filteredEntry.id,
            from: mail.from,
            reason: "Absender nicht erlaubt",
            allowedFrom: allowedFromNormalized,
            deleted: Boolean(filteredEntry.deleted),
            error: filteredEntry.deleteError,
          });

          continue;
        }

        const evaluation = evaluateMail(mail, activeRules);
        mailEntry = { ...mail, evaluation };
      } catch (err) {
        mailEntry = {
          id: entry.name,
          file: entry.file,
          error: err?.message || String(err),
          evaluation: { score: 0, matches: [] },
        };
      }

      if (deleteAfterRead) {
        try {
          await fsp.unlink(entry.file);
          mailEntry.deleted = true;
        } catch (deleteErr) {
          mailEntry.deleted = false;
          mailEntry.deleteError = deleteErr?.message || String(deleteErr);
        }
      }

      await logMailEvent("Mail verarbeitet", {
        file: mailEntry.file,
        id: mailEntry.id,
        score: mailEntry.evaluation?.score ?? 0,
        matches: mailEntry.evaluation?.matches?.length ?? 0,
        deleted: Boolean(mailEntry.deleted),
        error: mailEntry.error,
      });

      mails.push(mailEntry);
    }

    await logMailEvent("Inbox-Auswertung abgeschlossen", {
      mailDir,
      processed: mails.length,
      withErrors: mails.filter((m) => m.error).length,
      deleteAfterRead,
    });

    return { mails, rules: activeRules };
  } catch (err) {
    await logMailEvent("Inbox-Auswertung fehlgeschlagen", {
      mailDir,
      error: err?.message || String(err),
    });
    throw err;
  }
}
