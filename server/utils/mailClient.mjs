import net from "node:net";
import tls from "node:tls";
import os from "node:os";

const BOOL_TRUE = new Set(["1", "true", "yes", "y", "on"]); 
const BOOL_FALSE = new Set(["0", "false", "no", "n", "off"]);

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (BOOL_TRUE.has(normalized)) return true;
  if (BOOL_FALSE.has(normalized)) return false;
  return fallback;
}

function toInt(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeDomain(value) {
  const cleaned = String(value || "").trim().replace(/[^a-z0-9.-]/gi, "");
  return cleaned || "localhost";
}

function encodeHeaderValue(value) {
  const str = String(value ?? "");
  if (!/[\x00-\x1f\x7f-\xff]/.test(str)) return str;
  const b64 = Buffer.from(str, "utf8").toString("base64");
  return `=?utf-8?B?${b64}?=`;
}

function formatAddressHeader(name, address) {
  if (!name) return address;
  return `${encodeHeaderValue(name)} <${address}>`;
}

function parseAddress(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(.*)<([^<>]+)>$/);
    if (match) {
      const name = match[1].trim().replace(/^"|"$/g, "");
      const address = match[2].trim();
      if (!address) return null;
      return {
        name: name || null,
        address,
        header: formatAddressHeader(name || null, address)
      };
    }
    return { name: null, address: trimmed, header: trimmed };
  }
  if (typeof value === "object") {
    const address = String(value.address ?? value.email ?? "").trim();
    if (!address) return null;
    const nameRaw = value.name ?? value.displayName ?? "";
    const name = nameRaw ? String(nameRaw).trim() : "";
    return {
      name: name || null,
      address,
      header: formatAddressHeader(name || null, address)
    };
  }
  return null;
}

function collectRecipients(value) {
  if (!value) return [];
  const source = Array.isArray(value) ? value : [value];
  const result = [];
  for (const entry of source) {
    const parsed = parseAddress(entry);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return [];
  const entries = [];
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = String(rawKey || "").trim();
    if (!key) continue;
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        const val = item == null ? "" : String(item);
        entries.push({ key, value: val });
      }
    } else {
      const value = rawValue == null ? "" : String(rawValue);
      entries.push({ key, value });
    }
  }
  return entries;
}

export function getMailConfig() {
  const portFallback = process.env.MAIL_PORT ? null : 25;
  const port = toInt(process.env.MAIL_PORT, portFallback);
  const secureDefault = port === 465;
  const secure = toBool(process.env.MAIL_SECURE, secureDefault);
  const starttls = toBool(process.env.MAIL_STARTTLS, false);
  const timeoutMs = Math.max(1000, toInt(process.env.MAIL_TIMEOUT_MS, 15000));
  const rejectUnauthorized = toBool(process.env.MAIL_TLS_REJECT_UNAUTHORIZED, true);
  const clientId = process.env.MAIL_CLIENT_ID || os.hostname() || "localhost";

  return {
    host: process.env.MAIL_HOST || "",
    port: port || 25,
    secure,
    starttls,
    user: process.env.MAIL_USER || process.env.MAIL_USERNAME || "",
    pass: process.env.MAIL_PASSWORD || process.env.MAIL_PASS || "",
    from: process.env.MAIL_FROM || process.env.MAIL_USER || "",
    replyTo: process.env.MAIL_REPLY_TO || "",
    timeoutMs,
    rejectUnauthorized,
    clientId,
  };
}

export function isMailConfigured() {
  const cfg = getMailConfig();
  return Boolean(cfg.host && cfg.port && cfg.from);
}

function tryParseSmtpResponse(buffer) {
  const lines = buffer.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const messages = [];
  let code = null;
  for (const line of lines) {
    const match = line.match(/^(\d{3})([ \-])(.*)$/);
    if (!match) return null;
    code = Number(match[1]);
    messages.push(match[3] || "");
    if (match[2] === " ") {
      return { code, message: messages.join("\n"), lines };
    }
  }
  return null;
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const parsed = tryParseSmtpResponse(buffer);
      if (!parsed) return;
      cleanup();
      resolve(parsed);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("SMTP connection closed"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function connectSocket(cfg) {
  return new Promise((resolve, reject) => {
    const options = { host: cfg.host, port: cfg.port };
    let settled = false;
    let socket;

    const handleInitialError = (err) => {
      if (settled) return;
      settled = true;
      if (socket && !socket.destroyed) {
        try { socket.destroy(); } catch {}
      }
      reject(err);
    };

    const finalize = (sock) => {
      if (settled) return;
      settled = true;
      sock.off("error", handleInitialError);
      sock.setTimeout(cfg.timeoutMs);
      sock.once("timeout", () => {
        sock.destroy(new Error("SMTP timeout"));
      });
      resolve(sock);
    };

    if (cfg.secure) {
      socket = tls.connect({
        ...options,
        servername: cfg.host,
        rejectUnauthorized: cfg.rejectUnauthorized,
      });
      socket.once("secureConnect", () => finalize(socket));
    } else {
      socket = net.createConnection(options);
      socket.once("connect", () => finalize(socket));
    }

    socket.once("error", handleInitialError);
  });
}

function upgradeStartTls(socket, cfg) {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket,
      servername: cfg.host,
      rejectUnauthorized: cfg.rejectUnauthorized,
    });

    const onError = (err) => {
      tlsSocket.off("secureConnect", onSecure);
      reject(err);
    };

    const onSecure = () => {
      tlsSocket.setTimeout(cfg.timeoutMs);
      tlsSocket.once("timeout", () => {
        tlsSocket.destroy(new Error("SMTP timeout"));
      });
      tlsSocket.off("error", onError);
      resolve(tlsSocket);
    };

    tlsSocket.once("secureConnect", onSecure);
    tlsSocket.once("error", onError);
  });
}

function normalizeBody(text) {
  const raw = String(text ?? "");
  const normalized = raw.replace(/\r?\n/g, "\r\n").replace(/\r\n\./g, "\r\n..");
  return normalized + (raw.endsWith("\n") ? "" : "\r\n");
}

function buildMessage({ from, to, cc, bcc, subject, text, html, replyTo, headers, clientId }) {
  const date = new Date().toUTCString();
  const messageId = `<${Date.now().toString(16)}.${Math.random().toString(16).slice(2)}@${sanitizeDomain(clientId)}>`;

  const headerLines = [
    `From: ${from.header}`,
  ];
  if (to.length) headerLines.push(`To: ${to.map((r) => r.header).join(", ")}`);
  if (cc.length) headerLines.push(`Cc: ${cc.map((r) => r.header).join(", ")}`);
  if (replyTo) headerLines.push(`Reply-To: ${replyTo.header}`);
  headerLines.push(`Subject: ${encodeHeaderValue(subject || "")}`);
  headerLines.push(`Date: ${date}`);
  headerLines.push(`Message-ID: ${messageId}`);
  headerLines.push("X-Mailer: EinsatzInfo SMTP Client");

  const mimeParts = [];
  if (headers?.length) {
    for (const { key, value } of headers) {
      headerLines.push(`${key}: ${value}`);
    }
  }

  let bodyPayload = "";
  if (text && html) {
    const boundary = `----=_EINFO_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
    headerLines.push("MIME-Version: 1.0");
    headerLines.push(`Content-Type: multipart/alternative; boundary=\"${boundary}\"`);
    mimeParts.push(`--${boundary}`);
    mimeParts.push("Content-Type: text/plain; charset=utf-8");
    mimeParts.push("Content-Transfer-Encoding: 8bit");
    mimeParts.push("");
    mimeParts.push(text);
    mimeParts.push(`--${boundary}`);
    mimeParts.push("Content-Type: text/html; charset=utf-8");
    mimeParts.push("Content-Transfer-Encoding: 8bit");
    mimeParts.push("");
    mimeParts.push(html);
    mimeParts.push(`--${boundary}--`);
    bodyPayload = mimeParts.join("\r\n");
  } else if (html) {
    headerLines.push("MIME-Version: 1.0");
    headerLines.push("Content-Type: text/html; charset=utf-8");
    headerLines.push("Content-Transfer-Encoding: 8bit");
    bodyPayload = html;
  } else {
    headerLines.push("MIME-Version: 1.0");
    headerLines.push("Content-Type: text/plain; charset=utf-8");
    headerLines.push("Content-Transfer-Encoding: 8bit");
    bodyPayload = text || "";
  }

  const normalizedBody = normalizeBody(bodyPayload);
  const headerSection = headerLines.join("\r\n");
  return {
    messageId,
    payload: `${headerSection}\r\n\r\n${normalizedBody}`,
  };
}

export async function sendMail(options = {}) {
  const cfg = getMailConfig();
  if (!isMailConfigured()) {
    throw new Error("Mail configuration is incomplete");
  }

  const from = parseAddress(options.from ?? cfg.from);
  if (!from) {
    throw new Error("Ungültiger Absender");
  }

  const to = collectRecipients(options.to);
  const cc = collectRecipients(options.cc);
  const bcc = collectRecipients(options.bcc);

  if (to.length + cc.length + bcc.length === 0) {
    throw new Error("Mindestens ein Empfänger wird benötigt");
  }

  const replyTo = parseAddress(options.replyTo ?? cfg.replyTo);
  const headers = normalizeHeaders(options.headers);

  if (!options.text && !options.html) {
    throw new Error("Es wird ein Text- oder HTML-Inhalt benötigt");
  }

  const { messageId, payload } = buildMessage({
    from,
    to,
    cc,
    bcc,
    subject: options.subject || "",
    text: options.text || "",
    html: options.html || "",
    replyTo,
    headers,
    clientId: cfg.clientId,
  });

  let socket = await connectSocket(cfg);
  const accepted = [];
  const rejected = [];
  try {
    let response = await readSmtpResponse(socket);
    if (response.code !== 220) {
      const err = new Error(`SMTP begrüsst mit ${response.code}`);
      err.response = response;
      throw err;
    }

    response = await writeCommand(socket, `EHLO ${sanitizeDomain(cfg.clientId)}\r\n`);

    if (cfg.starttls && !cfg.secure) {
      if (response.code !== 250) {
        const err = new Error(`EHLO fehlgeschlagen: ${response.message}`);
        err.response = response;
        throw err;
      }
      const startResp = await writeCommand(socket, "STARTTLS\r\n");
      if (startResp.code !== 220) {
        const err = new Error(`STARTTLS nicht verfügbar: ${startResp.message}`);
        err.response = startResp;
        throw err;
      }
      socket = await upgradeStartTls(socket, cfg);
      response = await writeCommand(socket, `EHLO ${sanitizeDomain(cfg.clientId)}\r\n`);
    }

    if (response.code !== 250) {
      const err = new Error(`EHLO fehlgeschlagen: ${response.message}`);
      err.response = response;
      throw err;
    }

    if (cfg.user && cfg.pass) {
      const authResp = await writeCommand(socket, "AUTH LOGIN\r\n");
      if (authResp.code !== 334) {
        const err = new Error(`AUTH LOGIN nicht akzeptiert: ${authResp.message}`);
        err.response = authResp;
        throw err;
      }
      const userResp = await writeCommand(socket, `${Buffer.from(cfg.user, "utf8").toString("base64")}\r\n`);
      if (userResp.code !== 334) {
        const err = new Error(`SMTP akzeptiert Benutzer nicht: ${userResp.message}`);
        err.response = userResp;
        throw err;
      }
      const passResp = await writeCommand(socket, `${Buffer.from(cfg.pass, "utf8").toString("base64")}\r\n`);
      if (passResp.code !== 235) {
        const err = new Error(`SMTP akzeptiert Passwort nicht: ${passResp.message}`);
        err.response = passResp;
        throw err;
      }
    }

    const mailResp = await writeCommand(socket, `MAIL FROM:<${from.address}>\r\n`);
    if (![250, 251].includes(mailResp.code)) {
      const err = new Error(`MAIL FROM fehlgeschlagen: ${mailResp.message}`);
      err.response = mailResp;
      throw err;
    }

    const allRecipients = [...to, ...cc, ...bcc];
    for (const recipient of allRecipients) {
      const rcptResp = await writeCommand(socket, `RCPT TO:<${recipient.address}>\r\n`);
      if ([250, 251, 252].includes(rcptResp.code)) {
        accepted.push({ address: recipient.address, response: rcptResp.message });
      } else {
        rejected.push({ address: recipient.address, response: rcptResp.message, code: rcptResp.code });
      }
    }

    if (accepted.length === 0) {
      const err = new Error("Keine Empfänger akzeptiert");
      err.rejected = rejected;
      throw err;
    }

    const dataResp = await writeCommand(socket, "DATA\r\n");
    if (dataResp.code !== 354) {
      const err = new Error(`DATA fehlgeschlagen: ${dataResp.message}`);
      err.response = dataResp;
      throw err;
    }

    socket.write(payload + "\r\n.\r\n");
    const sendResp = await readSmtpResponse(socket);
    if (sendResp.code !== 250) {
      const err = new Error(`Senden fehlgeschlagen: ${sendResp.message}`);
      err.response = sendResp;
      throw err;
    }

    await writeCommand(socket, "QUIT\r\n");
    socket.end();

    return {
      ok: true,
      messageId,
      accepted,
      rejected,
      response: sendResp.message,
    };
  } catch (error) {
    if (socket && !socket.destroyed) {
      try { socket.destroy(); } catch {}
    }
    throw error;
  }
}

async function writeCommand(socket, command) {
  socket.write(command);
  return readSmtpResponse(socket);
}
