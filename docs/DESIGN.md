# Design notes

The brief: look like a serious research product, stay comfortable for long sessions, and never look machine-generated. So: flat surfaces, hairline borders, one accent colour, no gradients, no glows, no decorative icons, and motion only where it conveys state.

## Tokens

All colours are CSS custom properties in `src/styles.css`, defined once for light and once for dark (`:root[data-theme='dark']`).

| Role | Light | Dark |
|---|---|---|
| Page | `#f5f4ef` (warm paper) | `#13161b` |
| Surface | `#ffffff` | `#1a1e25` |
| Border | `#dfdcd3` | `#2d333d` |
| Text | `#1a1d22` | `#e9e7e2` |
| Accent | `#1e3a5f` (ink blue) | `#9dbde6` |
| Gain / loss | `#12703f` / `#b0261d` | `#5fc58d` / `#f0877e` |

## Type

- **IBM Plex Sans** for the interface: a humanist grotesque with true tabular figures, so columns of numbers line up.
- **Source Serif 4** for page titles and lesson text, which gives the editorial feel of a financial paper.
- **IBM Plex Mono** for formulas.

Fonts are self-hosted through Fontsource. Body text is 14px; numbers in tables and statistics use `font-variant-numeric: tabular-nums`.

## Layout

- Fixed left navigation grouped by what the user wants to do (Markets, Portfolio, Valuation, Plan, Learn), with a search box that covers tools, stocks, lessons and glossary terms (Ctrl/⌘ K or `/`).
- Tools use a two-column "inputs left, results right" layout that stacks on narrow screens.
- Below 900px the navigation becomes a drawer; below 620px grids collapse to one column and inputs grow to 16px so iOS does not zoom.

## Every tool follows the same pattern

1. A one-sentence description under the title.
2. Inputs with sensible defaults, units, range validation and an "i" tooltip for any term a beginner may not know.
3. Results that update immediately, headline figures first.
4. A chart where a picture helps.
5. An "In plain words" paragraph that says what the numbers mean.
6. A collapsible learning panel: what it does, why it matters, how to read it, the formula, a worked example, common mistakes, limits.

Inputs are remembered between visits and every tool has a reset.

## Charts

Charts are hand-built SVG (`src/components/charts.tsx`).

- One y-axis per chart, never two. Different measures get separate charts or are indexed to 100.
- Lines are 2px; bars are at most 24px wide with a rounded data end and a square baseline; area fills are a 10% wash.
- Gridlines are hairline and recessive. Axis labels use one unit per axis (plain, lakh or crore).
- Every plot has a hover or touch layer: a crosshair and tooltip on lines, a per-mark tooltip on bars and points.
- Two or more series always get a legend; text is never drawn in a series colour.
- Categorical series colours follow a fixed order chosen to stay distinguishable under colour-vision deficiency, with separate light and dark steps: blue, orange, aqua, yellow, magenta, green, violet, red.
- Gains and losses use green and red, always alongside a sign (+/−), so colour is never the only signal.
- Correlations use a diverging blue–neutral–red scale.
- Allocation is shown as labelled horizontal bars with exact percentages instead of pie charts.

## Accessibility

Form controls have labels; icon-only buttons have `aria-label`; tabs, dialogs and tooltips carry the appropriate roles; focus is always visible; `prefers-reduced-motion` disables animation; a print stylesheet hides navigation.
