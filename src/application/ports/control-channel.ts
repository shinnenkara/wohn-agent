export interface ControlChannel {
  start(): void;
  stop(): Promise<void>;
  resumeRequested(): boolean;
  consumeResume(): boolean;
}
