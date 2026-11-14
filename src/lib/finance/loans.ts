/**
 * Loans: EMI, amortisation schedules, prepayments and moratoriums (education loans).
 * Uses the reducing-balance method with monthly rests, the standard for Indian retail loans.
 */
import { FinanceError } from './tvm';

/** Equated monthly instalment. Rate is annual (decimal); interest is charged monthly at rate/12. */
export function emi(principal: number, annualRate: number, months: number): number {
  if (!(principal >= 0) || !(months > 0) || !(annualRate >= 0)) throw new FinanceError('Enter a loan amount, an interest rate of zero or more, and a tenure above zero.');
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  const k = Math.pow(1 + r, months);
  return (principal * r * k) / (k - 1);
}

/** Largest loan a given EMI can service. */
export function loanFromEmi(emiAmount: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  if (r === 0) return emiAmount * months;
  const k = Math.pow(1 + r, months);
  return (emiAmount * (k - 1)) / (r * k);
}

export interface Prepayment {
  /** month number (1 = first EMI month) in which the extra payment is made */
  month: number;
  amount: number;
}

export interface LoanInput {
  principal: number;
  annualRate: number;
  months: number;
  /** extra amount paid every month on top of the EMI */
  extraMonthly?: number;
  /** one-off part prepayments */
  prepayments?: Prepayment[];
  /** after a prepayment: keep the EMI and finish sooner (default), or keep the tenure and lower the EMI */
  prepayMode?: 'reduce-tenure' | 'reduce-emi';
  /** months before EMIs start (study period + grace) */
  moratoriumMonths?: number;
  /** during the moratorium: 'accrue' adds simple interest to the loan, 'pay' services interest monthly */
  moratoriumInterest?: 'accrue' | 'pay';
}

export interface LoanRow {
  month: number;
  opening: number;
  payment: number;
  interest: number;
  principal: number;
  prepayment: number;
  closing: number;
}

export interface LoanResult {
  emi: number;
  /** principal after any moratorium interest has been added */
  principalAtStart: number;
  totalInterest: number;
  totalPaid: number;
  monthsTaken: number;
  schedule: LoanRow[];
  yearly: { year: number; interest: number; principal: number; closing: number }[];
}

export function amortise(input: LoanInput): LoanResult {
  const { principal, annualRate, months } = input;
  if (!(principal > 0) || !(months > 0) || !(annualRate >= 0)) throw new FinanceError('Enter a loan amount and tenure above zero, and a rate of zero or more.');
  const r = annualRate / 12;
  const extra = Math.max(0, input.extraMonthly ?? 0);
  const mode = input.prepayMode ?? 'reduce-tenure';
  const mora = Math.max(0, Math.round(input.moratoriumMonths ?? 0));
  const prepay = new Map<number, number>();
  for (const p of input.prepayments ?? []) if (p.amount > 0 && p.month >= 1) prepay.set(Math.round(p.month), (prepay.get(Math.round(p.month)) ?? 0) + p.amount);

  const schedule: LoanRow[] = [];
  let balance = principal;
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  // Moratorium: Indian banks charge simple interest in this period and add it to the loan when repayment starts.
  if (mora > 0) {
    const mode2 = input.moratoriumInterest ?? 'accrue';
    let accrued = 0;
    for (let i = 0; i < mora; i++) {
      month++;
      const interest = principal * r;
      if (mode2 === 'pay') {
        schedule.push({ month, opening: balance, payment: interest, interest, principal: 0, prepayment: 0, closing: balance });
        totalPaid += interest;
      } else {
        accrued += interest;
        schedule.push({ month, opening: principal + accrued - interest, payment: 0, interest, principal: 0, prepayment: 0, closing: principal + accrued });
      }
      totalInterest += interest;
    }
    balance = principal + accrued;
  }

  const principalAtStart = balance;
  let instalment = emi(balance, annualRate, months);
  const firstEmi = instalment;
  let remaining = months;
  const cap = months + mora + 1200; // hard stop; a valid loan never needs it
  while (balance > 0.005 && month < cap) {
    month++;
    const emiMonth = month - mora;
    const opening = balance;
    const interest = opening * r;
    let pay = Math.min(instalment + extra, opening + interest);
    let principalPart = pay - interest;
    let pre = Math.min(prepay.get(emiMonth) ?? 0, opening - principalPart);
    if (pre < 0) pre = 0;
    balance = opening - principalPart - pre;
    if (balance < 0.005) balance = 0;
    totalInterest += interest;
    totalPaid += pay + pre;
    schedule.push({ month, opening, payment: pay, interest, principal: principalPart, prepayment: pre, closing: balance });
    remaining--;
    if (pre > 0 && mode === 'reduce-emi' && balance > 0 && remaining > 0) instalment = emi(balance, annualRate, remaining);
    if (remaining <= 0 && balance > 0.005 && mode === 'reduce-emi') remaining = 1; // rounding tail
  }

  const yearly: LoanResult['yearly'] = [];
  for (const row of schedule) {
    const y = Math.ceil(row.month / 12);
    const bucket = (yearly[y - 1] ??= { year: y, interest: 0, principal: 0, closing: 0 });
    bucket.interest += row.interest;
    bucket.principal += row.principal + row.prepayment;
    bucket.closing = row.closing;
  }
  return { emi: firstEmi, principalAtStart, totalInterest, totalPaid, monthsTaken: schedule.length, schedule, yearly };
}

/** Flat-rate loans quote interest on the full principal for the whole tenure; this converts to the true reducing-balance rate. */
export function flatToReducingRate(flatAnnualRate: number, months: number): number | null {
  if (!(flatAnnualRate > 0) || !(months > 0)) return null;
  const principal = 100;
  const payment = (principal + principal * flatAnnualRate * (months / 12)) / months;
  let lo = 0;
  let hi = 5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (emi(principal, mid, months) > payment) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
