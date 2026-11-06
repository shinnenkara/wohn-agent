export function gmailUrl(messageId: string, email: string | null): string {
  const account = email?.trim() ?? "";
  if (!account) {
    return `https://mail.google.com/mail/u/0/#all/${messageId}`;
  }
  const url = new URL("https://mail.google.com/mail/u/0/");
  url.searchParams.set("authuser", account);
  url.hash = `all/${messageId}`;
  return url.toString();
}
