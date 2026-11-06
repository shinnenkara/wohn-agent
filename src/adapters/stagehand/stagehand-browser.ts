import {
  CDPConnectionClosedError,
  localBrowser,
  Stagehand,
  type Action,
  type Page,
  type StagehandBrowser,
} from "@browserbasehq/stagehand";
import { z } from "zod";
import type {
  BrowserSession,
  CardRef,
  CachedSelector,
  ExposeFacts,
  FillFieldsResult,
  ObservedAction,
  SessionStatus,
  SubmitCheck,
} from "../../application/ports/browser-session.js";
import type { FormData, ProfileField } from "../../domain/applicant-profile.js";
import {
  CaptchaEncountered,
  classifyCaptchaWidgets,
  pausesSendingImmediately,
  textIndicatesApplicationSent,
  textIndicatesSendCaptcha,
  titleIndicatesCaptcha,
  type CaptchaSignal,
  type CaptchaWidget,
} from "../../domain/captcha-signal.js";
import type { ActionMethod } from "../../domain/selector-cache-entry.js";
import { ApplicationSent, StepFailure } from "../../domain/step-failure.js";
import type { AgentStep } from "../../domain/agent-event.js";
import { CACHED_SELECTOR_TIMEOUT_MS } from "../../domain/timing.js";
import {
  CLOSE_POPUP_INSTRUCTION,
  CONTACT_BUTTON_INSTRUCTION,
  MESSAGE_FIELD_INSTRUCTION,
  PACKAGE_INSTRUCTION,
  REQUIRED_FIELDS_INSTRUCTION,
  SUBMIT_BUTTON_INSTRUCTION,
} from "./instructions.js";
import { selectContactName, type ContactCandidate } from "../../domain/contact-name.js";
import { pickOpenerIndex, type OpenerCandidate } from "./contact-opener.js";
import { runFormPage, type FormFillReport, type FormPageCommand, type FormPageResult } from "./form-page.js";
import { namedFillPlan, type NamedFillPlan } from "./named-fields.js";
import { interpretExpose, uniqueScoutIds, type RawExpose } from "./parse-listing-text.js";
import { interpretSearchCard, readThumbnail } from "./parse-search-card.js";
import { toStagehandVariables, validationInstruction, type StagehandVariable } from "./profile-variables.js";

const HOME_URL = "https://www.immobilienscout24.de/";
const LOGIN_RESTORE_ATTEMPTS = 4;
const LOGIN_RESTORE_WAIT_MS = 4_000;
const CONTACT_BUTTON_SELECTOR = 'button[data-testid="contact-button"]';

const ExtractedExposeSchema = z.object({
  title: z.string(),
  contactName: z.string().nullable().optional(),
  description: z.string().optional(),
  priceCold: z.number().nullable().optional(),
  rooms: z.number().nullable().optional(),
  areaSqm: z.number().nullable().optional(),
  isPlusOnly: z.boolean().optional(),
  externalPortal: z.boolean().optional(),
});

export interface StagehandBrowserOptions {
  cdpUrl: string;
  apiKey: string;
  modelName: string;
}

export class StagehandBrowserSession implements BrowserSession {
  private stagehand: Stagehand | null = null;
  private browser: StagehandBrowser | null = null;
  private activePage: Page | null = null;

  constructor(private readonly options: StagehandBrowserOptions) {}

  async assertReachable(): Promise<void> {
    const response = await fetch(new URL("/json/version", this.options.cdpUrl));
    if (!response.ok) {
      throw new Error(`Chrome debugging port returned ${response.status}`);
    }
    const body = (await response.json()) as { webSocketDebuggerUrl?: string };
    if (!body.webSocketDebuggerUrl) {
      throw new Error("Chrome debugging port did not return a websocket url");
    }
  }

  async ensureLoggedIn(): Promise<SessionStatus> {
    return this.guard(async () => {
      const page = await this.page();
      const current = await page.url();
      // Leave an ImmoScout or Google page alone so a restored Google session can finish signing in.
      if (!/immobilienscout24\.de|accounts\.google\.com/i.test(current)) {
        await this.goto(HOME_URL);
      } else if (/immobilienscout24\.de/i.test(current)) {
        const captcha = await this.detectCaptcha();
        if (captcha) {
          throw new CaptchaEncountered(captcha);
        }
      }
      for (let attempt = 0; attempt < LOGIN_RESTORE_ATTEMPTS; attempt += 1) {
        if (await this.looksLoggedIn()) {
          return { loggedIn: true };
        }
        if (attempt < LOGIN_RESTORE_ATTEMPTS - 1) {
          await page.waitForTimeout(LOGIN_RESTORE_WAIT_MS);
        }
      }
      return { loggedIn: false };
    });
  }

  async goto(url: string): Promise<void> {
    await this.guard(async () => {
      const page = await this.page();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const captcha = await this.detectCaptcha();
      if (captcha) {
        throw new CaptchaEncountered(captcha);
      }
    });
  }

  async currentUrl(): Promise<string> {
    return this.guard(async () => (await this.page()).url());
  }

  async detectCaptcha(): Promise<CaptchaSignal | null> {
    return this.guard(async () => {
      const page = await this.page();
      const title = await page.title();
      if (titleIndicatesCaptcha(title)) {
        return { kind: "title", detail: title };
      }
      const widgets = await evaluateOnPage(page, (): CaptchaWidget[] => {
        const shown = (node: Element) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) > 0 &&
            rect.width >= 8 &&
            rect.height >= 8
          );
        };
        return Array.from(document.querySelectorAll("#captcha-box, .geetest_panel, iframe")).map((node) => ({
          kind: node.tagName === "IFRAME" ? "iframe" : "box",
          src: node.getAttribute("src") ?? "",
          title: node.getAttribute("title") ?? "",
          id: node.id,
          className: typeof node.className === "string" ? node.className : "",
          visible: shown(node),
        }));
      });
      const widget = classifyCaptchaWidgets(widgets);
      if (widget) {
        return widget;
      }
      const text = await evaluateOnPage(page, () => document.body?.innerText ?? "");
      if (textIndicatesSendCaptcha(text) || titleIndicatesCaptcha(text)) {
        return textIndicatesSendCaptcha(text)
          ? { kind: "selector", detail: "sicherheitsabfrage" }
          : { kind: "title", detail: "Ich bin kein Roboter" };
      }
      const pageChallenge = await evaluateOnPage(page, () => {
        const node = document.querySelector("#captcha-container, awswaf-captcha");
        if (!node) {
          return false;
        }
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width >= 8 && rect.height >= 8;
      });
      if (pageChallenge) {
        return { kind: "title", detail: "Ich bin kein Roboter" };
      }
      return null;
    });
  }

  async readTitle(): Promise<string> {
    return this.guard(async () => (await this.page()).title());
  }

  async extractCards(): Promise<CardRef[]> {
    return this.guard(async () => {
      const page = await this.page();
      const raw = await evaluateOnPage(page, (): RawSearchCard[] => {
        const found: RawSearchCard[] = [];
        document.querySelectorAll("[data-obid], [data-id]").forEach((node) => {
          const card = node as HTMLElement;
          const id = card.getAttribute("data-obid") || card.getAttribute("data-id") || "";
          const image = card.querySelector("img");
          let imageUrl = "";
          if (image) {
            const current = image.currentSrc || "";
            const src = image.getAttribute("src") || "";
            const lazy = image.getAttribute("data-src") || "";
            const srcset = (image.getAttribute("srcset") || "").split(",")[0] || "";
            const fromSet = srcset.trim().split(/\s+/)[0] || "";
            const candidate = [current, src, lazy, fromSet].find((item) => item && item.indexOf("data:") !== 0);
            imageUrl = candidate || "";
          }
          found.push({ scoutId: id, text: card.innerText || "", imageUrl });
        });
        return found;
      });
      const first = new Map<string, RawSearchCard>();
      for (const card of raw) {
        if (!first.has(card.scoutId)) {
          first.set(card.scoutId, card);
        }
      }
      const ids = uniqueScoutIds([...first.keys()]);
      return Promise.all(
        ids.map(async (scoutId) => {
          const card = first.get(scoutId);
          const facts = interpretSearchCard(card?.text ?? "");
          const image = await readThumbnail(card?.imageUrl ?? "");
          return { scoutId, ...facts, image };
        }),
      );
    });
  }

  async extractExpose(): Promise<ExposeFacts> {
    return this.guard(async () => {
      const page = await this.page();
      const raw = await evaluateOnPage(page, (): RawExpose => {
        const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? "";
        const bodyText = document.body?.innerText ?? "";
        const controls = Array.from(document.querySelectorAll("a, button"));
        const hasMessageButton = controls.some((node) =>
          /nachricht|kontakt|anfrage/i.test(node.textContent ?? ""),
        );
        const hasExternalLink = controls.some((node) =>
          /extern|zum anbieter|anbieterwebsite/i.test(node.textContent ?? ""),
        );
        const hasPhoneOnly = /tel:/i.test(document.body?.innerHTML ?? "") && !hasMessageButton;
        return {
          title: text("h1"),
          contactName: null,
          description: text('[data-qa="expose-description"]') || text("#expose-description"),
          bodyText,
          hasMessageButton,
          hasExternalLink,
          hasPhoneOnly,
        };
      });
      raw.contactName = await this.contactNameOn(page);
      const facts = interpretExpose(raw);
      if (facts.title.trim()) {
        return facts;
      }
      return this.extractExposeWithModel(page, facts);
    });
  }

  async readContactName(): Promise<string | null> {
    return this.guard(async () => this.contactNameOn(await this.page()));
  }

  async openContact(cached: CachedSelector | null): Promise<ObservedAction> {
    return this.guard(async () => {
      const page = await this.page();
      let opened = false;
      for (let index = 0; index < 3 && !opened; index += 1) {
        const clicked = await clickCssAt(page, CONTACT_BUTTON_SELECTOR, index);
        if (!clicked) {
          break;
        }
        opened = await this.waitForMessage(page, 3000);
        if (!opened && (await this.pageShowsApplicationSent(page))) {
          throw new ApplicationSent();
        }
      }
      if (!opened) {
        const base = (await page.url()).split("#")[0];
        await page.goto(`${base}#/basicContact/email`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
        opened = await this.waitForMessage(page, 4000);
      }
      if (!opened && (await this.pageShowsApplicationSent(page))) {
        throw new ApplicationSent();
      }
      if (!opened) {
        throw new StepFailure("FILL_FORM", "contact form did not open", { name: "TimeoutError" });
      }
      return {
        instruction: CONTACT_BUTTON_INSTRUCTION,
        selector: CONTACT_BUTTON_SELECTOR,
        method: "click",
      };
    });
  }

  private async pageShowsApplicationSent(page: Page): Promise<boolean> {
    const text = await evaluateOnPage(page, () => document.body?.innerText ?? "");
    return textIndicatesApplicationSent(text);
  }

  private async waitForMessage(page: Page, timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if ((await this.formPage(page, { op: "has-message" })) === true) {
        return true;
      }
      await page.waitForTimeout(250);
    }
    return false;
  }

  async fillRequiredFields(variables: FormData): Promise<FillFieldsResult> {
    return this.guard(async () => {
      const page = await this.page();
      const requiredFile = page.locator(
        'form input[type="file"][required], form input[type="file"][aria-required="true"]',
      );
      if ((await requiredFile.count({ timeout: 1000 })) > 0) {
        return { requiresFileUpload: true, unfilledRequired: false };
      }
      const named = await this.applyNamedFill(page, namedFillPlan(variables));
      if (variables.sendApplicationPackage) {
        await this.toggleApplicationPackage(page);
      }
      const after = asFillReport(await this.formPage(page, { op: "unfilled-required" }));
      return { requiresFileUpload: false, unfilledRequired: named.unfilledRequired || after.unfilledRequired };
    });
  }

  async fillFields(fields: readonly ProfileField[], variables: FormData): Promise<void> {
    await this.guard(async () => {
      if (fields.length === 0) {
        return;
      }
      const page = await this.page();
      await this.applyNamedFill(page, namedFillPlan(variables, fields));
      await this.actOnDiscoveredFields(
        page,
        validationInstruction(fields),
        toStagehandVariables(variables, fields),
      );
    });
  }

  async locateSubmit(cached: CachedSelector | null): Promise<ObservedAction> {
    return this.guard(async () => {
      const page = await this.page();
      const selector = await this.formPage(page, { op: "submit-selector" });
      if (typeof selector === "string" && selector) {
        return { instruction: SUBMIT_BUTTON_INSTRUCTION, selector, method: "click" };
      }
      if (cached && !cached.selector.startsWith("xpath=") && !cached.selector.startsWith("/")) {
        return { instruction: SUBMIT_BUTTON_INSTRUCTION, selector: cached.selector, method: "click" };
      }
      throw new StepFailure("SUBMIT", "Abschicken button not found", { name: "TimeoutError" });
    });
  }

  async fillMessage(text: string, cached: CachedSelector | null): Promise<ObservedAction> {
    return this.guard(async () => {
      const page = await this.page();
      if ((await this.formPage(page, { op: "fill-message", text })) === true) {
        return { instruction: MESSAGE_FIELD_INSTRUCTION, selector: "#message", method: "fill" };
      }
      if (cached) {
        try {
          await page.locator(cached.selector).fill(text, { timeout: CACHED_SELECTOR_TIMEOUT_MS });
          return { instruction: MESSAGE_FIELD_INSTRUCTION, selector: cached.selector, method: "fill" };
        } catch (error) {
          throw await this.asStepFailure("FILL_FORM", error);
        }
      }
      const textarea = page.locator("form textarea, textarea").first();
      if ((await textarea.count({ timeout: 1000 })) > 0) {
        await textarea.fill(text, { timeout: CACHED_SELECTOR_TIMEOUT_MS });
        return { instruction: MESSAGE_FIELD_INSTRUCTION, selector: "form textarea", method: "fill" };
      }
      throw new StepFailure("FILL_FORM", "message field not found", { name: "TimeoutError" });
    });
  }

  async clearMessage(): Promise<void> {
    await this.guard(async () => {
      const page = await this.page();
      const field = page.locator("form textarea, textarea").first();
      if ((await field.count({ timeout: 1000 })) === 0) {
        return;
      }
      await field.fill("", { timeout: 1000 }).catch(() => undefined);
    });
  }

  async submit(selector: string): Promise<SubmitCheck> {
    return this.guard(async () => {
      const page = await this.page();
      if ((await this.formPage(page, { op: "click-submit" })) === true) {
        return this.readSubmitResult(page);
      }
      try {
        await page.locator(selector).click({ timeout: CACHED_SELECTOR_TIMEOUT_MS });
      } catch (error) {
        throw await this.asStepFailure("SUBMIT", error);
      }
      return this.readSubmitResult(page);
    });
  }

  async closePopup(): Promise<void> {
    await this.guard(async () => {
      const page = await this.page();
      const stagehand = await this.connectedStagehand();
      await stagehand.act(CLOSE_POPUP_INSTRUCTION, { page, cache: false });
    });
  }

  async reload(): Promise<void> {
    await this.guard(async () => {
      const page = await this.page();
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    });
  }

  async clickSimpleCheckboxCaptcha(): Promise<boolean> {
    return this.guard(async () => {
      const page = await this.page();
      const iframe = page.locator('iframe[src*="recaptcha"][src*="anchor"], iframe[title*="reCAPTCHA"]');
      if ((await iframe.count({ timeout: 1000 })) === 0) {
        return false;
      }
      try {
        await iframe.first().click({ timeout: CACHED_SELECTOR_TIMEOUT_MS });
        return true;
      } catch {
        return false;
      }
    });
  }

  async disconnect(): Promise<void> {
    const stagehand = this.stagehand;
    this.stagehand = null;
    this.browser = null;
    this.activePage = null;
    // stagehand.close() drops the CDP session. browser.close() would send
    // Browser.close and quit the logged-in Chrome window, so it is never called.
    if (stagehand) {
      await stagehand.close().catch(() => undefined);
    }
  }

  private async clickOrDiscover(
    cached: CachedSelector | null,
    instruction: string,
    step: AgentStep,
    externalWhenMissing: boolean,
  ): Promise<ObservedAction> {
    const page = await this.page();
    if (instruction === CONTACT_BUTTON_INSTRUCTION || cached?.selector === CONTACT_BUTTON_SELECTOR) {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        if (await clickCss(page, CONTACT_BUTTON_SELECTOR)) {
          return { instruction, selector: CONTACT_BUTTON_SELECTOR, method: "click" };
        }
        await page.waitForTimeout(500);
      }
      const opened = await this.clickScoredOpener(page);
      if (opened) {
        return { instruction, selector: opened, method: "click" };
      }
      throw new StepFailure(step, "contact button not found", {
        name: "TimeoutError",
        domSnippet: await this.domSnippet(page),
      });
    }
    if (cached) {
      try {
        await page.locator(cached.selector).click({ timeout: CACHED_SELECTOR_TIMEOUT_MS });
        return { instruction, selector: cached.selector, method: "click" };
      } catch (error) {
        throw await this.asStepFailure(step, error);
      }
    }
    const stagehand = await this.connectedStagehand();
    const form = await this.formLocator(page);
    const { data } = await stagehand.observe(instruction, {
      page,
      cache: false,
      ...(form ? { locator: form } : {}),
    });
    const action = data[0];
    if (!action) {
      throw new StepFailure(step, externalWhenMissing ? "No message button" : "No matching element", {
        name: externalWhenMissing ? "ExternalPortal" : "TimeoutError",
        domSnippet: await this.domSnippet(page),
      });
    }
    await stagehand.act(action, { page, cache: false });
    return toObserved(action, instruction);
  }

  private async actOnDiscoveredFields(
    page: Page,
    instruction: string,
    variables: Record<string, StagehandVariable>,
  ): Promise<void> {
    const stagehand = await this.connectedStagehand();
    const form = await this.formLocator(page);
    const { data } = await stagehand.observe(instruction, {
      page,
      cache: false,
      variables,
      ...(form ? { locator: form } : {}),
    });
    for (const action of data) {
      if (isMessageAction(action)) {
        continue;
      }
      await stagehand.act(action, { page, cache: false, variables });
    }
  }

  private async toggleApplicationPackage(page: Page): Promise<void> {
    try {
      const stagehand = await this.connectedStagehand();
      const form = await this.formLocator(page);
      const { data } = await stagehand.observe(PACKAGE_INSTRUCTION, {
        page,
        cache: false,
        ...(form ? { locator: form } : {}),
      });
      const action = data.find((candidate) => !/file|upload/i.test(`${candidate.selector} ${candidate.description}`));
      if (action) {
        await stagehand.act(action, { page, cache: false });
      }
    } catch {
      // A missing saved-package control is left for validation recovery.
    }
  }

  private async extractExposeWithModel(page: Page, fallback: ExposeFacts): Promise<ExposeFacts> {
    const stagehand = await this.connectedStagehand();
    const { data } = await stagehand.extract(
      "Extract the public listing title, contact name, description, cold rent, rooms, square meters, whether it is MieterPlus-only, and whether contact is only by phone or an external website. Return JSON with keys title, contactName, description, priceCold, rooms, areaSqm, isPlusOnly, externalPortal.",
      { page, cache: false },
    );
    const parsed = ExtractedExposeSchema.safeParse(parseJsonObject(data.extraction));
    if (!parsed.success || !parsed.data.title.trim()) {
      throw new StepFailure("EXTRACT", "Listing title was not found", {
        name: "TimeoutError",
        domSnippet: await this.domSnippet(page),
      });
    }
    return {
      ...fallback,
      title: parsed.data.title,
      contactName: parsed.data.contactName ?? fallback.contactName,
      description: parsed.data.description || fallback.description,
      priceCold: parsed.data.priceCold ?? fallback.priceCold,
      rooms: plausibleRooms(parsed.data.rooms) ?? fallback.rooms,
      areaSqm: parsed.data.areaSqm ?? fallback.areaSqm,
      isPlusOnly: parsed.data.isPlusOnly ?? fallback.isPlusOnly,
      externalPortal: parsed.data.externalPortal ?? fallback.externalPortal,
    };
  }

  private async readSubmitResult(page: Page): Promise<SubmitCheck> {
    const started = Date.now();
    let text = "";
    while (Date.now() - started < 8_000) {
      text = await evaluateOnPage(page, () => document.body?.innerText ?? "");
      if (textIndicatesSendCaptcha(text)) {
        throw new CaptchaEncountered({ kind: "selector", detail: "sicherheitsabfrage" });
      }
      if (textIndicatesApplicationSent(text)) {
        return { confirmed: true, bookmarked: null, validationErrors: [] };
      }
      await page.waitForTimeout(400);
    }
    const validationErrors = await this.validationErrors(page);
    const composerStillOpen = (await this.formPage(page, { op: "has-message" })) === true;
    return {
      confirmed: !composerStillOpen && validationErrors.length === 0,
      bookmarked: null,
      validationErrors,
    };
  }

  private async validationErrors(page: Page): Promise<string[]> {
    return evaluateOnPage(page, () => {
      return Array.from(document.querySelectorAll('[aria-invalid="true"], [role="alert"], .error, .form-error'))
        .map((node) => node.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
        .slice(0, 8);
    });
  }

  private async looksLoggedIn(): Promise<boolean> {
    const page = await this.page();
    return evaluateOnPage(page, () => {
      if (document.querySelector(".sso-login--logged-in")) {
        return true;
      }
      const profile = document.querySelector('img[alt="Profilbild"]');
      return profile instanceof HTMLImageElement && profile.getClientRects().length > 0;
    });
  }

  private async observeFirst(instruction: string, scopeToForm: boolean): Promise<Action> {
    const page = await this.page();
    const stagehand = await this.connectedStagehand();
    const form = scopeToForm ? await this.formLocator(page) : null;
    const { data } = await stagehand.observe(instruction, {
      page,
      cache: false,
      ...(form ? { locator: form } : {}),
    });
    const action = data[0];
    if (!action) {
      throw new StepFailure("FILL_FORM", "No matching element", {
        name: "TimeoutError",
        domSnippet: await this.domSnippet(page),
      });
    }
    return action;
  }

  private async contactNameOn(page: Page): Promise<string | null> {
    const result = await this.formPage(page, { op: "contact-candidates" });
    if (!Array.isArray(result)) {
      return null;
    }
    return selectContactName(result as ContactCandidate[]);
  }

  private async clickScoredOpener(page: Page): Promise<string | null> {
    const result = await this.formPage(page, { op: "list-openers" });
    if (!Array.isArray(result)) {
      return null;
    }
    const candidates = result as OpenerCandidate[];
    const index = pickOpenerIndex(candidates);
    if (index < 0) {
      return null;
    }
    const selector = await this.formPage(page, { op: "click-opener", index });
    return typeof selector === "string" && selector ? selector : null;
  }

  private formPage(page: Page, command: FormPageCommand): Promise<FormPageResult> {
    return evaluateWithArg(page, runFormPage, command);
  }

  private async applyNamedFill(page: Page, plan: NamedFillPlan): Promise<FormFillReport> {
    const filled = asFillReport(await this.formPage(page, { op: "fill", plan }));
    if (filled.needsPetWait) {
      const started = Date.now();
      while (Date.now() - started < 2500) {
        const pets = asFillReport(await this.formPage(page, { op: "pets", plan }));
        if (!pets.needsPetWait) {
          break;
        }
        await page.waitForTimeout(200);
      }
    }
    if (filled.needsMoveInHold) {
      const started = Date.now();
      let stable = 0;
      while (Date.now() - started < 2000) {
        const tick = asFillReport(await this.formPage(page, { op: "move-in", plan }));
        if (tick.moveInStable) {
          stable += 1;
        } else {
          stable = 0;
        }
        if (stable >= 3 && Date.now() - started >= 1000) {
          break;
        }
        await page.waitForTimeout(200);
      }
    }
    const afterWaits = asFillReport(await this.formPage(page, { op: "unfilled-required" }));
    return { ...filled, unfilledRequired: afterWaits.unfilledRequired };
  }

  private async formLocator(page: Page) {
    const index = await evaluateOnPage(page, () => {
      return Array.from(document.forms).findIndex((form) => form.querySelector("textarea"));
    });
    if (index < 0) {
      return null;
    }
    return page.locator("form").nth(index);
  }

  private async page(): Promise<Page> {
    const { browser } = await this.ensureConnected();
    if (this.activePage) {
      return this.activePage;
    }
    const pages = await browser.context.pages();
    let fallback: Page | undefined;
    for (const candidate of pages) {
      const url = await candidate.url();
      if (url.includes("immobilienscout24.de")) {
        this.activePage = candidate;
        await browser.context.setActivePage(candidate);
        return candidate;
      }
      fallback ??= candidate;
    }
    const page = fallback ?? (await browser.context.newPage());
    this.activePage = page;
    await browser.context.setActivePage(page);
    return page;
  }

  private async connectedStagehand(): Promise<Stagehand> {
    return (await this.ensureConnected()).stagehand;
  }

  private async ensureConnected(): Promise<{ stagehand: Stagehand; browser: StagehandBrowser }> {
    if (this.stagehand && this.browser) {
      return { stagehand: this.stagehand, browser: this.browser };
    }
    await this.assertReachable();
    quietKnownCdpRaces();
    const browser = await localBrowser.connect({ cdpUrl: this.options.cdpUrl });
    const stagehand = await Stagehand.create({
      browser,
      cache: false,
      selfHeal: false,
      logging: { level: "warn" },
      model: {
        modelName: googleModel(this.options.modelName),
        apiKey: this.options.apiKey,
      },
    });
    this.browser = browser;
    this.stagehand = stagehand;
    return { stagehand, browser };
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof CDPConnectionClosedError) {
        await this.disconnect();
      }
      throw error;
    }
  }

  private async asStepFailure(step: AgentStep, error: unknown): Promise<StepFailure> {
    if (error instanceof StepFailure || error instanceof CaptchaEncountered) {
      return error as StepFailure;
    }
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : "Error";
    const classified = /intercept|not clickable/i.test(message)
      ? "ElementClickIntercepted"
      : /timeout|waiting for/i.test(`${name}\n${message}`)
        ? "TimeoutError"
        : name;
    let domSnippet = "";
    try {
      domSnippet = await this.domSnippet(await this.page());
    } catch {
      domSnippet = "";
    }
    return new StepFailure(step, message, { name: classified, domSnippet, cause: error });
  }

  private async domSnippet(page: Page): Promise<string> {
    try {
      const text = await page.locator("body").innerText({ timeout: 1000 });
      return text.slice(0, 2000);
    } catch {
      return "";
    }
  }
}

function asFillReport(result: FormPageResult): FormFillReport {
  if (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    "unfilledRequired" in result &&
    "needsPetWait" in result &&
    "needsMoveInHold" in result &&
    "moveInStable" in result
  ) {
    return result;
  }
  throw new Error("Form fill did not report required fields");
}

interface RawSearchCard {
  scoutId: string;
  text: string;
  imageUrl: string;
}

function evaluateOnPage<R>(page: Page, fn: () => R): Promise<R> {
  return evaluateWithArg(page, fn, undefined);
}

function evaluateWithArg<A, R>(page: Page, fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> {
  // tsx keeps function names by calling a `__name` helper that does not exist in the page.
  const payload = arg === undefined ? "" : JSON.stringify(arg);
  const expression = `(() => { const __name = (target) => target; return (${fn.toString()})(${payload}); })()`;
  return page.evaluate(expression);
}

function clickCss(page: Page, selector: string): Promise<boolean> {
  return clickCssAt(page, selector, 0);
}

function clickCssAt(page: Page, selector: string, index: number): Promise<boolean> {
  return evaluateWithArg(
    page,
    (arg: { sel: string; index: number }) => {
      const nodes = Array.from(document.querySelectorAll(arg.sel)).filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width >= 8 && rect.height >= 8;
      });
      nodes.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
      const target = nodes[arg.index];
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      target.scrollIntoView({ block: "center" });
      target.click();
      return true;
    },
    { sel: selector, index },
  );
}

let cdpRacesQuieted = false;

function quietKnownCdpRaces(): void {
  if (cdpRacesQuieted) {
    return;
  }
  cdpRacesQuieted = true;
  const stderr = process.stderr;
  const write = stderr.write.bind(stderr);
  stderr.write = ((chunk: string | Uint8Array, encoding?: unknown, callback?: (error?: Error | null) => void) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (isVanishedFrameRace(text)) {
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
      return true;
    }
    if (typeof encoding === "function") {
      return write(chunk, encoding as (error?: Error | null) => void);
    }
    return write(chunk, encoding as BufferEncoding, callback);
  }) as typeof stderr.write;
}

function isVanishedFrameRace(text: string): boolean {
  if (!text.includes("CDP response failed")) {
    return false;
  }
  return (
    (text.includes("DOM.getFrameOwner") && text.includes("Frame with the given id was not found")) ||
    (text.includes("Page.getFrameTree") && text.includes("Session with given id not found"))
  );
}

function toObserved(action: Action, instruction: string): ObservedAction {
  return {
    instruction,
    selector: action.selector,
    method: normalizeMethod(action.method),
  };
}

function normalizeMethod(method: string | undefined): ActionMethod {
  if (method === "fill" || method === "type") return "fill";
  if (method === "selectOption" || method === "select") return "selectOption";
  return "click";
}

function isMessageAction(action: { selector: string; description: string }): boolean {
  return /textarea|message|nachricht/i.test(`${action.selector} ${action.description}`);
}

function googleModel(modelName: string): `google/${string}` {
  if (!modelName.startsWith("google/")) {
    throw new Error("MODEL_NAME must start with google/");
  }
  return modelName as `google/${string}`;
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function plausibleRooms(value: number | null | undefined): number | null {
  if (value === null || value === undefined || value <= 0 || value > 20) {
    return null;
  }
  return value;
}
