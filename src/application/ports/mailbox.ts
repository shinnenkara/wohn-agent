export interface FetchedMail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  sentAt: string;
  text: string;
  html: string;
  calendarPart: boolean;
}

export interface Mailbox {
  historyId(): Promise<string>;
  listSince(since: Date, till: Date | null): Promise<FetchedMail[]>;
  addedSince(startId: string): Promise<{ mails: FetchedMail[]; latestId: string; expired: boolean }>;
}
