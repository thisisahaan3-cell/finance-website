/** Contextual learning notes shown under each tool. Filled in below. */
export interface Explanation {
  what: string;
  why: string;
  read: string;
  formula?: string;
  example?: string;
  mistakes: string[];
  limits: string[];
}

export const EXPLAIN: Record<string, Explanation> = {};
