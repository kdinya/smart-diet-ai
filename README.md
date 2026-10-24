# Smart Diet AI

**Live Web App:** [https://smart-diet-ai-psi.vercel.app/](https://smart-diet-ai-psi.vercel.app/)

A client-side, mobile-first progressive web application for tracking nutrition, logging meals, monitoring body weight, and receiving AI-assisted portion calculations based on personal daily calorie targets.

---

## English

### Overview

Smart Diet AI helps users maintain a balanced diet without complicated math. It combines a daily food diary, macro tracker, weight log, and an integrated AI Dietitian that estimates food portions in grams and macros to fit within remaining daily calorie budgets.

### Features

- **AI Dietitian (Gemini & OpenAI)**:
  - Estimates portion weights in grams, calories, and macronutrients (protein, fats, carbs) for raw food inputs (e.g., "cottage cheese, eggs").
  - Dynamically accounts for daily calorie limits, consumed calories, remaining calories, and selected meal categories (Breakfast, Lunch, Dinner, Snack).
  - Offers nutritional recommendations when meals lack balance or key nutrients.
  - Automatic model fallback (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`), timeout handling, and retry button for slow network responses.
  - Direct one-click import of calculated items into the food diary.

- **Daily Overview & Goals**:
  - **Today's Balance:** Real-time summary of consumed vs. remaining calories, progress bar, and total protein, fat, and carb grams.
  - **Calorie Goals:** Displays recommended daily intake (based on profile metrics) alongside user-defined targets with quick-edit support.
  - **Meal Cards:** Breakdown of today's meals with calorie subtotals and item counts.
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
  - **Backup:** Single-click JSON export of all logged meals, weight data, and goals.
  - **Cloud Sync:** Optional multi-device synchronization via Supabase Auth (email/password) and PostgreSQL with Row Level Security (RLS).
  - **Privacy:** Gemini/OpenAI API keys are saved exclusively in client-side storage.
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

### Configuration

- **AI Provider:** In **Settings → AI provider**, choose Google Gemini or OpenAI and enter your API key. Keys remain in your local browser storage.
- **Supabase Cloud Sync (Optional):**
  1. Create a Supabase project at [supabase.com](https://supabase.com).
  2. Run `supabase/schema.sql` in the Supabase SQL Editor.
  3. Enter your Project URL and public `anon` key in **Settings → Account & cloud sync**, then register or log in.

---

## Українська версія

### Огляд

Smart Diet AI — адаптивний PWA-застосунок для свідомого контролю харчування, що поєднує щоденник прийомів їжі, облік БЖВ, графіки ваги та вбудованого ШІ-дієтолога для автоматичного розрахунку ваги порцій під залишок добової норми калорій.

### Можливості

- **ШІ-дієтолог (Gemini та OpenAI)**:
  - Автоматичний розрахунок ваги продуктів у грамах, калорій та БЖВ за простим списком страв (наприклад, «Твердий сир, кава з молоком»).
  - Врахування добової цілі калорій, уже спожитого за день, залишку та вибраного прийому їжі (сніданок, обід, вечеря, перекус).
  - Поради щодо збалансованості раціону, якщо в прийомі бракує білків або інших нутрієнтів.
  - Швидкий резервний перехід між моделями (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`), контроль таймаутів та повторна спроба при затримці відповіді.
  - Додавання розрахованих продуктів у щоденник в один клік.

- **Головна панель та цілі**:
  - **Баланс на сьогодні:** Поточний стан спожитих калорій проти залишку, візуальний прогрес і підсумок білків, жирів та вуглеводів у грамах.
  - **Ціль калорій:** Відображення рекомендованої норми за формулою та встановленої користувачем цілі з можливістю швидкої зміни.
  - **Прийоми їжі:** Списки страв на сніданок, обід, вечерю та перекус із підсумком калорій.
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
  - Розрахунок рекомендованої добової калорійності за параметрами (вік, стать, зріст, поточна вага, цільова вага, рівень активності).

- **Збереження та синхронізація**:
  - **Локальний режим:** Повна автономна робота у сховищі браузера (`localStorage` / `smartdiet-v1`).
  - **Резервна копія:** Експорт усіх записів і цілей у JSON-файл.
  - **Хмарна синхронізація:** Підключення Supabase (Auth + PostgreSQL з RLS) для збереження даних на кількох пристроях.
  - **Приватність:** Ключі API Gemini/OpenAI зберігаються лише на поточному пристрої.

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

### Налаштування

- **AI-провайдер:** У **Налаштування → AI-провайдер** вкажіть API-ключ для Google Gemini або OpenAI.
- **Хмарна синхронізація (Supabase):**
  1. Створіть проєкт на [supabase.com](https://supabase.com).
  2. Застосуйте `supabase/schema.sql` у розділі SQL Editor.
  3. Введіть Project URL та публічний `anon` ключ у розділі **Налаштування → Акаунт та синхронізація**.

## Ліцензія

MIT License. Див. [LICENSE](LICENSE).
