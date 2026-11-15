# Formulas and conventions

Every calculation lives in `src/lib/finance/` as a pure, typed function with no UI code. Rates are decimals (0.12 = 12%). When the maths has no answer, a function returns `null` or throws a readable error: it never returns a plausible-looking number. Unit tests are in `tests/`; the reference values they check against are listed below.

## Time value of money (`tvm.ts`)

| Quantity | Formula |
|---|---|
| CAGR | `(end / start)^(1 / years) − 1` |
| Future value | `PV × (1 + r/m)^(m × years)` |
| Real return | `(1 + nominal) / (1 + inflation) − 1` |
| SIP (start of month) | simulated month by month; closed form `P × [((1+i)^n − 1) / i] × (1+i)` |
| NPV | `Σ CFₜ / (1 + r)^t`, with `CF₀` today |
| IRR | the `r` where NPV = 0 |
| XNPV | `Σ CFᵢ / (1 + r)^((dᵢ − d₀) / 365)` (Actual/365, as in Excel) |
| XIRR | the `r` where XNPV = 0 |
| MIRR | `(FV of inflows at reinvest rate / −PV of outflows at finance rate)^(1/n) − 1` |
| Payback | first period where the cumulative (optionally discounted) cash flow turns positive, interpolated |

**Monthly rate convention.** By default the monthly rate is the yearly rate ÷ 12, the convention used by Indian SIP and loan calculators. The SIP tool can switch to the exact `(1 + r)^(1/12) − 1`.

**Root finding.** IRR and XIRR scan a grid of rates from −99% to +100,000% for a sign change, then refine with Brent's method to a tolerance of 1e-10. If the cash flows never change sign there is no rate and the tool says so; if they change sign more than once it warns that several rates may exist.

**Reference values.** Excel documentation examples: IRR 8.66% and −2.12%; XIRR 37.3363%; XNPV 2,086.6476; MIRR 12.61%.

## Loans (`loans.ts`)

`EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)` with `r` = yearly rate ÷ 12. Each month: interest = balance × r; principal = payment − interest. Prepayments either keep the EMI and shorten the loan, or keep the term and recompute the EMI. During a moratorium, simple interest accrues on the original principal and is added to the loan when repayment starts (Indian bank practice), or is paid monthly.

**Reference value.** ₹1,00,000 at 10% over 12 months gives an EMI of ₹8,791.59.

## Indian income tax (`tax.ts`)

Rules are data: one object per financial year holding the slabs, standard deduction, rebate and surcharge tiers.

| | New regime, FY 2025-26 and 2026-27 | New regime, FY 2024-25 | Old regime |
|---|---|---|---|
| Slabs | 0–4L nil, 4–8L 5%, 8–12L 10%, 12–16L 15%, 16–20L 20%, 20–24L 25%, above 30% | 0–3L nil, 3–7L 5%, 7–10L 10%, 10–12L 15%, 12–15L 20%, above 30% | 0–2.5L nil (3L aged 60–79, 5L aged 80+), to 5L 5%, 5–10L 20%, above 30% |
| Standard deduction | ₹75,000 | ₹75,000 | ₹50,000 |
| Rebate (87A) | full up to ₹12L taxable, with marginal relief | full up to ₹7L, with marginal relief | ₹12,500 up to ₹5L, no marginal relief |
| Surcharge | 10% / 15% / 25% above ₹50L / ₹1Cr / ₹2Cr | same | adds 37% above ₹5Cr |

Order of calculation: slab tax → rebate → surcharge (with marginal relief at each threshold) → 4% cess.

Equity capital gains (sales from 23 July 2024, STT paid): short-term (held ≤ 12 months) 20%; long-term 12.5% on gains above ₹1.25 lakh per year; 4% cess. A short-term loss is set off against long-term gains; a long-term loss only against long-term gains.

**Reference values.** FY 2025-26, new regime: salary ₹12.75L → nil; ₹15L → ₹97,500; ₹12.85L → ₹10,400 (marginal relief); income ₹60L → ₹15,78,720; ₹50.5L → ₹11,75,200 (surcharge marginal relief).

## Deposits and bonds (`fixedIncome.ts`)

- FD: `P × (1 + r/m)^(m × years)`, quarterly compounding by default.
- RD: each monthly instalment compounds quarterly for its remaining months, `Σ R × (1 + r/4)^((N − k) / 3)`.
- PPF: yearly deposit at the start of the year, interest credited yearly.
- Bond price: `Σ C / (1 + y)^t + F / (1 + y)^n` with `y` and `C` per coupon period. Yield to maturity by Brent's method.
- Macaulay duration: `Σ t × PV(CFₜ) / price`; modified duration: Macaulay ÷ (1 + y per period); convexity: `Σ t(t+1) PV(CFₜ) / (1+y)² / (price × f²)`.

**Reference values.** 10-year 8% annual bond at 10%: 877.1087 (875.3779 semi-annual). 3-year 10% par bond: duration 2.7355. PPF ₹1.5L a year at 7.1% for 15 years: ₹40,68,209.

## Statistics (`stats.ts`)

Sample variance and covariance (n − 1). Annualised volatility = standard deviation × √periods. Sharpe = (mean × periods − risk-free) ÷ annualised volatility. Sortino uses downside deviation against the risk-free rate. Beta and alpha from an ordinary least-squares regression of excess returns. Historical VaR is the empirical percentile; parametric VaR assumes a normal distribution; CVaR is the mean beyond VaR.

Covariance estimators: sample; Ledoit–Wolf shrinkage towards a scaled identity matrix (Ledoit and Wolf, 2004); exponentially weighted.

## Portfolio optimisation (`optimize.ts`)

Minimise `½ wᵀΣw` subject to `Σw = 1`, per-asset bounds, optional sector caps and (for a target) `μᵀw ≥ target`. Solved by the Goldfarb–Idnani dual active-set method (`quadprog`), with a tiny ridge on Σ for numerical stability.

- **Maximum Sharpe**: the Sharpe ratio is unimodal along the efficient frontier, so a golden-section search over the target return finds it; each step is one quadratic programme.
- **Efficient frontier**: minimum-variance portfolios for a grid of target returns between the minimum-variance return and the maximum feasible return.
- **Risk parity**: Spinu's convex formulation solved by cyclical coordinate descent, so every asset contributes an equal share of variance.
- **Feasibility** is checked first and reported in plain language.

Tests compare results with closed-form two- and three-asset answers and with a brute-force grid search under constraints.

## Backtesting and performance (`backtest.ts`)

Daily simulation on total-return price levels. Holdings drift with prices; on a rebalance date they are reset to target weights and a cost (basis points × value traded) is deducted. Monthly contributions are invested at target weights on the first trading day of each month. The time-weighted index excludes the effect of contributions; XIRR is computed from the actual cash flows.

CAGR uses calendar time (365.25-day years). Volatility is annualised with the number of observations per year found in the data.

## Monte Carlo (`montecarlo.ts`)

Seeded generator (mulberry32) with Box–Muller normal draws, so results are reproducible. Monthly log-returns are parameterised so that the *annual simple* return has exactly the mean μ and volatility σ entered:

`s² = ln(1 + σ² / (1 + μ)²)`, `m = ln(1 + μ) − s²/2`; monthly mean `m/12`, monthly deviation `s/√12`.

The "with crashes" model uses a Student-t distribution with four degrees of freedom rescaled to unit variance. "Replay history" is a block bootstrap of actual monthly returns in six-month blocks.

## Valuation (`valuation.ts`)

- `FCFF = EBIT × (1 − tax) + D&A − capex − ΔNWC`, where `ΔNWC = (revenueₜ − revenueₜ₋₁) × NWC%`.
- Growth and margin fade linearly from the first-year to the final-year value.
- Terminal value (growth): `FCFFₙ × (1 + g) / (WACC − g)`; (multiple): `EBITDAₙ × multiple`.
- Mid-year convention discounts year `t` by `t − 0.5` and the Gordon terminal value by `n − 0.5`.
- Equity value = enterprise value − net debt − other claims + non-operating assets.
- Reverse DCF solves for the constant growth rate that reproduces the market price.
- CAPM: `Kₑ = r_f + β × ERP`. WACC: `E/(D+E) × Kₑ + D/(D+E) × K_d × (1 − t)`.
- Gordon growth: `D₁ / (r − g)`. Graham number: `√(22.5 × EPS × BVPS)`.

**Test.** A firm growing steadily at `g` must be worth `FCFF₁ / (WACC − g)`: the DCF reproduces this exactly.

## Ratios (`ratios.ts`)

Computed from year-end balances so each figure can be checked by hand against the statements shown: ROE = net profit ÷ equity; ROCE = EBIT ÷ (total assets − current liabilities); debt to equity = total debt ÷ equity; interest cover = EBIT ÷ interest. Growth is not reported from a zero or negative base.

## Portfolio accounting (`portfolio.ts`)

- **Lots** are first-in-first-out, the method used for Indian demat holdings. Charges are added to cost on a buy and deducted from proceeds on a sell.
- **Splits and bonuses** multiply the quantity and divide the cost per share; total cost is unchanged.
- **XIRR** treats buys as outflows, sells and dividends as inflows, and today's holdings value as a final inflow.
- **Time-weighted return**: daily return = (value + dividends − net money added) ÷ previous value − 1, chained.
- **Concentration**: HHI = Σ weight²; effective holdings = 1 ÷ HHI.
- **Rebalancing**: target value = total × target weight. "Only buy" spends spare cash on underweight holdings in proportion to their shortfall and never sells.
