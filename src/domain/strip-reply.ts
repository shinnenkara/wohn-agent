const ATTRIBUTIONS = [
  /^am\s.+\bschrieb\b/i,
  /^on\s.+\bwrote\b/i,
  /^urspr(?:u|ü)ngliche nachricht\b/i,
  /^-{5,}\s*original message\s*-{5,}/i,
];

export function stripQuotedReply(text: string, html: string): string {
  const plain = stripPlainQuotes(text);
  if (!html.trim()) {
    return plain;
  }
  const fromHtml = stripPlainQuotes(htmlToText(stripHtmlQuotes(html)));
  return fromHtml || plain;
}

export function stripHtmlQuotes(html: string): string {
  const marker = html.search(/<div\b[^>]*\bid\s*=\s*["']divRplyFwdMsg["']/i);
  const source = marker >= 0 ? html.slice(0, marker) : html;
  return removeQuotedElements(source);
}

function removeQuotedElements(html: string): string {
  let out = "";
  let index = 0;
  while (index < html.length) {
    if (html[index] !== "<") {
      out += html[index];
      index += 1;
      continue;
    }
    const end = html.indexOf(">", index);
    if (end < 0) {
      out += html.slice(index);
      break;
    }
    const tag = html.slice(index, end + 1);
    const name = quotedElementName(tag);
    if (name) {
      index = skipElement(html, end + 1, name);
      continue;
    }
    out += tag;
    index = end + 1;
  }
  return out;
}

function quotedElementName(tag: string): string | null {
  if (tag.startsWith("</") || tag.endsWith("/>")) {
    return null;
  }
  const match = /^<\s*([a-zA-Z0-9]+)/.exec(tag);
  if (!match?.[1]) {
    return null;
  }
  const name = match[1].toLowerCase();
  if (name === "blockquote" || /gmail_quote/i.test(tag)) {
    return name;
  }
  return null;
}

function skipElement(html: string, from: number, name: string): number {
  const lower = html.toLowerCase();
  const openToken = `<${name}`;
  const closeToken = `</${name}`;
  let depth = 1;
  let index = from;
  while (index < html.length && depth > 0) {
    const nextOpen = lower.indexOf(openToken, index);
    const nextClose = lower.indexOf(closeToken, index);
    if (nextClose < 0) {
      return html.length;
    }
    if (nextOpen >= 0 && nextOpen < nextClose && isTagBoundary(lower, nextOpen + openToken.length)) {
      depth += 1;
      index = nextOpen + openToken.length;
      continue;
    }
    const closeEnd = lower.indexOf(">", nextClose);
    index = closeEnd < 0 ? html.length : closeEnd + 1;
    if (isTagBoundary(lower, nextClose + closeToken.length)) {
      depth -= 1;
    }
  }
  return index;
}

function isTagBoundary(source: string, index: number): boolean {
  const mark = source[index];
  return mark === ">" || mark === " " || mark === "/" || mark === "\n" || mark === "\t" || mark === "\r";
}

function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const withLinks = withoutNoise.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, " $1 ");
  const text = withLinks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|blockquote|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text);
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  uuml: "ü",
  auml: "ä",
  ouml: "ö",
  szlig: "ß",
  euro: "€",
  ndash: "–",
  mdash: "—",
};

function decodeEntities(value: string): string {
  let current = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decodeOnce(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return collapseWhitespace(current);
}

function decodeOnce(value: string): string {
  const named = value.replace(/&amp;/gi, "&").replace(/&([a-z]+);/gi, (match, name: string) => {
    if (name.toLowerCase() === "amp") {
      return match;
    }
    const upper = name[0] === name[0]?.toUpperCase();
    const letter = NAMED_ENTITIES[name.toLowerCase()];
    if (!letter) {
      return match;
    }
    if (upper && letter.toLowerCase() !== letter.toUpperCase()) {
      return letter.toUpperCase();
    }
    return letter;
  });
  return named.replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number(digits)));
}

function collapseWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripPlainQuotes(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((line) => isAttribution(line));
  const head = cut >= 0 ? lines.slice(0, cut) : lines;
  return head
    .filter((line) => !isQuotedLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isAttribution(line: string): boolean {
  const trimmed = line.trim();
  return ATTRIBUTIONS.some((pattern) => pattern.test(trimmed));
}

function isQuotedLine(line: string): boolean {
  return /^\s*>/.test(line);
}
