import type { FormData, ProfileField } from "../../domain/applicant-profile.js";

const VARIABLE_NAMES: Record<ProfileField, string> = {
  salutation: "salutation",
  firstName: "first_name",
  lastName: "last_name",
  phone: "phone",
  moveInDate: "move_in_date",
  numberOfPersons: "number_of_persons",
  hasPets: "has_pets",
  employmentStatus: "employment_status",
  monthlyNetIncome: "monthly_net_income",
  schufaAvailable: "schufa_available",
  sendApplicationPackage: "send_application_package",
};

const DESCRIPTIONS: Record<ProfileField, string> = {
  salutation: "Salutation",
  firstName: "First name",
  lastName: "Last name",
  phone: "Phone number",
  moveInDate: "Move-in date",
  numberOfPersons: "Number of people in the household",
  hasPets: "Whether the household has pets",
  employmentStatus: "Employment status",
  monthlyNetIncome: "Monthly net income",
  schufaAvailable: "Whether a Schufa report is available",
  sendApplicationPackage: "Whether to attach the saved application package",
};

export interface StagehandVariable {
  value: string | boolean;
  description: string;
}

export function toStagehandVariables(
  data: FormData,
  fields?: readonly ProfileField[],
): Record<string, StagehandVariable> {
  const selected = fields ?? (Object.keys(VARIABLE_NAMES) as ProfileField[]);
  const variables: Record<string, StagehandVariable> = {};
  for (const field of selected) {
    variables[VARIABLE_NAMES[field]] = {
      value: data[field],
      description: DESCRIPTIONS[field],
    };
  }
  return variables;
}

export function validationInstruction(fields: readonly ProfileField[]): string {
  const names = fields.map((field) => `%${VARIABLE_NAMES[field]}%`).join(", ");
  return `Find the empty form fields for ${names} and fill those variables.`;
}
