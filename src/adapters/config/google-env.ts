import { loadDotEnv } from "./dotenv.js";

export const SHARED_GOOGLE_URL = "https://wohn-google.shinnenkara.workers.dev";

export interface GoogleConfig {
  databasePath: string;
  geminiApiKey: string | null;
  geminiModel: string;
}

export function loadGoogleConfig(): GoogleConfig {
  loadDotEnv();
  const model = process.env.GEMINI_MODEL?.trim() || process.env.MODEL_NAME?.trim() || "gemini-3.5-flash-lite";
  const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
  return {
    databasePath: process.env.DATABASE_PATH?.trim() || "./data/wohn-agent.db",
    geminiApiKey: geminiApiKey || null,
    geminiModel: model.replace(/^google\//, ""),
  };
}
