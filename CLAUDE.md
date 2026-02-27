# CLAUDE.md - Weight Tracker (Shotsy)

## Project Overview

Weight Tracker (internal codename "Shotsy") is a mobile-first single-page application for tracking weight loss progress and GLP-1 medication doses (Semaglutide/Ozempic/Wegovy, Tirzepatide/Mounjaro/Zepbound, Liraglutide/Saxenda). All data is stored in browser localStorage. There is no backend, no database, and no user accounts.

## Tech Stack

- **Vanilla JavaScript** (ES6+) — no frameworks, no transpilation, no bundler
- **HTML5 / CSS3** — single HTML file, single CSS file
- **Chart.js v4.4.1** + **chartjs-adapter-date-fns v3.0.0** — loaded via CDN (jsDelivr)
- **No package manager** — no package.json, no node_modules
- **No build step** — files are served as-is
- **Deployment** — GitHub Pages via GitHub Actions (auto-deploy on push to `main`)

## File Structure

```
Weight-Tracker/
├── .github/workflows/deploy.yml   # GitHub Pages deploy (push to main triggers it)
├── css/style.css                  # All styles: CSS custom properties, theming, responsive
├── js/store.js                    # Data layer: localStorage CRUD, statistics, export/import
├── js/app.js                      # UI controller: routing, charts, modals, event handling
└── index.html                     # All markup, CDN script tags, modals, bottom nav
```

## Architecture

### Module Pattern (IIFE)

Both JavaScript files use the Immediately Invoked Function Expression pattern:

- **`Store`** (`js/store.js`) — Data layer. Exposes public API with CRUD methods. Does not touch the DOM.
- **`App`** (`js/app.js`) — UI controller. Calls `Store` methods for data. Manages DOM, Chart.js instances, routing, and user interactions.

Script load order matters: `store.js` loads before `app.js` in `index.html`. `App` depends on `Store` being globally available.

```
index.html
  └─ <script src="js/store.js">  →  window.Store (IIFE)
  └─ <script src="js/app.js">   →  window.App (IIFE), calls Store.*
                                     └─ DOMContentLoaded → App.init()
```

### Data Flow

```
User Action → App event handler → Store.method() → localStorage
                                        ↓
                              App.refresh*() → Store.get*() → Update DOM / Chart.js
```

### Routing

Hash-based SPA routing with four pages: `#summary` (default), `#doses`, `#progress`, `#settings`. The `navigateTo(page)` function hides all `.page` sections, shows `#page-{name}`, updates the active `.nav-tab`, and calls the corresponding `refresh*()` function.

### Chart.js Usage

Four Chart.js instances managed as module-scoped variables:
- `doseRingChart` — doughnut chart (next dose countdown on Summary)
- `weightSummaryChart` — line chart (weight trend on Summary, last 30 days)
- `weightFullChart` — line chart (full weight history on Progress, with goal line)
- `doseChart` — stepped line chart (dose history on Doses)

Charts are destroyed via `destroyChart()` and recreated on every page refresh. Colors adapt to the current theme via `getChartColors()`.

## localStorage Keys

All keys are prefixed with `shotsy_`:

| Key | Type | Description |
|---|---|---|
| `shotsy_profile` | Object | User profile (name, height, medication) |
| `shotsy_weights` | Array | Weight entries, sorted by date ascending |
| `shotsy_jabs` | Array | Dose/injection entries, sorted by date ascending |
| `shotsy_goals` | Object | Target weight, weekly target |
| `shotsy_settings` | Object | Weight unit, theme preference |

### Data Models

**Profile:**
```js
{ name, age, height, heightUnit, startWeight, startDate, medication, dosage, frequency }
```

**Weight entry:**
```js
{ id, date, weight, note }
// id: generated via Date.now().toString(36) + random suffix
```

**Dose/Jab entry:**
```js
{ id, date, time, medication, dose, doseUnit, site, sideEffects: [], notes }
// medication: "semaglutide" | "tirzepatide" | "liraglutide" | "other" | "none"
// site: "abdomen-left" | "abdomen-right" | "thigh-left" | "thigh-right" | "arm-left" | "arm-right"
// sideEffects: array from fixed set (nausea, headache, fatigue, diarrhea, constipation, injection-site, dizziness, none)
```

**Goals:**
```js
{ targetWeight, weeklyTarget, targetDate }
```

**Settings:**
```js
{ weightUnit, theme, weeklyReminder, jabReminder, reminderDay }
// weightUnit: "kg" | "lbs" | "st"
// theme: "light" | "dark" | "auto"
```

## Naming Conventions

### JavaScript
- **camelCase** for all variables and functions
- DOM element IDs use **hyphen-separated** names with prefixes:
  - `btn-` for buttons (`btn-add-dose`, `btn-quick-weight`)
  - `page-` for page sections (`page-summary`, `page-doses`)
  - `chart-` for canvas elements (`chart-weight-full`, `chart-doses`)
  - `set-` for settings inputs (`set-name`, `set-medication`)
  - `ob-` for onboarding inputs (`ob-name`, `ob-weight`)
  - `dose-` for dose modal inputs (`dose-date`, `dose-amount`)
  - `weight-` for weight modal inputs (`weight-date`, `weight-value`)
  - `sum-` for summary stat elements (`sum-bmi`, `sum-total-doses`)
  - `prog-` for progress stat elements (`prog-current`, `prog-to-goal`)
- Store methods follow `get*`/`save*`/`add*`/`update*`/`delete*` pattern
- App refresh functions: `refreshSummary()`, `refreshDoses()`, `refreshProgress()`, `refreshSettings()`

### CSS
- **BEM-ish** naming: `.dose-item`, `.dose-item-icon`, `.dose-item-info`
- CSS custom properties on `:root`, overridden on `[data-theme="dark"]`
- Button variants: `.btn-primary`, `.btn-ghost`, `.btn-outline`, `.btn-danger`, `.btn-block`, `.btn-sm`
- Layout: `.form-row`, `.form-group`, `.form-actions`
- Primary color: `#6366f1` (indigo), Teal: `#14b8a6` (doses), Orange: `#f97316` (weight)

## Running Locally

No build step. Open `index.html` directly in a browser or use a local server:

```bash
python3 -m http.server 8000
# Visit http://localhost:8000
```

First-time users see an onboarding modal. The app checks `profile.name` in localStorage to determine whether to show onboarding.

## Deployment

GitHub Actions auto-deploys to GitHub Pages on push to `main`. The workflow (`.github/workflows/deploy.yml`) uploads the entire repo as a static site. No build, no minification.

## Patterns to Follow

1. **Keep the IIFE module pattern.** New modules should follow the same `const Module = (() => { ... return { publicAPI }; })();` pattern.
2. **Store handles data, App handles UI.** No DOM manipulation in `store.js`. No localStorage calls in `app.js`.
3. **Destroy charts before recreating.** Always call `destroyChart(chartVariable)` before creating a new Chart.js instance.
4. **Sorted arrays.** Weight and jab arrays are kept sorted by date ascending after every add/update.
5. **ID generation.** Use `Date.now().toString(36) + Math.random().toString(36).slice(2, 7)`.
6. **Refresh after mutations.** After any Store write, call the relevant `refresh*()` function(s). Usually both the current page and `refreshSummary()`.
7. **Toast for feedback.** Use `toast(message, type)` where type is `'success'`, `'error'`, or `''`.
8. **Modal visibility.** Show with `modal.style.display = 'flex'`, hide with `modal.style.display = 'none'`.
9. **Filter chips.** Time filters use `data-range` attributes: `7`, `30`, `90`, `180`, or `all`.
10. **Theme-aware charts.** Get colors from `getChartColors()` which checks the `data-theme` attribute.

## App Public API

`App` exposes these methods globally (used by inline `onclick` in dynamically generated HTML):
- `App.editWeight(id)` — opens weight modal in edit mode
- `App.removeWeight(id)` — deletes weight entry with confirmation
- `App.editDose(id)` — opens dose modal in edit mode
- `App.removeDose(id)` — deletes dose entry with confirmation

New inline action handlers must be added to the `App` return object.

## What NOT to Do

- **No build tools** (webpack, Vite, Parcel). This is intentionally zero-build.
- **No package manager** (npm, yarn). Dependencies are CDN-only.
- **No frameworks** (React, Vue, Svelte). Vanilla JS by design.
- **No TypeScript.** There is no transpilation step.
- **No CSS preprocessors** (Sass, Less). Use native CSS custom properties.
- **No ES modules** (`import`/`export`). Scripts rely on global scope and load order.
- **Do not change the `shotsy_` localStorage prefix.** Users have existing data.
- **Do not create a `package.json`.** There are no Node.js dependencies.
