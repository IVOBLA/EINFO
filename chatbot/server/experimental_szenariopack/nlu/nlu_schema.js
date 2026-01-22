const VALID_INTENTS = new Set([
  "WETTER_ABFRAGE",
  "RESSOURCE_ABFRAGE",
  "LOGISTIK_ANFRAGE",
  "BEFEHL",
  "PLAN_ZEIT",
  "PLAN_WENN_DANN",
  "ANTWORT",
  "UNKLAR"
]);

export function buildDefaultResult() {
  return {
    absicht: "UNKLAR",
    vertrauen: 0,
    felder: {},
    rueckfrage: "Bitte präzisieren Sie die Anfrage."
  };
}

export function validateNluResult(result) {
  if (!result || typeof result !== "object") return false;
  if (!VALID_INTENTS.has(result.absicht)) return false;
  if (typeof result.vertrauen !== "number") return false;
  if (result.felder && typeof result.felder !== "object") return false;
  if (result.rueckfrage !== null && typeof result.rueckfrage !== "string") return false;
  return true;
}

export function normalizeNluResult(result) {
  if (!validateNluResult(result)) return buildDefaultResult();
  return {
    absicht: result.absicht,
    vertrauen: Math.max(0, Math.min(1, result.vertrauen)),
    felder: result.felder || {},
    rueckfrage: result.rueckfrage ?? null
  };
}
