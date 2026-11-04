export interface FormData {
  salutation: string;
  firstName: string;
  lastName: string;
  phone: string;
  moveInDate: string;
  numberOfPersons: string;
  hasPets: string;
  employmentStatus: string;
  monthlyNetIncome: string;
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
