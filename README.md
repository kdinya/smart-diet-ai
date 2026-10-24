# Smart Diet AI

**Live Web App:** [https://smart-diet-ai-psi.vercel.app/](https://smart-diet-ai-psi.vercel.app/)

A client-side, mobile-first progressive web application for tracking nutrition, logging meals, monitoring body weight, and receiving AI-assisted portion calculations based on personal daily calorie targets.

---

## English

### Overview

Smart Diet AI helps users maintain a balanced diet without complicated math. It combines a daily food diary, macro tracker, weight log, and an integrated AI Dietitian that estimates food portions in grams and macros to fit within remaining daily calorie budgets.

### Features

- **AI Dietitian (Gemini, OpenAI, Claude & Groq)**:
  - Estimates portion weights in grams, calories, and macronutrients (protein, fats, carbs) for raw food inputs (e.g., "cottage cheese, eggs").
  - Dynamically accounts for daily calorie limits, consumed calories, remaining calories, and selected meal categories (Breakfast, Lunch, Dinner, Snack).
  - Offers nutritional recommendations when meals lack balance or key nutrients.
  - Uses `gemini-3.8-flash` with low thinking effort; switches to `gemini-3.5-flash-lite` only when the daily or per-minute quota of the main model is exhausted. Automatic retry on temporary errors, timeout handling, and retry button.
  - Several AI providers can be configured at once; if one is unavailable, rejects the key, or runs out of quota, the next one with a key is used automatically.
  - Direct one-click import of calculated items into the food diary.

- **Daily Overview & Goals**:
  - **Today's Balance:** Progress bars for calories, protein, fat, and carbs, each showing consumed / remaining.
  - **Meal Cards:** Breakdown of meals with calories, protein, fat, and carb subtotals and item counts (on the overview and for every day in the diary).
  - **Pace-based Plan:** The daily calorie target is calculated from the chosen pace (0.25 / 0.5 / 0.75 kg per week), capped at a safe deficit (up to 25% of maintenance, never below the minimum calories); protein is 1.8 g per kg of reference weight (target weight × 1.15 when losing, never above current weight), capped at 2.2 g per kg of current weight. Changing date of birth, sex, height, weight, activity, or pace recalculates the target automatically once a plan exists. A target weight with BMI below 18.5 is rejected.
  - **Body Weight Check (Statistics):** A semicircle BMI gauge (underweight / healthy / overweight / obesity) based on the latest logged weight, height, age and sex, with the healthy weight range, a recommended weight, and how many kilograms are above or below the range.
  - **Meal Guides:** The calorie guide for each meal accounts for what was already eaten in other meals during the day (unused budget of skipped meals carries forward, up to 1.5× the base share).
  - **Progress & Forecast (Statistics):** 7-day trend weight (dashed line on the chart), weekly rate, kilograms to goal, forecast date, plan vs. actual pace, and a plateau warning after 3+ weeks without progress.
  - **Adaptive Target:** After 2+ weeks of weigh-ins and complete diary days (breakfast, lunch and dinner all logged), real maintenance calories are estimated from average intake and weight trend, and an updated target is suggested (applied only on tap).
  - **Weekly Balance:** Under/over target for the current week and a softened guide for today (within ±15%, never below the minimum).
  - **Quick Actions:** Instant access to the AI Dietitian, manual meal entry, full diary, and weight logger.

- **Food Diary**:
  - Chronological meal logs categorized into Breakfast, Lunch, Dinner, and Snacks.
  - Full CRUD operations: add, edit, and delete individual food items (name, grams, calories, protein, fat, carbs).
  - Manual entry modal with macro-per-100g calculation.

- **Weight Tracking & Statistics**:
  - Weight log with historical records and date stamps.
  - Visual weight trend chart and weekly calorie intake distribution.

- **Personal Profile & Safe Plan**:
  - First-launch onboarding modal with immediate language selection (Ukrainian / English) and dismiss button.
  - Calculation of safe daily caloric targets based on age, gender, height, current weight, target weight, and activity level.

- **Storage & Synchronization**:
  - **Local-first:** Complete offline capability using browser `localStorage` (`smartdiet-v1`).
  - **Backup:** Export all meals, weight data, and goals to a JSON file, then import it on another device. Import replaces the data on the device where it runs. AI keys are not exported.
  - **Cloud Sync:** Optional multi-device synchronization via Supabase Auth (email/password) and PostgreSQL with Row Level Security (RLS). Every change (food, edits, deletions, weight, goals) is sent to the cloud right away; changes that cannot be sent yet stay on the device and are retried automatically. The status is shown in Settings → Account & cloud sync.
  - **Privacy:** AI provider API keys are saved exclusively in client-side storage.
  - **Statistics:** Charts and daily totals are calculated from saved food and weight records; statistics are not a separate data store.
  - **Data safety:** Clearing browser/site data, using private browsing, losing a browser profile, deleting a Supabase account, or losing an unexported local dataset can remove records. Export a JSON backup before clearing storage or switching accounts.

- **PWA & Mobile Optimization**:
  - Installable Progressive Web App (iOS, Android, Chromium desktop).
  - Offline asset caching via Service Worker (`sw.js`).
  - Responsive mobile navigation bar, centered touch modals, background scroll locking, and safe area insets.
  - Bilingual interface with seamless toggle between English and Ukrainian.

### Project Structure

```text
.
├── index.html          # Core application (UI, responsive styles, client logic)
├── manifest.json       # PWA metadata and icons configuration
├── sw.js               # Service Worker caching logic
├── icon.svg            # Application vector icon
├── package.json        # Dev dependency for browser smoke tests
├── playwright.config.js
├── tests/              # Browser smoke tests
├── supabase/
│   └── schema.sql      # Supabase database tables and RLS policies
├── AGENTS.md           # Guidelines for AI agents
├── LICENSE             # MIT License
└── README.md           # Documentation
```

### Getting Started

Because Smart Diet AI is built as a single-file client application, no build tools or package managers are required.

1. **Directly in Browser:** Open `index.html` in any modern web browser.
2. **Local HTTP Server:**
   ```bash
   python3 -m http.server 8080
   ```
   Navigate to `http://localhost:8080`.

### Browser Smoke Tests (optional)

Playwright checks the main flows in Chromium: saving goals, deleting entries (local and synced), uploading entries when the profile cannot be saved, switching accounts, and importing backups (confirmation, declining, and invalid files). Supabase is mocked, so no project or keys are needed.

```bash
npm install
npx playwright install chromium
npm run test:smoke
```

### Configuration

- **AI Provider:** In **Settings → AI provider**, enter API keys for Google Gemini, OpenAI, Anthropic Claude, or Groq and arrange them in priority order with the arrows. Keys remain in your local browser storage.
- **Supabase Cloud Sync (Optional):**
  1. The app is already connected to the shared Supabase project. Users only register or log in under **Settings → Account & cloud sync**; no SQL or keys are needed.
  2. To run your own copy: create a Supabase project, run `supabase/schema.sql` once in the SQL Editor, then set `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of the script in `index.html`. Never put a `service_role` key in the app.
  3. Email confirmation links use the site address. In Supabase, set **Authentication → URL Configuration → Site URL** to your deployed address (for example `https://smart-diet-ai-psi.vercel.app`) and add `<your address>/**` to **Redirect URLs**. Otherwise links point to `localhost`.
  4. After updating from an older version, run `supabase/schema.sql` again in the SQL Editor (it is safe to repeat); the Snack meal category needs the updated constraint.

---

## Українська версія

### Огляд

Smart Diet AI — адаптивний PWA-застосунок для свідомого контролю харчування, що поєднує щоденник прийомів їжі, облік БЖВ, графіки ваги та вбудованого ШІ-дієтолога для автоматичного розрахунку ваги порцій під залишок добової норми калорій.

### Можливості

- **ШІ-дієтолог (Gemini, OpenAI, Claude та Groq)**:
  - Автоматичний розрахунок ваги продуктів у грамах, калорій та БЖВ за простим списком страв (наприклад, «Твердий сир, кава з молоком»).
  - Врахування добової цілі калорій, уже спожитого за день, залишку та вибраного прийому їжі (сніданок, обід, вечеря, перекус).
  - Поради щодо збалансованості раціону, якщо в прийомі бракує білків або інших нутрієнтів.
  - Використовує `gemini-3.8-flash` з низьким рівнем міркування; на `gemini-3.5-flash-lite` переходить лише коли вичерпано добову або хвилинну квоту основної моделі. Автоповтор при тимчасових помилках, контроль таймаутів та кнопка повторного розрахунку.
  - Додавання розрахованих продуктів у щоденник в один клік.

- **Головна панель та цілі**:
  - **Баланс на сьогодні:** Прогрес-бари калорій, білків, жирів і вуглеводів з показником «з’їдено / залишилось».
  - **План за темпом:** Добова ціль калорій розраховується за обраним темпом (0,25 / 0,5 / 0,75 кг на тиждень) з обмеженням безпечного дефіциту (до 25% від підтримки, не нижче мінімуму калорій); білок рахується як 1,8 г на кг опорної ваги (цільова × 1,15 під час схуднення, але не вище поточної), не більше 2,2 г на кг поточної ваги. Зміна віку, статі, зросту, ваги, активності чи темпу автоматично перераховує ціль, якщо план уже створено. Цільова вага з ІМТ нижче 18,5 відхиляється.
  - **Перевірка ваги тіла (Статистика):** Півколо ІМТ (недостатня / нормальна / надмірна вага / ожиріння) за останньою внесеною вагою, зростом, віком і статтю, зі здоровим діапазоном ваги, рекомендованою вагою та різницею в кілограмах.
  - **Орієнтири по прийомах:** Орієнтир калорій для кожного прийому враховує вже з’їдене в інших прийомах за день (невикористаний бюджет пропущених прийомів переноситься, максимум 1,5× від базової частки).
  - **Прогрес і прогноз (Статистика):** Трендова вага за 7 днів (пунктир на графіку), темп на тиждень, кілограми до цілі, прогноз дати, порівняння плану з фактом і попередження про плато після 3+ тижнів без прогресу.
  - **Адаптивна ціль:** Після 2+ тижнів зважувань і повних днів обліку (зафіксовані сніданок, обід і вечеря) оцінюється реальна підтримка за середнім споживанням і трендом ваги та пропонується оновлена ціль (застосовується лише за натисканням).
  - **Баланс тижня:** Недобір або перебір за поточний тиждень і м’якший орієнтир на сьогодні (в межах ±15%, не нижче мінімуму).
  - **Прийоми їжі:** Списки страв на сніданок, обід, вечерю та перекус із підсумком калорій, білків, жирів і вуглеводів (на «Огляді» та в щоденнику за кожен день). ШІ-дієтолог розраховує лише названі користувачем продукти, а пропозиції подає текстом у пораді.
  - **Швидкі дії:** Виклик ШІ-дієтолога, ручне додавання страви, перегляд щоденника та запис ваги.

- **Щоденник харчування**:
  - Журнал за датами з поділом на прийоми їжі.
  - Створення, редагування та видалення записів (назва, вага в грамах, калорії, білки, жири, вуглеводи).
  - Розрахунок калорійності за даними на 100 г.

- **Історія ваги та статистика**:
  - Внесення показників ваги з фіксацією дати та часу.
  - Графік динаміки ваги та щотижневий розподіл калорій.

- **Зберігання даних і безпека**:
  - У локальному режимі записи зберігаються в `localStorage` браузера під ключем `smartdiet-v1`; статистика не є окремою копією, а щоразу обчислюється з журналу їжі та історії ваги.
  - Очищення даних сайту/браузера, приватний режим, втрата профілю браузера або видалення акаунта Supabase можуть видалити записи. Перед очищенням сховища чи зміною акаунта експортуй JSON-резервну копію.
  - Після підключення Supabase харчові записи та вага зберігаються в PostgreSQL у таблицях `food_entries` і `weight_entries`; RLS обмежує доступ рядками поточного користувача.

- **Профіль та безпечний план**:
  - Стартове вікно при першому запуску з миттєвим вибором мови (українська / English) та можливістю закриття.
  - Розрахунок рекомендованої добової калорійності за параметрами (дата народження, стать, зріст, поточна вага, цільова вага, рівень активності).

- **Збереження та синхронізація**:
  - **Локальний режим:** Повна автономна робота у сховищі браузера (`localStorage` / `smartdiet-v1`).
  - **Резервна копія:** Експорт усіх записів і цілей у JSON-файл та імпорт на іншому пристрої. Імпорт замінює дані на цьому пристрої. API-ключі у файл не потрапляють.
  - **Хмарна синхронізація:** Підключення Supabase (Auth + PostgreSQL з RLS) для збереження даних на кількох пристроях. Кожна зміна (їжа, редагування, видалення, вага, цілі) одразу надсилається в хмару; ще не надіслані зміни зберігаються на пристрої й надсилаються повторно автоматично. Статус видно в Налаштування → Акаунт та синхронізація.
  - **Приватність:** Ключі API провайдерів ШІ зберігаються лише на поточному пристрої.

- **PWA та мобільна оптимізація**:
  - Можливість встановлення як автономний застосунок на смартфони та ПК.
  - Кешування оболонки через Service Worker (`sw.js`).
  - Мобільне навігаційне меню, центрування спливаючих вікон, блокування фонової прокрутки та підтримка вирізів екрана.
  - Повна локалізація інтерфейсу двома мовами: українська та англійська.

### Структура репозиторію

```text
.
├── index.html          # Головний файл застосунку (UI, стилі, логіка)
├── manifest.json       # Маніфест PWA та метадані
├── sw.js               # Service Worker для офлайн-роботи
├── icon.svg            # Векторна іконка застосунку
├── package.json        # Dev-залежність для браузерних смоук-тестів
├── playwright.config.js
├── tests/              # Браузерні смоук-тести
├── supabase/
│   └── schema.sql      # Таблиці бази даних та політики RLS
├── AGENTS.md           # Інструкції для AI-асистентів
├── LICENSE             # Ліцензія MIT
└── README.md           # Документація проєкту
```

### Запуск

Застосунок працює без додаткових етапів збірки чи встановлення залежностей:

1. **У браузері:** Відкрийте `index.html`.
2. **Локальний сервер:**
   ```bash
   python3 -m http.server 8080
   ```
   Перейдіть на `http://localhost:8080`.

### Браузерні смоук-тести (необов’язково)

Playwright перевіряє основні сценарії в Chromium: збереження цілей, видалення записів (локальних і синхронізованих), вивантаження записів, коли профіль не вдалося зберегти, перемикання акаунтів та імпорт резервних копій (підтвердження, відмова й некоректні файли). Supabase замінено моком, тож проєкт і ключі не потрібні.

```bash
npm install
npx playwright install chromium
npm run test:smoke
```

### Налаштування

- **AI-провайдер:** У **Налаштування → AI-провайдер** вкажіть API-ключі для Google Gemini, OpenAI, Anthropic Claude або Groq і стрілками задайте порядок пріоритету. Якщо провайдер недоступний або ліміти вичерпано, автоматично використовується наступний.
- **Хмарна синхронізація (Supabase):**
  1. Застосунок уже підключений до спільного проєкту Supabase. Користувачам достатньо зареєструватися або увійти в **Налаштування → Акаунт та синхронізація**; SQL і ключі не потрібні.
  2. Для власної копії: створіть проєкт на [supabase.com](https://supabase.com), один раз застосуйте `supabase/schema.sql` у SQL Editor, потім вкажіть `SUPABASE_URL` і `SUPABASE_ANON_KEY` на початку скрипта в `index.html`. Ключ `service_role` у застосунку не використовуйте.
  3. Посилання для підтвердження пошти ведуть на адресу сайту. У Supabase встановіть **Authentication → URL Configuration → Site URL** на адресу вашого застосунку (наприклад, `https://smart-diet-ai-psi.vercel.app`) і додайте `<адреса>/**` у **Redirect URLs**. Інакше посилання вестимуть на `localhost`.
  4. Після оновлення зі старої версії ще раз виконайте `supabase/schema.sql` у SQL Editor (це безпечно); для категорії «Перекус» потрібне оновлене обмеження.

## Ліцензія

MIT License. Див. [LICENSE](LICENSE).
