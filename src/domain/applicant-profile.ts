export const SALUTATIONS = ["Herr", "Frau"] as const;
export const MOVE_IN_DATE_TYPES = ["FROM_NOW", "FLEXIBLE", "CONCRETE"] as const;
export const YES_NO = ["TRUE", "FALSE"] as const;
export const EMPLOYMENT_STATUSES = ["INDEFINITE_PERIOD", "FIXED_TERM"] as const;

export type Salutation = (typeof SALUTATIONS)[number];
export type MoveInDateType = (typeof MOVE_IN_DATE_TYPES)[number];
export type YesNo = (typeof YES_NO)[number];
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export interface FormData {
  salutation: Salutation;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  moveInDateType: MoveInDateType;
  moveInDate: string;
  numberOfAdults: string;
  numberOfKids: string;
  hasPets: YesNo;
  petDetails: string;
  employmentStatus: EmploymentStatus;
  incomeAmount: string;
  forCommercialPurposes: YesNo;
  rentArrears: YesNo;
  insolvencyProcess: YesNo;
  smoker: YesNo;
  schufaAvailable: boolean;
  sendApplicationPackage: boolean;
}

export type ProfileField = keyof FormData;

export interface ApplicantProfile {
  searchUrls: readonly string[];
  blacklistKeywords: readonly string[];
  formData: FormData;
  messageTemplate: string;
}
