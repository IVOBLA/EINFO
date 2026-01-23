import { callLLMForChat } from "../../llm_client.js";
import { extractJsonObject } from "../../json_sanitizer.js";
import { normalizeNluResult, buildDefaultResult } from "./nlu_schema.js";
import { getExperimentalConfig } from "../config/config_loader.js";

const config = getExperimentalConfig();
const llmConfig = config?.nlu?.llm || {};

export async function parseWithLlm(text) {
  try {
    if (!llmConfig.system_prompt || !llmConfig.options) {
      return buildDefaultResult();
    }
    const response = await callLLMForChat(
      llmConfig.system_prompt,
      String(text || ""),
      { ...llmConfig.options }
    );
    const parsed = extractJsonObject(response);
    return normalizeNluResult(parsed);
  } catch {
    return buildDefaultResult();
  }
}
