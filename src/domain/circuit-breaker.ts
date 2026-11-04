export type CircuitState = "CLOSED" | "HALF_OPEN" | "OPEN";

export class CaptchaBreaker {
  private constructor(readonly state: CircuitState) {}

  static closed(): CaptchaBreaker {
    return new CaptchaBreaker("CLOSED");
  }

  static rehydrate(state: CircuitState): CaptchaBreaker {
    return new CaptchaBreaker(state);
  }

  recordDetection(): CaptchaBreaker {
    if (this.state === "CLOSED") {
      return new CaptchaBreaker("HALF_OPEN");
    }
    return new CaptchaBreaker("OPEN");
  }

  recordCleared(): CaptchaBreaker {
    return new CaptchaBreaker("CLOSED");
  }
}
