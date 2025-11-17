import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { logDirCandidates } from "./logDirectories.mjs";

const truthy = new Set(["1", "true", "yes", "y", "on"]);
const rawMailLogFlag = process.env.MAIL_LOG ?? process.env.MAIL_DEBUG ?? "";
export const isMailLoggingEnabled = truthy.has(String(rawMailLogFlag).trim().toLowerCase());

let activeLogDir = null;
let lastLoggedErrorKey = null;

function getLogFile(dir) {
  return path.join(dir, "MAIL.log");
}

async function writeToLogDir(dir, line) {
  await mkdir(dir, { recursive: true });
  await appendFile(getLogFile(dir), `${line}\n`, "utf8");
}

async function appendLogLine(line) {
  const firstChoice = activeLogDir ? [activeLogDir] : [];
  const candidates = [...firstChoice, ...logDirCandidates.filter((dir) => dir !== activeLogDir)];

  for (const dir of candidates) {
    try {
      await writeToLogDir(dir, line);
      activeLogDir = dir;
      lastLoggedErrorKey = null;
      return;
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? error.message : String(error);
      const errorKey = `${dir}:${message}`;
      if (lastLoggedErrorKey !== errorKey) {
        console.error(`[MAIL LOG ERROR] ${message} (${dir})`);
        lastLoggedErrorKey = errorKey;
      }
      if (activeLogDir === dir) {
        activeLogDir = null;
      }
    }
  }
}

export async function logMailEvent(message, context = null) {
  if (!isMailLoggingEnabled) return;
  const timestamp = new Date().toISOString();
  let contextSuffix = "";
  try {
    if (context && Object.keys(context).length > 0) {
      contextSuffix = ` ${JSON.stringify(context)}`;
    }
  } catch {
    contextSuffix = "";
  }
  await appendLogLine(`${timestamp} ${message}${contextSuffix}`);
}
