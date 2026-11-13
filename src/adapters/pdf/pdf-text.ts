import { extractText } from "unpdf";

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const extracted = await extractText(bytes, { mergePages: true });
  return extracted.text;
}
