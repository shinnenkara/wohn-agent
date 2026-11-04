import type { ProfileField } from "./applicant-profile.js";

const FIELD_PATTERNS: readonly { field: ProfileField; pattern: RegExp }[] = [
  { field: "monthlyNetIncome", pattern: /einkommen|income|gehalt|netto/i },
  { field: "hasPets", pattern: /haustier|pets|tierhaltung/i },
  { field: "numberOfPersons", pattern: /personen|haushalt|household|mitbewohner/i },
  { field: "employmentStatus", pattern: /besch[aä]ft|employment|beruf|anstellung/i },
  { field: "phone", pattern: /telefon|phone|mobil/i },
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
