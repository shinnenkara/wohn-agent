export interface FetchedMail {
  id: string;
  threadId: string;
  from: string;
  replyTo: string;
  messageId: string;
  inReplyTo: string;
  references: string;
  subject: string;
  sentAt: string;
  text: string;
  html: string;
  calendarPart: boolean;
}

export interface MailListOptions {
  skip?: ReadonlySet<string>;
  onBatch?: (mails: readonly FetchedMail[]) => Promise<void>;
}

export interface Mailbox {
  historyId(): Promise<string>;
  listSince(since: Date, till: Date | null, options?: MailListOptions): Promise<FetchedMail[]>;
  addedSince(startId: string): Promise<{ mails: FetchedMail[]; latestId: string; expired: boolean }>;
}
