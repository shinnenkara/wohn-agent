import { z } from "zod";
import type { LeaseFactReader } from "../../application/ports/lease-reader.js";
import { emptyLeaseFacts, type ProposedLeaseFacts, type StaffelStep } from "../../domain/lease-audit.js";

const StepSchema = z.object({
  amount: z.string().optional(),
  citation: z.string().optional(),
});

const FactsSchema = z.object({
  coldRentEur: z.number().optional(),
  coldRentCitation: z.string().optional(),
  indexCitation: z.string().optional(),
  capCitation: z.string().optional(),
  staffelSteps: z.array(StepSchema).optional(),
  fixedTermCitation: z.string().optional(),
  fixedTermReason: z.string().optional(),
  furnitureSurchargeEur: z.number().optional(),
  furnitureSurchargeCitation: z.string().optional(),
  furnitureValueEur: z.number().optional(),
  furnitureValueCitation: z.string().optional(),
  depositEur: z.number().optional(),
  depositCitation: z.string().optional(),
  iban: z.string().optional(),
  ibanCitation: z.string().optional(),
  renovationCitations: z.array(z.string()).optional(),
});

const SYSTEM =
  "Extract facts from one German Mietvertrag. " +
  "Every citation must be an exact substring of the contract. " +
  "Leave a citation empty when the contract does not state that fact. " +
  "Do not judge whether a clause is lawful. " +
  "indexCitation quotes the Indexmiete clause. capCitation quotes an upper bound on that adjustment, or is empty. " +
  "staffelSteps quote each stated rent step. fixedTermCitation quotes a befristet term. fixedTermReason quotes the stated reason. " +
  "Amounts are euros as numbers. iban is the contract IBAN without spaces.";

export class GeminiLeaseReader implements LeaseFactReader {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async read(contractText: string): Promise<ProposedLeaseFacts> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: contractText }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: factsSchema(),
        },
      }),
    });
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
    return toFacts(FactsSchema.parse(JSON.parse(text)));
  }
}

function toFacts(parsed: z.infer<typeof FactsSchema>): ProposedLeaseFacts {
  const cold = amount(parsed.coldRentEur, parsed.coldRentCitation);
  const surcharge = amount(parsed.furnitureSurchargeEur, parsed.furnitureSurchargeCitation);
  const furniture = amount(parsed.furnitureValueEur, parsed.furnitureValueCitation);
  const deposit = amount(parsed.depositEur, parsed.depositCitation);
  const steps: StaffelStep[] = (parsed.staffelSteps ?? [])
    .map((step) => ({ amount: step.amount?.trim() ?? "", citation: step.citation?.trim() ?? "" }))
    .filter((step) => step.amount !== "" && step.citation !== "");
  return {
    ...emptyLeaseFacts(),
    coldRentEur: cold.euros,
    coldRentCitation: cold.citation,
    indexCitation: parsed.indexCitation?.trim() ?? "",
    capCitation: parsed.capCitation?.trim() ?? "",
    staffelSteps: steps,
    fixedTermCitation: parsed.fixedTermCitation?.trim() ?? "",
    fixedTermReason: parsed.fixedTermReason?.trim() ?? "",
    furnitureSurchargeEur: surcharge.euros,
    furnitureSurchargeCitation: surcharge.citation,
    furnitureValueEur: furniture.euros,
    furnitureValueCitation: furniture.citation,
    depositEur: deposit.euros,
    depositCitation: deposit.citation,
    iban: (parsed.iban ?? "").replace(/\s+/g, "").toUpperCase(),
    ibanCitation: parsed.ibanCitation?.trim() ?? "",
    renovationCitations: (parsed.renovationCitations ?? []).map((item) => item.trim()).filter(Boolean),
  };
}

function amount(value: number | undefined, citation: string | undefined): { euros: number | null; citation: string } {
  const quote = citation?.trim() ?? "";
  if (!quote || value == null || !Number.isFinite(value)) {
    return { euros: null, citation: "" };
  }
  return { euros: value, citation: quote };
}

function factsSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      coldRentEur: { type: "number" },
      coldRentCitation: { type: "string" },
      indexCitation: { type: "string" },
      capCitation: { type: "string" },
      staffelSteps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            amount: { type: "string" },
            citation: { type: "string" },
          },
        },
      },
      fixedTermCitation: { type: "string" },
      fixedTermReason: { type: "string" },
      furnitureSurchargeEur: { type: "number" },
      furnitureSurchargeCitation: { type: "string" },
      furnitureValueEur: { type: "number" },
      furnitureValueCitation: { type: "string" },
      depositEur: { type: "number" },
      depositCitation: { type: "string" },
      iban: { type: "string" },
      ibanCitation: { type: "string" },
      renovationCitations: { type: "array", items: { type: "string" } },
    },
  };
}
