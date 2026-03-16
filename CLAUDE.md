# CLAUDE.md - Jab It

## Project Overview

Jab It is a mobile-first single-page application (PWA) for tracking weight loss progress and GLP-1 medication doses (Semaglutide/Ozempic/Wegovy, Tirzepatide/Mounjaro/Zepbound, Liraglutide/Saxenda). Data is stored locally in browser localStorage (and IndexedDB for photos), with optional cloud sync via Supabase for signed-in users.

## Tech Stack

- **Vanilla JavaScript** (ES6+) — no frameworks, no transpilation, no bundler
- **HTML5 / CSS3** — single HTML file, single CSS file
- **Chart.js v4.4.1** + **chartjs-adapter-date-fns v3.0.0** — loaded via CDN (jsDelivr)
- **Supabase JS SDK v2** — loaded via CDN for optional auth and cloud sync
- **Service Worker** — offline support, push notifications, background sync
- **PWA** — installable via manifest.json
- **No package manager** — no package.json, no node_modules
- **No build step** — files are served as-is
- **Deployment** — GitHub Pages via GitHub Actions (auto-deploy on push to `main`)

## File Structure

```
Weight-Tracker/
├── .github/workflows/
│   ├── deploy.yml                 # GitHub Pages deploy (push to main)
│   ├── build-static-site.yml      # Build artifact workflow
│   └── release-check.yml          # Release validation (robots.txt, sitemap, canonical)
├── css/style.css                  # All styles: CSS custom properties, theming, responsive
├── js/
│   ├── config.js                  # Supabase URL and anon key
│   ├── auth.js                    # Supabase authentication (magic link, passkeys)
│   ├── store.js                   # Data layer: localStorage/IndexedDB CRUD, statistics, export/import
│   ├── sync.js                    # Bidirectional Supabase sync with conflict resolution
│   └── app.js                     # UI controller: routing, charts, modals, event handling
├── sw.js                          # Service worker: caching, offline, notifications
├── manifest.json                  # PWA manifest (installable app)
├── index.html                     # All markup, CDN script tags, modals, bottom nav
├── robots.txt                     # SEO
├── sitemap.xml                    # SEO sitemap
├── supabase-schema.sql            # Database schema for Supabase backend
└── scripts/
    ├── release_check.py           # Release validation script
    └── smart_tool_engine.py       # Smart tooling script
```

## Architecture

### Module Pattern (IIFE)

All JavaScript files use the Immediately Invoked Function Expression pattern:

- **`Config`** (`js/config.js`) — Supabase connection configuration.
- **`Auth`** (`js/auth.js`) — Authentication module. Supabase magic link and passkey sign-in.
- **`Store`** (`js/store.js`) — Data layer. Exposes public API with CRUD methods. Does not touch the DOM. Uses localStorage for structured data and IndexedDB for photo blobs.
- **`Sync`** (`js/sync.js`) — Cloud sync module. Bidirectional sync with Supabase. Listens for `store-mutation` events.
- **`App`** (`js/app.js`) — UI controller. Calls `Store` methods for data. Manages DOM, Chart.js instances, routing, and user interactions.

### Script Load Order (Critical)

```
index.html
  └─ <script src="js/config.js">  →  window.Config (Supabase config)
  └─ <script src="js/auth.js">   →  window.Auth (authentication)
  └─ <script src="js/store.js">  →  window.Store (data layer)
  └─ <script src="js/sync.js">   →  window.Sync (cloud sync)
  └─ <script src="js/app.js">    →  window.App (UI controller)
                                      └─ DOMContentLoaded → App.init()
```

### Data Flow

```
User Action → App event handler → Store.method() → localStorage / IndexedDB
                                        ↓
                              App.refresh*() → Store.get*() → Update DOM / Chart.js
                                        ↓
                              Store dispatches 'store-mutation' event
                                        ↓
                              Sync.pushAll() → Supabase (if signed in, debounced 2s)
```

### Routing

Hash-based SPA routing with five pages: `#summary` (default), `#doses`, `#progress`, `#journal`, `#settings`. The `navigateTo(page)` function hides all `.page` sections, shows `#page-{name}`, updates the active `.nav-tab`, and calls the corresponding `refresh*()` function.

### Chart.js Usage

Seven Chart.js instances managed as module-scoped variables:
- `doseRingChart` — doughnut chart (next dose countdown on Summary)
- `weightSummaryChart` — line chart (weight trend on Summary, last 30 days)
- `weightFullChart` — line chart (full weight history on Progress, with goal line)
- `doseChart` — stepped line chart (dose history on Doses)
- `measurementChart` — line chart (measurement trends on Progress)
- `moodTrendChart` — line chart (mood/energy averages on Journal)
- `fastingRingChart` — doughnut chart (fasting timer on Journal)

Charts are destroyed via `destroyChart()` and recreated on every page refresh. Colors adapt to the current theme via `getChartColors()`.

## localStorage Keys

All keys are prefixed with `shotsy_`:

| Key | Type | Description |
|---|---|---|
| `shotsy_profile` | Object | User profile (name, height, medication) |
| `shotsy_weights` | Array | Weight entries, sorted by date ascending |
| `shotsy_jabs` | Array | Dose/injection entries, sorted by date ascending |
| `shotsy_goals` | Object | Target weight, weekly target |
| `shotsy_settings` | Object | Weight unit, theme preference, reminders |
| `shotsy_victories` | Array | Non-scale victories/milestones |
| `shotsy_photos` | Array | Progress photo metadata (blobs stored in IndexedDB) |
| `shotsy_measurements` | Array | Body measurements (chest, waist, hips, etc.) |
| `shotsy_journal` | Array | Mood/energy journal entries |
| `shotsy_fasts` | Array | Fasting history (start/end times) |
| `shotsy_exercises` | Array | Exercise/activity entries |

### IndexedDB

Photo blob data is stored separately in IndexedDB:
- Database: `shotsy_photo_db` (version 2)
- Object store: `photos`

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

**Measurement entry:**
```js
{ id, date, chest, waist, hips, thigh, arm, neck, unit }
```

**Journal entry:**
```js
{ id, date, mood, energy, notes }
// mood: 1-5 scale
// energy: 1-5 scale
```

**Fast entry:**
```js
{ id, startTime, endTime, protocol, notes }
```

**Exercise entry:**
```js
{ id, date, type, duration, intensity, calories, notes }
```

**Victory entry:**
```js
{ id, date, category, text }
```

**Photo entry (metadata in localStorage):**
```js
{ id, date, note, contentHash, storagePath, syncedAt }
// Actual blob stored in IndexedDB or Supabase Storage
```

## Authentication & Sync

### Auth (`js/auth.js`)

- `Auth.init()` — Initialize Supabase client
- `Auth.isConfigured()` — Check if Supabase URL/key are set
- `Auth.signInWithMagicLink(email)` — Passwordless email sign-in
- `Auth.signInWithPasskey(email)` — WebAuthn passkey sign-in
- `Auth.supportsPasskeys()` — Check browser WebAuthn support
- `Auth.signOut()` — Log out
- `Auth.getUser()` / `Auth.getSession()` / `Auth.isLoggedIn()`

### Sync (`js/sync.js`)

- `Sync.pushAll()` / `Sync.pullAll()` — Bidirectional data sync
- `Sync.mergeOnSignIn()` — Smart merge for new/returning users
- `Sync.syncPhotos()` / `Sync.pushPhoto()` / `Sync.deletePhotoRemote()` — Photo sync with Supabase Storage
- `Sync.markDeleted(table, itemId)` — Soft-delete via tombstones
- `Sync.syncOnResume()` — Sync when app resumes from background
- `Sync.pauseSync()` / `Sync.resumeSync()` — Control sync flow
- Store mutations dispatch `store-mutation` CustomEvent, which Sync listens for
- Sync is debounced at 2000ms after Store mutations

## Modals

The app has 11 modals:

| Modal ID | Purpose |
|---|---|
| `#onboarding-modal` | First-run setup (checklist flow) |
| `#auth-modal` | Sign in (magic link / passkey) |
| `#dose-modal` | Log/edit medication doses |
| `#weight-modal` | Log/edit weight entries |
| `#measurement-modal` | Log/edit body measurements |
| `#journal-modal` | Log/edit mood & energy entries |
| `#exercise-modal` | Log/edit exercise/activity |
| `#nsv-modal` | Log non-scale victories |
| `#photo-modal` | Add progress photos |
| `#photo-viewer-modal` | Compare progress photos |
| `#share-modal` | Share progress card (canvas-based) |
| `#missed-dose-modal` | Log missed doses |

## Naming Conventions

### JavaScript
- **camelCase** for all variables and functions
- DOM element IDs use **hyphen-separated** names with prefixes:
  - `btn-` for buttons (`btn-add-dose`, `btn-quick-weight`)
  - `page-` for page sections (`page-summary`, `page-doses`, `page-journal`)
  - `chart-` for canvas elements (`chart-weight-full`, `chart-doses`, `chart-measurements`, `chart-mood-trend`, `chart-fasting-ring`)
  - `set-` for settings inputs (`set-name`, `set-medication`)
  - `ob-` for onboarding inputs (`ob-name`, `ob-weight`, `ob-signin-*`)
  - `dose-` for dose modal inputs (`dose-date`, `dose-amount`)
  - `weight-` for weight modal inputs (`weight-date`, `weight-value`)
  - `sum-` for summary stat elements (`sum-bmi`, `sum-total-doses`)
  - `prog-` for progress stat elements (`prog-current`, `prog-to-goal`)
  - `measurement-` for measurement modal inputs
  - `journal-` for journal modal inputs
  - `exercise-` for exercise modal inputs
  - `nsv-` for non-scale victory modal inputs
  - `photo-` for photo modal/viewer elements
  - `auth-` for auth modal elements
  - `fast-` / `fasting-` for fasting UI elements
  - `mood-` / `energy-` for mood/energy tracking elements
  - `streak-` for streak statistics
  - `account-` for account section in settings
  - `share-card-` for share canvas elements
- Store methods follow `get*`/`save*`/`add*`/`update*`/`delete*` pattern
- App refresh functions: `refreshSummary()`, `refreshDoses()`, `refreshProgress()`, `refreshJournal()`, `refreshSettings()`, plus sub-refreshes like `refreshJournalList()`, `refreshMoodTrend()`, `refreshExerciseList()`, `refreshFastingTimer()`, `refreshFastingHistory()`

### CSS
- **BEM-ish** naming: `.dose-item`, `.dose-item-icon`, `.dose-item-info`
- CSS custom properties on `:root`, overridden on `[data-theme="dark"]`
- Button variants: `.btn-primary`, `.btn-ghost`, `.btn-outline`, `.btn-danger`, `.btn-block`, `.btn-sm`
- Layout: `.form-row`, `.form-group`, `.form-actions`
- Primary color: `#6366f1` (indigo), Teal: `#14b8a6` (doses), Orange: `#f97316` (weight)
- Gradients: `--gradient-primary`, `--gradient-teal`, `--gradient-orange`, `--gradient-success`, `--gradient-danger`
- Glass effects: `--glass-bg`, `--glass-border`
- Shadows: `--shadow-sm`, `--shadow`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`
- Easing: `--ease-smooth`, `--ease-spring`

## Service Worker & PWA

### Service Worker (`sw.js`)
- Cache name: `jabit-v7` (increment on updates)
- Caches all local assets plus CDN dependencies (Chart.js, date-fns adapter, Supabase SDK, Inter font)
- Background Sync: `jabit-reminder-check` tag
- Periodic Sync: 15-minute interval for reminder checks
- Notification click handling
- Offline-first caching strategy

### PWA Manifest (`manifest.json`)
- Categories: health, fitness, medical
- Display: standalone
- Theme color: `#6366f1`
- Icons: SVG + 192x192 + 512x512 (maskable)

## Running Locally

No build step. Open `index.html` directly in a browser or use a local server:

```bash
python3 -m http.server 8000
# Visit http://localhost:8000
```

First-time users see an onboarding checklist modal. The app checks `profile.name` in localStorage to determine whether to show onboarding.

Note: Service worker features (notifications, background sync) require HTTPS or localhost.

## Deployment

GitHub Actions auto-deploys to GitHub Pages on push to `main`. Three workflows:

1. **`deploy.yml`** — Main deploy. Syncs sitemap timestamps, validates release metadata, deploys static site.
2. **`build-static-site.yml`** — Builds and uploads site as GitHub artifact.
3. **`release-check.yml`** — Validates robots.txt, sitemap.xml, and canonical URL consistency on PRs and pushes.

No build step, no minification.

## App Public API

`App` exposes these methods globally (used by inline `onclick` in dynamically generated HTML):

- `App.editWeight(id)` — opens weight modal in edit mode
- `App.removeWeight(id)` — deletes weight entry with confirmation
- `App.editDose(id)` — opens dose modal in edit mode
- `App.removeDose(id)` — deletes dose entry with confirmation
- `App.editMeasurement(id)` — opens measurement modal in edit mode
- `App.removeMeasurement(id)` — deletes measurement with confirmation
- `App.editJournalEntry(id)` — opens journal modal in edit mode
- `App.removeJournalEntry(id)` — deletes journal entry with confirmation
- `App.editExercise(id)` — opens exercise modal in edit mode
- `App.removeExercise(id)` — deletes exercise with confirmation
- `App.removeFast(id)` — deletes fast entry with confirmation
- `App.removePhoto(id)` — deletes photo with confirmation
- `App.removeVictory(id)` — deletes victory with confirmation
- `App.viewPhotos()` — opens photo viewer

New inline action handlers must be added to the `App` return object.

## Store Public API

### Core CRUD (all data types)
- `get*()` / `save*()` / `add*()` / `update*()` / `delete*()` for: Weights, Jabs, Measurements, Journal entries, Exercises, Fasts, Victories, Photos
- `getProfile()` / `saveProfile()`, `getGoals()` / `saveGoals()`, `getSettings()` / `saveSettings()`

### Photo Storage (IndexedDB)
- `ensurePhotoStorageReady()` — Initialize IndexedDB
- `compressImage()` / `computeContentHash()` / `dataUrlToBlob()` / `blobToDataUrl()`
- `getPhotoRecord(id)` / `markPhotoSynced(id, path)` / `savePhotoFromRemote(photoMeta, blob)`

### Fasting
- `getActiveFast()` / `setActiveFast()` / `clearActiveFast()` / `getFastingStats()`

### Analytics & Statistics
- `getStats()` / `getStreakData()` / `getMilestones()`
- `getSideEffectTrends()` / `getDoseEscalations()` / `getDoseWeightCorrelation()`
- `getMovingAverage()` / `getRateOfLoss()` / `getNextRecommendedSite()`
- `getMeasurementStats()` / `getMoodTrend()` / `getExerciseStats()`
- `getPeriodSummary()` / `calculateGoalDate()` / `getProjectedGoalDate()`
- `generateDoctorReport()`

### Export / Import
- `exportData()` / `importData()` / `exportCSV()`
- `exportEncryptedBackup()` / `importBackupData()`
- `generateBackupLink()` / `generateMetadataBackupLink()` / `importFromBackupLink()`
- `getBackupSizeInfo()`

### Utilities
- `convertWeight()` / `convertAllWeights()`
- `parseLocalDate()` / `formatLocalDate()` / `parseTimeParts()`
- `clearAll()`

## Patterns to Follow

1. **Keep the IIFE module pattern.** New modules should follow the same `const Module = (() => { ... return { publicAPI }; })();` pattern.
2. **Store handles data, App handles UI.** No DOM manipulation in `store.js`. No localStorage calls in `app.js`.
3. **Destroy charts before recreating.** Always call `destroyChart(chartVariable)` before creating a new Chart.js instance.
4. **Sorted arrays.** Weight, jab, and other entry arrays are kept sorted by date ascending after every add/update.
5. **ID generation.** Use `Date.now().toString(36) + Math.random().toString(36).slice(2, 7)`.
6. **Refresh after mutations.** After any Store write, call the relevant `refresh*()` function(s). Usually both the current page and `refreshSummary()`.
7. **Toast for feedback.** Use `toast(message, type)` where type is `'success'`, `'error'`, or `''`.
8. **Modal visibility.** Show with `modal.style.display = 'flex'`, hide with `modal.style.display = 'none'`.
9. **Filter chips.** Time filters use `data-range` attributes: `7`, `30`, `90`, `180`, or `all`.
10. **Theme-aware charts.** Get colors from `getChartColors()` which checks the `data-theme` attribute.
11. **Dispatch store-mutation events.** After localStorage writes in Store, dispatch a `store-mutation` CustomEvent so Sync can pick it up.
12. **Sync debouncing.** Sync waits 2000ms after the last Store mutation before pushing to Supabase.
13. **Soft deletes for sync.** When deleting synced data, use `Sync.markDeleted()` to create tombstones rather than hard-deleting from Supabase.
14. **Photo blobs in IndexedDB.** Never store photo blob data in localStorage. Use the IndexedDB `shotsy_photo_db` database.

## What NOT to Do

- **No build tools** (webpack, Vite, Parcel). This is intentionally zero-build.
- **No package manager** (npm, yarn). Dependencies are CDN-only.
- **No frameworks** (React, Vue, Svelte). Vanilla JS by design.
- **No TypeScript.** There is no transpilation step.
- **No CSS preprocessors** (Sass, Less). Use native CSS custom properties.
- **No ES modules** (`import`/`export`). Scripts rely on global scope and load order.
- **Do not change the `shotsy_` localStorage prefix.** Users have existing data.
- **Do not create a `package.json`.** There are no Node.js dependencies.
- **Do not change script load order.** `config.js` → `auth.js` → `store.js` → `sync.js` → `app.js` is required.
- **Do not store photo blobs in localStorage.** Use IndexedDB via Store's photo methods.
