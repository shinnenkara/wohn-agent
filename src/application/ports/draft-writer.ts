export interface ReplyDraft {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
}

export interface DraftWriter {
  createReply(draft: ReplyDraft): Promise<{ messageId: string }>;
}
