import type { ApplicantProfile } from "./applicant-profile.js";

export interface PlannedField {
  name: string;
  action: "fill" | "blank" | "skip";
  value: string;
}

const PROHIBITED: readonly RegExp[] = [
  /\bfamilienstand\b/,
  /\behestand\b/,
  /\bledig\b/,
  /\bverheiratet\b/,
  /\bgeschieden\b/,
  /\breligion\b/,
  /\bkonfession\b/,
  /\bglaubens/,
  /\bethnisch/,
  /\bherkunft\b/,
  /\bschwanger/,
  /\bbisherig\w* vermieter\b/,
  /\bvorherig\w* vermieter\b/,
  /\bvorvermieter\b/,
  /\balter vermieter\b/,
  /\bfrueher\w* vermieter\b/,
];

const HOUSE_NUMBER = /\bhausnummer\b|\bhausnr\b/;
const STREET = /\bstrasse\b|\bstr\b/;

export function normalizeField(name: string): string {
  return name
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function disclosurePlan(fieldNames: readonly string[], profile: ApplicantProfile): { fields: PlannedField[] } {
  const folded = fieldNames.map(normalizeField);
  const separateHouse = folded.some((name) => isHouseField(name));
  return {
    fields: fieldNames.map((name, index) => planField(name, folded[index] ?? "", profile, separateHouse)),
  };
}

export function isProhibitedField(name: string): boolean {
  return PROHIBITED.some((pattern) => pattern.test(normalizeField(name)));
}

function planField(name: string, folded: string, profile: ApplicantProfile, separateHouse: boolean): PlannedField {
  if (PROHIBITED.some((pattern) => pattern.test(folded))) {
    return { name, action: "blank", value: "" };
  }
  const value = aliasValue(folded, profile, separateHouse);
  if (!value) {
    return { name, action: "skip", value: "" };
  }
  return { name, action: "fill", value };
}

function aliasValue(folded: string, profile: ApplicantProfile, separateHouse: boolean): string {
  const data = profile.formData;
  if (/\bvorname\b|\bfirst name\b/.test(folded)) {
    return data.firstName.trim();
  }
  if (/\bnachname\b|\bfamilienname\b|\blast name\b|\bzuname\b/.test(folded)) {
    return data.lastName.trim();
  }
  if (/\banrede\b/.test(folded)) {
    return data.salutation;
  }
  if (isHouseField(folded)) {
    return data.houseNumber.trim();
  }
  if (STREET.test(folded)) {
    const street = data.street.trim();
    if (!street) {
      return "";
    }
    if (separateHouse) {
      return street;
    }
    return [street, data.houseNumber.trim()].filter(Boolean).join(" ");
  }
  if (/\bplz\b|\bpostleitzahl\b/.test(folded)) {
    return data.postcode.trim();
  }
  if (/\bort\b|\bwohnort\b|\bstadt\b/.test(folded)) {
    return data.city.trim();
  }
  if (/\btelefon\b|\bphone\b|\bmobil\b/.test(folded)) {
    return data.phone.trim();
  }
  if (/\be mail\b|\bemail\b/.test(folded)) {
    return data.email.trim();
  }
  if (/\bberuf\b|\bbeschaeftigung\b|\barbeitsverhaeltnis\b|\banstellung\b/.test(folded)) {
    return data.employmentStatus === "FIXED_TERM" ? "befristet" : "unbefristet";
  }
  if (/\bnetto|\beinkommen\b/.test(folded)) {
    return data.incomeAmount.trim();
  }
  if (/\beinzug/.test(folded)) {
    return moveIn(profile);
  }
  if (/\berwachsene\b|\bhaushaltsmitglieder\b|\bpersonen im haushalt\b/.test(folded)) {
    return data.numberOfAdults.trim();
  }
  if (/\bkinder\b|\bkind\b/.test(folded)) {
    return data.numberOfKids.trim();
  }
  if (/\bhaustier|\btiere\b/.test(folded)) {
    if (data.hasPets !== "TRUE") {
      return "Nein";
    }
    return data.petDetails.trim() || "Ja";
  }
  if (/\braucher\b/.test(folded)) {
    return yesNo(data.smoker);
  }
  if (/rueckstand|rueckstaend|mietschulden(?!frei)/.test(folded)) {
    return yesNo(data.rentArrears);
  }
  if (/\binsolvenz\b/.test(folded)) {
    return yesNo(data.insolvencyProcess);
  }
  if (/\bgewerbe/.test(folded)) {
    return yesNo(data.forCommercialPurposes);
  }
  if (/\bschufa\b/.test(folded)) {
    return data.schufaAvailable ? "Ja" : "Nein";
  }
  return "";
}

function moveIn(profile: ApplicantProfile): string {
  if (profile.formData.moveInDateType === "FROM_NOW") {
    return "ab sofort";
  }
  if (profile.formData.moveInDateType === "FLEXIBLE") {
    return "flexibel";
  }
  return profile.formData.moveInDate.trim();
}

function yesNo(value: "TRUE" | "FALSE"): string {
  return value === "TRUE" ? "Ja" : "Nein";
}

function isHouseField(folded: string): boolean {
  return HOUSE_NUMBER.test(folded) && !STREET.test(folded);
}
