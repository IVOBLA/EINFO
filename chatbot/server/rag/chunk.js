// chatbot/server/rag/chunk.js

export function chunkText(text, maxChars = 1000, overlap = 200) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = i + maxChars;
    const slice = cleaned.slice(i, end);
    chunks.push(slice);
    if (end >= cleaned.length) break;
    i = end - overlap;
  }
  return chunks;
}
