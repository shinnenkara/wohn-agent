import type { ControlChannel } from "../../application/ports/control-channel.js";

export class NoopControl implements ControlChannel {
  start(): void {}

  async stop(): Promise<void> {}

  resumeRequested(): boolean {
    return false;
  }

  consumeResume(): boolean {
    return false;
  }
}
