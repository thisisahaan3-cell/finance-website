export type Block = { h: string } | { p: string } | { ul: string[] } | { formula: string } | { callout: string } | { table: string[][] };
export interface Lesson {
  id: string;
  module: string;
  title: string;
  minutes: number;
  summary: string;
  body: Block[];
  /** tool ids to try after reading */
  tools?: string[];
}
export const MODULES: { id: string; title: string; blurb: string }[] = [];
export const LESSONS: Lesson[] = [];
