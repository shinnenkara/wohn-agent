export interface GoogleAccount {
  email: string;
  gmailHistoryId: string | null;
  calendarSyncToken: string | null;
}

export interface AccountStore {
  load(): GoogleAccount | null;
  saveLogin(input: { email: string; connectedAt: Date }): void;
  saveGmailHistory(historyId: string): void;
  saveCalendarToken(token: string): void;
}
