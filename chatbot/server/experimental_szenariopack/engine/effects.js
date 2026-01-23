function matchesTitle(taskTitle, rule) {
  const title = String(taskTitle || "").toLowerCase();
  const keywords = Array.isArray(rule.title_contains) ? rule.title_contains : [];
  return keywords.some((keyword) => title.includes(String(keyword).toLowerCase()));
}

function matchesState(state, rule) {
  const matches = rule.state_matches || {};
  return Object.entries(matches).every(([key, value]) => state[key] === value);
}

export function applyTaskEffects(state, task, scenario) {
  if (!task || !task.title) return;
  const effects = scenario?.regeln?.task_effekte || [];
  for (const effect of effects) {
    if (matchesTitle(task.title, effect) && matchesState(state, effect)) {
      const updates = effect.set_state || {};
      for (const [key, value] of Object.entries(updates)) {
        state[key] = value;
      }
    }
  }
}
