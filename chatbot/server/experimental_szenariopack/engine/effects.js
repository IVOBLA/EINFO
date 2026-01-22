export function applyTaskEffects(state, task) {
  if (!task || !task.title) return;
  const title = String(task.title).toLowerCase();
  if (title.includes("sandsacklinie") || title.includes("damm")) {
    if (state.damm_status === "BRUCHGEFAHR") {
      state.damm_status = "SICKER";
    }
  }
}
