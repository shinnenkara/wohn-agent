const CONTACT_FALLBACK = "Damen und Herren";

export function renderMessage(
  template: string,
  contactName: string | null,
  title: string,
): string {
  const name = contactName?.trim() ? contactName.trim() : CONTACT_FALLBACK;
  return template.replaceAll("{{contact_name}}", name).replaceAll("{{title}}", title);
}
