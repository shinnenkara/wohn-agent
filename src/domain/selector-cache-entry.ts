export const ACTION_METHODS = ["click", "fill", "selectOption"] as const;

export type ActionMethod = (typeof ACTION_METHODS)[number];

export function isActionMethod(value: string): value is ActionMethod {
  return (ACTION_METHODS as readonly string[]).includes(value);
}

export interface SelectorCacheEntry {
  actionKey: string;
  instruction: string;
  selector: string;
  method: ActionMethod;
  failCount: number;
  updatedAt: Date;
}
