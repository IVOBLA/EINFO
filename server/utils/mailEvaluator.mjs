import fsp from "node:fs/promises";
import net from "node:net";
import tls from "node:tls";
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

function extractNormalizedAddresses(value) {
  if (!value) return [];

  const withoutComments = String(value).replace(/\([^()]*\)/g, " ");
  const candidates = withoutComments.split(/[,;]/);
  const addresses = new Set();

  for (const candidate of candidates) {
    const matches = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);

    if (matches?.length) {
      for (const email of matches) {
        const normalized = normalizeAddress(email);
        if (normalized) addresses.add(normalized);
      }
      continue;
    }

    const normalized = normalizeAddress(candidate);
    if (normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      addresses.add(normalized);
    }
  }

  return [...addresses];
}

function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

const DEFAULT_INBOX_DIR = resolvePath(process.env.MAIL_INBOX_DIR, path.join(DATA_DIR, "mail", "inbox"));
const DEFAULT_ALLOWED_FROM = normalizeAllowedFrom(process.env.MAIL_ALLOWED_FROM);
const DEFAULT_IMAP_CONFIG = {
  host: process.env.MAIL_IMAP_HOST || process.env.MAIL_HOST || "",
  port: Number(process.env.MAIL_IMAP_PORT) || 993,
  secure: toBool(process.env.MAIL_IMAP_SECURE, true),
  mailbox: process.env.MAIL_IMAP_MAILBOX || "INBOX",
  user: process.env.MAIL_IMAP_USER || process.env.MAIL_USER || "",
  pass: process.env.MAIL_IMAP_PASSWORD || process.env.MAIL_PASSWORD || "",
  rejectUnauthorized: toBool(process.env.MAIL_IMAP_TLS_REJECT_UNAUTHORIZED, true),
};
const DEFAULT_POP3_CONFIG = {
  host: process.env.MAIL_POP3_HOST || process.env.MAIL_HOST || "",
  port: Number(process.env.MAIL_POP3_PORT) || 995,
  secure: toBool(process.env.MAIL_POP3_SECURE, true),
  user: process.env.MAIL_POP3_USER || process.env.MAIL_USER || "",
  pass: process.env.MAIL_POP3_PASSWORD || process.env.MAIL_PASSWORD || "",
  rejectUnauthorized: toBool(process.env.MAIL_POP3_TLS_REJECT_UNAUTHORIZED, true),
};

export function getMailInboxConfig() {
  return {
    inboxDir: DEFAULT_INBOX_DIR,
    allowedFrom: DEFAULT_ALLOWED_FROM,
    imap: DEFAULT_IMAP_CONFIG,
    pop3: DEFAULT_POP3_CONFIG,
  };
}

function hasImapConfig(imapConfig = DEFAULT_IMAP_CONFIG) {
  return Boolean(imapConfig?.host && imapConfig?.user && imapConfig?.pass);
}

function hasPop3Config(pop3Config = DEFAULT_POP3_CONFIG) {
  return Boolean(pop3Config?.host && pop3Config?.user && pop3Config?.pass);
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

function createPop3Reader(socket) {
  let buffer = "";
  let closed = false;
  const waiters = [];

  function tryResolve() {
    for (let i = 0; i < waiters.length; i += 1) {
      const waiter = waiters[i];
      if (waiter.type === "line") {
        const idx = buffer.indexOf("\r\n");
        if (idx === -1) continue;
        waiters.splice(i, 1);
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        waiter.resolve(line);
        i -= 1;
        continue;
      }

      const marker = "\r\n.\r\n";
      const idx = buffer.indexOf(marker);
      if (idx === -1) continue;
      waiters.splice(i, 1);
      const content = buffer.slice(0, idx);
      buffer = buffer.slice(idx + marker.length);
      waiter.resolve(content);
      i -= 1;
    }
  }

  function onData(chunk) {
    buffer += chunk.toString("utf8");
    tryResolve();
  }

  function rejectAll(err) {
    if (closed) return;
    closed = true;
    socket.off("data", onData);
    const reason = err || new Error("POP3-Verbindung beendet");
    while (waiters.length) {
      const waiter = waiters.shift();
      waiter.reject(reason);
    }
  }

  socket.on("data", onData);
  socket.once("error", (err) => rejectAll(err));
  socket.once("close", () => rejectAll());
  socket.once("end", () => rejectAll());

  function readLine() {
    return new Promise((resolve, reject) => {
      waiters.push({ type: "line", resolve, reject });
      tryResolve();
    });
  }

  function readMultiline() {
    return new Promise((resolve, reject) => {
      waiters.push({ type: "multi", resolve, reject });
      tryResolve();
    });
  }

  return { readLine, readMultiline };
}

async function fetchImapMessages({
  imapConfig = DEFAULT_IMAP_CONFIG,
  limit = 50,
  deleteAfterRead = false,
} = {}) {
  if (!hasImapConfig(imapConfig)) {
    throw new Error("IMAP-Konfiguration unvollständig – Host, Benutzer und Passwort sind erforderlich.");
  }

  let ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (err) {
    const reason = err?.message || err;
    throw new Error(`IMAP-Modul \"imapflow\" konnte nicht geladen werden: ${reason}`);
  }
  const client = new ImapFlow({
    host: imapConfig.host,
    port: imapConfig.port,
    secure: Boolean(imapConfig.secure),
    auth: { user: imapConfig.user, pass: imapConfig.pass },
    tls: { rejectUnauthorized: imapConfig.rejectUnauthorized !== false },
    logger: false,
  });

  await client.connect();
  let lock = null;
  try {
    lock = await client.getMailboxLock(imapConfig.mailbox || "INBOX");
    const uids = await client.search({}, { uid: true });
    const sorted = [...uids].sort((a, b) => b - a).slice(0, Math.max(1, Number(limit) || 1));
    const mails = [];

    for (const uid of sorted) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true, uid: true });
      if (!msg?.source) continue;
      const raw = msg.source instanceof Buffer ? msg.source.toString("utf8") : String(msg.source);
      mails.push({
        uid,
        raw,
        id: msg?.envelope?.messageId || String(uid),
        receivedAt: msg?.internalDate ? msg.internalDate.getTime() : null,
      });

      if (deleteAfterRead) await client.messageDelete(uid, { uid: true });
      else await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    }

    return { mails, total: uids.length };
  } finally {
    lock?.release();
    await client.logout().catch(() => {});
  }
}

async function fetchPop3Messages({
  pop3Config = DEFAULT_POP3_CONFIG,
  limit = 50,
  deleteAfterRead = false,
} = {}) {
  if (!hasPop3Config(pop3Config)) {
    throw new Error("POP3-Konfiguration unvollständig – Host, Benutzer und Passwort sind erforderlich.");
  }

  const maxLimit = Math.max(1, Number(limit) || 1);
  const rejectUnauthorized = pop3Config.rejectUnauthorized !== false;
  const socket = pop3Config.secure
    ? tls.connect({
        host: pop3Config.host,
        port: pop3Config.port,
        rejectUnauthorized,
        servername: pop3Config.host,
      })
    : net.createConnection({ host: pop3Config.host, port: pop3Config.port });

  socket.setEncoding("utf8");
  socket.setTimeout(15000, () => socket.destroy(new Error("POP3-Timeout")));

  const reader = createPop3Reader(socket);

  const expectOk = async (linePromise, step) => {
    const line = await linePromise;
    if (!line?.startsWith("+OK")) {
      throw new Error(`POP3-Fehler bei ${step}: ${line || "keine Antwort"}`);
    }
    return line;
  };

  const send = (cmd, { multi = false } = {}) => {
    socket.write(`${cmd}\r\n`);
    return multi ? reader.readMultiline() : reader.readLine();
  };

  try {
    await expectOk(reader.readLine(), "Verbindung");
    await expectOk(send(`USER ${pop3Config.user}`), "USER");
    await expectOk(send(`PASS ${pop3Config.pass}`), "PASS");

    const stat = await expectOk(send("STAT"), "STAT");
    const [, totalStr] = stat.split(" ");
    const total = Math.max(0, Number(totalStr) || 0);

    const listRaw = await expectOk(send("LIST", { multi: true }), "LIST");
    const entries = listRaw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^(\d+)\s+/.test(line))
      .map((line) => Number(line.split(/\s+/)[0]))
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((a, b) => a - b);

    const selectedIds = entries.slice(-maxLimit);
    const mails = [];

    for (const id of selectedIds) {
      const raw = await expectOk(send(`RETR ${id}`, { multi: true }), `RETR ${id}`);
      mails.push({ id: String(id), raw, uid: id, receivedAt: null });
      if (deleteAfterRead) await expectOk(send(`DELE ${id}`), `DELE ${id}`);
    }

    await send("QUIT").catch(() => {});
    return { mails, total };
  } finally {
    socket.destroy();
  }
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


export async function readAndEvaluateInbox({
  mailDir = DEFAULT_INBOX_DIR,
  limit = 50,
  rules = null,
  deleteAfterRead = false,
  allowedFrom = DEFAULT_ALLOWED_FROM,
  useImap = null,
  usePop3 = null,
  imapConfig = DEFAULT_IMAP_CONFIG,
  pop3Config = DEFAULT_POP3_CONFIG,
} = {}) {
  const allowedFromNormalized = normalizeAllowedFrom(allowedFrom);
  const imapEnabled = useImap ?? hasImapConfig(imapConfig);
  const pop3Enabled = usePop3 ?? (!imapEnabled && hasPop3Config(pop3Config));
  const mode = imapEnabled ? "imap" : pop3Enabled ? "pop3" : "filesystem";
  try {
    await logMailEvent("Starte Inbox-Auswertung", {
      mailDir,
      limit,
      deleteAfterRead,
      customRules: Array.isArray(rules),
      allowedFrom: allowedFromNormalized,
      mode,
      mailbox: imapEnabled ? imapConfig.mailbox || "INBOX" : undefined,
      imapHost: imapEnabled ? imapConfig.host : undefined,
      pop3Host: pop3Enabled ? pop3Config.host : undefined,
    });

    let entries = [];
    if (imapEnabled) {
      const { mails, total } = await fetchImapMessages({ imapConfig, limit, deleteAfterRead });

      await logMailEvent("Anmeldung am Mailserver erfolgreich", {
        mailbox: imapConfig.mailbox || "INBOX",
        imapHost: imapConfig.host,
      });

      await logMailEvent("Inbox gelesen", {
        mailbox: imapConfig.mailbox || "INBOX",
        imapHost: imapConfig.host,
        total,
        limited: mails.length,
        limit,
      });

      entries = mails.map((mail) => ({
        id: mail.id || String(mail.uid),
        file: null,
        raw: mail.raw,
      }));
    } else if (pop3Enabled) {
      const { mails, total } = await fetchPop3Messages({ pop3Config, limit, deleteAfterRead });

      await logMailEvent("Anmeldung am Mailserver erfolgreich", {
        pop3Host: pop3Config.host,
      });

      await logMailEvent("Inbox gelesen", {
        pop3Host: pop3Config.host,
        total,
        limited: mails.length,
        limit,
      });

      entries = mails.map((mail) => ({
        id: mail.id || String(mail.uid),
        file: null,
        raw: mail.raw,
      }));
    } else {
      const files = await listInboxFiles(mailDir).catch((err) => {
        const error = new Error(`Mail-Verzeichnis nicht lesbar: ${err?.message || err}`);
        error.code = err?.code;
        throw error;
      });

      await logMailEvent("Anmeldung am Mailserver erfolgreich", { mailDir });

      const sortedFiles = files
        .map((file) => ({ file, name: path.basename(file) }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .reverse()
        .slice(0, Math.max(1, Number(limit) || 1));

      await logMailEvent("Inbox gelesen", {
        mailDir,
        total: files.length,
        limited: sortedFiles.length,
        limit,
      });

      entries = sortedFiles.map((entry) => ({
        id: entry.name,
        file: entry.file,
        raw: null,
      }));
    }

    const activeRules = [];
    const mails = [];
    const skippedMails = [];
    const failedMails = [];

    for (const entry of entries) {
      let mailEntry;
      try {
        const mail = entry.raw ? parseRawMail(entry.raw, { id: entry.id }) : await readMailFile(entry.file);
        const senders = extractNormalizedAddresses(mail.from);
        const senderAllowed =
          allowedFromNormalized.length === 0 ||
          senders.some((sender) => allowedFromNormalized.includes(sender));

        if (!senderAllowed) {
          const filteredEntry = { ...mail, evaluation: { score: 0, matches: [] }, filtered: true };
          if (deleteAfterRead && entry.file) {
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

          skippedMails.push({
            id: filteredEntry.id,
            file: filteredEntry.file,
            reason: "absender_not_allowed",
            deleteError: filteredEntry.deleteError,
          });

          continue;
        }

    let evaluation;

    if (!activeRules.length) {
      evaluation = {
        score: 1,
        matches: [
          {
            rule: "default-allowed-from",
            field: "from",
            pattern: "*",
          },
        ],
      };
    } else {
      evaluation = evaluateMail(mail, activeRules);
    }
        mailEntry = { ...mail, evaluation };
      } catch (err) {
        mailEntry = {
          id: entry.id || entry.name,
          file: entry.file,
          error: err?.message || String(err),
          evaluation: { score: 0, matches: [] },
        };

        failedMails.push({ id: mailEntry.id, file: mailEntry.file, reason: mailEntry.error });
      }

      if (!imapEnabled && !pop3Enabled && deleteAfterRead) {
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
      skipped: skippedMails.length,
      failed: failedMails.length,
      skippedDetails: skippedMails,
      failedDetails: failedMails,
      deleteAfterRead,
      mode,
      mailbox: imapEnabled ? imapConfig.mailbox || "INBOX" : undefined,
      imapHost: imapEnabled ? imapConfig.host : undefined,
      pop3Host: pop3Enabled ? pop3Config.host : undefined,
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
