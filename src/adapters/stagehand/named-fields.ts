import type { FormData, ProfileField, Salutation } from "../../domain/applicant-profile.js";

const SALUTATION_VALUE: Record<Salutation, string> = {
  Herr: "MALE",
  Frau: "FEMALE",
};

const LABEL_FIELDS: ReadonlyArray<{ key: ProfileField; pattern: string }> = [
  { key: "firstName", pattern: "vorname|first.?name|given-name" },
  { key: "lastName", pattern: "nachname|last.?name|familienname|family-name" },
  { key: "email", pattern: "e-?mail" },
  { key: "phone", pattern: "telefon|phone|mobil|\\btel\\b" },
  { key: "houseNumber", pattern: "hausnummer|haus.?nr|house.?number" },
  { key: "street", pattern: "straße|strasse|street-address|\\bstreet\\b" },
  { key: "postcode", pattern: "\\bplz\\b|postleitzahl|postcode|postal-code" },
  { key: "city", pattern: "\\bort\\b|wohnort|\\bstadt\\b|address-level2|\\bcity\\b" },
];

const SELECT_FIELDS: ReadonlyArray<ProfileField> = [
  "hasPets",
  "employmentStatus",
  "forCommercialPurposes",
  "rentArrears",
  "insolvencyProcess",
  "smoker",
];

const INPUT_FIELDS: ReadonlyArray<ProfileField> = ["numberOfAdults", "numberOfKids", "incomeAmount"];

export interface LabelFill {
  pattern: string;
  value: string;
}

export interface NamedValue {
  name: string;
  value: string;
}

export interface NamedFillPlan {
  labelFills: LabelFill[];
  salutationLabel: string;
  salutationValue: string;
  selects: NamedValue[];
  inputs: NamedValue[];
  moveInDateType: string;
  moveInDate: string;
  hasPets: string;
  petDetails: string;
}

function selected(fields: readonly ProfileField[] | undefined, field: ProfileField): boolean {
  return !fields || fields.includes(field);
}

function textValue(data: FormData, field: ProfileField, fields: readonly ProfileField[] | undefined): string {
  if (!selected(fields, field)) {
    return "";
  }
  const value = data[field];
  return typeof value === "string" ? value.trim() : "";
}

function incomeBand(amount: string): string {
  const value = Number(amount.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  if (value < 500) return "BELOW_500";
  if (value <= 1000) return "OVER_500_UPTO_1000";
  if (value <= 1500) return "OVER_1000_UPTO_1500";
  if (value <= 2000) return "OVER_1500_UPTO_2000";
  if (value <= 3000) return "OVER_2000_UPTO_3000";
  if (value <= 4000) return "OVER_3000_UPTO_4000";
  if (value <= 5000) return "OVER_4000_UPTO_5000";
  return "OVER_5000";
}

function householdSize(adults: string, kids: string): string {
  const adultCount = Number(adults);
  const kidCount = Number(kids);
  if (!Number.isFinite(adultCount) || adultCount <= 0) {
    return "";
  }
  if (adultCount === 1 && (!Number.isFinite(kidCount) || kidCount <= 0)) {
    return "ONE_PERSON";
  }
  if (adultCount === 2 && kidCount <= 0) {
    return "TWO_PERSON";
  }
  if (kidCount > 0) {
    return "FAMILY";
  }
  return "BIG_GROUP";
}

export function namedFillPlan(data: FormData, fields?: readonly ProfileField[]): NamedFillPlan {
  const labelFills: LabelFill[] = [];
  for (const spec of LABEL_FIELDS) {
    const value = textValue(data, spec.key, fields);
    if (value) {
      labelFills.push({ pattern: spec.pattern, value });
    }
  }
  const salutation = textValue(data, "salutation", fields) as Salutation | "";
  const selects: NamedValue[] = [];
  for (const field of SELECT_FIELDS) {
    const value = textValue(data, field, fields);
    if (value) {
      selects.push({ name: field, value });
    }
  }
  const inputs: NamedValue[] = [];
  for (const field of INPUT_FIELDS) {
    const value = textValue(data, field, fields);
    if (value) {
      inputs.push({ name: field, value });
    }
  }
  const email = textValue(data, "email", fields);
  if (email) {
    inputs.push({ name: "emailAddress", value: email });
  }
  const phone = textValue(data, "phone", fields);
  if (phone) {
    inputs.push({ name: "phoneNumber", value: phone });
  }
  const household = householdSize(textValue(data, "numberOfAdults", fields), textValue(data, "numberOfKids", fields));
  if (household) {
    selects.push({ name: "numberOfPersons", value: household });
  }
  const band = incomeBand(textValue(data, "incomeAmount", fields));
  if (band) {
    selects.push({ name: "income", value: band });
  }
  if ((!fields || fields.length === 0) && data.sendApplicationPackage) {
    selects.push({ name: "applicationPackageCompleted", value: "TRUE" });
  }
  return {
    labelFills,
    salutationLabel: salutation,
    salutationValue: salutation ? SALUTATION_VALUE[salutation] : "",
    selects,
    inputs,
    moveInDateType: textValue(data, "moveInDateType", fields),
    moveInDate: textValue(data, "moveInDate", fields),
    hasPets: textValue(data, "hasPets", fields),
    petDetails: textValue(data, "petDetails", fields),
  };
}
