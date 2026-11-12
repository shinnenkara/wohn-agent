import { z } from "zod";
import {
  MailReaderRateLimit,
  type MailInterpretation,
  type MailReader,
  type MailTriageInput,
} from "../../application/ports/mail-reader.js";
import type { MailResolver, MailResolveInput } from "../../application/ports/mail-resolver.js";
import { emptyProposal, type MailProposal } from "../../domain/mail-citation.js";
import { MAIL_INTENTS, MAIL_RELATIONS } from "../../domain/mail-reply.js";
import {
  DOCUMENT_CODES,
  INTENT_CODES,
  RED_FLAGS,
  type ProposedTriage,
} from "../../domain/triage.js";

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
  intent: z.string().optional(),
  relation: z.string().optional(),
  evidence: z.string().optional(),
});

const ResolveSchema = z.object({
  scoutId: z.string().optional(),
});

const TriageSchema = z.object({
  intents: z
    .array(
      z.object({
        intentCode: z.string().optional(),
        confidence: z.number().optional(),
        summary: z.string().optional(),
        citation: z.string().optional(),
        actionDeepLink: z.string().optional(),
        linkCitation: z.string().optional(),
        requestedDocuments: z.array(z.string()).optional(),
        proposedSlots: z
          .array(
            z.object({
              text: z.string().optional(),
              citation: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  redFlags: z
    .array(
      z.object({
        code: z.string().optional(),
        citation: z.string().optional(),
      }),
    )
    .optional(),
});

export class GeminiMailReader implements MailReader, MailResolver {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async propose(subject: string, body: string): Promise<MailInterpretation> {
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
    return toInterpretation(ProposalSchema.parse(JSON.parse(text)));
  }

  async triage(input: MailTriageInput): Promise<ProposedTriage> {
    const text = await this.complete(triagePrompt(input), triageSchema(), TRIAGE_SYSTEM);
    return toProposed(TriageSchema.parse(JSON.parse(text)));
  }

  async resolve(input: MailResolveInput): Promise<string | null> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: resolvePrompt(input) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: { scoutId: { type: "string" } },
          },
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
    const id = ResolveSchema.parse(JSON.parse(text)).scoutId?.trim() ?? "";
    if (!input.candidates.some((candidate) => candidate.scoutId === id)) {
      return null;
    }
    return id;
  }

  private async complete(promptText: string, responseSchema: Record<string, unknown>, system = ""): Promise<string> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
      },
    };
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] };
    }
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
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
    return text;
  }
}

function toInterpretation(parsed: z.infer<typeof ProposalSchema>): MailInterpretation {
  return {
    proposal: toProposal(parsed),
    intent: parsed.intent ?? "",
    relation: parsed.relation ?? "",
    evidence: parsed.evidence ?? "",
  };
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

function resolvePrompt(input: MailResolveInput): string {
  const lines = input.candidates.map(
    (candidate) =>
      `${candidate.scoutId} | ${candidate.title ?? ""} | ${candidate.address ?? ""} | ${candidate.priceCold ?? ""}`,
  );
  return (
    "Choose the one open apartment application this email belongs to. " +
    "scoutId must be copied from the list. Use an empty scoutId when none of the apartments fit.\n\n" +
    lines.join("\n") +
    "\n\nSubject: " +
    input.subject +
    "\n\n" +
    input.body
  );
}

function prompt(subject: string, body: string): string {
  return (
    "Classify this landlord email about a Berlin apartment application and extract the apartment facts. " +
    `intent is one of: ${MAIL_INTENTS.join(", ")}. ` +
    `relation is one of: ${MAIL_RELATIONS.join(", ")}. ` +
    "Use start when the mail opens that step, continue when it stays on the same step, and close when the step ends. " +
    "evidence is an exact substring of the email that supports the intent, or empty when the intent is unknown. " +
    "Every non-empty address, visit, and contact field must include a citation that is an exact substring of the email. " +
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
      intent: { type: "string", enum: [...MAIL_INTENTS] },
      relation: { type: "string", enum: [...MAIL_RELATIONS] },
      evidence: { type: "string" },
    },
  };
}

const TRIAGE_SYSTEM =
  "You triage one landlord or portal email about a Berlin apartment application. " +
  "Return every distinct intent you can cite. " +
  `intentCode is one of: ${INTENT_CODES.join(", ")}. ` +
  `requestedDocuments is a subset of: ${DOCUMENT_CODES.join(", ")}. ` +
  `redFlags.code is one of: ${RED_FLAGS.join(", ")}. ` +
  "citation, linkCitation, and each proposedSlots.citation must be exact substrings of the email. " +
  "Leave actionDeepLink empty when the email has no http link. " +
  "Do not assign a priority or a risk level.";

function triagePrompt(input: MailTriageInput): string {
  return `Stage: ${input.stage ?? "unknown"}\n\nSubject: ${input.subject}\n\n${input.body}`;
}

function toProposed(parsed: z.infer<typeof TriageSchema>): ProposedTriage {
  return {
    intents: (parsed.intents ?? []).map((intent) => ({
      code: intent.intentCode ?? "",
      confidence: intent.confidence ?? 0,
      summary: intent.summary ?? "",
      citation: intent.citation ?? "",
      deepLink: intent.actionDeepLink ?? "",
      linkCitation: intent.linkCitation ?? "",
      requestedDocuments: intent.requestedDocuments ?? [],
      proposedSlots: (intent.proposedSlots ?? []).map((slot) => ({
        text: slot.text ?? "",
        citation: slot.citation ?? "",
      })),
    })),
    redFlags: (parsed.redFlags ?? []).map((flag) => ({
      code: flag.code ?? "",
      citation: flag.citation ?? "",
    })),
  };
}

function triageSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      intents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            intentCode: { type: "string", enum: [...INTENT_CODES] },
            confidence: { type: "number" },
            summary: { type: "string" },
            citation: { type: "string" },
            actionDeepLink: { type: "string" },
            linkCitation: { type: "string" },
            requestedDocuments: {
              type: "array",
              items: { type: "string", enum: [...DOCUMENT_CODES] },
            },
            proposedSlots: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  citation: { type: "string" },
                },
              },
            },
          },
        },
      },
      redFlags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: "string", enum: [...RED_FLAGS] },
            citation: { type: "string" },
          },
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
