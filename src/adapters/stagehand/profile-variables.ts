import type { FormData, ProfileField } from "../../domain/applicant-profile.js";

const VARIABLE_NAMES: Record<ProfileField, string> = {
  salutation: "salutation",
  firstName: "firstName",
  lastName: "lastName",
  email: "email",
  phone: "phone",
  street: "street",
  houseNumber: "houseNumber",
  postcode: "postcode",
  city: "city",
  moveInDateType: "moveInDateType",
  moveInDate: "moveInDate",
  numberOfAdults: "numberOfAdults",
  numberOfKids: "numberOfKids",
  hasPets: "hasPets",
  petDetails: "petDetails",
  employmentStatus: "employmentStatus",
  incomeAmount: "incomeAmount",
  forCommercialPurposes: "forCommercialPurposes",
  rentArrears: "rentArrears",
  insolvencyProcess: "insolvencyProcess",
  smoker: "smoker",
  schufaAvailable: "schufa_available",
  sendApplicationPackage: "send_application_package",
};

const DESCRIPTIONS: Record<ProfileField, string> = {
  salutation: "Salutation. Herr selects MALE, Frau selects FEMALE.",
  firstName: "First name",
  lastName: "Last name",
  email: "Email address",
  phone: "Phone number",
  street: "Street",
  houseNumber: "House number",
  postcode: "Postal code",
  city: "City",
  moveInDateType: "Move-in timing. FROM_NOW means ab sofort, FLEXIBLE means flexibel, CONCRETE means a specific date.",
  moveInDate: "Move-in date, used only when move-in timing is CONCRETE.",
  numberOfAdults: "Number of adults in the household",
  numberOfKids: "Number of children in the household",
  hasPets: "Whether the household has pets. TRUE means ja, FALSE means nein.",
  petDetails: "Pet count and species, used when hasPets is TRUE.",
  employmentStatus: "Employment status. INDEFINITE_PERIOD means unbefristet, FIXED_TERM means befristet.",
  incomeAmount: "Monthly net household income",
  forCommercialPurposes: "Whether the home is used commercially. TRUE or FALSE.",
  rentArrears: "Rent arrears in the last 5 years. TRUE or FALSE.",
  insolvencyProcess: "Insolvency proceedings in the last 5 years. TRUE or FALSE.",
  smoker: "Whether the applicant smokes. TRUE or FALSE.",
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
  const selected = (fields ?? (Object.keys(VARIABLE_NAMES) as ProfileField[])).filter((field) => {
    if (field === "sendApplicationPackage" && !fields) {
      return false;
    }
    return true;
  });
  const variables: Record<string, StagehandVariable> = {};
  for (const field of selected) {
    const value = data[field];
    if (typeof value === "string" && value.trim() === "") {
      continue;
    }
    variables[VARIABLE_NAMES[field]] = {
      value,
      description: DESCRIPTIONS[field],
    };
  }
  return variables;
}

export function validationInstruction(fields: readonly ProfileField[]): string {
  const names = fields.map((field) => `%${VARIABLE_NAMES[field]}%`).join(", ");
  return `Find the empty form fields for ${names} and fill those variables.`;
}
