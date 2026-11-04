export interface CaptchaSignal {
  kind: "title" | "selector" | "checkbox";
  detail: string;
}

export class CaptchaEncountered extends Error {
  readonly signal: CaptchaSignal;

  constructor(signal: CaptchaSignal) {
    super(signal.detail);
    this.name = "CaptchaEncountered";
    this.signal = signal;
  }
}

export function titleIndicatesCaptcha(title: string): boolean {
  const normalized = title.toLowerCase();
  return (
    normalized.includes("ich bin kein roboter") ||
    normalized.includes("sicherheitsüberprüfung") ||
    normalized.includes("sicherheitsuberprufung")
  );
}

export function titleIsClearOfCaptcha(title: string): boolean {
  return title.trim().length > 0 && !titleIndicatesCaptcha(title);
}

export interface CaptchaWidget {
  kind: "box" | "iframe";
  src: string;
  title: string;
  id: string;
  className: string;
  visible: boolean;
}

export function classifyCaptchaWidgets(widgets: readonly CaptchaWidget[]): CaptchaSignal | null {
  const visible = widgets.filter((widget) => widget.visible);
  if (visible.some(isGeetestOrBox)) {
    return { kind: "selector", detail: "captcha-widget" };
  }
  const frames = visible.filter((widget) => widget.kind === "iframe");
  if (frames.some(isRecaptchaChallenge)) {
    return { kind: "selector", detail: "recaptcha-challenge" };
  }
  if (frames.some(isRecaptchaCheckbox)) {
    return { kind: "checkbox", detail: "recaptcha" };
  }
  if (frames.some(isGenericCaptchaFrame)) {
    return { kind: "selector", detail: "captcha-frame" };
  }
  return null;
}

function widgetText(widget: CaptchaWidget): string {
  return `${widget.src} ${widget.title} ${widget.id} ${widget.className}`.toLowerCase();
}

function isGeetestOrBox(widget: CaptchaWidget): boolean {
  return widget.id === "captcha-box" || widgetText(widget).includes("geetest");
}

function isRecaptchaInfrastructure(widget: CaptchaWidget): boolean {
  return /\/aframe(?:$|[?#])/i.test(widget.src);
}

function isRecaptchaChallenge(widget: CaptchaWidget): boolean {
  return /recaptcha/i.test(widget.src) && /bframe/i.test(widget.src);
}

function isRecaptchaCheckbox(widget: CaptchaWidget): boolean {
  if (isRecaptchaInfrastructure(widget) || isRecaptchaChallenge(widget)) {
    return false;
  }
  const src = widget.src.toLowerCase();
  const title = widget.title.toLowerCase();
  return src.includes("anchor") || title.includes("recaptcha");
}

function isGenericCaptchaFrame(widget: CaptchaWidget): boolean {
  if (isRecaptchaInfrastructure(widget) || /recaptcha/i.test(widget.src)) {
    return false;
  }
  return /captcha/i.test(`${widget.src} ${widget.title} ${widget.id}`);
}
