/**
 * Indian income tax for resident individuals, and capital-gains tax on listed equity.
 *
 * Rules are data, not code: each financial year is a config object, so slabs can be
 * inspected in the UI and updated in one place. Sources: Finance Act 2024 (FY 2024-25),
 * Finance Act 2025 (FY 2025-26), Budget 2026 (FY 2026-27, slabs and equity capital-gains
 * rates left unchanged). This is an estimate for learning and planning, not tax advice.
 */

export type RegimeId = 'new' | 'old';
export type AgeBand = 'below60' | '60to79' | '80plus';

export interface Slab {
  /** upper limit of the slab in rupees (Infinity for the last) */
  upTo: number;
  rate: number;
}

export interface RegimeRules {
  slabs: Slab[];
  standardDeduction: number;
  /** full rebate (section 87A) when taxable income is at or below this */
  rebateIncomeLimit: number;
  rebateMax: number;
  /** new regime only: just above the limit, tax cannot exceed the income above the limit */
  rebateMarginalRelief: boolean;
  /** [income above, surcharge rate] in ascending order */
  surcharge: [number, number][];
}

export interface TaxYear {
  id: string;
  label: string;
  assessmentYear: string;
  note: string;
  cess: number;
  newRegime: RegimeRules;
  oldRegime: Record<AgeBand, RegimeRules>;
}

const L = 100_000;
const CR = 10_000_000;

const oldSlabs = (exempt: number): Slab[] =>
  exempt >= 5 * L
    ? [
        { upTo: 5 * L, rate: 0 },
        { upTo: 10 * L, rate: 0.2 },
        { upTo: Infinity, rate: 0.3 },
      ]
    : [
        { upTo: exempt, rate: 0 },
        { upTo: 5 * L, rate: 0.05 },
        { upTo: 10 * L, rate: 0.2 },
        { upTo: Infinity, rate: 0.3 },
      ];

const oldRegime = (exempt: number): RegimeRules => ({
  slabs: oldSlabs(exempt),
  standardDeduction: 50_000,
  rebateIncomeLimit: 5 * L,
  rebateMax: 12_500,
  rebateMarginalRelief: false,
  surcharge: [
    [50 * L, 0.1],
    [1 * CR, 0.15],
    [2 * CR, 0.25],
    [5 * CR, 0.37],
  ],
});

const OLD: Record<AgeBand, RegimeRules> = {
  below60: oldRegime(2.5 * L),
  '60to79': oldRegime(3 * L),
  '80plus': oldRegime(5 * L),
};

const NEW_SURCHARGE: [number, number][] = [
  [50 * L, 0.1],
  [1 * CR, 0.15],
  [2 * CR, 0.25],
];

const NEW_2025: RegimeRules = {
  slabs: [
    { upTo: 4 * L, rate: 0 },
    { upTo: 8 * L, rate: 0.05 },
    { upTo: 12 * L, rate: 0.1 },
    { upTo: 16 * L, rate: 0.15 },
    { upTo: 20 * L, rate: 0.2 },
    { upTo: 24 * L, rate: 0.25 },
    { upTo: Infinity, rate: 0.3 },
  ],
  standardDeduction: 75_000,
  rebateIncomeLimit: 12 * L,
  rebateMax: 60_000,
  rebateMarginalRelief: true,
  surcharge: NEW_SURCHARGE,
};

export const TAX_YEARS: TaxYear[] = [
  {
    id: '2026-27',
    label: 'FY 2026-27',
    assessmentYear: 'Tax year 2026-27 (Income-tax Act, 2025)',
    note: 'Budget 2026 left the slabs, rebate and standard deduction unchanged from FY 2025-26. The Income-tax Act, 2025 applies from 1 April 2026 and renumbers the sections, but the calculation is the same.',
    cess: 0.04,
    newRegime: NEW_2025,
    oldRegime: OLD,
  },
  {
    id: '2025-26',
    label: 'FY 2025-26',
    assessmentYear: 'AY 2026-27',
    note: 'Finance Act 2025: new-regime slabs widened and no tax up to ₹12 lakh of taxable income (₹12.75 lakh of salary after the standard deduction).',
    cess: 0.04,
    newRegime: NEW_2025,
    oldRegime: OLD,
  },
  {
    id: '2024-25',
    label: 'FY 2024-25',
    assessmentYear: 'AY 2025-26',
    note: 'Finance (No. 2) Act 2024: standard deduction in the new regime raised to ₹75,000; no tax up to ₹7 lakh of taxable income.',
    cess: 0.04,
    newRegime: {
      slabs: [
        { upTo: 3 * L, rate: 0 },
        { upTo: 7 * L, rate: 0.05 },
        { upTo: 10 * L, rate: 0.1 },
        { upTo: 12 * L, rate: 0.15 },
        { upTo: 15 * L, rate: 0.2 },
        { upTo: Infinity, rate: 0.3 },
      ],
      standardDeduction: 75_000,
      rebateIncomeLimit: 7 * L,
      rebateMax: 25_000,
      rebateMarginalRelief: true,
      surcharge: NEW_SURCHARGE,
    },
    oldRegime: OLD,
  },
];

/** Deductions the old regime allows, with their statutory caps. */
export interface OldRegimeDeductions {
  /** 80C: EPF, PPF, ELSS, life insurance, principal on home loan… (cap ₹1.5 lakh) */
  sec80C?: number;
  /** 80CCD(1B): own NPS contribution (cap ₹50,000) */
  nps80CCD1B?: number;
  /** 80D: health insurance for self and family */
  healthSelf?: number;
  /** 80D: health insurance for parents */
  healthParents?: number;
  parentsSenior?: boolean;
  /** exempt house rent allowance, as computed by the employer */
  hraExempt?: number;
  /** 24(b): interest on a self-occupied home loan (cap ₹2 lakh) */
  homeLoanInterest?: number;
  /** 80TTA / 80TTB: savings (or, for seniors, deposit) interest */
  savingsInterest?: number;
  /** any other deduction or exemption */
  other?: number;
}

export interface TaxInput {
  yearId: string;
  age: AgeBand;
  /** gross salary or pension for the year */
  salary: number;
  /** interest, rent, business and other income taxed at slab rates */
  otherIncome: number;
  /** employer's NPS contribution, 80CCD(2): allowed in both regimes */
  employerNps?: number;
  deductions?: OldRegimeDeductions;
}

export interface SlabLine {
  from: number;
  to: number;
  rate: number;
  amount: number;
  tax: number;
}

export interface RegimeTax {
  regime: RegimeId;
  grossIncome: number;
  deductions: { label: string; amount: number }[];
  totalDeductions: number;
  taxableIncome: number;
  slabLines: SlabLine[];
  taxBeforeRebate: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  /** total tax ÷ gross income */
  effectiveRate: number;
  /** tax on the next rupee of income, including cess (ignores surcharge cliffs) */
  marginalRate: number;
  monthlyTakeHome: number;
}

export function slabTax(income: number, slabs: Slab[]): { tax: number; lines: SlabLine[] } {
  let prev = 0;
  let tax = 0;
  const lines: SlabLine[] = [];
  for (const s of slabs) {
    const amount = Math.max(0, Math.min(income, s.upTo) - prev);
    const t = amount * s.rate;
    lines.push({ from: prev, to: s.upTo, rate: s.rate, amount, tax: t });
    tax += t;
    prev = s.upTo;
    if (income <= s.upTo) break;
  }
  return { tax, lines };
}

/** Tax after the 87A rebate (with marginal relief where the regime has it), before surcharge and cess. */
function taxAfterRebate(income: number, rules: RegimeRules): { before: number; rebate: number; lines: SlabLine[] } {
  const { tax, lines } = slabTax(income, rules.slabs);
  let rebate = 0;
  if (income <= rules.rebateIncomeLimit) rebate = Math.min(tax, rules.rebateMax);
  else if (rules.rebateMarginalRelief) {
    const excess = income - rules.rebateIncomeLimit;
    if (tax > excess) rebate = tax - excess;
  }
  return { before: tax, rebate, lines };
}

/** Surcharge with marginal relief: crossing a threshold cannot cost more than the income above it. */
function surchargeOn(income: number, rules: RegimeRules): number {
  const base = taxAfterRebate(income, rules);
  const tax = base.before - base.rebate;
  let rate = 0;
  let threshold = 0;
  for (const [above, r] of rules.surcharge) {
    if (income > above) {
      rate = r;
      threshold = above;
    }
  }
  if (rate === 0) return 0;
  const full = tax * rate;
  // tax (with any lower surcharge) payable exactly at the threshold
  const atT = taxAfterRebate(threshold, rules);
  const taxAtT = atT.before - atT.rebate;
  let lowerRate = 0;
  for (const [above, r] of rules.surcharge) if (threshold > above) lowerRate = r;
  const cap = taxAtT * (1 + lowerRate) + (income - threshold);
  return Math.max(0, Math.min(full, cap - tax));
}

function capped(v: number | undefined, cap: number): number {
  return Math.max(0, Math.min(v ?? 0, cap));
}

export function computeRegime(input: TaxInput, regime: RegimeId): RegimeTax {
  const year = TAX_YEARS.find((y) => y.id === input.yearId);
  if (!year) throw new Error('Unknown financial year');
  const rules = regime === 'new' ? year.newRegime : year.oldRegime[input.age];
  const salary = Math.max(0, input.salary || 0);
  const other = Math.max(0, input.otherIncome || 0);
  const gross = salary + other;
  const list: { label: string; amount: number }[] = [];
  const add = (label: string, amount: number) => {
    if (amount > 0) list.push({ label, amount });
  };
  add('Standard deduction', Math.min(rules.standardDeduction, salary));
  add("Employer's NPS contribution, 80CCD(2)", Math.max(0, input.employerNps ?? 0));
  if (regime === 'old') {
    const d = input.deductions ?? {};
    const senior = input.age !== 'below60';
    add('Section 80C', capped(d.sec80C, 150_000));
    add('NPS, 80CCD(1B)', capped(d.nps80CCD1B, 50_000));
    add('Health insurance, 80D (self and family)', capped(d.healthSelf, senior ? 50_000 : 25_000));
    add('Health insurance, 80D (parents)', capped(d.healthParents, d.parentsSenior ? 50_000 : 25_000));
    add('HRA exemption', Math.max(0, d.hraExempt ?? 0));
    add('Home-loan interest, 24(b)', capped(d.homeLoanInterest, 200_000));
    add(senior ? 'Deposit interest, 80TTB' : 'Savings interest, 80TTA', capped(d.savingsInterest, senior ? 50_000 : 10_000));
    add('Other deductions', Math.max(0, d.other ?? 0));
  }
  const totalDeductions = Math.min(gross, list.reduce((s, x) => s + x.amount, 0));
  const taxable = Math.max(0, gross - totalDeductions);
  const base = taxAfterRebate(taxable, rules);
  const afterRebate = base.before - base.rebate;
  const surcharge = surchargeOn(taxable, rules);
  const cess = (afterRebate + surcharge) * year.cess;
  const totalTax = afterRebate + surcharge + cess;
  const slabRate = rules.slabs.find((s) => taxable < s.upTo)?.rate ?? rules.slabs[rules.slabs.length - 1].rate;
  return {
    regime,
    grossIncome: gross,
    deductions: list,
    totalDeductions,
    taxableIncome: taxable,
    slabLines: base.lines,
    taxBeforeRebate: base.before,
    rebate: base.rebate,
    surcharge,
    cess,
    totalTax,
    effectiveRate: gross > 0 ? totalTax / gross : 0,
    marginalRate: afterRebate > 0 || taxable > rules.rebateIncomeLimit ? slabRate * (1 + year.cess) : 0,
    monthlyTakeHome: (gross - totalTax) / 12,
  };
}

export function compareRegimes(input: TaxInput): { newRegime: RegimeTax; oldRegime: RegimeTax; better: RegimeId; saving: number } {
  const n = computeRegime(input, 'new');
  const o = computeRegime(input, 'old');
  return { newRegime: n, oldRegime: o, better: n.totalTax <= o.totalTax ? 'new' : 'old', saving: Math.abs(n.totalTax - o.totalTax) };
}

/* ---------- capital gains on listed equity shares and equity mutual funds ---------- */

export interface EquityCgRules {
  /** short-term rate: held 12 months or less (section 111A) */
  stcgRate: number;
  /** long-term rate: held more than 12 months (section 112A) */
  ltcgRate: number;
  /** long-term gains exempt each financial year */
  ltcgExemption: number;
  cess: number;
  holdingMonths: number;
  note: string;
}

/** Applies to sales on or after 23 July 2024 where securities transaction tax was paid. */
export const EQUITY_CG: EquityCgRules = {
  stcgRate: 0.2,
  ltcgRate: 0.125,
  ltcgExemption: 125_000,
  cess: 0.04,
  holdingMonths: 12,
  note: 'Listed shares and equity funds sold on or after 23 July 2024 with STT paid: short-term gains 20%, long-term gains 12.5% above ₹1.25 lakh a year, plus 4% cess. Budget 2026 kept these rates for FY 2026-27. Surcharge (if your income is above ₹50 lakh) is not included.',
};

export interface EquityCgResult {
  stcgTax: number;
  ltcgTaxable: number;
  ltcgTax: number;
  cess: number;
  total: number;
}

/**
 * Tax on equity capital gains for one financial year. Losses are set off the way the law allows:
 * a short-term loss reduces long-term gains too, a long-term loss reduces only long-term gains.
 */
export function equityCapitalGainsTax(stcg: number, ltcg: number, rules: EquityCgRules = EQUITY_CG): EquityCgResult {
  let st = stcg;
  let lt = ltcg;
  if (st < 0 && lt > 0) {
    const used = Math.min(-st, lt);
    lt -= used;
    st += used;
  }
  const stTaxable = Math.max(0, st);
  const ltTaxable = Math.max(0, lt - rules.ltcgExemption);
  const stcgTax = stTaxable * rules.stcgRate;
  const ltcgTax = ltTaxable * rules.ltcgRate;
  const cess = (stcgTax + ltcgTax) * rules.cess;
  return { stcgTax, ltcgTaxable: ltTaxable, ltcgTax, cess, total: stcgTax + ltcgTax + cess };
}

/** True when a lot bought on `buy` and sold on `sell` (ISO dates) counts as long-term (held more than 12 months). */
export function isLongTerm(buy: string, sell: string, months = 12): boolean {
  const b = new Date(buy + 'T00:00:00Z');
  const limit = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + months, b.getUTCDate()));
  return new Date(sell + 'T00:00:00Z').getTime() > limit.getTime();
}

/** Indian financial year label for an ISO date: 2026-05-10 → "2026-27". */
export function financialYearOf(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
