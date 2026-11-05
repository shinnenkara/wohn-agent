import { loadDotEnv } from "./dotenv.js";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  databasePath: string;
  geminiApiKey: string | null;
  geminiModel: string;
}

export function loadGoogleConfig(): GoogleConfig {
  loadDotEnv();
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env");
  }
  const model = process.env.GEMINI_MODEL?.trim() || process.env.MODEL_NAME?.trim() || "gemini-3.5-flash-lite";
  const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
  return {
    clientId,
    clientSecret,
    databasePath: process.env.DATABASE_PATH?.trim() || "./data/wohn-agent.db",
    geminiApiKey: geminiApiKey || null,
    geminiModel: model.replace(/^google\//, ""),
  };
}
