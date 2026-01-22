import { callLLMForChat } from "../../llm_client.js";
import { extractJsonObject } from "../../json_sanitizer.js";
import { normalizeNluResult, buildDefaultResult } from "./nlu_schema.js";

const SYSTEM_PROMPT = `Du bist ein NLU-Parser. Antworte NUR mit einem JSON-Objekt.
Format:
{
  "absicht": "WETTER_ABFRAGE|RESSOURCE_ABFRAGE|LOGISTIK_ANFRAGE|BEFEHL|PLAN_ZEIT|PLAN_WENN_DANN|ANTWORT|UNKLAR",
  "vertrauen": 0.0,
  "felder": { "pegel": 0, "minuten": 0, "aktion": "", "ressource": "", "antwort": "" },
  "rueckfrage": null
}
Keine zusätzlichen Felder, kein Text außerhalb des JSON.`;

export async function parseWithLlm(text) {
  try {
    const response = await callLLMForChat(SYSTEM_PROMPT, String(text || ""), {
      taskType: "analysis",
      stream: false,
      requireJson: true,
      maxTokens: 256,
      temperature: 0
    });
    const parsed = extractJsonObject(response);
    return normalizeNluResult(parsed);
  } catch {
    return buildDefaultResult();
  }
}
