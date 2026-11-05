import type { ProfileField } from "./applicant-profile.js";

const FIELD_PATTERNS: readonly { field: ProfileField; pattern: RegExp }[] = [
  { field: "incomeAmount", pattern: /einkommen|income|gehalt|netto/i },
  { field: "petDetails", pattern: /tierart/i },
  { field: "hasPets", pattern: /haustier|pets|tierhaltung/i },
  { field: "numberOfKids", pattern: /\bkinder\b|\bkids\b/i },
  { field: "numberOfAdults", pattern: /erwachsen|personen|mitbewohner|adults/i },
  { field: "employmentStatus", pattern: /besch[aä]ft|employment|beruf|anstellung/i },
  { field: "forCommercialPurposes", pattern: /gewerbl/i },
  { field: "rentArrears", pattern: /r[uü]ckst[aä]nd|arrears/i },
  { field: "insolvencyProcess", pattern: /insolvenz/i },
  { field: "smoker", pattern: /raucher|smoker/i },
  { field: "email", pattern: /e-?mail/i },
  { field: "phone", pattern: /telefon|phone|mobil/i },
  { field: "houseNumber", pattern: /hausnummer|haus.?nr/i },
  { field: "street", pattern: /stra(?:ß|ss)e|street/i },
  { field: "postcode", pattern: /\bplz\b|postleitzahl|postcode/i },
  { field: "city", pattern: /\bort\b|wohnort|\bstadt\b|\bcity\b/i },
  { field: "moveInDateType", pattern: /einzug|bezugs|move-in|move in/i },
  { field: "moveInDate", pattern: /einzug|bezugs|move-in|move in/i },
  { field: "salutation", pattern: /anrede|salutation/i },
  { field: "firstName", pattern: /vorname|first name/i },
  { field: "lastName", pattern: /nachname|last name|familienname/i },
  { field: "schufaAvailable", pattern: /schufa/i },
];

export function matchValidationFields(errorText: string): ProfileField[] {
  const matches: ProfileField[] = [];
  for (const entry of FIELD_PATTERNS) {
    if (entry.pattern.test(errorText)) {
      matches.push(entry.field);
    }
  }
  return matches;
}
