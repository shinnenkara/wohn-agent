import type { ContactCandidate } from "../../domain/contact-name.js";
import type { OpenerCandidate } from "./contact-opener.js";
import type { NamedFillPlan } from "./named-fields.js";

export type FormPageCommand =
  | { op: "contact-candidates" }
  | { op: "list-openers" }
  | { op: "click-opener"; index: number }
  | { op: "has-message" }
  | { op: "fill-message"; text: string }
  | { op: "submit-selector" }
  | { op: "click-submit" }
  | { op: "fill"; plan: NamedFillPlan }
  | { op: "pets"; plan: NamedFillPlan }
  | { op: "move-in"; plan: NamedFillPlan }
  | { op: "unfilled-required" };

export interface FormFillReport {
  unfilledRequired: boolean;
  needsPetWait: boolean;
  needsMoveInHold: boolean;
  moveInStable: boolean;
}

export type FormPageResult = ContactCandidate[] | OpenerCandidate[] | string | boolean | FormFillReport;

export function runFormPage(command: FormPageCommand): FormPageResult {
  const SKIP_NAMES = new Set(["sendUserProfile", "followAnAgent"]);

  function emptyReport(patch: Partial<FormFillReport> = {}): FormFillReport {
    return {
      unfilledRequired: false,
      needsPetWait: false,
      needsMoveInHold: false,
      moveInStable: false,
      ...patch,
    };
  }

  function queryAllDeep(node: ParentNode, selector: string): Element[] {
    const out: Element[] = [];
    const walk = (current: ParentNode | null) => {
      if (!current || !current.querySelectorAll) {
        return;
      }
      out.push(...Array.from(current.querySelectorAll(selector)));
      for (const el of Array.from(current.querySelectorAll("*"))) {
        if (el.shadowRoot) {
          walk(el.shadowRoot);
        }
      }
    };
    walk(node);
    return out;
  }

  function visible(el: Element | null): boolean {
    if (!el || el.closest("[data-immo-ext]")) {
      return false;
    }
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return el.getClientRects().length > 0;
  }

  function normalizedText(el: Element): string {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function hasControls(el: Element): boolean {
    return Boolean(el.querySelector("button, a, svg"));
  }

  function labelText(el: Element): string {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) {
        return label.textContent || "";
      }
    }
    const parent = el.closest("label");
    if (parent) {
      return parent.textContent || "";
    }
    return el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
  }

  function fieldBlob(el: Element): string {
    return [el.getAttribute("name"), el.id, el.getAttribute("autocomplete"), el.getAttribute("placeholder"), el.getAttribute("aria-label"), labelText(el)]
      .filter(Boolean)
      .join(" ");
  }

  function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
    const view = el.ownerDocument.defaultView;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const desc = view ? Object.getOwnPropertyDescriptor(proto, "value") : undefined;
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isEmpty(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
    return !String(el.value || "").trim();
  }

  function editable(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      return false;
    }
    return !el.disabled && !SKIP_NAMES.has(el.name) && el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio" && el.type !== "submit";
  }

  function findMessageField(): Element | null {
    const areas = queryAllDeep(document, "textarea").filter(visible);
    const labeled = areas.find((el) => /nachricht|message|anmerkung|mitteilung/i.test(fieldBlob(el)));
    if (labeled) {
      return labeled;
    }
    if (areas.length === 1) {
      return areas[0] ?? null;
    }
    const inputs = queryAllDeep(document, "input").filter((el) => visible(el) && /nachricht|message/i.test(fieldBlob(el)));
    return inputs[0] ?? null;
  }

  function findNamed(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
    const found = queryAllDeep(document, `[name="${CSS.escape(name)}"], #${CSS.escape(name)}`).find((el) => {
      return visible(el) && editable(el) && !SKIP_NAMES.has((el as HTMLInputElement).name);
    });
    return found && editable(found) ? found : null;
  }

  function fillNamedSelect(name: string, value: string): void {
    if (!value) {
      return;
    }
    const el = findNamed(name);
    if (!el || el.tagName !== "SELECT" || !isEmpty(el)) {
      return;
    }
    const select = el as HTMLSelectElement;
    const option = Array.from(select.options).find((item) => item.value === value);
    if (option) {
      setNativeValue(select, option.value);
    }
  }

  function forceNamedSelect(name: string, value: string): boolean {
    if (!value) {
      return false;
    }
    const el = findNamed(name);
    if (!el || el.tagName !== "SELECT") {
      return false;
    }
    const select = el as HTMLSelectElement;
    if (select.value === value) {
      return true;
    }
    const option = Array.from(select.options).find((item) => item.value === value);
    if (!option) {
      return false;
    }
    setNativeValue(select, option.value);
    return select.value === value;
  }

  function findMoveInDate(): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
    const found = queryAllDeep(document, "#moveInDate, [name='moveInDate'], [data-testid='moveInDate'] input").find((el) => {
      return visible(el) && editable(el);
    });
    return found && editable(found) ? found : null;
  }

  function forceMoveInDate(value: string): boolean {
    if (!value) {
      return false;
    }
    const date = findMoveInDate();
    if (!date) {
      return false;
    }
    if (date.value === value) {
      return true;
    }
    setNativeValue(date, value);
    return date.value === value;
  }

  function fillNamedInput(name: string, value: string): void {
    if (!value) {
      return;
    }
    const el = findNamed(name);
    if (el && el.tagName !== "SELECT" && isEmpty(el)) {
      setNativeValue(el, value);
    }
  }

  function findPetDetails(): HTMLInputElement | HTMLTextAreaElement | null {
    const found = queryAllDeep(document, "input, textarea").find((el) => {
      if (!visible(el) || !editable(el)) {
        return false;
      }
      if (/moveInDate|numberOfAdults|numberOfKids|incomeAmount|firstName|lastName|email|phone|street|house|postcode|city/i.test(`${el.getAttribute("name") || ""} ${el.id}`)) {
        return false;
      }
      return /anzahl|tierart|haustier/i.test(fieldBlob(el));
    });
    if (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement) {
      return found;
    }
    return null;
  }

  function leftoverRequired(): boolean {
    const messageEl = findMessageField();
    const controls = queryAllDeep(document, "input, select, textarea").filter((el) => visible(el));
    return controls.some((el) => {
      if (el === messageEl || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        return false;
      }
      if (el.disabled || SKIP_NAMES.has(el.name) || el.type === "hidden" || el.type === "submit") {
        return false;
      }
      const required = el.required || el.getAttribute("aria-required") === "true";
      if (!required) {
        return false;
      }
      if (el.type === "file") {
        return true;
      }
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        if (el.type === "checkbox") {
          return !el.checked;
        }
        const group = queryAllDeep(document, "input[type='radio']").filter((node) => node.getAttribute("name") === el.name);
        return !group.some((node) => node instanceof HTMLInputElement && node.checked);
      }
      return isEmpty(el);
    });
  }

  function contactCandidates(): ContactCandidate[] {
    const out: ContactCandidate[] = [];
    for (const el of queryAllDeep(document, "[data-qa='contactName'], [data-qa='contact-name']")) {
      if (!visible(el)) {
        continue;
      }
      out.push({ text: normalizedText(el), named: true, hasControls: hasControls(el) });
    }
    const scopes = queryAllDeep(document, "[data-qa*='contact' i], [data-qa*='realtor' i], [data-qa*='anbieter' i], [class*='contact' i], [class*='Contact']");
    const roots: ParentNode[] = scopes.length > 0 ? scopes : [document.body ?? document];
    for (const scope of roots) {
      for (const el of queryAllDeep(scope, "h1, h2, h3, h4, p, span, li, dd, strong, div")) {
        if (el.closest("[data-immo-ext]")) {
          continue;
        }
        const text = normalizedText(el);
        if (!text || text.length > 80 || !visible(el)) {
          continue;
        }
        out.push({ text, named: false, hasControls: hasControls(el) });
        if (out.length >= 2000) {
          return out;
        }
      }
    }
    return out;
  }

  function submitLabel(el: Element): string {
    const raw = el instanceof HTMLInputElement ? el.value : el instanceof HTMLElement ? el.innerText : el.textContent || "";
    return raw.replace(/\s+/g, " ").trim();
  }

  function isSubmitButton(el: Element): boolean {
    const text = submitLabel(el);
    return text.length > 0 && text.length <= 80 && /anfrage\s+senden|nachricht\s+senden|\babsenden\b|^senden$|^abschicken$/i.test(text);
  }

  function findSubmitButton(): HTMLElement | null {
    const message = findMessageField();
    const root = message?.closest("form") ?? document;
    const buttons = queryAllDeep(root, "button, input[type='submit']").filter((el) => visible(el) && isSubmitButton(el));
    const match = buttons[0];
    return match instanceof HTMLElement ? match : null;
  }

  function fillMessage(text: string): boolean {
    const field = findMessageField();
    if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) {
      return false;
    }
    setNativeValue(field, text);
    return field.value === text;
  }

  function openerElements(): Element[] {
    return queryAllDeep(document, "button, a, [role='button']").filter((el) => {
      if (!visible(el)) {
        return false;
      }
      const text = (el instanceof HTMLElement ? el.innerText : el.textContent || "").replace(/\s+/g, " ").trim();
      return text.length > 0 && text.length <= 80;
    });
  }

  function openerRecords(elements: readonly Element[]): OpenerCandidate[] {
    return elements.map((el) => ({
      text: (el instanceof HTMLElement ? el.innerText : el.textContent || "").replace(/\s+/g, " ").trim(),
      tag: el.tagName,
      role: el.getAttribute("role") || "",
      hint: `${el.getAttribute("data-qa") || ""} ${el.getAttribute("class") || ""}`,
      href: el.getAttribute("href") || "",
      type: el.getAttribute("type") || "",
    }));
  }

  function stableSelector(el: Element): string {
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }
    for (const attr of ["data-testid", "data-qa"]) {
      const value = el.getAttribute(attr);
      if (value) {
        return `[${attr}="${CSS.escape(value)}"]`;
      }
    }
    const token = `opener-${Date.now()}`;
    el.setAttribute("data-wohn-opener", token);
    return `[data-wohn-opener="${CSS.escape(token)}"]`;
  }

  function fillEmptyFields(plan: NamedFillPlan): void {
    const controls = queryAllDeep(document, "input, select, textarea").filter((el) => visible(el) && editable(el));
    for (const spec of plan.labelFills) {
      if (!spec.value) {
        continue;
      }
      const pattern = new RegExp(spec.pattern, "i");
      const el = controls.find((candidate) => pattern.test(fieldBlob(candidate)));
      if (el && editable(el) && isEmpty(el)) {
        setNativeValue(el, spec.value);
      }
    }
    if (!plan.salutationLabel) {
      return;
    }
    const salutation = controls.find((el) => el.tagName === "SELECT" && /anrede|salutation/i.test(fieldBlob(el)));
    if (!salutation || !editable(salutation) || salutation.tagName !== "SELECT" || !isEmpty(salutation)) {
      return;
    }
    const select = salutation as HTMLSelectElement;
    const option = Array.from(select.options).find((item) => {
      return item.text.trim() === plan.salutationLabel || item.value === plan.salutationLabel || item.value === plan.salutationValue;
    });
    if (option) {
      setNativeValue(select, option.value);
    }
  }

  function fillPets(plan: NamedFillPlan): boolean {
    if (plan.hasPets !== "TRUE") {
      return false;
    }
    const pets = findPetDetails();
    if (pets && isEmpty(pets) && plan.petDetails) {
      setNativeValue(pets, plan.petDetails);
    }
    return !pets || (!!plan.petDetails && isEmpty(pets));
  }

  function moveInStable(plan: NamedFillPlan): boolean {
    if (!plan.moveInDateType) {
      return false;
    }
    const wantsDate = plan.moveInDateType === "CONCRETE";
    const typeOk = forceNamedSelect("moveInDateType", plan.moveInDateType);
    const dateOk = !wantsDate || forceMoveInDate(plan.moveInDate);
    return typeOk && dateOk;
  }

  function fillPlan(plan: NamedFillPlan): FormFillReport {
    fillEmptyFields(plan);
    const needsMoveInHold = Boolean(plan.moveInDateType && findNamed("moveInDateType"));
    if (needsMoveInHold) {
      moveInStable(plan);
    }
    for (const spec of plan.selects) {
      if (spec.name === "applicationPackageCompleted") {
        forceNamedSelect(spec.name, spec.value);
      } else {
        fillNamedSelect(spec.name, spec.value);
      }
    }
    const needsPetWait = fillPets(plan);
    for (const spec of plan.inputs) {
      fillNamedInput(spec.name, spec.value);
    }
    return emptyReport({
      unfilledRequired: leftoverRequired(),
      needsPetWait,
      needsMoveInHold,
      moveInStable: needsMoveInHold && moveInStable(plan),
    });
  }

  if (command.op === "contact-candidates") {
    return contactCandidates();
  }
  if (command.op === "has-message") {
    return findMessageField() !== null;
  }
  if (command.op === "fill-message") {
    return fillMessage(command.text);
  }
  if (command.op === "submit-selector") {
    const button = findSubmitButton();
    return button ? stableSelector(button) : "";
  }
  if (command.op === "click-submit") {
    const button = findSubmitButton();
    if (!button) {
      return false;
    }
    button.click();
    return true;
  }
  if (command.op === "list-openers") {
    return openerRecords(openerElements());
  }
  if (command.op === "click-opener") {
    const elements = openerElements();
    const el = elements[command.index];
    if (!(el instanceof HTMLElement)) {
      return "";
    }
    el.click();
    return stableSelector(el);
  }
  if (command.op === "fill") {
    return fillPlan(command.plan);
  }
  if (command.op === "pets") {
    return emptyReport({ needsPetWait: fillPets(command.plan) });
  }
  if (command.op === "move-in") {
    return emptyReport({ moveInStable: moveInStable(command.plan) });
  }
  return emptyReport({ unfilledRequired: leftoverRequired() });
}
