import express from "express";

export function isJsonContentType(contentType) {
  if (!contentType) return false;
  const raw = Array.isArray(contentType) ? contentType[0] : String(contentType);
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .some((entry) => entry === "application/json" || entry.endsWith("+json"));
}

export function createJsonBodyParser() {
  return express.json({
    type: (req) => isJsonContentType(req.headers?.["content-type"]),
  });
}
