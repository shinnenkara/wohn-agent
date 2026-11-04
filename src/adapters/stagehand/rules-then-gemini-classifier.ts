import { z } from "zod";
import type { FailureClassifier, FailureContext } from "../../application/ports/failure-classifier.js";
import { FAILURE_TYPES, type FailureType } from "../../domain/failure-type.js";
import { classifyByRules } from "./classify-by-rules.js";

const DecisionSchema = z.object({
  error_type: z.enum(FAILURE_TYPES),
});

export function buildClassifierPrompt(context: FailureContext): string {
  return [
    "Classify one browser automation failure.",
    'Return JSON only: {"error_type":"POPUP_BLOCKED"|"SELECTOR_STALE"|"VALIDATION_ERROR"|"EXTERNAL_PORTAL"|"CAPTCHA_HIT"}.',
    "Do not include or request personal data.",
    `step: ${context.step}`,
    `error_name: ${context.errorName}`,
    `error_message: ${context.message.slice(0, 1000)}`,
    `dom_snippet: ${context.domSnippet.slice(0, 4000)}`,
  ].join("\n");
}

export function parseClassifierDecision(text: string): FailureType {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Gemini did not return a JSON decision");
  }
  const parsed = DecisionSchema.parse(JSON.parse(text.slice(start, end + 1)) as unknown);
  return parsed.error_type;
}

export class RulesThenGeminiClassifier implements FailureClassifier {
  constructor(private readonly generate: (prompt: string) => Promise<string>) {}

  async classify(context: FailureContext): Promise<FailureType> {
    const ruled = classifyByRules(context);
    if (ruled) {
      return ruled;
    }
    return parseClassifierDecision(await this.generate(buildClassifierPrompt(context)));
  }
}

export function createGeminiClassifier(options: {
  apiKey: string;
  modelName: string;
  fetchImpl?: typeof fetch;
}): FailureClassifier {
  return new RulesThenGeminiClassifier((prompt) => generateGeminiText({ ...options, prompt }));
}

export async function generateGeminiText(options: {
  apiKey: string;
  modelName: string;
  prompt: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.modelName.replace(/^google\//, "");
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": options.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status}`);
  }
  const body = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned an empty decision");
  }
  return text;
}
