export function matchBlacklist(
  keywords: readonly string[],
  title: string,
  description: string,
): string | null {
  const haystack = `${title}\n${description}`.toLowerCase();
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (trimmed && haystack.includes(trimmed.toLowerCase())) {
      return trimmed;
    }
  }
  return null;
}
