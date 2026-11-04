export interface Logger {
  info(message: string, fields?: Record<string, string | number | boolean | null>): void;
  error(message: string, fields?: Record<string, string | number | boolean | null>): void;
  preview(text: string): void;
}
