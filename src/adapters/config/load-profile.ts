import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ApplicantProfile } from "../../domain/applicant-profile.js";

const httpUrl = z.string().refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Expected an http(s) URL");

const yesNo = z.enum(["TRUE", "FALSE"]);

const FormDataSchema = z
  .object({
    salutation: z.enum(["Herr", "Frau"]),
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().min(1),
    email: z.string().trim(),
    phone: z.string().trim().min(1),
    street: z.string().trim(),
    house_number: z.string().trim(),
    postcode: z.string().trim(),
    city: z.string().trim(),
    move_in_date_type: z.enum(["FROM_NOW", "FLEXIBLE", "CONCRETE"]),
    move_in_date: z.string().trim(),
    number_of_adults: z.string().trim().min(1),
    number_of_kids: z.string().trim().min(1),
    has_pets: yesNo,
    pet_details: z.string().trim(),
    employment_status: z.enum(["INDEFINITE_PERIOD", "FIXED_TERM"]),
    income_amount: z.string().trim().min(1),
    for_commercial_purposes: yesNo,
    rent_arrears: yesNo,
    insolvency_process: yesNo,
    smoker: yesNo,
    schufa_available: z.boolean(),
    send_application_package: z.boolean(),
  })
  .refine((data) => data.move_in_date_type !== "CONCRETE" || data.move_in_date.length > 0, {
    message: "move_in_date is required when move_in_date_type is CONCRETE",
    path: ["move_in_date"],
  });

function withLegacyIncome(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (record.income_amount == null && typeof record.monthly_net_income === "string") {
    return { ...record, income_amount: record.monthly_net_income };
  }
  return value;
}

const ProfileSchema = z.object({
  search_urls: z.array(httpUrl).min(1),
  blacklist_keywords: z.array(z.string().min(1)),
  form_data: z.preprocess(withLegacyIncome, FormDataSchema),
  message_template: z.string().trim().min(1),
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
      email: parsed.form_data.email,
      phone: parsed.form_data.phone,
      street: parsed.form_data.street,
      houseNumber: parsed.form_data.house_number,
      postcode: parsed.form_data.postcode,
      city: parsed.form_data.city,
      moveInDateType: parsed.form_data.move_in_date_type,
      moveInDate: parsed.form_data.move_in_date,
      numberOfAdults: parsed.form_data.number_of_adults,
      numberOfKids: parsed.form_data.number_of_kids,
      hasPets: parsed.form_data.has_pets,
      petDetails: parsed.form_data.pet_details,
      employmentStatus: parsed.form_data.employment_status,
      incomeAmount: parsed.form_data.income_amount,
      forCommercialPurposes: parsed.form_data.for_commercial_purposes,
      rentArrears: parsed.form_data.rent_arrears,
      insolvencyProcess: parsed.form_data.insolvency_process,
      smoker: parsed.form_data.smoker,
      schufaAvailable: parsed.form_data.schufa_available,
      sendApplicationPackage: parsed.form_data.send_application_package,
    },
  };
}

export function loadProfile(path: string): ApplicantProfile {
  return parseProfile(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
