const OPENER = /nachricht schreiben|kontaktieren|kontakt aufnehmen|anbieter kontaktieren|^nachricht$|^kontakt$|interesse bekunden/i;
const SEND = /anfrage\s+senden|nachricht\s+senden|\babsenden\b|^senden$|^abschicken$/i;

export function isSubmitLabel(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= 80 && SEND.test(normalized);
}

export interface OpenerCandidate {
  text: string;
  tag: string;
  role: string;
  hint: string;
  href: string;
  type: string;
}

export function pickOpenerIndex(candidates: readonly OpenerCandidate[]): number {
  let best = -1;
  let bestScore = 0;
  candidates.forEach((candidate, index) => {
    const text = candidate.text.replace(/\s+/g, " ").trim();
    if (!text || text.length > 80 || SEND.test(text) || candidate.type === "submit") {
      return;
    }
    if (!OPENER.test(text)) {
      return;
    }
    let score = 1;
    if (candidate.tag === "BUTTON" || candidate.role === "button") {
      score += 2;
    }
    if (/contact|kontakt/i.test(candidate.hint)) {
      score += 2;
    }
    if (candidate.tag === "A" && candidate.href && !candidate.href.startsWith("#")) {
      score -= 3;
    }
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}
