import { z } from "zod";
import { MailReaderRateLimit, type MailReader } from "../../application/ports/mail-reader.js";
import { emptyProposal, type MailProposal } from "../../domain/mail-citation.js";

const CitedSchema = z.object({
  text: z.string().optional(),
  citation: z.string().optional(),
}).nullish();

const ProposalSchema = z.object({
  address: CitedSchema,
  visit: z.object({
    when: z.string().optional(),
    place: z.string().optional(),
    citation: z.string().optional(),
  }).nullish(),
  contact: z.object({
    name: z.string().optional(),
    role: z.string().optional(),
    citation: z.string().optional(),
  }).nullish(),
});

export class GeminiMailReader implements MailReader {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async propose(subject: string, body: string): Promise<MailProposal> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt(subject, body) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema(),
        },
      }),
    });
    if (response.status === 429) {
      throw new MailReaderRateLimit(retryAfterMs(response.headers.get("retry-after")));
    }
    if (!response.ok) {
      throw new Error(`gemini returned ${response.status}`);
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("gemini returned no text");
    }
    return toProposal(ProposalSchema.parse(JSON.parse(text)));
  }
}

function toProposal(parsed: z.infer<typeof ProposalSchema>): MailProposal {
  const proposal = emptyProposal();
  if (parsed.address) {
    proposal.address = { text: parsed.address.text ?? "", citation: parsed.address.citation ?? "" };
  }
  if (parsed.visit) {
    proposal.visit = {
      when: parsed.visit.when ?? "",
      place: parsed.visit.place ?? "",
      citation: parsed.visit.citation ?? "",
    };
  }
  if (parsed.contact) {
    proposal.contact = {
      name: parsed.contact.name ?? "",
      role: parsed.contact.role ?? "",
      citation: parsed.contact.citation ?? "",
    };
  }
  return proposal;
}

function prompt(subject: string, body: string): string {
  return (
    "Extract apartment facts from this email. " +
    "Every non-empty field must include a citation that is an exact substring of the email. " +
    "Leave a field empty when the email does not say it. " +
    "Never use Immobilien Scout's own office address.\n\nSubject: " +
    subject +
    "\n\n" +
    body
  );
}

function schema(): Record<string, unknown> {
  const cited = {
    type: "object",
    properties: {
      text: { type: "string" },
      citation: { type: "string" },
    },
  };
  return {
    type: "object",
    properties: {
      address: cited,
      visit: {
        type: "object",
        properties: {
          when: { type: "string" },
          place: { type: "string" },
          citation: { type: "string" },
        },
      },
      contact: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          citation: { type: "string" },
        },
      },
    },
  };
}

function retryAfterMs(header: string | null): number {
  const value = header?.trim() ?? "";
  if (!value) {
    return 0;
  }
  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const when = Date.parse(value);
  if (!Number.isNaN(when)) {
    return Math.max(0, when - Date.now());
  }
  return 0;
}
