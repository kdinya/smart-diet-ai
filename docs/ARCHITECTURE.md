# Smart Diet AI Architecture & Module Guide

## 2. Core Architecture & Strict Invariants

1. **Modular Architecture (Vanilla JS & CSS, No Build Step):**
   - The application uses a modular, framework-free vanilla JavaScript and CSS architecture without bundlers (Webpack, Vite) or compilation steps.
   - Core modules and their responsibilities:
     - `index.html`: Core application shell, DOM hierarchy, state management, event listeners, and view switching.
     - `js/i18n.js`: Bilingual translation dictionaries (`I.uk` and `I.en`).
     - `js/calc-nutrition.js`: Pure mathematical domain calculations, macros, scaling, portion normalization, and composite meal math.
     - `js/ai-service.js`: AI providers (Gemini, OpenAI, Anthropic, Groq, xAI), model definitions, prompts, JSON parsers, and dietitian reply formatters.
     - `css/main.css`: Core styles, CSS variables, components, modals, and toasts.
     - `css/responsive.css`: Breakpoint styles and mobile viewport media queries (<=680px, <=430px, 360px).
     - `docs/DATA_CONTRACTS.md`: Source of truth for data models and contract schemas.
   - Auxiliary files must be maintained in sync:
     - `manifest.json`: Web app manifest (PWA metadata, icons, theme color).
     - `sw.js`: Service worker caching logic (`CACHE` version and `SHELL` asset list).
     - `supabase/schema.sql`: Database tables, indexes, and Row Level Security policies.
     - `README.md` (English) and `README.uk.md` (Ukrainian): user-facing description of the app with screenshots in `docs/screenshots/`. Keep both files in sync.

2. **Task-Based File Routing (Context & Token Optimization):**
   To maximize editing speed and minimize context/token expenditure, agents must inspect and edit only the specific files pertinent to the task at hand. Do not read or modify unrelated modules:
   - **Translations, copy, or wording changes:**
     - Target: `js/i18n.js` only.
     - Rules: Never read or edit `index.html`, `css/*`, `js/calc-nutrition.js`, or `js/ai-service.js`. Maintain 100% dictionary key parity between `I.uk` and `I.en`. Verify via `node --check js/i18n.js`.
   - **Nutrition formulas, portions, macros, or calculations:**
     - Target: `js/calc-nutrition.js` only.
     - Rules: Contains pure domain calculation functions (`calcProteinTarget`, `calcMacrosFor`, `compositeTotals`, `scaleNutrients`, `scaleComponentGrams`, `normalizeFoodComponentsForEntry`, `parseImportedNutrition`, etc.). Never read or edit `index.html` or `css/*`.
     - Verification: Run instant unit tests `node tests/unit/calc.test.mjs` (~100 ms).
   - **AI prompts, models, providers, or reply formatting:**
     - Target: `js/ai-service.js` only.
     - Rules: Handles AI provider endpoints, requests (`callGemini`, `callOpenAICompat`, `callAnthropic`, etc.), prompts (`nutritionPrompt`, `mealPlanPrompt`, `analysisPrompt`, `askPrompt`, `dailyRecommendationPrompt`), and response parsers. Keep client-side API key contract in `state.ai` intact.
     - Verification: Run unit tests `node tests/unit/ai.test.mjs` and `node --check js/ai-service.js`.
   - **Visual styling, colors, layout, or mobile adaptation:**
     - Target: `css/main.css` (general styling, components, modals) or `css/responsive.css` (mobile viewports <=680px, <=430px, 360px).
     - Rules: Modify stylesheets directly. Do not touch JavaScript files unless new DOM elements or class names are needed in `index.html`. Verify modal dialogs and layouts at 360px width.
   - **DOM structure, view rendering, or app state orchestration:**
     - Target: `index.html`.
     - Rules: Use targeted searches and line ranges for the specific element or handler. Never read or rewrite the full file unprompted.
   - **Data structures, storage models, or compatibility:**
     - Target: Consult `docs/DATA_CONTRACTS.md` before changing data models, storage keys (`smartdiet-v1`, `smartdiet-sync-queue`), or database structures. Maintain strict backwards compatibility.
   - **Database schema, RLS, or cloud sync:**
     - Target: `supabase/schema.sql` and `tests/db.integration.mjs`.
     - Rules: Test against the dedicated test Supabase project only. Never run migrations or destructive tests against production.
   - **Service worker & offline cache updates:**
     - Target: `sw.js`.
     - Rules: Whenever adding new files to `js/` or `css/` or renaming assets, increment `CACHE` (e.g. `smartdiet-shell-v...`) and update the `SHELL` array. Ensure any new JS file is covered by `node --check` in `.github/workflows/ci.yml`.
   - **Targeted test selection for fast feedback:**
     - Run narrow tests first for fast feedback:
       - Calculation changes: `node tests/unit/calc.test.mjs`
       - AI service changes: `node tests/unit/ai.test.mjs`
       - All unit tests: `npm run test:unit`
       - Product catalog, composite meals, addons: `npm run test:smoke:products`
       - General UI and modal flows: `npm run test:smoke:ui`
       - Cloud sync flows: `npm run test:smoke:sync`
       - AI smoke flows: `npm run test:smoke:ai`
       - Full smoke suite (pre-merge gate): `npm run test:smoke`

3. **Full Localization Coverage (`I` Dictionary):**
   - The application strictly supports bilingual interface: Ukrainian (`uk`) and English (`en`).
   - Every user-facing string (labels, placeholders, buttons, notifications, modal titles, error messages) MUST be routed through the `I` translation object.
   - Never hardcode strings in UI templates or scripts without corresponding `uk` and `en` entries.
   - Keep 100% dictionary key parity between `I.uk` and `I.en`.

4. **Absolute Priority: User Data Preservation & Functional Integrity (MANDATORY):**
   - Preserving existing user data and core application integrity is the highest-priority invariant. No code change may clear, lose, silently overwrite, misattribute, or expose user data: profile details, daily goals, food diary entries, weight history, custom products, and pending sync/deletion queues.
   - Treat `smartdiet-v1`, `smartdiet-ask-v1`, account-scoped archives, record IDs, schemas, ownership fields, and synchronization queues as compatibility contracts. Never rename or reset storage keys or change record shapes without a backwards-compatible migration that preserves every existing record.
   - Local data is authoritative until the server confirms a corresponding write or deletion. Network errors, RLS/permission failures, timeouts, account switches, retries, and concurrent edits must never be treated as successful sync or cause pending changes to be discarded.
   - Keep every queued operation associated with the correct account. Do not upload one user's local data to another account; do not delete data or archives belonging to other accounts. A deletion is complete only after the server confirms it, and an edit made during an upload must remain queued for a later sync.
   - Before changing persistence, sync, authentication, import/export, or record editing, inspect the full read/write/delete and migration paths first. Add regression coverage for the affected failure and race cases, including reload and account-switch behavior. Prefer isolated/mock or dedicated test data; never run destructive tests against production user data.
   - **Mandatory Test Database Verification:** Whenever modifying database operations, schema definitions, authentication flows, or cloud synchronization, run the database checks against the dedicated test Supabase project only. Never run destructive or schema migrations directly against production user databases.
     - Secrets: `TEST_DATABASE_URL`, `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY` (GitHub Actions secrets). Never print, log, commit, or paste their values.
     - The `database` job in `.github/workflows/ci.yml` runs on push to `main` and on manual dispatch. It first refuses to run if the target is the production project (its ref is hardcoded in the workflow and in `tests/db.integration.mjs`), or if `TEST_DATABASE_URL` does not belong to the same test project as `TEST_SUPABASE_URL`. It then applies `supabase/schema.sql` to the test database and runs `tests/db.integration.mjs`.
     - `tests/db.integration.mjs` creates throwaway users, checks RLS, profiles, food entries, weigh-ins, products, friendships, product sharing and account deletion, and removes those users at the end. Extend it when adding a table, policy or sync path.
     - GitHub-hosted runners need IPv4: `TEST_DATABASE_URL` must use an IPv4-reachable Supabase pooler address, not the direct database host.
     - The mocked smoke suite (`npm run test:smoke`) does not replace this check. Do not weaken the production-ref guard or point any test, schema or migration at production.
     - For changes in these areas, confirm the `database` job is green on the pushed commit before reporting the work as done.
   - Before release, verify existing profile, goals, foods, weights, products, and pending queue load, render, survive reload, and remain intact after failed/slow sync. If a migration or test cannot prove preservation, do not ship the change until it is safe.
   - **Never expose Supabase `service_role` key in client-side code.** Only the public `anon`/publishable key with properly configured Row Level Security (RLS) is allowed in the browser.

5. **AI Providers & Model Integration:**
   - The app supports Google Gemini, OpenAI, Anthropic Claude, Groq, and xAI Grok. Preserve all configured provider paths and their fallback behavior when editing prompts or UI.
   - Keep model identifiers and request parameters aligned with each provider's current official API documentation. Do not assume a model remains available because it worked previously. When touching provider code, verify current models and endpoint requirements from the provider's official documentation; report any needed model change before changing it, except to restore a feature broken by a discontinued model.
   - Respect provider-specific request constraints. Reasoning-enabled OpenAI models may reject `temperature`; Gemini responses may be truncated at the output limit, so detect truncation and never parse or save incomplete structured output as valid data.
   - For Anthropic Claude, Groq, and xAI Grok, use current models and request parameters from provider documentation.
   - API keys are stored solely on the client device in `localStorage`; never transmit user API keys to third-party proxy servers without explicit consent.
   - Surface provider failures clearly and keep retry/fallback behavior bounded. Validate structured AI values before saving them; missing or invalid nutrition values must not silently become zero or be written to a user's diary.

6. **Dietary & Safety Guardrails:**
   - Calculations and AI estimations are approximate nutritional estimates and NOT medical advice.
   - Maintain visible safety notices and disclaimers across the UI and in AI system prompts (e.g., adult guidance 18+, consulting healthcare professionals, warnings against aggressive calorie restriction).
   - Calorie calculations must enforce reasonable minimum thresholds to prevent unsafe dietary recommendations.

7. **Responsive Layout & Mobile Adaptation:**
   - The application is designed mobile-first as an installable PWA.
   - Mobile navigation bar (`.mobilebar`), sticky headers, chat panels, modals, and input keyboards (`inputmode="numeric"`, `inputmode="decimal"`) must work flawlessly on narrow viewports (360px - 430px) and iOS Safari with notch/home indicator safe areas (`env(safe-area-inset-*)`).
   - Modals must be cleanly dismissible via close buttons (✕), backdrop clicks, or cancel actions.
8. **UI Layering & Stacking Hierarchy:**
   - Base pages and layout views: baseline layer (`z-index: 0` – `5`).
   - Sticky navigation, action buttons, and panels (`.mobilebar`, `.chat-fab`, `.chat-panel`): interface overlay layer (`z-index: 40` – `60`).
   - Standard modal dialogs (`.modal-back`): modal layer (`z-index: 100`).
   - Confirmation dialogs (`#confirm-modal`): alert/confirmation layer (`z-index: 200`), always positioned above any underlying open modals.
   - Informational toasts and notifications (`.toast`): topmost layer (`z-index: 10000`), always visible above all windows and dialogs.

---

## 3. Task Classification & Verification Guidelines

To preserve token context, maximize agent execution speed, and eliminate regressions, tasks are classified into two distinct operational scopes:

### A. Local Domain Task (Pure Modules & Unit Tests)
- **Scope**: Changes confined strictly to pure domain calculation logic, AI prompt templates/parsers, data transformations, or dictionary translations (`js/calc-nutrition.js`, `js/ai-service.js`, `js/storage.js`, `js/i18n.js`).
- **Characteristics**:
  - No DOM manipulation, no browser APIs (`document`, `window.localStorage`, Canvas, WebGL, Spine).
  - Operates purely on input arguments and returns deterministic outputs.
  - Requires **zero edits** to `index.html` or `css/*`.
- **Verification Protocol**:
  - Run fast syntax and integrity check: `npm run check`.
  - Run the dedicated unit test suite:
    - Calculations: `npm run test:unit:calc` (~100 ms).
    - AI Service: `npm run test:unit:ai` (~80 ms).
    - Storage logic: `npm run test:unit:storage` (~90 ms).
    - Translations: `npm run test:unit:i18n` (~30 ms).
    - Assistant pure helpers: `npm run test:unit:ecobot` (~50 ms).
    - All unit tests: `npm run test:unit` (< 500 ms).
  - *Browser-based Playwright smoke suite is unnecessary and should be skipped for pure domain tasks.*

### B. Integration Task (DOM, Views, Modals & UI Orchestration)
- **Scope**: Features, UI enhancements, event listeners, modal lifecycles, or state mutations that connect user interactions in the DOM with domain logic and cloud persistence (`index.html`, `css/*`, `sw.js`).
- **Characteristics**:
  - Involves DOM element querying, event delegation, modal open/close states, animations, or view switching.
  - Modifies application state (`state`), triggers storage saves (`save()`), or enqueues cloud sync operations (`enqueue()`).
- **Verification Protocol**:
  - Run static sanity checks: `npm run check`.
  - Run targeted smoke test shard:
    - Simple products & CRUD: `npm run test:smoke:products:basic`
    - Composite meals & normalization: `npm run test:smoke:composite`
    - Addons & companion products: `npm run test:smoke:addons`
    - Shared catalog & publication: `npm run test:smoke:catalog`
    - Full smoke suite: `npm run test:smoke`
  - Update `sw.js` cache version (`CACHE = 'smartdiet-shell-v...'`) whenever assets or HTML change.

---

## 4. Global Dependency Map (Core Orchestration)

In the vanilla architecture without bundlers, `index.html` acts as the primary runtime coordinator. The following global primitives form the core contract across modules:

| Global Symbol | Defining Module / Location | Type / Role | Description & Usage Invariants |
| :--- | :--- | :--- | :--- |
| `state` | `index.html` (loaded via `js/storage.js`) | `Object` (Singleton) | Single source of truth for runtime data (`state.user`, `state.profile`, `state.foods`, `state.weights`, `state.products`, `state.companions`, `state.ai`, `state.prefs`). Must never be reassigned directly; mutate properties or use helper functions. |
| `window` | Browser Runtime | `Global Object` | Shared bus where standalone modules export their APIs (`window.calcNutrition`, `window.aiService`, `window.i18n`, `window.storage`, `window.nutritionBot`). |
| `I` | `js/i18n.js` | `Object` (`{ uk: {...}, en: {...} }`) | Bilingual translation dictionaries. Must maintain 100% exact key parity between `uk` and `en` at all times. |
| `t(key)` | `index.html` | `Function(string) -> string` | Primary translation helper. Retrieves localized string from `I[currentLang][key]`. Falls back gracefully if key is missing. |
| `$` / `$$` | `index.html` | `Function(selector) -> Element/NodeList` | Convenience wrappers for `document.querySelector` and `document.querySelectorAll`. Used across UI handlers. |
| `save()` | `index.html` | `Function() -> void` | Serializes current `state` to `localStorage` under `smartdiet-v1` via `serializeState()`. Triggers UI updates for affected views. |
| `enqueue(table, id)` | `index.html` | `Function(string, string) -> void` | Adds record mutation or deletion to `smartdiet-sync-queue` for background cloud synchronization. |
| `runSync(force)` | `index.html` | `Async Function(boolean) -> Promise<void>` | Flushes pending queue items to Supabase via authenticated REST/PostgREST when online. |
| `toast(msg)` | `index.html` | `Function(string) -> void` | Dispatches styled transient notifications positioned on topmost stacking layer (`z-index: 10000`). |
| `askConfirm(opts)` | `index.html` | `Async Function(object) -> Promise<boolean>` | In-app styled confirmation modal (`#confirm-modal`). Native `window.confirm` is strictly prohibited. |
