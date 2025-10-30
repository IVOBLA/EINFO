export const FORBIDDEN_MESSAGE = "Sie haben keine Berechtigung";

export function notifyForbidden() {
  if (typeof window === "undefined") return;
  const alertFn = typeof window.alert === "function" ? window.alert.bind(window) : null;
  if (alertFn) {
    alertFn(FORBIDDEN_MESSAGE);
  }
}

export function forbiddenError() {
  notifyForbidden();
  const error = new Error(FORBIDDEN_MESSAGE);
  error.status = 403;
  error.code = "FORBIDDEN";
  return error;
}
