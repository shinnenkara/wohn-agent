export function gmailUrl(messageId: string, email: string | null): string {
  return gmailHashUrl(email, `all/${messageId}`);
}

export function gmailInboxUrl(messageId: string, email: string | null): string {
  return gmailHashUrl(email, `inbox/${messageId}`);
}

export function gmailDraftUrl(messageId: string, email: string | null): string {
  return gmailHashUrl(email, `drafts?compose=${messageId}`);
}

function gmailHashUrl(email: string | null, hash: string): string {
  const account = email?.trim() ?? "";
  if (!account) {
    return `https://mail.google.com/mail/u/0/#${hash}`;
  }
  const url = new URL("https://mail.google.com/mail/u/0/");
  url.searchParams.set("authuser", account);
  url.hash = hash;
  return url.toString();
}
