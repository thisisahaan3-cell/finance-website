export interface Term {
  term: string;
  def: string;
  cat: string;
  /** path of a tool where the idea is used */
  see?: string;
}
export const GLOSSARY: Term[] = [];
