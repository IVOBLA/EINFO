function sortPoints(points = []) {
  return [...points]
    .filter((p) => Number.isFinite(p.takt) && Number.isFinite(p.pegel_cm))
    .sort((a, b) => a.takt - b.takt);
}

export function getPegelAtTick(scenario, tick) {
  const curve = sortPoints(scenario?.verlauf?.pegelkurve || []);
  if (curve.length === 0) return 0;
  if (tick <= curve[0].takt) return curve[0].pegel_cm;
  if (tick >= curve[curve.length - 1].takt) return curve[curve.length - 1].pegel_cm;

  for (let i = 0; i < curve.length - 1; i += 1) {
    const start = curve[i];
    const end = curve[i + 1];
    if (tick >= start.takt && tick <= end.takt) {
      const span = end.takt - start.takt;
      if (span <= 0) return end.pegel_cm;
      const ratio = (tick - start.takt) / span;
      return Math.round(start.pegel_cm + ratio * (end.pegel_cm - start.pegel_cm));
    }
  }

  return curve[curve.length - 1].pegel_cm;
}

export function getZeitstempel(scenario, tick) {
  const start = scenario?.zeit?.start_zeit ? new Date(scenario.zeit.start_zeit) : new Date(0);
  const schrittMin = scenario?.zeit?.schritt_minuten || 5;
  const ms = start.getTime() + tick * schrittMin * 60 * 1000;
  return new Date(ms).toISOString();
}
