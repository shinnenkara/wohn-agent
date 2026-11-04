import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ApplicantProfile } from "../../domain/applicant-profile.js";

const httpUrl = z.string().refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Expected an http(s) URL");

const ProfileSchema = z.object({
  search_urls: z.array(httpUrl).min(1),
  blacklist_keywords: z.array(z.string().min(1)),
  form_data: z.object({
    salutation: z.string().min(1),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    phone: z.string().min(1),
    move_in_date: z.string().min(1),
    number_of_persons: z.string().min(1),
    has_pets: z.string().min(1),
    employment_status: z.string().min(1),
    monthly_net_income: z.string().min(1),
    schufa_available: z.boolean(),
    send_application_package: z.boolean(),
  }),
  message_template: z.string().min(1),
});

export function parseProfile(input: unknown): ApplicantProfile {
  const parsed = ProfileSchema.parse(input);
  return {
    searchUrls: parsed.search_urls,
    blacklistKeywords: parsed.blacklist_keywords,
    messageTemplate: parsed.message_template,
    formData: {
      salutation: parsed.form_data.salutation,
      firstName: parsed.form_data.first_name,
      lastName: parsed.form_data.last_name,
      phone: parsed.form_data.phone,
      moveInDate: parsed.form_data.move_in_date,
      numberOfPersons: parsed.form_data.number_of_persons,
      hasPets: parsed.form_data.has_pets,
      employmentStatus: parsed.form_data.employment_status,
      monthlyNetIncome: parsed.form_data.monthly_net_income,
      schufaAvailable: parsed.form_data.schufa_available,
      sendApplicationPackage: parsed.form_data.send_application_package,
    },
  };
}

export function loadProfile(path: string): ApplicantProfile {
  return parseProfile(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
