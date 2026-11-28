const { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate } = require('./smoke.helpers');

async function waitForTransformTransition(locator) {
  await expect.poll(() => locator.evaluate((element) => {
    const transition = element.getAnimations().find((animation) => animation.transitionProperty === 'transform');
    return !transition || transition.playState === 'finished';
  })).toBe(true);
}

async function clearSleepFoodReminderCooldown(page) {
  await page.evaluate(() => {
    localStorage.removeItem('smartdiet-sleep-food-reminder');
    localStorage.removeItem('smartdiet-sleep-food-morning');
    if (typeof sleepFoodReminderAt !== 'undefined') sleepFoodReminderAt = 0;
    if (typeof sleepFoodMorningAt !== 'undefined') sleepFoodMorningAt = 0;
  });
}


test.describe('Smoke: accessibility', () => {
  test('settings fields and the diary date have accessible names', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const ids = ['auth-email', 'auth-password', 'auth-signup-name', 'auth-confirm-password', 'pref-name', 'pref-lang', 'pref-kcal', 'pref-protein', 'pref-carbs', 'pref-fat', 'profile-birth', 'profile-sex', 'profile-height', 'profile-weight', 'profile-weight-date', 'profile-target', 'profile-activity', 'profile-pace', 'profile-notes', 'diary-date'];
    const unnamed = await page.evaluate((list) => list.filter((id) => {
      const el = document.getElementById(id);
      return !el || !((el.labels && el.labels.length) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
    }), ids);
    expect(unnamed).toEqual([]);
  });

  test('dialogs are announced as dialogs with a name', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const bad = await page.evaluate(() => [...document.querySelectorAll('.modal-back')].filter((el) => {
      const label = el.getAttribute('aria-labelledby');
      return el.getAttribute('role') !== 'dialog' || el.getAttribute('aria-modal') !== 'true' || !label || !document.getElementById(label);
    }).map((el) => el.id));
    expect(bad).toEqual([]);
  });

  test('muted text colour keeps at least 4.5:1 contrast on the app backgrounds', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const ratio = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const parse = (hex) => { let v = hex.trim().replace('#', ''); if (v.length === 3) v = [...v].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255); };
      const lum = (rgb) => { const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const contrast = (a, b) => { const [hi, lo] = [lum(parse(a)), lum(parse(b))].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
      const muted = css.getPropertyValue('--muted');
      return Math.min(...['--bg', '--paper', '--mint'].map((name) => contrast(muted, css.getPropertyValue(name))));
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test('the body weight gauge has a text alternative', async ({ page }) => {
    await openApp(page, {
      prefs: { ...BASE_PREFS, setupComplete: true, birthDate: '1990-01-01', height: 175, currentWeight: 80, targetWeight: 72 },
      foods: [],
      weights: [],
    });
    await openView(page, 'stats');
    await expect(page.locator('#bmi-gauge svg')).toHaveAttribute('aria-label', /BMI \d+\.\d/);
  });
});

test.describe('Smoke: mobile layout at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('main screens have no horizontal overflow and the settings dropdown stays on screen', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    for (const v of ['home', 'diary', 'products', 'stats', 'settings']) {
      await page.locator(`#nav:visible [data-view="${v}"], #mobile-nav:visible [data-view="${v}"]`).first().click();
      await expect(page.locator(`#view-${v}`)).toHaveClass(/active/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await page.locator('#profile-activity').locator('xpath=..').locator('.dd-btn').click();
    const box = await page.evaluate(() => {
      const b = document.querySelector('#profile-activity').parentElement.querySelector('.dd-list').getBoundingClientRect();
      return { left: b.left, right: b.right, W: innerWidth };
    });
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.W);
  });

  test('meal eyes stay crisp and nutrition details align below them on narrow screens', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [
      { id:'11111111-1111-4111-8111-111111111111', name:'Вівсянка', meal:'breakfast', grams:100, kcal:200, protein:5, fat:3, carbs:30, date:today, createdAt:1 },
      { id:'22222222-2222-4222-8222-222222222222', name:'Яблуко', meal:'snack', grams:100, kcal:80, protein:1, fat:0, carbs:20, date:today, createdAt:2, snackId:'snack-a' },
      { id:'33333333-3333-4333-8333-333333333333', name:'Курка', meal:'lunch', grams:100, kcal:300, protein:30, fat:5, carbs:0, date:today, createdAt:3 },
      { id:'44444444-4444-4444-8444-444444444444', name:'Риба', meal:'dinner', grams:100, kcal:250, protein:25, fat:10, carbs:0, date:today, createdAt:4 },
    ], weights:[] });
    await openView(page, 'diary');
    const cards = page.locator('#diary-meals .meal-card');
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) {
      const bounds = await card.locator('.meal-top').evaluate(el => {
        const box = el.getBoundingClientRect();
        const eyeButton = el.querySelector('[data-meal-activity]');
        const icon = eyeButton.querySelector('.meal-activity-icon');
        const details = el.querySelector('.meal-details').getBoundingClientRect();
        const eyeBox = eyeButton.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el.querySelector('.meal-title'));
        const titleText = range.getBoundingClientRect();
        return { left: box.left, right: box.right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          eye: eyeBox, icon: iconBox, title: titleText, details,
          eyeBg: getComputedStyle(eyeButton).backgroundColor, iconBg: getComputedStyle(icon).backgroundColor,
          iconBorder: getComputedStyle(icon).borderWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(360);
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
      expect(bounds.title.left).toBeGreaterThanOrEqual(bounds.eye.right);
      expect(bounds.title.left - bounds.eye.right).toBeLessThanOrEqual(8);
      expect(Math.abs(bounds.icon.width - bounds.icon.height)).toBeLessThanOrEqual(0.5);
      expect(bounds.eyeBg).toBe('rgba(0, 0, 0, 0)');
      expect(bounds.iconBg).toBe('rgba(0, 0, 0, 0)');
      expect(bounds.iconBorder).toBe('0px');
      expect(Math.abs(bounds.details.left - bounds.eye.left)).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });

  test('home meals actions at 360px show analyze day, add food and all entries with equal widths in one row', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openView(page, 'home');
    const actions = page.locator('#view-home .home-meals-actions');
    await expect(actions).toBeVisible();
    const buttons = actions.locator('button');
    await expect(buttons).toHaveCount(3);
    const b1 = await buttons.nth(0).boundingBox();
    const b2 = await buttons.nth(1).boundingBox();
    const b3 = await buttons.nth(2).boundingBox();
    expect(b1.x).toBeLessThan(b2.x);
    expect(b2.x).toBeLessThan(b3.x);
    expect(Math.abs(b1.y - b2.y)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(b2.y - b3.y)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(b1.width - b2.width)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(b2.width - b3.width)).toBeLessThanOrEqual(1.5);
    expect(b3.x + b3.width).toBeLessThanOrEqual(360);
  });

  test('home meals actions at 390px show analyze day, add food and all entries in one row with equal widths without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openView(page, 'home');
    const actions = page.locator('#view-home .home-meals-actions');
    await expect(actions).toBeVisible();
    const buttons = actions.locator('button');
    await expect(buttons).toHaveCount(3);
    const b1 = await buttons.nth(0).boundingBox();
    const b2 = await buttons.nth(1).boundingBox();
    const b3 = await buttons.nth(2).boundingBox();
    expect(b1.x).toBeLessThan(b2.x);
    expect(b2.x).toBeLessThan(b3.x);
    expect(Math.abs(b1.y - b2.y)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(b2.y - b3.y)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(b1.width - b2.width)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(b2.width - b3.width)).toBeLessThanOrEqual(1.5);
    expect(b3.x + b3.width).toBeLessThanOrEqual(390);
  });
});

test('progress statistics cards follow the two-column mobile order: trend/goal/forecast and daily/weekly/total', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [
      { id: 'w-oct-26', value: 96.5, date: '2026-10-26' },
      { id: 'w-oct-30', value: 96, date: '2026-10-30' },
      { id: 'w-oct-31', value: 95.6, date: '2026-10-31' },
      { id: 'w-nov-02', value: 95.5, date: '2026-11-02' },
    ],
  });
  await page.evaluate(() => showView('stats'));
  const metrics = page.locator('#progress-stats .metric');
  await expect(metrics).toHaveCount(6);

  // Column 1 (Left column in row-based 2-col grid: indices 0, 2, 4)
  await expect(metrics.nth(0)).toContainText('Трендова вага');
  await expect(metrics.nth(2)).toContainText('До цілі');
  await expect(metrics.nth(4)).toContainText('Прогноз дати');

  // Column 2 (Right column in row-based 2-col grid: indices 1, 3, 5)
  await expect(metrics.nth(1)).toContainText('Середня втрата ваги за день');
  await expect(metrics.nth(3)).toContainText('Середнє за тиждень');
  await expect(metrics.nth(5)).toContainText('Загальна втрата від ваги в профілі');
});

test('stats metrics display info button and clicking it opens detailed description modal', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [
      { id: 'w-oct-26', value: 96.5, date: '2026-10-26' },
      { id: 'w-oct-30', value: 96, date: '2026-10-30' },
      { id: 'w-oct-31', value: 95.6, date: '2026-10-31' },
      { id: 'w-nov-02', value: 95.5, date: '2026-11-02' },
    ],
  });
  await page.evaluate(() => showView('stats'));
  const infoButtons = page.locator('#progress-stats .metric-info-btn');
  await expect(infoButtons).toHaveCount(6);

  // Click info on Trend weight
  await infoButtons.nth(0).click();
  await expect(page.locator('#info-modal')).toHaveClass(/open/);
  await expect(page.locator('#info-title')).toContainText('Трендова вага');
  await expect(page.locator('#info-body')).toContainText('7');

  // Close modal via close button
  await page.locator('#info-close').click();
  await expect(page.locator('#info-modal')).not.toHaveClass(/open/);

  // Click info on Daily loss
  await infoButtons.nth(1).click();
  await expect(page.locator('#info-modal')).toHaveClass(/open/);
  await expect(page.locator('#info-title')).toContainText('Середня втрата');

  // Close modal via backdrop click
  await page.locator('#info-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#info-modal')).not.toHaveClass(/open/);
});

test('mobile page titles and descriptions fit beside the date and weight at readable sizes in both languages', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
  await page.setViewportSize({ width: 360, height: 780 });

  const expectedUk = {
    home: ['Мій день', 'Їж усвідомлено, без складних підрахунків', 'Вкажи продукти. ШІ оцінить порції, а перед додаванням ти вибереш дату й прийом їжі.', '🥑'],
    diary: ['Щоденник харчування 📖', 'Переглядай записи за датами й калорії для кожного прийому їжі.', '🍎'],
    products: ['Мої продукти', 'Збережи продукти, які їси часто, і додавай їх у раціон одним натисканням. 🛒', '🥕'],
    stats: ['Статистика 🍩', 'Дивись на прогрес у часі, а не лише за один день.', '🫐'],
    settings: ['Налаштування', 'Профіль, мова, ШІ та хмарна синхронізація.', '🍋'],
  };
  const expectedEn = {
    home: ['My day', 'Eat mindfully, without complex math', 'Name the foods. AI estimates portions; choose a date and meal before adding.', '🥑'],
    diary: ['Food diary 📖', 'Review meals by date and track calories for each meal.', '🍎'],
    products: ['My products', 'Save foods you eat often and add them to your diary in one tap. 🛒', '🥕'],
    stats: ['Statistics 🍩', 'Look at progress over time, not just one day.', '🫐'],
    settings: ['Settings', 'Profile, language, AI and cloud sync.', '🍋'],
  };

  const checkView = async (view, expected) => {
    await openView(page, view);
    const intro = page.locator('.mobile-page-intro');
    await expect(intro).toBeVisible();
    await expect(intro.locator('h2')).toHaveText(expected[0]);
    if (view === 'home') {
      await expect(intro.locator('.mobile-page-tagline')).toHaveText(expected[1]);
      await expect(intro.locator('.mobile-page-desc')).toHaveText(expected[2]);
    } else {
      await expect(intro.locator('.mobile-page-tagline')).toBeHidden();
      await expect(intro.locator('.mobile-page-desc')).toHaveText(expected[1]);
    }
    const geometry = await page.evaluate(() => {
      const introElement = document.querySelector('.mobile-page-intro');
      const intro = introElement.getBoundingClientRect();
      const date = document.querySelector('#today-label').getBoundingClientRect();
      const weight = document.querySelector('#weight-badge').getBoundingClientRect();
      const title = document.querySelector('#mobile-page-title');
      const text = document.querySelector('#mobile-page-desc:not([hidden])');
      const tagline = document.querySelector('#mobile-page-tagline:not([hidden])');
      const artwork = getComputedStyle(introElement, '::after'); return { introRight: intro.right, dateLeft: date.left, weightLeft: weight.left, titleSize: parseFloat(getComputedStyle(title).fontSize), textSize: Math.min(...[text, tagline].filter(Boolean).map(el => parseFloat(getComputedStyle(el).fontSize))), artworkPosition: artwork.position, artworkContent: artwork.content, artworkZ: artwork.zIndex, artworkRight: parseFloat(artwork.right), artworkTop: parseFloat(artwork.top), artworkSize: parseFloat(artwork.fontSize), titleZ: getComputedStyle(title).zIndex, overflow: Array.from(introElement.querySelectorAll('h2,p:not([hidden])')).some(el => el.scrollWidth > el.clientWidth + 1) };
    });
    expect(geometry.introRight).toBeLessThanOrEqual(geometry.dateLeft);
    expect(geometry.introRight).toBeLessThanOrEqual(geometry.weightLeft);
    expect(geometry.titleSize).toBeGreaterThanOrEqual(24);
    expect(geometry.artworkPosition).toBe('absolute');
    expect(geometry.artworkContent).toContain(expected.at(-1));
    expect(Number(geometry.artworkZ)).toBeLessThan(Number(geometry.titleZ));
    expect(geometry.artworkRight).toBe(0);
    expect(geometry.artworkTop).toBe(22);
    expect(geometry.artworkSize).toBeCloseTo(86.4, 1);
    expect(geometry.textSize).toBeGreaterThanOrEqual(14);
    expect(geometry.overflow).toBe(false);
  };

  for (const view of Object.keys(expectedUk)) await checkView(view, expectedUk[view]);
  await page.selectOption('#pref-lang', 'en');
  await page.locator('#save-lang').click();
  for (const view of Object.keys(expectedEn)) await checkView(view, expectedEn[view]);
  await page.selectOption('#pref-lang', 'uk');
  await page.locator('#save-lang').click();
  await page.setViewportSize({ width: 430, height: 780 });
  for (const view of Object.keys(expectedUk)) await checkView(view, expectedUk[view]);
});

test('tablet keeps the section sidebar and uses the mobile content layout on every page', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });

  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 1024 });
    for (const view of ['home', 'diary', 'products', 'stats', 'settings']) {
      await openView(page, view);
      await expect(page.locator('.sidebar')).toBeVisible();
      await expect(page.locator('.mobilebar')).toBeHidden();
      await expect(page.locator('.mobile-page-intro')).toBeVisible();
      await expect(page.locator('.mobile-page-intro')).toHaveAttribute('data-page', view);
      const layout = await page.evaluate((name) => {
        const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
        const main = document.querySelector('.main').getBoundingClientRect();
        const active = document.querySelector('.view.active');
        const selectors = {
          home: '#view-home .stack',
          diary: '#diary-meals',
          products: '#view-products #products-toolbar',
          stats: '#view-stats>.grid',
          settings: '#view-settings>.grid',
        };
        const grid = active.querySelector(selectors[name]);
        return {
          sidebarLeft: sidebar.left,
          sidebarWidth: sidebar.width,
          mainLeft: main.left,
          mainRight: main.right,
          gridColumns: getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length,
          artworkTop: parseFloat(getComputedStyle(document.querySelector('.mobile-page-intro'), '::after').top),
          documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          viewOverflow: active.scrollWidth > active.clientWidth + 1,
        };
      }, view);
      expect(layout.sidebarLeft).toBe(0);
      expect(layout.artworkTop).toBe(12);
      expect(layout.sidebarWidth).toBe(width <= 950 ? 205 : 244);
      expect(layout.mainLeft).toBeGreaterThanOrEqual(layout.sidebarWidth);
      expect(layout.mainRight).toBeLessThanOrEqual(width + 1);
      expect(layout.documentOverflow).toBe(false);
      expect(layout.viewOverflow).toBe(false);
      if (view !== 'products') expect(layout.gridColumns).toBe(1);
      else expect(layout.gridColumns).toBe(2);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await openView(page, 'home');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.mobilebar')).toBeVisible();
  await expect(page.locator('.mobile-page-intro')).toBeVisible();
});

test('home hero card contains avocado illustration cleanly within bounds', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
  await page.setViewportSize({ width: 1280, height: 800 });
  const hero = page.locator('#view-home .card.hero');
  await expect(hero).toBeVisible();
  const styles = await hero.evaluate((el) => {
    const after = window.getComputedStyle(el, '::after');
    const h2 = el.querySelector('h2');
    const p = el.querySelector('p');
    return {
      minHeight: parseFloat(window.getComputedStyle(el).minHeight),
      top: parseFloat(after.top),
      right: parseFloat(after.right),
      h2Z: window.getComputedStyle(h2).zIndex,
      pZ: window.getComputedStyle(p).zIndex,
      afterZ: after.zIndex,
    };
  });
  expect(styles.top).toBe(16);
  expect(styles.minHeight).toBeGreaterThanOrEqual(140);
  expect(Number(styles.h2Z)).toBeGreaterThan(Number(styles.afterZ || 0));
  expect(Number(styles.pZ)).toBeGreaterThan(Number(styles.afterZ || 0));
});

test('calorie chart shows daily intake, goal details and filters by period', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-07T12:00:00') });
  const today = '2026-11-07';
  const day = (offset) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  };
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'en', kcal: 1800 },
    foods: [
      { id: 'c-today', name: 'Lunch', meal: 'lunch', kcal: 650, protein: 30, fat: 20, carbs: 70, date: today, createdAt: 3 },
      { id: 'c-4d', name: 'Dinner', meal: 'dinner', kcal: 1200, protein: 45, fat: 35, carbs: 140, date: day(4), createdAt: 2 },
      { id: 'c-zero', name: 'Uncounted meal', meal: 'breakfast', kcal: 0, protein: 0, fat: 0, carbs: 0, date: day(2), createdAt: 4 },
      { id: 'c-12d', name: 'Breakfast', meal: 'breakfast', kcal: 400, protein: 20, fat: 10, carbs: 50, date: day(12), createdAt: 1 },
      { id: 'c-40d', name: 'Older meal', meal: 'lunch', kcal: 2000, protein: 50, fat: 60, carbs: 220, date: day(40), createdAt: 0 },
    ],
    weights: [],
  });
  await page.evaluate(() => document.querySelector('#intro')?.remove());
  await openView(page, 'stats');
  await expect(page.locator('[data-i18n="calorieChartTitle"]')).toHaveText('Calorie trend');
  const localeParity = await page.evaluate(() => Object.keys(I.en).sort().join('|') === Object.keys(I.uk).sort().join('|'));
  expect(localeParity).toBe(true);
  const chart = page.locator('#calorie-chart');
  await expect(chart).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  await expect(chart.locator('[data-calorie-point]')).toHaveCount(3);
  await expect(chart.locator('[data-calorie-point][data-value="0"]')).toHaveCount(0);
  await expect(chart.locator(`[data-calorie-point][data-date="${day(2)}"]`)).toHaveCount(0);
  await expect(page.locator('#calorie-chart-summary')).toContainText('3 days logged');
  await expect(page.locator('#calorie-chart-summary')).toContainText('2,250 kcal total');
  await expect(chart.locator('line[stroke-dasharray="7 6"]')).toHaveCount(1);
  const todayPoint = chart.locator('[data-calorie-point]').last();
  await todayPoint.focus();
  await expect(page.locator('#calorie-chart-tooltip')).toBeVisible();
  await expect(page.locator('#calorie-chart-tooltip')).toContainText('650 kcal');
  await expect(page.locator('#calorie-chart-tooltip')).toContainText('1,800 kcal');
  await page.locator('[data-calorie-range="7d"]').click();
  await expect(page.locator('[data-calorie-range="7d"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('[data-calorie-point]')).toHaveCount(2);
  await expect(chart.locator('line[stroke="#28754f"]')).toHaveCount(1);
  await expect(chart.locator(`[data-calorie-point][data-date="${day(4)}"]`)).toBeVisible();
  await expect(page.locator('#calorie-chart-summary')).toContainText('2 days logged');
  await page.locator('[data-calorie-range="all"]').click();
  await expect(chart.locator('[data-calorie-point]')).toHaveCount(4);
  await expect(chart.locator('line[stroke="#28754f"]')).toHaveCount(3);
});

test('calorie chart keeps labels and points proportional on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date('2026-11-07T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk' },
    foods: [
      { id: 'c-mobile-a', name: 'Обід', meal: 'lunch', kcal: 700, protein: 30, fat: 20, carbs: 90, date: '2026-11-05', createdAt: 2 },
      { id: 'c-mobile-b', name: 'Вечеря', meal: 'dinner', kcal: 1100, protein: 40, fat: 35, carbs: 130, date: '2026-11-07', createdAt: 3 },
    ],
    weights: [],
  });
  await page.evaluate(() => document.querySelector('#intro')?.remove());
  await openView(page, 'stats');
  await expect(page.locator('[data-i18n="calorieChartTitle"]')).toHaveText('Динаміка калорій');
  const chart = page.locator('#calorie-chart');
  await expect(chart.locator('[data-calorie-point]')).toHaveCount(2);
  await expect(chart.locator('line[stroke="#28754f"]')).toHaveCount(1);
  await expect(page.locator('#calorie-chart-summary')).toContainText('Записано днів: 2');
  const measurements = await chart.evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    const point = svg.querySelector('[data-calorie-point] .calorie-point-hitarea').getBoundingClientRect();
    return { ratio: svg.viewBox.baseVal.width / svg.viewBox.baseVal.height, renderedRatio: rect.width / rect.height, pointDifference: Math.abs(point.width - point.height), width: rect.width };
  });
  expect(Math.abs(measurements.ratio - measurements.renderedRatio)).toBeLessThan(0.03);
  expect(measurements.pointDifference).toBeLessThan(1);
  expect(measurements.width).toBeLessThan(400);
});

test.describe('Smoke: phone back button', () => {
  const isOpen = (page, selector) => page.locator(selector).evaluate((el) => el.classList.contains('open'));
  const markAlive = (page) => page.evaluate(() => { window.__alive = 1; });
  const atBase = (page) => expect.poll(() => page.evaluate(() => (history.state && history.state.sd) || 0)).toBe(0);

  test('back closes an open dialog first and only then leaves the app', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await markAlive(page);
    await page.evaluate(() => openModal('food'));
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await page.goBack();
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => window.__alive)).toBe(1);
    await atBase(page);
  });

  test('back returns to the previous section one step at a time', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await markAlive(page);
    await openView(page, 'diary');
    await openView(page, 'settings');
    await expect(page.locator('#view-settings')).toHaveClass(/active/);
    await page.goBack();
    await expect(page.locator('#view-diary')).toHaveClass(/active/);
    await page.goBack();
    await expect(page.locator('#view-home')).toHaveClass(/active/);
    expect(await page.evaluate(() => window.__alive)).toBe(1);
    await atBase(page);
  });

  test('back closes only the top layer when a confirmation is open over a dialog', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(() => openModal('food'));
    await page.evaluate(() => { window.__confirmResult = 'pending'; askConfirm('Sure?').then((v) => { window.__confirmResult = v; }); });
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.goBack();
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#modal')).toHaveClass(/open/);
    expect(await page.evaluate(() => window.__confirmResult)).toBe(false);
    await page.goBack();
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
  });

  test('closing a dialog with the close button leaves no extra history step', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await markAlive(page);
    await page.evaluate(() => openModal('food'));
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => history.state && history.state.sd)).toBe(1);
    await page.locator('#modal-close').click();
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
    await atBase(page);
    await page.goBack();
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
  });

  test('back closes an open dropdown list before the dialog under it', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const milk = { id: '22222222-2222-4222-8222-222222222222', name: 'Milk', grams: 100, kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8 };
    await page.evaluate((product) => { state.products = [product]; openMealPicker(product); }, milk);
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await page.locator('#pick-modal .dd:has(#pick-portions) .dd-btn').click();
    await expect(page.locator('#pick-modal .dd.open')).toHaveCount(1);
    await page.goBack();
    await expect(page.locator('#pick-modal .dd.open')).toHaveCount(0);
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
  });

  test('back returns from manual entry to the choice screen before closing the dialog', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');
    await page.locator('#view-diary .toolbar [data-action="add-food"]').click();
    await page.locator('#food-add-manual').click();
    await expect(page.locator('#food-fields')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#food-fields')).toBeHidden();
    await expect(page.locator('#pick-product')).toBeVisible();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await page.goBack();
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
  });

  test('back steps out of the products picker pane before closing it', async ({ page }) => {
    const milk = { id: '22222222-2222-4222-8222-222222222222', name: 'Milk', grams: 100, kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8 };
    await openApp(page, { prefs: BASE_PREFS, products: [milk], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products[0]));
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await page.goBack();
    await expect(page.locator('#pick-modal')).not.toHaveClass(/open/);
  });

  test('back closes every dialog of the app', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const ids = await page.evaluate(() => [...document.querySelectorAll('.modal-back')].map((el) => el.id).filter((id) => id && id !== 'onboarding-modal'));
    const stuck = [];
    for (const id of ids) {
      await page.evaluate((target) => document.getElementById(target).classList.add('open'), id);
      await page.waitForTimeout(60);
      await page.goBack();
      await page.waitForTimeout(80);
      if (await isOpen(page, `#${id}`)) stuck.push(id);
      await page.evaluate((target) => document.getElementById(target).classList.remove('open'), id);
      await page.waitForTimeout(60);
    }
    expect(stuck).toEqual([]);
  });
});


test('home meals action buttons are placed in meals card between analyze day and all entries with equal widths', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
  await openView(page, 'home');

  const balanceAddBtn = page.locator('#view-home .card:has([data-i18n="todayBalance"]) [data-action="add-food"]');
  await expect(balanceAddBtn).toHaveCount(0);

  const actions = page.locator('#view-home .home-meals-actions');
  await expect(actions).toBeVisible();

  const buttons = actions.locator('button');
  await expect(buttons).toHaveCount(3);

  const analyzeBtn = buttons.nth(0);
  const addFoodBtn = buttons.nth(1);
  const allEntriesBtn = buttons.nth(2);

  await expect(analyzeBtn).toHaveAttribute('data-analyze', 'day');
  await expect(addFoodBtn).toHaveAttribute('data-action', 'add-food');
  await expect(allEntriesBtn).toHaveAttribute('data-go', 'diary');

  const b1 = await analyzeBtn.boundingBox();
  const b2 = await addFoodBtn.boundingBox();
  const b3 = await allEntriesBtn.boundingBox();

  expect(b1.x).toBeLessThan(b2.x);
  expect(b2.x).toBeLessThan(b3.x);
  expect(Math.abs(b1.y - b2.y)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(b2.y - b3.y)).toBeLessThanOrEqual(1.5);

  expect(Math.abs(b1.width - b2.width)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(b2.width - b3.width)).toBeLessThanOrEqual(1.5);

  await addFoodBtn.click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
});
