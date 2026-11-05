import { z } from "zod";
import { loadDotEnv } from "./dotenv.js";

export type AppEnv = "dev" | "prod";

export const SHARED_NOTIFY_URL = "https://wohn-notify.shinnenkara.workers.dev";

export interface RuntimeConfig {
  googleApiKey: string;
  modelName: string;
  notifyUrl: string;
  chromeCdpUrl: string;
  databasePath: string;
  applicantProfilePath: string;
  maxApplicationsPerCycle: number;
  dryRun: boolean;
  overnightRun: boolean;
  appEnv: AppEnv;
}

const EnvSchema = z.object({
  googleApiKey: z.string().min(1),
  modelName: z.string().refine((value) => value.startsWith("google/"), "MODEL_NAME must start with google/"),
  notifyUrl: z.string().refine((value) => value.startsWith("http"), "NOTIFY_URL must be an http URL"),
  chromeCdpUrl: z.string().refine((value) => value.startsWith("http"), "CHROME_CDP_URL must be an http URL"),
  databasePath: z.string().min(1),
  applicantProfilePath: z.string().min(1),
  maxApplicationsPerCycle: z.number().int().positive(),
  dryRun: z.boolean(),
  overnightRun: z.boolean(),
  appEnv: z.enum(["dev", "prod"]),
});

export function parseEnv(source: Record<string, string | undefined>): RuntimeConfig {
  return EnvSchema.parse({
    googleApiKey: source.GOOGLE_GENERATIVE_AI_API_KEY,
    modelName: source.MODEL_NAME || "google/gemini-3.8-flash",
    notifyUrl: source.NOTIFY_URL?.trim() || SHARED_NOTIFY_URL,
    chromeCdpUrl: source.CHROME_CDP_URL || "http://127.0.0.1:9222",
    databasePath: source.DATABASE_PATH || "./data/wohn-agent.db",
    applicantProfilePath: source.APPLICANT_PROFILE_PATH || "./applicant_profile.json",
    maxApplicationsPerCycle: Number(source.MAX_APPLICATIONS_PER_CYCLE || "5"),
    dryRun: envFlag(source.DRY_RUN),
    overnightRun: envFlag(source.OVERNIGHT_RUN),
    appEnv: appEnv(source.APP_ENV),
  });
}

function appEnv(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : "prod";
}

function envFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function loadRuntimeConfig(): RuntimeConfig {
  loadDotEnv();
  return parseEnv(process.env);
}
