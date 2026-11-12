import { CaptchaEncountered } from "../domain/captcha-signal.js";
import type { BrowserSession, ExposeFacts } from "./ports/browser-session.js";

export async function readExpose(browser: BrowserSession, url: string): Promise<ExposeFacts> {
  if ((await browser.currentUrl()) !== url) {
    await browser.goto(url);
  }
  const captcha = await browser.detectCaptcha();
  if (captcha) {
    throw new CaptchaEncountered(captcha);
  }
  return browser.extractExpose();
}
