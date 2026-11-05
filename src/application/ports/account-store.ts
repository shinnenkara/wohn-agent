export interface GoogleAccount {
  email: string;
  tokenJson: string;
  gmailHistoryId: string | null;
  calendarSyncToken: string | null;
}

export interface AccountStore {
  load(): GoogleAccount | null;
  saveLogin(input: { email: string; tokenJson: string; connectedAt: Date }): void;
  saveToken(tokenJson: string): void;
  saveGmailHistory(historyId: string): void;
  saveCalendarToken(token: string): void;
}
