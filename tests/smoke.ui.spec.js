const { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate } = require('./smoke.helpers');

async function waitForTransformTransition(locator) {
  await expect.poll(() => locator.evaluate((element) => {
    const transition = element.getAnimations().find((animation) => animation.transitionProperty === 'transform');
    return !transition || transition.playState === 'finished';
  })).toBe(true);
}

test.describe('Smoke: app version', () => {
  test('shows the current release version in Settings in both interface languages', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    const release = await page.evaluate(() => ({
      version: APP_VERSION,
      newestFirst: APP_RELEASES.slice().reverse().map((item) => item.version),
      latest: APP_RELEASES[APP_RELEASES.length - 1],
    }));
    expect(release.newestFirst[0]).toBe(release.version);
    const entryFor = (version) => page.locator('#release-history-list > details').filter({ has: page.locator('summary', { hasText: version }) });

    await openView(page, 'settings');
    await expect(page.locator('#app-version')).toHaveText(release.version);
    await expect(page.locator('[data-i18n="appVersion"]')).toHaveText('Версія застосунку');
    await page.selectOption('#pref-lang', 'en');
    await page.locator('#save-lang').click();
    await expect(page.locator('#app-version')).toHaveText(release.version);
    await expect(page.locator('[data-i18n="appVersion"]')).toHaveText('App version');
    await page.locator('#app-version').click();
    await expect(page.locator('#release-history-modal')).toBeVisible();
    const versions = page.locator('#release-history-list > details');
    await expect(versions).toHaveCount(release.newestFirst.length);
    for (const [index, version] of release.newestFirst.entries()) {
      await expect(versions.nth(index).locator('summary')).toContainText(version);
    }
    const latest = versions.first();
    await latest.locator('summary').click();
    await expect(latest).toHaveAttribute('open', '');
    await expect(latest).toContainText(release.latest.description.en);
    const previous = entryFor('2026.10.4');
    await previous.locator('summary').click();
    await expect(previous).toContainText('Replaced raw database permission errors');
    const initial = entryFor('2026.10.0');
    await initial.locator('summary').click();
    await expect(initial).toContainText('bilingual food diary');
    await expect(initial).toContainText('Added');
    await page.locator('#release-history-close').click();
    await page.selectOption('#pref-lang', 'uk');
    await page.locator('#save-lang').click();
    await page.locator('#app-version').click();
    const latestUk = versions.first();
    await latestUk.locator('summary').click();
    await expect(latestUk).toContainText(release.latest.description.uk);
    const previousUk = entryFor('2026.10.4');
    await previousUk.locator('summary').click();
    await expect(previousUk).toContainText('Зрозуміліші помилки акаунта й синхронізації');
    const initialUk = entryFor('2026.10.0');
    await initialUk.locator('summary').click();
    await expect(initialUk).toContainText('Smart Diet AI — двомовний харчовий щоденник');
  });
});

test.describe('Smoke: product clipboard nutrition import', () => {
  test('shows copied nutrition text and editable parsed values before filling product form', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page, { prefs: BASE_PREFS, products: [], foods: [], weights: [] });
    await page.evaluate(async () => navigator.clipboard.writeText(`263 ккал\nТакож 1,100 кДж ● Енергія\nБілки\n6.93 г\nРекомендована добова норма споживання: 118 г\nВуглеводи\n30 г\nРекомендована добова норма споживання: 182 г\nЦукор\n12 г\nЖири\n11.93 г\nРекомендована добова норма споживання: 53 г\nНасичені жирні кислоти\n8 г`));
    await openView(page, 'products');
    await page.click('#product-new');
    await page.fill('#food-name', 'Test product');
    await page.fill('#food-grams', '100');
    await page.fill('#food-kcal', '200');
    await page.fill('#food-protein', '5');
    await page.fill('#food-fat', '4');
    await page.fill('#food-carbs', '25');
    await page.click('#product-import-clipboard');
    await expect(page.locator('#product-import-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-import-source')).toHaveValue(/263 ккал/);
    await expect(page.locator('#import-kcal')).toHaveValue('263');
    await expect(page.locator('#import-protein')).toHaveValue('6.93');
    await expect(page.locator('#import-fat')).toHaveValue('11.93');
    await expect(page.locator('#import-carbs')).toHaveValue('30');
    await expect(page.locator('#import-kcal-previous')).toHaveText('(was: 200)');
    await expect(page.locator('#import-protein-previous')).toHaveText('(was: 5)');
    await expect(page.locator('#import-fat-previous')).toHaveText('(was: 4)');
    await expect(page.locator('#import-carbs-previous')).toHaveText('(was: 25)');
    await page.fill('#import-protein', '7.1');
    await page.click('#product-import-confirm');
    await expect(page.locator('#product-import-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#food-kcal')).toHaveValue('263');
    await expect(page.locator('#food-protein')).toHaveValue('7.1');
    await expect(page.locator('#food-fat')).toHaveValue('11.93');
    await expect(page.locator('#food-carbs')).toHaveValue('30');
    await expect(page.locator('#food-name')).toHaveValue('Test product');
    await expect(page.locator('#food-kcal-previous')).toHaveText('(was: 200)');
    await expect(page.locator('#food-protein-previous')).toHaveText('(was: 5)');
    await expect(page.locator('#food-fat-previous')).toHaveText('(was: 4)');
    await expect(page.locator('#food-carbs-previous')).toHaveText('(was: 25)');
    await page.click('#food-save');
    await expect(page.locator('#food-kcal-previous')).toBeHidden();
    await expect(page.locator('#food-protein-previous')).toBeHidden();
    await expect(page.locator('#food-fat-previous')).toBeHidden();
    await expect(page.locator('#food-carbs-previous')).toBeHidden();

    // Closing the clipboard review modal without confirming clears previous values
    await page.locator('#products-list [data-toggle-product]').first().click();
    await page.locator('#products-list [data-edit-product]').first().click();
    await page.click('#product-import-clipboard');
    await expect(page.locator('#product-import-modal')).toHaveClass(/open/);
    await page.click('#product-import-close');
    await expect(page.locator('#product-import-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#food-kcal-previous')).toBeHidden();
    await expect(page.locator('#food-protein-previous')).toBeHidden();
    await expect(page.locator('#food-fat-previous')).toBeHidden();
    await expect(page.locator('#food-carbs-previous')).toBeHidden();
  });

  test('calorie search modal opens with google query, hides on tap and closes cleanly', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, products: [], foods: [], weights: [] });
    await openView(page, 'products');
    await page.click('#product-new');
    await page.fill('#food-name', 'Вівсянка');
    await page.click('#product-calc-search');
    await expect(page.locator('#calc-search-modal')).toHaveClass(/open/);
    await expect(page.locator('#calc-search-query')).toHaveText('Вівсянка');
    await expect(page.locator('#calc-search-open')).toHaveAttribute('href', /site%3Atablycjakalorijnosti\.com\.ua%20%D0%92%D1%96%D0%B2%D1%81%D1%8F%D0%BD%D0%BA%D0%B0/);

    // Pointerdown makes it transparent before navigation
    await page.locator('#calc-search-open').dispatchEvent('pointerdown');
    expect(await page.locator('#calc-search-modal').evaluate(el => el.style.opacity)).toBe('0');
    await page.locator('#calc-search-open').dispatchEvent('pointercancel');
    expect(await page.locator('#calc-search-modal').evaluate(el => el.style.opacity)).toBe('');

    await page.click('#calc-search-close');
    await expect(page.locator('#calc-search-modal')).not.toHaveClass(/open/);
  });

  test('shows a warning when copied text has no nutrition values', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page, { prefs: BASE_PREFS, products: [], foods: [], weights: [] });
    await page.evaluate(async () => navigator.clipboard.writeText('Just a product description, no nutrition facts.'));
    await openView(page, 'products');
    await page.click('#product-new');
    await page.fill('#food-name', 'Test product');
    await page.click('#product-import-clipboard');
    await expect(page.locator('#product-import-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#notif-stack')).toContainText('Could not confidently find calories');
  });
});

test.describe('Smoke: goals', () => {
  test('saves daily goals, keeps them after reload, and rejects invalid numbers', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });

    await openView(page, 'settings');
    await page.fill('#pref-kcal', '1800');
    await page.fill('#pref-protein', '120');
    await page.fill('#pref-carbs', '200');
    await page.fill('#pref-fat', '60');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Goals saved.');

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'settings');
    await expect(page.locator('#pref-kcal')).toHaveValue('1800');
    await expect(page.locator('#pref-protein')).toHaveValue('120');
    await expect(page.locator('#pref-carbs')).toHaveValue('200');
    await expect(page.locator('#pref-fat')).toHaveValue('60');

    await openView(page, 'home');
    await expect(page.locator('#home-kcal-left')).toHaveText('1800');

    await openView(page, 'settings');
    await page.fill('#pref-kcal', '-500');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Values must be numbers from 0 to 10000.');

    await page.fill('#pref-kcal', '0');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Values must be numbers from 0 to 10000.');

    const stored = await readStore(page);
    expect(stored.prefs.kcal).toBe(1800);
    expect(stored.prefs.protein).toBe(120);
  });
});

test.describe('Smoke: input limits and resilience', () => {
  test('values above the database limits are rejected in the forms', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(() => openModal('food', 'breakfast'));
    await page.fill('#food-name', 'Huge portion');
    await page.fill('#food-kcal', '99999999');
    await page.click('#food-save');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Values must be numbers from 0 to 10000.');
    expect((await readStore(page)).foods).toHaveLength(0);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '1000');
    await page.click('#weight-save');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Enter a weight from 1 to 500 kg.');
    expect((await readStore(page)).weights).toHaveLength(0);
  });

  test('a long food name is cut to the database limit', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(() => openModal('food', 'breakfast'));
    await page.locator('#food-name').evaluate((el) => { el.removeAttribute('maxlength'); });
    await page.fill('#food-name', 'x'.repeat(300));
    await page.fill('#food-kcal', '100');
    await page.click('#food-save');
    await expect.poll(async () => (await readStore(page)).foods.length).toBe(1);
    expect((await readStore(page)).foods[0].name).toHaveLength(120);
  });

  test('unreadable saved data does not break the app and a copy is kept', async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded-broken')) {
        sessionStorage.setItem('seeded-broken', '1');
        localStorage.setItem('smartdiet-v1', '{broken json');
      }
    });
    await page.goto('/');
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('unreadable', { timeout: 20_000 });
    const kept = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('smartdiet-corrupt-')).map((key) => localStorage.getItem(key)));
    expect(kept).toEqual(['{broken json']);
  });

  test('wrongly shaped saved data is repaired instead of crashing', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: 'oops', weights: 5, products: { a: 1 } });
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    const shapes = await page.evaluate(() => [state.foods, state.weights, state.products].map((list) => Array.isArray(list)));
    expect(shapes).toEqual([true, true, true]);
  });

  test('the app loads no scripts from other hosts and ships a content security policy', async ({ page }) => {
    const external = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (req.resourceType() === 'script' && url.origin !== new URL(page.url() === 'about:blank' ? 'http://localhost' : page.url()).origin) external.push(req.url());
    });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    expect(external).toEqual([]);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('cdn.jsdelivr.net');
    expect(await page.evaluate(() => typeof window.supabase?.createClient)).toBe('function');
  });
});

test.describe('Smoke: first-run setup', () => {
  test('first-run choice offers sign-in, registration, and guest profile setup', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false, pace: 20 }, foods: [], weights: [] });
    await expect(page.locator('#onboarding-modal')).toHaveClass(/open/);
    await expect(page.locator('#onboarding-choice-signin')).toBeVisible();
    await expect(page.locator('#onboarding-choice-signup')).toBeVisible();
    await expect(page.locator('#onboarding-choice-guest')).toBeVisible();
    await expect(page.locator('.onboarding-account-note')).toBeVisible();
    await expect(page.locator('.onboarding-account-note')).toContainText('email and password');
    await expect(page.locator('#onboarding-profile')).toBeHidden();
    await page.locator('#onboarding-choice-guest').click();
    await expect(page.locator('#onboarding-profile')).toBeVisible();
    await expect(page.locator('#onboard-name')).toBeAttached();
    await expect(page.locator('#onboard-birth')).toBeAttached();
    await expect(page.locator('#onboard-sex')).toBeAttached();
    await expect(page.locator('#onboard-height')).toBeAttached();
    await expect(page.locator('#onboard-weight')).toBeAttached();
    await expect(page.locator('#onboard-activity')).toBeAttached();
    await expect(page.locator('#onboard-pace')).toBeAttached();
    const order = await page.evaluate(() => {
      const activity = document.querySelector('#onboard-activity').closest('.field');
      const pace = document.querySelector('#onboard-pace').closest('.field');
      return activity.compareDocumentPosition(pace) & Node.DOCUMENT_POSITION_FOLLOWING ? 'activity-before-pace' : 'wrong';
    });
    expect(order).toBe('activity-before-pace');
    await page.evaluate(() => {
      const pace = document.querySelector('#onboard-pace');
      pace.value = '0';
      pace.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#onboard-target-field')).toBeHidden();
  });

  test('guest setup saves the completed plan locally without signing in', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false, pace: 20 }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-guest').click();
    await page.evaluate(() => {
      const set = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('onboard-name', 'Guest');
      set('onboard-birth', '1990-01-01');
      set('onboard-height', '170');
      set('onboard-weight', '70');
      set('onboard-target', '');
      set('onboard-pace', '0');
    });
    await page.locator('#onboarding-save').click();
    await expect.poll(async () => (await readStore(page)).prefs?.setupComplete).toBe(true);
    const store = await readStore(page);
    expect(store.prefs.name).toBe('Guest');
    expect(store.prefs.pace).toBe(0);
    expect(store.prefs.targetWeight).toBeFalsy();
    expect(store.prefs.recommendation.maintenance).toBe(true);
    expect(store.prefs.kcal).toBeGreaterThan(0);
    expect(store.prefs.protein).toBeGreaterThan(0);
    expect(store.synced?.uid).toBeUndefined();
    await expect(page.locator('#onboarding-modal')).not.toHaveClass(/open/);
    await page.reload();
    await expect(page.locator('#onboarding-modal')).not.toHaveClass(/open/);
  });

  test('sign-in opens the sign-in form and returns to plan setup for an incomplete profile', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signin').click();
    await expect(page.locator('#onboard-auth-submit')).toContainText('Sign in');
    await page.fill('#onboard-auth-email', 'alice@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect.poll(async () => (await readStore(page)).synced?.uid).toBe(USERS['alice@example.test']);
    await expect(page.locator('#onboarding-profile')).toBeVisible();
    await expect(page.locator('#onboarding-modal')).toHaveClass(/open/);
  });

  test('registration opens a signup form and submits email and password to Supabase signup', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await expect(page.locator('#onboard-auth-submit')).toContainText('Create account');
    await expect(page.locator('#onboard-auth-password')).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.locator('#onboard-username-field')).toBeVisible();
    await page.fill('#onboard-username', 'Alice');
    await page.fill('#onboard-auth-email', 'new@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect.poll(async () => backend.authEvents).toEqual([{ action: 'signup', email: 'new@example.test' }]);
    await expect.poll(async () => (await readStore(page)).synced?.uid).toBe(USERS['new@example.test']);
    await expect(page.locator('#onboarding-profile')).toBeVisible();
    await expect(page.locator('#onboarding-greeting')).toHaveText('Welcome, Alice!');
    await expect(page.locator('#onboard-name')).toHaveValue('Alice');
  });

  test('registration without a username is blocked before Supabase signup', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await page.fill('#onboard-auth-email', 'noname@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Enter a username to create an account.');
    expect(backend.authEvents).toEqual([]);
  });
});

test.describe('Smoke: accessibility', () => {
  test('settings fields and the diary date have accessible names', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const ids = ['auth-email', 'auth-password', 'pref-name', 'pref-lang', 'pref-kcal', 'pref-protein', 'pref-carbs', 'pref-fat', 'profile-birth', 'profile-sex', 'profile-height', 'profile-weight', 'profile-weight-date', 'profile-target', 'profile-activity', 'profile-pace', 'profile-notes', 'diary-date'];
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

test.describe('Smoke: meals, balance layout and weight picker', () => {
  test('a snack can be added and shows up in the diary and on the overview', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await expect(page.locator('#diary-meals .meal-card')).toHaveCount(4);
    await addFood(page, 'Apple', 'snack');
    await expect.poll(() => backend.tables.food_entries.map((row) => row.meal_type)).toEqual(['snack']);
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 1' })).toHaveCount(1);

    await openView(page, 'home');
    await expect(page.locator('#home-meals .meal-card')).toHaveCount(4);
    await expect(page.locator('#home-meals')).toContainText('Apple');
    await expect(page.locator('#chat-meal')).toHaveCount(0);
  });

  test('multiple snack events are numbered, grouped, and survive reload', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => { window.__testNow = Date.now(); Date.now = () => window.__testNow; window.__advanceTestClock = ms => { window.__testNow += ms; localStorage.setItem('smartdiet-sleep-food-reminder', String(window.__testNow)); }; });
    await openView(page, 'diary');
    await addFood(page, 'Apple', 'snack');
    let first = page.locator('#diary-meals [data-meal-key*="|snack|"]').first();
    await first.locator('[data-action="add-food"]').click();
    for (const [id, value] of [['#food-name','Pear'],['#food-grams','100'],['#food-kcal','50'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','12']]) await page.fill(id,value);
    await page.click('#food-save');
    await page.evaluate(() => window.__advanceTestClock(60 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    for (const [id, value] of [['#food-name','Banana'],['#food-grams','100'],['#food-kcal','90'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','23']]) await page.fill(id,value);
    await page.click('#food-save');
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 1' })).toHaveCount(1);
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 2' })).toHaveCount(1);
    const foods = (await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(foods).toHaveLength(3);
    expect(foods[0].snackId).toBe(foods[1].snackId);
    expect(foods[2].snackId).not.toBe(foods[0].snackId);
    await page.reload();
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 1' })).toHaveCount(1);
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 2' })).toHaveCount(1);
  });

  test('meal activity icons toggle totals while preserving food entries', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); });
    await openApp(page, { prefs: BASE_PREFS, foods: [
      { id:'aaaa1111-1111-4111-8111-111111111111', name:'Today oats', meal:'lunch', grams:100, kcal:300, protein:10, fat:5, carbs:50, date:today, createdAt:1 },
      { id:'bbbb2222-2222-4222-8222-222222222222', name:'Tomorrow oats', meal:'lunch', grams:100, kcal:600, protein:20, fat:10, carbs:100, date:tomorrow, createdAt:2 },
    ], weights:[] });
    await openView(page,'diary');
    await page.evaluate(date=>{let input=document.querySelector('#diary-date');input.value=date;input.dispatchEvent(new Event('change'))},tomorrow);
    const future=page.locator('#diary-meals .meal-card').nth(1);
    await expect(future).toHaveClass(/excluded/);
    await expect(future.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'closed');
    await expect(future.locator('.meal-activity-status')).toHaveCount(0);
    const futureHeader = await future.locator('.meal-top').evaluate(el => {
      const eye = el.querySelector('[data-meal-activity]').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el.querySelector('.meal-title'));
      const title = range.getBoundingClientRect();
      return { eyeRight: eye.right, titleLeft: title.left };
    });
    expect(futureHeader.eyeRight).toBeLessThanOrEqual(futureHeader.titleLeft);
    await expect(future.locator('.meal-list')).toContainText('Tomorrow oats');
    await expect(future.locator('.meal-kcal')).toContainText('600 / 700');
    await future.locator('[data-meal-activity]').click();
    await expect(future).not.toHaveClass(/excluded/);
    await expect(future.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await expect(future.locator('.meal-kcal')).toContainText('600 / 700');
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(true);

    const confirmations=[]; await autoConfirm(page,true,confirmations);
    await openView(page,'diary');
    const current=page.locator('#diary-meals .meal-card').nth(1);
    await expect(current.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await current.locator('[data-meal-activity]').click();
    await expect.poll(()=>confirmations.length).toBe(1);
    await expect(current).toHaveClass(/excluded/);
    await expect(current.locator('.meal-list')).toContainText('Today oats');
    await expect(current.locator('.meal-kcal')).toContainText('300 / 700');
    expect((await readStore(page)).prefs.mealActivity[`${today}|lunch`]).toBe(false);
  });

  test('inactive meal keeps its own stats, anchors snacks, and stays excluded after date rollover', async ({ page }) => {
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en', mealActivity: {
      [`${tomorrow}|breakfast`]: true,
      [`${tomorrow}|lunch`]: false,
      [`${tomorrow}|dinner`]: true,
    } }, foods: [
      { id:'aaaa1111-1111-4111-8111-111111111111', name:'Breakfast oats', meal:'breakfast', grams:100, kcal:100, protein:5, fat:2, carbs:15, date:tomorrow, createdAt:100 },
      { id:'bbbb2222-2222-4222-8222-222222222222', name:'Lunch rice', meal:'lunch', grams:100, kcal:600, protein:12, fat:4, carbs:80, date:tomorrow, createdAt:200 },
      { id:'cccc3333-3333-4333-8333-333333333333', name:'Afternoon apple', meal:'snack', grams:100, kcal:80, protein:0, fat:0, carbs:20, date:tomorrow, createdAt:300, snackId:'afternoon-snack' },
      { id:'dddd4444-4444-4444-8444-444444444444', name:'Dinner fish', meal:'dinner', grams:100, kcal:300, protein:25, fat:12, carbs:5, date:tomorrow, createdAt:400 },
    ], weights:[] });
    await openView(page, 'diary');
    await page.evaluate(date => { const input=document.querySelector('#diary-date'); input.value=date; input.dispatchEvent(new Event('change')); }, tomorrow);
    const titles = () => page.locator('#diary-meals .meal-title').allTextContents();
    expect(await titles()).toEqual(['Breakfast', 'Lunch', 'Snack 1', 'Dinner']);
    let lunch = page.locator('#diary-meals .meal-card').nth(1);
    await expect(lunch).toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-kcal')).toContainText('600 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('400');

    const nextDayTime = await page.evaluate(date => new Date(`${date}T12:00:00`).getTime(), tomorrow);
    await page.addInitScript(time => {
      const NativeDate = Date;
      class FixedDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
      }
      Object.defineProperty(window, 'Date', { value: FixedDate });
    }, nextDayTime);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    lunch = page.locator('#diary-meals .meal-card').nth(1);
    await expect(lunch).toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'closed');
    await expect(lunch.locator('.meal-kcal')).toContainText('600 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('480');
    expect(await titles()).toEqual(['Breakfast', 'Lunch', 'Snack 1', 'Dinner']);

    await lunch.locator('[data-meal-activity]').click();
    await expect(lunch).not.toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('1080');
    expect(await titles()).toEqual(['Breakfast', 'Lunch', 'Snack 1', 'Dinner']);
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(true);
  });

  test('food added for tomorrow remains excluded after that date arrives until activated', async ({ page }) => {
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); });
    const nextDayTime = await page.evaluate(date => new Date(`${date}T12:00:00`).getTime(), tomorrow);
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights:[] });
    await openView(page, 'diary');
    await page.evaluate(date => { const input=document.querySelector('#diary-date'); input.value=date; input.dispatchEvent(new Event('change')); }, tomorrow);
    await page.locator('#diary-meals .meal-card').nth(1).locator('[data-toggle-meal]').click();
    await addFood(page, 'Tomorrow lunch', 'lunch');
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(false);
    await expect(page.locator('#diary-meals .meal-card').nth(1)).toHaveClass(/excluded/);
    await expect(page.locator('#diary-meals .meal-card').nth(1).locator('.meal-kcal')).toContainText('250 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('0');

    await page.addInitScript(time => {
      const NativeDate = Date;
      class FixedDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
      }
      Object.defineProperty(window, 'Date', { value: FixedDate });
    }, nextDayTime);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    const lunch = page.locator('#diary-meals .meal-card').nth(1);
    await expect(lunch).toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'closed');
    await expect(lunch.locator('.meal-kcal')).toContainText('250 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('0');
    await lunch.locator('[data-meal-activity]').click();
    await expect(lunch).not.toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('250');
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(true);
  });

  test('past meal activity is always counted and eye controls appear only for today and tomorrow', async ({ page }) => {
    const dates = await page.evaluate(() => {
      const today = new Date();
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      return { today: today.toLocaleDateString('en-CA'), yesterday: yesterday.toLocaleDateString('en-CA'), dayAfterTomorrow: dayAfterTomorrow.toLocaleDateString('en-CA') };
    });
    await openApp(page, { prefs: { ...BASE_PREFS, mealActivity: { [`${dates.yesterday}|lunch`]: false } }, foods: [
      { id:'51515151-5151-4151-8151-515151515151', name:'Вчорашня каша', meal:'lunch', grams:100, kcal:300, protein:10, fat:5, carbs:50, date:dates.yesterday, createdAt:1 },
      { id:'61616161-6161-4161-8161-616161616161', name:'Пізній запис', meal:'lunch', grams:100, kcal:400, protein:15, fat:8, carbs:60, date:dates.dayAfterTomorrow, createdAt:2 },
    ], weights:[] });
    await openView(page, 'diary');
    const selectDiaryDate = async (date) => {
      await page.click('#diary-date');
      while (true) {
        const visibleMonth = (await page.locator('#cal-days .cal-day').first().getAttribute('data-cal-date')).slice(0, 7);
        if (visibleMonth === date.slice(0, 7)) break;
        await page.locator(visibleMonth < date.slice(0, 7) ? '#cal-next' : '#cal-prev').click();
      }
      await page.locator(`[data-cal-date="${date}"]`).click();
      await page.click('#cal-done');
    };
    await selectDiaryDate(dates.yesterday);
    const yesterdayCard = page.locator('#diary-meals .meal-card').nth(1);
    await expect(yesterdayCard.locator('.meal-title')).toContainText('Lunch');
    await expect(yesterdayCard).not.toHaveClass(/excluded/);
    await expect(yesterdayCard.locator('[data-meal-activity]')).toHaveCount(0);
    await expect(yesterdayCard.locator('.meal-kcal')).toContainText('300 / 700');

    await selectDiaryDate(dates.dayAfterTomorrow);
    const futureCard = page.locator('#diary-meals .meal-card').nth(1);
    await expect(futureCard.locator('[data-meal-activity]')).toHaveCount(0);
    await expect(futureCard).toHaveClass(/excluded/);
    await expect(futureCard.locator('.meal-kcal')).toContainText('400 / 700');
  });

  test('snack arrows move a snack across fixed main meals and persist', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page,{prefs:{...BASE_PREFS,lang:'en'},foods:[
      {id:'cccc1111-1111-4111-8111-111111111111',name:'Breakfast food',meal:'breakfast',grams:100,kcal:200,protein:5,fat:3,carbs:30,date:today,createdAt:100,mealOrder:1},
      {id:'dddd2222-2222-4222-8222-222222222222',name:'Snack food',meal:'snack',grams:100,kcal:100,protein:2,fat:1,carbs:20,date:today,createdAt:200,mealOrder:2,snackId:'snack-a'},
      {id:'eeee3333-3333-4333-8333-333333333333',name:'Lunch food',meal:'lunch',grams:100,kcal:300,protein:10,fat:5,carbs:40,date:today,createdAt:300,mealOrder:3},
      {id:'ffff4444-4444-4444-8444-444444444444',name:'Dinner food',meal:'dinner',grams:100,kcal:400,protein:20,fat:8,carbs:50,date:today,createdAt:400,mealOrder:4},
    ],weights:[]});
    await openView(page,'diary');
    const cards=page.locator('#diary-meals .meal-card');
    await expect(cards).toHaveCount(4);
    let titles=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(titles).toEqual(['Breakfast','Snack 1','Lunch','Dinner']);
    const snack=page.locator('#diary-meals [data-meal-key*="|snack|"]').first();
    await snack.locator('[data-snack-move="1"]').click();
    titles=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(titles).toEqual(['Breakfast','Lunch','Snack 1','Dinner']);
    await snack.locator('[data-snack-move="-1"]').click();
    titles=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(titles).toEqual(['Breakfast','Snack 1','Lunch','Dinner']);
    await page.reload();
    await expect(page.locator('#diary-meals .meal-title')).toHaveText(['Breakfast','Snack 1','Lunch','Dinner']);
  });

  test('main meals stay in breakfast-lunch-dinner order when added out of order', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openView(page, 'diary');
    await addFood(page, 'Dinner food', 'dinner');
    await addFood(page, 'Breakfast food', 'breakfast');
    await addFood(page, 'Lunch food', 'lunch');
    const labels=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(labels.indexOf('Сніданок')).toBeLessThan(labels.indexOf('Обід'));
    expect(labels.indexOf('Обід')).toBeLessThan(labels.indexOf('Вечеря'));
    await page.locator('#diary-meals [data-meal="snack"]').first().click();
    for (const [id, value] of [['#food-name','Snack food'],['#food-grams','100'],['#food-kcal','90'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','23']]) await page.fill(id,value);
    await page.click('#food-save');
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Перекус 1' })).toHaveCount(1);
    const ordered=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(ordered.indexOf('Сніданок')).toBeLessThan(ordered.indexOf('Обід'));
    expect(ordered.indexOf('Обід')).toBeLessThan(ordered.indexOf('Вечеря'));
    expect(ordered.indexOf('Вечеря')).toBeLessThan(ordered.indexOf('Перекус 1'));
  });

  test('snacks added less than an hour apart share the same snack event', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => { window.__testNow = Date.now(); Date.now = () => window.__testNow; window.__advanceTestClock = ms => { window.__testNow += ms; localStorage.setItem('smartdiet-sleep-food-reminder', String(window.__testNow)); }; });
    await openView(page, 'diary');
    await addFood(page, 'Apple', 'snack');
    const firstId=(await readStore(page)).foods.find(f=>f.meal==='snack').snackId;
    await page.evaluate(() => window.__advanceTestClock(59 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    for (const [id, value] of [['#food-name','Pear'],['#food-grams','100'],['#food-kcal','50'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','12']]) await page.fill(id,value);
    await page.click('#food-save');
    let foods=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(foods).toHaveLength(2);
    expect(foods[0].snackId).toBe(firstId);
    expect(foods[1].snackId).toBe(firstId);
    await page.evaluate(() => window.__advanceTestClock(60 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    for (const [id, value] of [['#food-name','Banana'],['#food-grams','100'],['#food-kcal','90'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','23']]) await page.fill(id,value);
    await page.click('#food-save');
    foods=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(foods).toHaveLength(3);
    expect(foods[2].snackId).not.toBe(firstId);
  });

  test('a main meal interrupts the snack hour but an existing snack can still receive food', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => { window.__testNow = Date.now(); Date.now = () => window.__testNow; window.__advanceTestClock = ms => { window.__testNow += ms; localStorage.setItem('smartdiet-sleep-food-reminder', String(window.__testNow)); }; });
    await openView(page, 'diary');
    await addFood(page, 'Apple', 'snack');
    const firstId=(await readStore(page)).foods.find(f=>f.meal==='snack').snackId;
    await page.evaluate(() => window.__advanceTestClock(15 * 60 * 1000));
    await addFood(page, 'Lunch', 'lunch');
    await page.evaluate(() => window.__advanceTestClock(10 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    for (const [id, value] of [['#food-name','Pear'],['#food-grams','100'],['#food-kcal','50'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','12']]) await page.fill(id,value);
    await page.click('#food-save');
    let snacks=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(snacks).toHaveLength(2);
    expect(snacks[0].snackId).toBe(firstId);
    expect(snacks[1].snackId).not.toBe(firstId);
    const firstCard=page.locator(`#diary-meals [data-meal-key*="|snack|${firstId}"]`).first();
    await firstCard.locator('[data-action="add-food"]').click();
    for (const [id, value] of [['#food-name','Orange'],['#food-grams','100'],['#food-kcal','45'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','11']]) await page.fill(id,value);
    await page.click('#food-save');
    snacks=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(snacks).toHaveLength(3);
    expect(snacks[2].snackId).toBe(firstId);
  });

  test('today balance shows two blocks per row', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const boxes = await page.locator('#view-home .stats .metric').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.querySelector('strong').id, top: Math.round(r.top), left: Math.round(r.left) };
    }));
    expect(boxes.map((b) => b.id)).toEqual(['home-kcal', 'home-protein', 'home-fat', 'home-carbs']);
    expect(boxes[0].top).toBe(boxes[1].top);
    expect(boxes[2].top).toBe(boxes[3].top);
    expect(boxes[2].top).toBeGreaterThan(boxes[0].top);
    expect(boxes[0].left).toBe(boxes[2].left);
  });

  test('diary shows eaten against the daily target, green in range and red well above', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const food = (id, kcal) => ({ id, name: `Item ${id}`, meal: 'lunch', grams: 100, kcal, protein: 10, fat: 70, carbs: 300, date: today, createdAt: Date.now() });
    await openApp(page, {
      prefs: { ...BASE_PREFS, kcal: 2000, protein: 10, fat: 70, carbs: 242 },
      foods: [food('11111111-1111-4111-8111-111111111111', 2000), food('22222222-2222-4222-8222-222222222222', 0)],
      weights: [],
    });
    await openView(page, 'diary');
    const totals = page.locator('#diary-summary .day-total');
    await expect(totals).toHaveCount(4);
    await expect(totals.nth(0)).toContainText('2000/2000');
    await expect(totals.nth(0)).toHaveClass(/ok/);
    await expect(totals.nth(1)).toContainText('20/10');
    await expect(totals.nth(1)).toHaveClass(/over/);
    await expect(totals.nth(2)).toContainText('140/70');
    await expect(totals.nth(2)).toHaveClass(/over/);
    await expect(totals.nth(3)).toContainText('600/242');
    await expect(totals.nth(3)).toHaveClass(/over/);
    const colors = await totals.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
    expect(colors[0]).not.toBe(colors[1]);
  });

  test('diary colors tell apart below, within and above the daily target', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: { ...BASE_PREFS, kcal: 2000, protein: 100, fat: 70, carbs: 242 },
      foods: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Mixed', meal: 'lunch', grams: 100, kcal: 1500, protein: 100, fat: 90, carbs: 300, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await openView(page, 'diary');
    const totals = page.locator('#diary-summary .day-total');
    await expect(totals.nth(0)).toHaveClass(/under/);
    await expect(totals.nth(1)).toHaveClass(/ok/);
    await expect(totals.nth(2)).toHaveClass(/over/);
    await expect(totals.nth(3)).toHaveClass(/high/);
    const colors = await totals.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
    expect(new Set(colors).size).toBe(4);
  });

  test('dietitian has no meal selector and shows meal choice only in add configuration', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openDietitianChat(page);
    await expect(page.locator('#chat-meal')).toHaveCount(0);
    await expect(page.locator('#chat-panel .chat-context select')).toHaveCount(0);
  });

  test('diary info popup explains the colors', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');
    await page.click('#diary-summary [data-day-info]');
    await expect(page.locator('#info-modal')).toHaveClass(/open/);
    await expect(page.locator('#info-body .info-row')).toHaveCount(4);
    await page.click('#info-close');
    await expect(page.locator('#info-modal')).not.toHaveClass(/open/);
  });

  test('AI provider order is saved as soon as it is changed', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'settings');
    for (let i = 0; i < 3; i++) await page.click('.ai-row[data-prov="groq"] [data-ai-move="-1"]');
    await expect.poll(async () => (await readStore(page)).ai.order[0]).toBe('groq');
  });

  test('weight form starts from the latest recorded weight', async ({ page }) => {
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [],
      weights: [
        { id: '44444444-4444-4444-8444-444444444444', value: 82.3, date: '2026-10-01' },
        { id: '55555555-5555-4555-8555-555555555555', value: 80.4, date: '2026-10-20' },
      ],
    });
    await page.evaluate(() => openModal('weight'));
    await expect(page.locator('#weight-value')).toHaveValue('80.4');
  });

  test('dietitian has no separate meal selection control', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const meals = await page.evaluate(() => [8, 12, 15, 16, 21].map((h) => autoMeal(h)));
    expect(meals).toEqual(['breakfast', 'lunch', 'lunch', 'dinner', 'dinner']);
    await openDietitianChat(page);
    await expect(page.locator('#chat-meal')).toHaveCount(0);
  });

  test('dietitian input grows up to five lines and then scrolls', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openDietitianChat(page);
    const input = page.locator('#chat-input');
    const one = (await input.boundingBox()).height;
    await input.fill('1\n2\n3');
    const three = (await input.boundingBox()).height;
    expect(three).toBeGreaterThan(one);
    await input.fill('1\n2\n3\n4\n5\n6\n7\n8');
    const many = (await input.boundingBox()).height;
    expect(many).toBeLessThanOrEqual(133);
    expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(page.locator('#chat-send')).toHaveText('');
  });

  test('overview shows the profile weight until a weight is logged, then the latest one', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, currentWeight: 77 }, foods: [], weights: [] });
    await expect(page.locator('#home-weight')).toHaveText('77.0');
    await page.evaluate(() => {
      state.weights.push({ id: '66666666-6666-4666-8666-666666666666', value: 75.2, date: iso() });
      save();
    });
    await expect(page.locator('#home-weight')).toHaveText('75.2');
  });

  test('a food row expands to show protein, fat and carbs', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: '77777777-7777-4777-8777-777777777777', name: 'Oats', meal: 'breakfast', grams: 200, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await openView(page, 'diary');
    const row = page.locator('#diary-meals .meal-item', { hasText: 'Oats' });
    await expect(row.locator('.meal-detail')).toBeHidden();
    await row.locator('.meal-info').click();
    await expect(row.locator('.meal-detail')).toBeVisible();
    await expect(row.locator('.meal-detail')).toContainText('10');
    await row.locator('.meal-info').click();
    await expect(row.locator('.meal-detail')).toBeHidden();
  });

  test('breakfast, lunch and dinner show eaten against the meal target', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, kcal: 2000, protein: 100, fat: 70, carbs: 242 }, foods: [], weights: [] });
    await openView(page, 'diary');
    const cards = page.locator('#diary-meals .meal-card');
    await expect(cards.nth(0).locator('.meal-kcal')).toContainText('0 / 500');
    await expect(cards.nth(1).locator('.meal-kcal')).toContainText('0 / 700');
    await expect(cards.nth(2).locator('.meal-kcal')).toContainText('0 / 800');
    await expect(cards.nth(3).locator('.meal-kcal')).not.toContainText('/');
  });

  test('a weigh-in can be deleted from the statistics', async ({ page }) => {
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [],
      weights: [
        { id: '88888888-8888-4888-8888-888888888888', value: 82.3, date: '2026-10-01' },
        { id: '99999999-9999-4999-8999-999999999999', value: 80.4, date: '2026-10-20' },
      ],
    });
    await openView(page, 'stats');
    await expect(page.locator('#weight-history .food-row')).toHaveCount(2);
    await autoConfirm(page, true);
    await page.locator('#weight-history [data-delete-weight="2026-10-20"]').click();
    await expect(page.locator('#weight-history .food-row')).toHaveCount(1);
    await expect(page.locator('#weight-history')).not.toContainText('80.4');
  });

  test('meal cards are expanded today, collapsed for other dates, and can be toggled', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const past = new Date(Date.now() - 3 * 86400000).toLocaleDateString('en-CA');
    const mk = (id, date) => ({ id, name: 'Oats ' + date, meal: 'breakfast', grams: 100, kcal: 300, protein: 10, fat: 5, carbs: 50, date, createdAt: Date.now() });
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [mk('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', today), mk('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', past)],
      weights: [],
    });
    await openView(page, 'diary');
    const first = page.locator('#diary-meals .meal-card').first();
    await expect(first).not.toHaveClass(/collapsed/);
    await expect(first.locator('.meal-item')).toBeVisible();
    await first.locator('.meal-head').click();
    await expect(first).toHaveClass(/collapsed/);
    await expect(first.locator('.meal-item')).toBeHidden();
    await expect(first.locator('.meal-kcal')).toContainText('300');
    await page.evaluate((value) => { const el = document.getElementById('diary-date'); el.value = value; el.dispatchEvent(new Event('change')); }, past);
    await page.locator('#diary-date').dispatchEvent('change');
    await expect(page.locator('#diary-meals .meal-card').first()).toHaveClass(/collapsed/);
    await page.locator('#diary-meals .meal-card').first().locator('.meal-head').click();
    await expect(page.locator('#diary-meals .meal-card').first().locator('.meal-item')).toBeVisible();
  });

  test('delete buttons use a trash icon', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Oats', meal: 'breakfast', grams: 100, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: Date.now() }],
      weights: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', value: 80, date: today }],
    });
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals [data-delete-food] svg')).toHaveCount(1);
    await expect(page.locator('#diary-meals [data-delete-food]')).not.toContainText('✕');
    await openView(page, 'stats');
    await expect(page.locator('#weight-history [data-delete-weight] svg')).toHaveCount(1);
  });

  test('changing personal plan details recalculates the daily calorie recommendation at once', async ({ page }) => {
    await openApp(page, {
      prefs: { ...BASE_PREFS, name: 'Anna', kcal: 1500, sex: 'female', birthDate: '1990-01-01', height: 170, currentWeight: 80, targetWeight: 70, activity: 'low', pace: 20, recommendation: { pace: 20, tdee: 2200 } },
      foods: [],
      weights: [],
    });
    await openView(page, 'settings');
    await expect(page.locator('#pref-kcal')).toHaveValue('1500');
    await page.fill('#profile-weight', '90');
    await page.locator('#profile-weight').press('Tab');
    await expect(page.locator('#pref-kcal')).not.toHaveValue('1500');
    const kcal = await page.locator('#pref-kcal').inputValue();
    await expect(page.locator('#daily-rec-result')).toContainText(kcal);
  });

  test('changing plan details calculates the daily calorie recommendation even without an earlier one', async ({ page }) => {
    await openApp(page, {
      prefs: { ...BASE_PREFS, name: 'Anna', kcal: 2000, sex: 'female', birthDate: '1990-01-01', height: 170, currentWeight: 80, targetWeight: 70, activity: 'low', pace: 20 },
      foods: [],
      weights: [],
    });
    await openView(page, 'settings');
    await page.fill('#profile-weight', '90');
    await page.locator('#profile-weight').press('Tab');
    const kcal = await page.locator('#pref-kcal').inputValue();
    expect(kcal).not.toBe('2000');
    await expect(page.locator('#daily-rec-result')).toContainText(kcal);
  });

  test('editing the weight recalculates calories and macros proportionally', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Oats', meal: 'breakfast', grams: 200, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await openView(page, 'diary');
    await page.locator('#diary-meals [data-edit-food]').first().click();
    await page.fill('#food-grams', '100');
    await expect(page.locator('#food-kcal')).toHaveValue('150');
    await expect(page.locator('#food-protein')).toHaveValue('5');
    await expect(page.locator('#food-fat')).toHaveValue('2.5');
    await expect(page.locator('#food-carbs')).toHaveValue('25');
  });

  test('a diary food can be saved to My products, highlighted, and added back', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Oats', meal: 'breakfast', grams: 200, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await openView(page, 'diary');
    const row = page.locator('#diary-meals .meal-item', { hasText: 'Oats' });
    await expect(row).not.toHaveClass(/saved/);
    await row.locator('[data-save-product]').click();
    await expect(page.locator('#diary-meals .meal-item', { hasText: 'Oats' })).toHaveClass(/saved/);
    await openView(page, 'products');
    await expect(page.locator('#products-list')).toContainText('Oats');
    await page.locator('#products-list [data-toggle-product]').first().click();
    await page.locator('#products-list [data-add-product]').first().click();
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await expect(page.locator('#pick-dates [data-pick-date="tomorrow"]')).toBeVisible();
    await page.locator('#pick-dates [data-pick-date="today"]').click();
    await page.fill('#pick-grams', '100');
    await page.click('#pick-add');
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals .meal-item', { hasText: 'Oats' })).toHaveCount(2);
    expect((await readStore(page)).foods.map((food) => food.kcal).sort((a, b) => a - b)).toEqual([150, 300]);
  });

  test('a new product can be created and deleted in My products', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'products');
    await page.click('#product-new');
    await page.fill('#food-name', 'Buckwheat');
    await page.fill('#food-kcal', '110');
    await page.click('#food-save');
    await expect(page.locator('#products-list')).toContainText('Buckwheat');
    await page.locator('#products-list [data-toggle-product]').first().click();
    const prodDialogs = [];
    await autoConfirm(page, true, prodDialogs);
    await page.locator('#products-list [data-delete-product]').first().click();
    await expect.poll(() => prodDialogs.length).toBe(1);
    expect(prodDialogs[0]).toBe('Delete “Buckwheat” from My products?');
    await expect(page.locator('#products-list')).not.toContainText('Buckwheat');
  });


    test('same-name products are kept as numbered copies and product changes persist in the journal', async ({ page }) => {
    const original = { id: '11111111-1111-4111-8111-111111111111', name: 'Buckwheat', grams: 100, kcal: 110, protein: 4, fat: 1, carbs: 22 };
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products: [original] });
    await openView(page, 'products');
    await page.click('#product-new');
    await page.fill('#food-name', 'Buckwheat');
    await page.fill('#food-grams', '100');
    await page.fill('#food-kcal', '130');
    await page.click('#food-save');

    await expect(page.locator('#products-list .product-name')).toHaveText(['Buckwheat', 'Buckwheat copy']);
    let stored = await readStore(page);
    expect(stored.products).toHaveLength(2);
    expect(stored.products.find((product) => product.id === original.id).kcal).toBe(110);
    expect(stored.productHistory.map((entry) => entry.action)).toEqual(['created']);
    await expect(page.locator('.toast-msg').last()).toContainText('Buckwheat copy');

    await openView(page, 'settings');
    await page.locator('#product-history-open-settings').click();
    await expect(page.locator('#product-history-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-history-list')).toContainText('Created');
    await expect(page.locator('#product-history-list')).toContainText('Buckwheat copy');
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'products');
    await page.locator('#products-list [data-toggle-product]').nth(1).click();
    await page.locator('#products-list [data-edit-product]').nth(1).click();
    await page.fill('#food-name', 'Buckwheat deluxe');
    await page.click('#food-save');
    stored = await readStore(page);
    expect(stored.productHistory.map((entry) => entry.action)).toEqual(['renamed', 'created']);
    expect(stored.productHistory[0].previousName).toBe('Buckwheat copy');

    await page.locator('#products-list [data-toggle-product]').first().click();
    await autoConfirm(page, true);
    await page.locator('#products-list [data-delete-product]').first().click();
    await expect.poll(async () => (await readStore(page)).productHistory[0].action).toBe('deleted');
    await page.reload();
    await openView(page, 'products');
    await openView(page, 'settings');
    await page.locator('#product-history-open-settings').click();
    await expect(page.locator('#product-history-list')).toContainText('Deleted');
    await expect(page.locator('#product-history-list')).toContainText('Buckwheat');
  });

  test('legacy product migration keeps same-name products as localized copies', async ({ page }) => {
    const legacyProducts = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Пангасіус', grams: 100, kcal: 85, protein: 18, fat: 2, carbs: 0 },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Пангасіус', grams: 100, kcal: 90, protein: 19, fat: 2, carbs: 0 },
      { id: '33333333-3333-4333-8333-333333333333', name: 'Пангасіус', grams: 100, kcal: 95, protein: 20, fat: 2, carbs: 0 },
    ];
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk', products: legacyProducts }, foods: [], weights: [] });
    const stored = await readStore(page);
    expect(stored.products.map((product) => product.name).sort()).toEqual(['Пангасіус', 'Пангасіус копія', 'Пангасіус копія 2']);
    expect(stored.products.map((product) => product.id)).toEqual(legacyProducts.map((product) => product.id));
    expect(stored.products.map((product) => product.kcal)).toEqual([85, 90, 95]);
    expect(stored.productHistory.filter((entry) => entry.action === 'created')).toHaveLength(3);
    await page.reload();
    expect((await readStore(page)).products).toHaveLength(3);
    expect((await readStore(page)).productHistory.filter((entry) => entry.action === 'created')).toHaveLength(3);
  });

  test('a failed product write keeps the form open and does not claim the product was saved', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'products');
    await page.click('#product-new');
    await page.fill('#food-name', 'Storage test');
    await page.fill('#food-grams', '100');
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      let failed = false;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'smartdiet-v1' && String(value).includes('Storage test')) { failed = true; throw new DOMException('quota exceeded', 'QuotaExceededError'); }
        return original.call(this, key, value);
      };
    });
    await page.click('#food-save');
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#products-list')).not.toContainText('Storage test');
    await expect(page.locator('.toast-msg').last()).toContainText('Could not save “Storage test”');
    expect((await readStore(page)).products || []).toHaveLength(0);
  });

  test('cancelling food deletion preserves the diary entry', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');
    await addFood(page, 'Cancel apple');
    await autoConfirm(page, false);
    await foodRow(page, 'Cancel apple').locator('[data-delete-food]').click();
    await expect(foodRow(page, 'Cancel apple')).toHaveCount(1);
  });

  test('cancelling product deletion preserves the product in My products', async ({ page }) => {
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [],
      weights: [],
      products: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Keep oatmeal', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25 }],
    });
    await openView(page, 'products');
    await page.locator('#products-list [data-toggle-product]').first().click();
    await autoConfirm(page, false);
    await page.locator('#products-list [data-delete-product]').first().click();
    await expect(page.locator('#products-list')).toContainText('Keep oatmeal');
  });

  test('saved-product selectors use the My products font size and alphabetical order', async ({ page }) => {
    const products = [
      { id: 'product-z', name: 'Zucchini', grams: 100, kcal: 20, protein: 1, fat: 0, carbs: 4 },
      { id: 'product-b', name: 'Buckwheat', grams: 100, kcal: 110, protein: 4, fat: 1, carbs: 22 },
      { id: 'product-a', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14 },
    ];
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });

    await openView(page, 'products');
    const savedNames = page.locator('#products-list .product-name');
    await expect(savedNames).toHaveText(['Apple', 'Buckwheat', 'Zucchini']);
    await expect(savedNames.first()).toHaveCSS('font-size', '14px');

    await openView(page, 'home');
    await page.locator('#meal-plan-open').click();
    const planNames = page.locator('#meal-plan-products .meal-plan-picker-name');
    await expect(planNames).toHaveText(['Apple', 'Buckwheat', 'Zucchini']);
    await expect(planNames.first()).toHaveCSS('font-size', '14px');
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').first()).toHaveCSS('padding-top', '7px');
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').first()).toHaveCSS('padding-bottom', '7px');
    await page.locator('[data-close-meal-plan]').first().click();

    await page.locator('#view-home .section-head > [data-action="add-food"]').click();
    await page.locator('#pick-product').click();
    const pickerNames = page.locator('#pick-body .pick-item b');
    await expect(pickerNames).toHaveText(['Apple', 'Buckwheat', 'Zucchini']);
    await expect(pickerNames.first()).toHaveCSS('font-size', '14px');
    await expect(page.locator('#pick-body .pick-item').first()).toHaveCSS('padding-top', '8px');
    await expect(page.locator('#pick-body .pick-item').first()).toHaveCSS('padding-bottom', '8px');
    await expect(page.locator('#pick-body .pick-item .muted').first()).toHaveCSS('font-size', '12px');
  });

  test('verified products show the same check in each product picker modal', async ({ page }) => {
    const products = [
      { id: 'verified-oats', name: 'Oats', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25, verified: true },
      { id: 'unverified-apple', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14, verified: false },
    ];
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });
    const badge = page.locator('.product-verified');

    await openView(page, 'home');
    await page.locator('#meal-plan-open').click();
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').nth(0).locator('.product-verified')).toHaveCount(0);
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').nth(1).locator('.product-verified')).toHaveCount(1);
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').nth(1).locator('.product-verified')).toHaveAttribute('aria-label', 'Verified product');
    await page.locator('[data-close-meal-plan]').first().click();

    await page.locator('#view-home .section-head > [data-action="add-food"]').click();
    await page.locator('#pick-product').click();
    await expect(page.locator('#pick-body .pick-item').nth(0).locator('.product-verified')).toHaveCount(0);
    await expect(page.locator('#pick-body .pick-item').nth(1).locator('.product-verified')).toHaveCount(1);
    await expect(page.locator('#pick-body .pick-item').nth(1).locator('.product-verified')).toHaveAttribute('aria-label', 'Verified product');
  });

  test('product pickers display protein fat and carbs beside calories', async ({ page }) => {
    const products = [
      { id: 'oats', name: 'Oats', grams: 100, kcal: 150, protein: 5.5, fat: 3.2, carbs: 25.1 },
    ];
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });

    await openView(page, 'home');
    await page.locator('#meal-plan-open').click();
    const planMeta = page.locator('#meal-plan-products .meal-plan-picker-item .meal-plan-picker-meta');
    await expect(planMeta).toBeVisible();
    await expect(planMeta).toContainText('100 g · 150 kcal');
    await expect(planMeta).toContainText('P 5.5 · F 3.2 · C 25.1 g');
    await page.locator('[data-close-meal-plan]').first().click();

    await page.locator('#view-home .section-head > [data-action="add-food"]').click();
    await page.locator('#pick-product').click();
    const pickItemMuted = page.locator('#pick-body .pick-item .muted').first();
    await expect(pickItemMuted).toBeVisible();
    await expect(pickItemMuted).toContainText('100 g · 150 kcal · P 5.5 · F 3.2 · C 25.1 g');
  });

  test('weekly calorie chart renders dashed weight-loss calorie target series and accessible label', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, kcal: 1750 }, foods: [], weights: [] });
    await openView(page, 'stats');

    const chart = page.locator('#calorie-chart');
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute('aria-label', 'Calorie chart');
    await expect(chart.locator('polyline[stroke-dasharray="7 6"]')).toHaveCount(1);
    await expect(page.locator('[data-i18n="calorieChartLegend"]')).toBeVisible();
  });

  test('food entry modal puts product picker first and hides date for a chosen meal', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');

    await page.locator('#diary-meals [data-action="add-food"][data-meal="breakfast"]').click();
    await expect(page.locator('#food-form > #pick-product')).toHaveCount(1);
    await expect(page.locator('#food-date').locator('xpath=..')).toBeHidden();
    await page.locator('#modal-close').click();

    await page.locator('#view-diary .toolbar [data-action="add-food"]').click();
    await expect(page.locator('#food-form > #pick-product')).toHaveCount(1);
    await expect(page.locator('#food-date').locator('xpath=..')).toBeVisible();
  });

  test('reopened dialogs return to the top without changing product pickers', async ({ page }) => {
    const products = Array.from({ length: 28 }, (_, i) => ({
      id: `scroll-product-${i}`,
      name: `Scroll product ${String(i).padStart(2, '0')}`,
      grams: 100,
      kcal: 120,
      protein: 5,
      fat: 2,
      carbs: 20,
    }));
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });
    await page.setViewportSize({ width: 390, height: 640 });
    await page.evaluate(() => {
      let prototype = HTMLElement.prototype;
      while (prototype && !Object.getOwnPropertyDescriptor(prototype, 'scrollTop')) prototype = Object.getPrototypeOf(prototype);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'scrollTop');
      window.__pickScrollWrites = 0;
      Object.defineProperty(prototype, 'scrollTop', {
        ...descriptor,
        set(value) {
          if (this.closest?.('#pick-modal')) window.__pickScrollWrites += 1;
          return descriptor.set.call(this, value);
        },
      });
    });
    await openView(page, 'diary');

    const addEntry = page.locator('#view-diary .toolbar [data-action="add-food"]');
    const entryModal = page.locator('#modal .modal');
    await addEntry.click();
    await entryModal.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await entryModal.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.locator('#modal-close').click();
    await addEntry.click();
    await expect.poll(() => entryModal.evaluate((el) => el.scrollTop)).toBe(0);

    await page.locator('#pick-product').click();
    await expect(page.locator('#pick-modal .pick-item')).toHaveCount(28);
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    expect(await page.evaluate(() => window.__pickScrollWrites)).toBe(0);
  });

  test('saved products start collapsed and reveal details and actions when toggled', async ({ page }) => {
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [],
      weights: [],
      products: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Oats', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25 }],
    });
    await openView(page, 'products');
    const card = page.locator('.product-item');
    await expect(card).toHaveClass(/collapsed/);
    await expect(card.locator('.product-name')).toHaveText('Oats');
    await expect(card.locator('.product-row')).toBeHidden();
    await card.locator('[data-toggle-product]').click();
    await expect(card).not.toHaveClass(/collapsed/);
    await expect(card.locator('.product-row')).toBeVisible();
    await expect(card.locator('[data-share-product]')).toBeVisible();
  });

  test('weight is chosen on a scroll wheel on touch devices', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto('/');
    await page.evaluate((data) => localStorage.setItem('smartdiet-v1', JSON.stringify(data)), { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.reload();
    await expect(page.locator('#mobile-nav')).toBeVisible();
    await page.evaluate(() => openModal('weight'));
    await page.locator('#weight-value').click();
    await expect(page.locator('#wheel-back')).toHaveClass(/open/);
    await page.evaluate(() => {
      const [ints, decs] = document.querySelectorAll('#wheel-cols .wheel-col');
      ints.scrollTop = (72 - 30) * 44;
      decs.scrollTop = 5 * 44;
    });
    await page.waitForTimeout(200);
    await page.click('#wheel-done');
    await expect(page.locator('#weight-value')).toHaveValue('72.5');
    await page.click('#weight-save');
    await expect.poll(async () => (await readStore(page)).weights.map((w) => w.value)).toEqual([72.5]);
    await context.close();
  });
});

test.describe('Smoke: today balance', () => {
  test('shows eaten over the daily target with the remainder below in a smaller font', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Rice', meal: 'lunch', grams: 200, kcal: 500, protein: 20, fat: 10, carbs: 80, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await expect(page.locator('#home-kcal')).toHaveText('500');
    await expect(page.locator('#home-kcal-total')).toHaveText('2000');
    await expect(page.locator('#home-kcal-left')).toHaveText('1500');
    await expect(page.locator('#home-protein')).toHaveText('20');
    await expect(page.locator('#home-protein-total')).toHaveText('100');
    await expect(page.locator('#home-protein-left')).toHaveText('80');
    const metric = page.locator('#view-home .stats .metric').first();
    await expect(metric.locator('.left-line')).toContainText('left 1500 kcal');
    const sizes = await metric.evaluate((el) => ({
      main: parseFloat(getComputedStyle(el.querySelector('#home-kcal')).fontSize),
      left: parseFloat(getComputedStyle(el.querySelector('.left-line')).fontSize),
    }));
    expect(sizes.left).toBeLessThan(sizes.main);
    const order = await metric.evaluate((el) => {
      const line = el.querySelector('.left-line').getBoundingClientRect().top;
      return { main: el.querySelector('#home-kcal').getBoundingClientRect().top, line };
    });
    expect(order.line).toBeGreaterThan(order.main);
  });

  test('an overage is shown as over, and the text follows the language', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: { ...BASE_PREFS, lang: 'uk' },
      foods: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Cake', meal: 'snack', grams: 300, kcal: 2400, protein: 10, fat: 90, carbs: 300, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await expect(page.locator('#home-kcal')).toHaveText('2400');
    await expect(page.locator('#home-kcal-total')).toHaveText('2000');
    await expect(page.locator('#home-kcal-left')).toHaveText('400');
    const kcalLine = page.locator('#view-home .stats .metric').first().locator('.left-line');
    await expect(kcalLine).toContainText('400 ккал');
    await expect(kcalLine).toContainText('перебір');
    await expect(kcalLine).toHaveClass(/over/);
  });
});

test.describe('Smoke: calendar', () => {
  test('calendar uses the app style and marks days with saved entries', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: '77777777-7777-4777-8777-777777777777', name: 'Calendar pear', meal: 'lunch', grams: 100, kcal: 60, protein: 1, fat: 0, carbs: 15, date: today, createdAt: 1 }],
      weights: [],
    });
    await openView(page, 'diary');
    await page.click('#diary-date');
    await expect(page.locator('#cal-modal')).toHaveClass(/open/);
    await expect(page.locator(`[data-cal-date="${today}"]`)).toHaveClass(/has-entries/);
    await page.locator('#cal-done').click();
    await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);
  });
});

test.describe('Smoke: dialog focus', () => {
  test('opening the dietitian chat does not open the keyboard by itself', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openDietitianChat(page);
    await expect(page.locator('#chat-panel')).toHaveClass(/open/);
    await expect(page.locator('#chat-input')).not.toBeFocused();
  });
});

test.describe('Smoke: review fixes', () => {
  test('goal form rejects empty, out-of-range and inconsistent values', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'settings');
    await page.fill('#pref-kcal', '500');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('1000');
    await page.fill('#pref-kcal', '2000');
    await page.fill('#pref-protein', '200');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('do not match');
    await page.fill('#pref-protein', '100');
    await page.fill('#pref-carbs', '');
    await page.click('#save-prefs');
    const st = await readStore(page);
    expect(st.prefs.carbs).toBe(242);
    expect(st.prefs.protein).toBe(100);
  });

  test('AI parser rejects items with missing or negative values and does not alter calories silently', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const r = await page.evaluate(() => {
      const tryParse = (o) => { try { return { status: 'accepted', data: parseNutrition(JSON.stringify(o)) }; } catch (e) { return { status: 'rejected' }; } };
      return {
        missingKcal: tryParse({ items: [{ name: 'Rice', grams: 150, protein: 3, fat: 0, carbs: 40 }] }).status,
        negativeKcal: tryParse({ items: [{ name: 'Rice', grams: 150, kcal: -195, protein: 3, fat: 0, carbs: 40 }] }).status,
        negativeProtein: tryParse({ items: [{ name: 'Rice', grams: 150, kcal: 195, protein: -3, fat: 0, carbs: 40 }] }).status,
        complete: tryParse({ items: [{ name: 'Rice', grams: 150, kcal: 195, protein: 3, fat: 0, carbs: 40 }] }).status,
        zeroGrams: tryParse({ items: [{ name: 'Rice', grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 }] }).status,
        keptKcal: tryParse({ items: [{ name: 'Test', grams: 100, kcal: 200, protein: 20, fat: 10, carbs: 30 }] }).data?.items[0]?.kcal,
      };
    });
    expect(r).toEqual({
      missingKcal: 'rejected',
      negativeKcal: 'rejected',
      negativeProtein: 'rejected',
      complete: 'accepted',
      zeroGrams: 'rejected',
      keptKcal: 200,
    });
  });

  test('GPT-6 requests send no temperature and use low reasoning effort', async ({ page }) => {
    let captured = null;
    await page.route('https://api.openai.com/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      captured = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) });
    });
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(() => callOpenAICompat('https://api.openai.com/v1/chat/completions', ['gpt-6-luna'], 'sk-test', 'hi', false, Date.now() + 10000));
    expect(captured.model).toBe('gpt-6-luna');
    expect('temperature' in captured).toBe(false);
    expect(captured.reasoning_effort).toBe('low');
  });

  test('a Gemini reply cut off by the length limit is reported, not parsed', async ({ page }) => {
    await page.route('https://generativelanguage.googleapis.com/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"items":[' }] } }] }) });
    });
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const msg = await page.evaluate(() => callGemini('k', 'p', true, Date.now() + 10000).then(() => 'ok', e => e.message));
    expect(msg).toContain('cut off');
  });

  test('an OpenAI-compatible reply cut off by length is reported, not parsed', async ({ page }) => {
    await page.route('https://api.openai.com/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"items":[' } }] }) });
    });
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const msg = await page.evaluate(() => callOpenAICompat('https://api.openai.com/v1/chat/completions', ['gpt-4.1-mini'], 'k', 'p', true, Date.now() + 10000).then(() => 'ok', e => e.message));
    expect(msg).toContain('cut off');
  });

  test('an Anthropic reply cut off by max_tokens is reported, not parsed', async ({ page }) => {
    await page.route('https://api.anthropic.com/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"items":[' }] }) });
    });
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const msg = await page.evaluate(() => callAnthropic('k', 'p', Date.now() + 10000).then(() => 'ok', e => e.message));
    expect(msg).toContain('cut off');
  });

  test('adding a food item from a meal draft is idempotent and marks the item added', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const draft = {
      id: 'draft-idempotent-1',
      date: today,
      items: [{ id: 'p-1', name: 'Oatmeal', meal: 'breakfast', grams: 150, kcal: 200, protein: 7, fat: 4, carbs: 32 }],
    };
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate((d) => {
      saveMealDrafts([d]);
      renderMealDraftButton();
    }, draft);

    await page.locator('#meal-drafts-open').click();
    await expect(page.locator('#meal-drafts-modal')).toHaveClass(/open/);
    const addBtn = page.locator('#meal-drafts-list [data-plan-add]').first();
    await expect(addBtn).toBeEnabled();

    await addBtn.click();
    await expect(addBtn).toBeDisabled();
    await expect(addBtn).toContainText(/Added|Додано/);

    const foods = await page.evaluate(() => state.foods);
    expect(foods).toHaveLength(1);
    expect(foods[0].name).toBe('Oatmeal');

    const drafts = await page.evaluate(() => mealDrafts());
    expect(drafts[0].items[0].added).toBe(true);
    expect(drafts[0].items[0].addedFoodId).toBe(foods[0].id);

    await page.locator('#meal-drafts-modal [data-close-meal-drafts]').first().click();
    await page.locator('#meal-drafts-open').click();
    const reopenedBtn = page.locator('#meal-drafts-list [data-plan-add]').first();
    await expect(reopenedBtn).toBeDisabled();
  });

  test('meal plan rejects zero-gram portions and refuses to save when budget is exceeded', async ({ page }) => {
    const products = [
      { id: 'meal-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'meal-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'meal-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
    ];
    await openApp(page, { ...AI_STORE(['gemini']), products, prefs: { ...BASE_PREFS, kcal: 200 } });
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          items: [{ id: 'meal-oats', grams: 0.1, meal: 'breakfast' }],
        }) }] } }],
      }),
    }));

    await page.locator('#meal-plan-open').click();
    const checks = page.locator('#meal-plan-products [data-plan-product]');
    for (let i = 0; i < 3; i += 1) await checks.nth(i).check();
    await page.locator('#meal-plan-run').click();

    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText(/Could not create plan: portion too small \(0 g\)\.|Не вдалося скласти план: порція замала \(0 г\)\./i);
    const drafts = await page.evaluate(() => mealDrafts());
    expect(drafts).toHaveLength(0);
  });

  test('meal plan scales carbohydrate totals down to the remaining target when calories fit', async ({ page }) => {
    const products = ['A', 'B', 'C'].map((name, i) => ({ id: `macro-${i}`, name, grams: 100, kcal: 10, protein: 1, fat: 0, carbs: 100 }));
    await openApp(page, { ...AI_STORE(['gemini']), products, prefs: { ...BASE_PREFS, kcal: 2000, carbs: 242 } });
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200, headers: CORS, contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: products.map(p => ({ id: p.id, grams: 100, meal: 'lunch' })) }) }] } }] }),
    }));
    await page.locator('#meal-plan-open').click();
    for (const check of await page.locator('#meal-plan-products [data-plan-product]').all()) await check.check();
    await page.locator('#meal-plan-run').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Plan saved as a draft');
    const drafts = await page.evaluate(() => mealDrafts());
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items.reduce((s, it) => s + it.carbs, 0)).toBeLessThanOrEqual(242);
    expect(drafts[0].items.reduce((s, it) => s + it.kcal, 0)).toBeLessThanOrEqual(2000);
  });

  test('accepting a product that was already recalled does not save it', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const saved = await page.evaluate(async () => {
      const chain = { delete() { return this; }, eq() { return this; }, select() { const p = Promise.resolve({ data: [], error: null }); p.eq = () => p; return p; } };
      sb = { from: () => chain };
      user = { id: 'u-recipient' };
      inboxRows = [{ id: 'share-1', name: 'Ghost product', grams: 100, kcal: 200, protein: 1, fat: 1, carbs: 1, from_user: 'u-sender' }];
      await resolveShare('share-1', true);
      return state.products.some(p => p.name === 'Ghost product');
    });
    expect(saved).toBe(false);
  });

  test('a failed local save while accepting a shared product leaves the invitation available', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const result = await page.evaluate(async () => {
      const chain = { delete() { return this; }, eq() { return this; }, select() { return Promise.resolve({ data: [{ id: 'share-1' }], error: null }); } };
      sb = { from: () => chain };
      user = { id: 'u-recipient' };
      inboxRows = [{ id: 'share-1', name: 'Shared lentils', grams: 100, kcal: 200, protein: 1, fat: 1, carbs: 1, from_user: 'u-sender' }];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key === 'smartdiet-sync-queue') throw new DOMException('quota', 'QuotaExceededError'); return original.call(this, key, value); };
      try { await resolveShare('share-1', true); }
      finally { Storage.prototype.setItem = original; }
      return { products: state.products.map(x => x.name), inbox: inboxRows.map(x => x.id) };
    });
    expect(result.products).toEqual([]);
    expect(result.inbox).toEqual(['share-1']);
  });

  test('setting aside foreign data preserves account-scoped deletion queues in the archive', async ({ page }) => {
    await openApp(page, { ...BASE_PREFS, foods: [], weights: [] });
    const archive = await page.evaluate(() => {
      state.synced = { uid: 'account-a', email: 'a@example.test' };
      syncQueue.delFoods = [{ id: 'deleted-food', u: 'account-a' }];
      syncQueue.delWeights = [{ d: '2025-01-01', u: 'account-a' }];
      if (!setAsideForeignData()) return null;
      const key = Object.keys(localStorage).find(k => k.startsWith('smartdiet-foreign-account-a-'));
      return JSON.parse(localStorage.getItem(key));
    });
    expect(archive.syncQueue.delFoods).toEqual([{ id: 'deleted-food', u: 'account-a' }]);
    expect(archive.syncQueue.delWeights).toEqual([{ d: '2025-01-01', u: 'account-a' }]);
  });

  test('deleting a weigh-in while signed in queues the deletion for that account only', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [{ id: 'w-1', value: 80, date: '2024-05-01' }] });
    const queued = await page.evaluate(async () => {
      user = { id: 'account-a' };
      await deleteWeight('2024-05-01');
      return syncQueue.delWeights;
    });
    expect(queued).toEqual([{ d: '2024-05-01', u: 'account-a' }]);
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
});

test.describe('Smoke: legacy snack ordering', () => {
  test('old and current snack records share one chronological order when mealOrder is absent or null', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, { prefs: BASE_PREFS, foods: [
      { id: 'old-snack-food', name: 'Old snack', meal: 'snack', grams: 100, kcal: 20, protein: 1, fat: 0, carbs: 3, date: today, createdAt: 1000, mealOrder: null },
      { id: 'new-snack-food', name: 'New snack', meal: 'snack', grams: 100, kcal: 20, protein: 1, fat: 0, carbs: 3, date: today, createdAt: 2000, mealOrder: 9999999999999, snackId: 'new-snack' },
      { id: 'breakfast-anchor', name: 'Breakfast', meal: 'breakfast', grams: 100, kcal: 100, protein: 5, fat: 2, carbs: 10, date: today, createdAt: 500 },
    ], weights: [] });
    const names = await page.evaluate((date) => mealTimeline(date).filter(x => x.type === 'snack').map(x => x.event.foods[0].name), today);
    expect(names).toEqual(['Old snack', 'New snack']);
  });
});

test.describe('Smoke: sleepy assistant food reminder', () => {
  const store = () => ({ prefs: { ...BASE_PREFS, botMode: 'mascot', lang: 'uk' }, products: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Apple', grams: 100, kcal: 52, protein: 0.3, fat: 0.2, carbs: 14 }], foods: [], weights: [] });

  test('meal add shows a reminder while asleep and returns the assistant to sleep when closed', async ({ page }) => {
    await openApp(page, store());
    await page.evaluate(() => { localStorage.removeItem('smartdiet-sleep-food-reminder'); setBotServiceState({ period: 'night', pajamas: true }); });
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
    const meal = page.locator('#home-meals .meal-card').first();
    await meal.locator('.meal-head').click();
    await meal.locator('[data-action="add-food"]').click();
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
    await expect(page.locator('#bot-comic .bot-comic-text')).toHaveText('Може, давай спатки, а не їсти?');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await page.locator('#bot-comic .bot-comic-actions button').click();
    await expect.poll(() => page.evaluate(() => botMotion), { timeout: 2000 }).toBe('sleeping');
  });

  test('product plus shows a reminder while asleep and does not open the meal picker', async ({ page }) => {
    await openApp(page, store());
    await page.evaluate(() => localStorage.removeItem('smartdiet-sleep-food-reminder'));
    await openView(page, 'products');
    await page.locator('#products-list [data-toggle-product]').first().click();
    await page.evaluate(() => setBotServiceState({ period: 'night', pajamas: true }));
    await page.locator('#products-list [data-add-product]').first().click();
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
    await expect(page.locator('#pick-modal')).not.toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await page.locator('#bot-comic .bot-comic-actions button').click();
    await expect.poll(() => page.evaluate(() => botMotion), { timeout: 2000 }).toBe('sleeping');
    await page.evaluate(() => { localStorage.removeItem('smartdiet-sleep-food-reminder'); setBotServiceState({ period: 'morning', pajamas: true }); });
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await page.locator('#products-list [data-add-product]').first().click();
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
    await expect(page.locator('#pick-modal')).not.toHaveClass(/open/);
    await page.locator('#bot-comic .bot-comic-actions button').click();
    await expect.poll(() => page.evaluate(() => botMotion), { timeout: 2000 }).toBe('sleepy');
  });

  test('sleepy reminder respects its cooldown and then allows meal entry', async ({ page }) => {
    await openApp(page, store());
    await page.evaluate(() => setBotServiceState({ period: 'morning', pajamas: true }));
    const meal = page.locator('#home-meals .meal-card').first();
    await meal.locator('.meal-head').click();
    await page.evaluate(() => localStorage.setItem('smartdiet-sleep-food-reminder', String(Date.now())));
    await meal.locator('[data-action="add-food"]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);
    await page.locator('#modal-close').click();
  });
});

test.describe('Smoke: notifications', () => {
  test('unread messages can be read individually or together and all messages can be cleared with confirmation', async ({ page }) => {
    await page.clock.install();
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(() => {
      document.querySelectorAll('#notif-stack .toast').forEach((card) => card.remove());
      notifications.length = 0;
      saveNotifications();
      refreshNotifications();
    });

    await page.evaluate(() => {
      toast('First note');
      toast('Second note');
    });
    await expect(page.locator('#notif-stack .toast')).toHaveCount(2);

    await page.clock.runFor(10_500);
    await expect(page.locator('#notif-stack .toast')).toHaveCount(0);
    await expect(page.locator('#notif-badge')).toHaveText('2');

    await page.evaluate(() => toast('Third note'));
    await page.locator('#notif-stack .toast').last().locator('.toast-close').click();
    await expect(page.locator('#notif-badge')).toHaveText('2');

    await page.click('#notif-bell');
    await expect(page.locator('#notif-modal')).toHaveClass(/open/);
    const items = page.locator('#notif-list .notif-item');
    await expect(items).toHaveCount(3);
    await page.setViewportSize({ width: 360, height: 780 });
    const notificationLayout = await items.nth(1).evaluate((item) => {
      const body = item.querySelector('.notif-body').getBoundingClientRect();
      const actions = item.querySelector('.notif-item-actions').getBoundingClientRect();
      return { scrollWidth: item.scrollWidth, clientWidth: item.clientWidth, body: { left: body.left, right: body.right }, actions: { left: actions.left, right: actions.right } };
    });
    expect(notificationLayout.scrollWidth).toBeLessThanOrEqual(notificationLayout.clientWidth);
    expect(notificationLayout.body.right).toBeLessThanOrEqual(notificationLayout.actions.left);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await expect(items.nth(0)).toContainText('Third note');
    await expect(items.nth(0)).toHaveClass(/read/);
    await expect(items.nth(1)).toHaveClass(/unread/);

    await items.nth(1).locator('[data-notif-read]').click();
    await expect(items.nth(1)).toHaveClass(/read/);
    await expect(page.locator('#notif-badge')).toHaveText('1');

    await page.click('#notif-read-all');
    await expect(page.locator('#notif-badge')).toBeHidden();
    await expect(page.locator('#notif-list .notif-item.unread')).toHaveCount(0);

    await items.nth(2).locator('.notif-del').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.click('#confirm-ok');
    await expect(items).toHaveCount(2);

    await page.click('#notif-delete-all');
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.click('#confirm-cancel');
    await expect(items).toHaveCount(2);

    await page.click('#notif-delete-all');
    await page.click('#confirm-ok');
    await expect(items).toHaveCount(0);
    await expect(page.locator('#notif-list .notif-empty')).toBeVisible();
    await expect(page.locator('#notif-delete-all')).toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(page.locator('#notif-modal')).not.toHaveClass(/open/);
  });

  test('dismisses pop-up notifications by swiping right or left and marks them as read', async ({ page }) => {
    await page.clock.install();
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(() => {
      document.querySelectorAll('#notif-stack .toast').forEach((card) => card.remove());
      notifications.length = 0;
      saveNotifications();
      refreshNotifications();
    });

    // 1. Toast dismissed by swipe right
    await page.evaluate(() => toast('Swipe me right'));
    const toastRight = page.locator('#notif-stack .toast').last();
    await expect(toastRight).toBeVisible();
    const boxR = await toastRight.boundingBox();
    expect(boxR).toBeTruthy();

    await page.mouse.move(boxR.x + boxR.width / 2, boxR.y + boxR.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxR.x + boxR.width / 2 + 80, boxR.y + boxR.height / 2, { steps: 5 });
    await page.mouse.up();

    await page.clock.runFor(300);
    await expect(page.locator('#notif-stack .toast')).toHaveCount(0);
    // Because it was dismissed by user gesture, it is marked as read immediately, unread count stays 0
    await expect(page.locator('#notif-badge')).toBeHidden();

    // 2. Toast dismissed by swipe left
    await page.evaluate(() => toast('Swipe me left'));
    const toastLeft = page.locator('#notif-stack .toast').last();
    await expect(toastLeft).toBeVisible();
    const boxL = await toastLeft.boundingBox();
    expect(boxL).toBeTruthy();

    await page.mouse.move(boxL.x + boxL.width / 2, boxL.y + boxL.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxL.x + boxL.width / 2 - 80, boxL.y + boxL.height / 2, { steps: 5 });
    await page.mouse.up();

    await page.clock.runFor(300);
    await expect(page.locator('#notif-stack .toast')).toHaveCount(0);
    await expect(page.locator('#notif-badge')).toBeHidden();

    // Verify notification center lists both as read
    await page.click('#notif-bell');
    await expect(page.locator('#notif-modal')).toHaveClass(/open/);
    const items = page.locator('#notif-list .notif-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveClass(/read/);
    await expect(items.nth(1)).toHaveClass(/read/);
    await expect(page.locator('#notif-list .notif-item.unread')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#notif-modal')).not.toHaveClass(/open/);
  });
});

test.describe('Smoke: current date card', () => {
  test('shows weekday on the first row and date with only the day bold on the second row', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const date = page.locator('#today-label');
    const expected = await page.evaluate(() => Object.fromEntries(new Intl.DateTimeFormat(lang() === 'uk' ? 'uk-UA' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(new Date()).map((part) => [part.type, part.value])));
    const expectedDateMonth = await page.evaluate(() => new Intl.DateTimeFormat(lang() === 'uk' ? 'uk-UA' : 'en-US', { day: 'numeric', month: 'long' }).format(new Date()));
    await expect(date.locator('.date-weekday')).toHaveText(expected.weekday);
    await expect(date.locator('.date-day-month')).toHaveText(expectedDateMonth);
    await expect(date.locator('.date-day')).toHaveText(expected.day);
    await expect(date.locator('.date-month')).toHaveText(expected.month);
    const layout = await date.evaluate((el) => {
      const weekday = el.querySelector('.date-weekday');
      const day = el.querySelector('.date-day');
      const month = el.querySelector('.date-month');
      return {
        weekdayAlign: getComputedStyle(weekday).textAlign,
        dayFontSize: parseFloat(getComputedStyle(day).fontSize),
        dayFontWeight: parseInt(getComputedStyle(day).fontWeight, 10),
        monthFontSize: parseFloat(getComputedStyle(month).fontSize),
        monthFontWeight: parseInt(getComputedStyle(month).fontWeight, 10),
        weekdayFontSize: parseFloat(getComputedStyle(weekday).fontSize),
        weekdayFontWeight: parseInt(getComputedStyle(weekday).fontWeight, 10),
      };
    });
    expect(layout.weekdayAlign).toBe('right');
    expect(layout.dayFontSize).toBeCloseTo(15.4, 1);
    expect(layout.dayFontWeight).toBeGreaterThanOrEqual(700);
    expect(layout.monthFontSize).toBeCloseTo(12.9, 1);
    expect(layout.monthFontWeight).toBeLessThan(700);
    expect(layout.weekdayFontSize).toBeCloseTo(12.9, 1);
    expect(layout.weekdayFontWeight).toBeLessThan(700);

    const bell = page.locator('#notif-bell');
    const headerBoxes = await page.evaluate(() => {
      const bell = document.querySelector('#notif-bell').getBoundingClientRect();
      const date = document.querySelector('#today-label').getBoundingClientRect();
      const title = document.querySelector('#greeting').getBoundingClientRect();
      const header = document.querySelector('.topline').getBoundingClientRect();
      return { bell: { left: bell.left, right: bell.right, top: bell.top, bottom: bell.bottom }, date: { left: date.left, right: date.right, top: date.top, bottom: date.bottom }, title: { left: title.left, right: title.right, top: title.top, bottom: title.bottom }, headerLeft: header.left };
    });
    expect(headerBoxes.bell.right <= headerBoxes.date.left || headerBoxes.date.right <= headerBoxes.bell.left || headerBoxes.bell.bottom <= headerBoxes.date.top || headerBoxes.date.bottom <= headerBoxes.bell.top).toBe(true);
    expect(headerBoxes.date.top).toBeGreaterThanOrEqual(headerBoxes.bell.bottom);
    expect(Math.abs(headerBoxes.bell.right - headerBoxes.date.right)).toBeLessThanOrEqual(1);
    expect(headerBoxes.title.left).toBeCloseTo(headerBoxes.headerLeft, 0);
    expect(headerBoxes.title.right <= headerBoxes.date.left || headerBoxes.date.right <= headerBoxes.title.left || headerBoxes.title.bottom <= headerBoxes.date.top || headerBoxes.date.bottom <= headerBoxes.title.top).toBe(true);
    const hero = page.locator('.hero');
    const dateBottom = await date.evaluate((el) => el.getBoundingClientRect().bottom);
    const heroTop = await hero.evaluate((el) => el.getBoundingClientRect().top);
    expect(dateBottom).toBeLessThanOrEqual(heroTop);

    await page.setViewportSize({ width: 360, height: 780 });
    const mobileWidth = await date.evaluate((el) => el.getBoundingClientRect().width);
    expect(mobileWidth).toBeLessThanOrEqual(360 - 32);
    const mobileDateBottom = await date.evaluate((el) => el.getBoundingClientRect().bottom);
    const mobileHeroTop = await hero.evaluate((el) => el.getBoundingClientRect().top);
    const mobileBoxes = await page.evaluate(() => {
      const bell = document.querySelector('#notif-bell').getBoundingClientRect();
      const date = document.querySelector('#today-label').getBoundingClientRect();
      const title = document.querySelector('#greeting').getBoundingClientRect();
      const header = document.querySelector('.topline').getBoundingClientRect();
      return { bell: { left: bell.left, right: bell.right, top: bell.top, bottom: bell.bottom }, date: { left: date.left, right: date.right, top: date.top, bottom: date.bottom }, title: { left: title.left, right: title.right, top: title.top, bottom: title.bottom }, headerLeft: header.left };
    });
    expect(mobileBoxes.bell.right <= mobileBoxes.date.left || mobileBoxes.date.right <= mobileBoxes.bell.left || mobileBoxes.bell.bottom <= mobileBoxes.date.top || mobileBoxes.date.bottom <= mobileBoxes.bell.top).toBe(true);
    expect(mobileBoxes.date.top).toBeGreaterThanOrEqual(mobileBoxes.bell.bottom);
    expect(Math.abs(mobileBoxes.bell.right - mobileBoxes.date.right)).toBeLessThanOrEqual(1);
    expect(mobileBoxes.title.left).toBeCloseTo(mobileBoxes.headerLeft, 0);
    expect(mobileBoxes.title.right <= mobileBoxes.date.left || mobileBoxes.date.right <= mobileBoxes.title.left || mobileBoxes.title.bottom <= mobileBoxes.date.top || mobileBoxes.date.bottom <= mobileBoxes.title.top).toBe(true);
    expect(mobileDateBottom).toBeLessThanOrEqual(mobileHeroTop);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});

test.describe('Smoke: launch icons', () => {
  test('the install manifest gives Android the app icon and a separate maskable icon', async ({ page }) => {
    const manifest = await (await page.request.get('./manifest.json')).json();
    const anyIcon = manifest.icons.find((i) => i.sizes === '512x512' && i.purpose === 'any');
    const maskable = manifest.icons.find((i) => i.sizes === '512x512' && i.purpose === 'maskable');
    expect(anyIcon?.src).toBe('./icon-512.png');
    expect(maskable?.src).toBe('./icon-maskable-512.png');
    expect(manifest.background_color).toBe('#042415');
  });
});

test('save buttons keep the product and diary labels after a re-render', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
  await page.evaluate(() => openProductModal({ id: 'p-label', name: 'Oats', grams: 100, kcal: 370, protein: 13, fat: 7, carbs: 60 }));
  await page.evaluate(() => render());
  await expect(page.locator('#food-save')).toHaveText(await page.evaluate(() => t('saveProduct')));
  await page.evaluate(() => openModal('food', 'breakfast', { id: 'f-label', name: 'Egg', grams: 50, kcal: 70, protein: 6, fat: 5, carbs: 0, meal: 'breakfast', date: iso() }));
  await page.evaluate(() => render());
  await expect(page.locator('#food-save')).toHaveText(await page.evaluate(() => t('saveChanges')));
});

test('profile weight uses its entered date for the exact weekly rate and survives unrelated edits', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, name: 'Weight tester', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [{ id: 'w-after-profile', value: 95.5, date: '2026-11-01' }],
  });
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#view-stats')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => progressInfo().lastWeekRate)).toBeCloseTo(-1.3125, 8);
  await expect(page.locator('#weight-history')).toContainText('10/25/2026');
  await page.evaluate(() => openWeightHistory());
  const profileHistoryRow = page.locator('#weight-history-modal-list .food-row').filter({ hasText: '97.0 kg' });
  await expect(profileHistoryRow).toContainText('From your profile');
  await expect(profileHistoryRow).toContainText('10/25/2026');
  await page.locator('#weight-history-done').click();

  await page.evaluate(() => showView('settings'));
  await expect(page.locator('#view-settings')).toHaveClass(/active/);
  await expect(page.locator('#profile-weight-date')).toHaveValue('2026-10-25');
  await page.fill('#pref-name', 'Weight tester updated');
  await page.locator('#save-profile').click();
  await expect.poll(async () => (await readStore(page)).prefs.currentWeightDate).toBe('2026-10-25');
  await page.reload();
  await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
  expect((await readStore(page)).prefs.currentWeightDate).toBe('2026-10-25');
});

test('progress shows recent weekly and average daily change, while keeping the forecast trend internal', async ({ page }) => {
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
  await expect(page.locator('#view-stats')).toHaveClass(/active/);
  await expect(page.locator('#progress-stats .metric')).toHaveCount(6);
  await expect(page.locator('#progress-stats .metric').nth(0)).toContainText('згладжене середнє за останні 7 днів');
  await expect(page.locator('#progress-stats .metric').nth(1).locator('strong')).toHaveText('-0.188');
  await expect(page.locator('#progress-stats .metric').nth(1)).toContainText('Середня втрата ваги за день');
  await expect(page.locator('#progress-stats .metric').nth(3).locator('strong')).toHaveText('-1.31');
  await expect(page.locator('#progress-stats .metric').nth(3)).toContainText('Середнє за тиждень');
  await expect(page.locator('#progress-stats')).not.toContainText('Довгостроковий тренд для прогнозу');
  await expect.poll(() => page.evaluate(() => progressInfo().rate)).toBeCloseTo(-1.2630434783, 6);
  await expect(page.locator('#progress-stats .metric').nth(4).locator('strong')).not.toHaveText('—');
});


test('weight progress shows a plus sign when weight increases', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [{ id: 'w-gain', value: 98, date: '2026-11-02' }],
  });
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#progress-stats .metric').nth(1).locator('strong')).toHaveText('+0.125');
  await expect(page.locator('#progress-stats .metric').filter({ hasText: 'Загальна втрата від ваги в профілі' }).locator('strong')).toHaveText('+1.0');
});

test('weekly rate averages the change since the profile weight from screenshot weigh-ins', async ({ page }) => {
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
  await expect.poll(() => page.evaluate(() => progressInfo().lastWeekRate)).toBeCloseTo(-1.3125, 8);
  await expect.poll(() => page.evaluate(() => progressInfo().rate)).toBeCloseTo(-1.2630434783, 6);
  await expect(page.locator('#progress-stats .metric').nth(1).locator('strong')).toHaveText('-0.188');
  await expect(page.locator('#progress-stats .metric').nth(3).locator('strong')).toHaveText('-1.31');
  await expect.poll(() => page.evaluate(() => progressInfo().averageDailyLoss)).toBeCloseTo(0.1875, 8);
  await expect(page.locator('#progress-stats')).toContainText('Загальна втрата від ваги в профілі');
  await expect(page.locator('#progress-stats .metric').filter({ hasText: 'Загальна втрата від ваги в профілі' }).locator('strong')).toHaveText('-1.5');
  await expect.poll(() => page.evaluate(() => progressInfo().totalLost)).toBeCloseTo(1.5, 8);
});

test('weekly rate under one week uses the days elapsed since the profile weight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-27T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [{ id: 'w-oct-27', value: 96, date: '2026-10-27' }],
  });
  await page.evaluate(() => showView('stats'));
  await expect.poll(() => page.evaluate(() => progressInfo().lastWeekRate)).toBeCloseTo(-3.5, 8);
  await expect(page.locator('#progress-stats .metric').nth(3).locator('strong')).toHaveText('-3.50');
});

test('weekly rate shows zero instead of an empty value when nothing was weighed in after the profile weight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [],
  });
  await page.evaluate(() => showView('stats'));
  await expect.poll(() => page.evaluate(() => progressInfo().lastWeekRate)).toBeCloseTo(0, 8);
  await expect(page.locator('#progress-stats .metric').nth(3).locator('strong')).toHaveText('0.00');
});

test('profile weight date can be backfilled from the calendar and a new weight defaults to today', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, name: 'Weight tester', currentWeight: 97 }, foods: [], weights: [] });
  await openView(page, 'settings');
  await page.locator('#profile-weight-date').click();
  await expect(page.locator('#cal-title')).toHaveText('November 2026');
  await page.locator('#cal-prev').click();
  await page.locator('[data-cal-date="2026-10-25"]').click();
  await page.locator('#cal-done').click();
  await page.locator('#save-profile').click();
  await expect.poll(async () => (await readStore(page)).prefs.currentWeightDate).toBe('2026-10-25');

  await page.fill('#profile-weight', '95.5');
  await page.locator('#profile-weight').dispatchEvent('change');
  await expect(page.locator('#profile-weight-date')).toHaveValue('2026-11-02');
  await page.locator('#save-profile').click();
  await expect.poll(async () => (await readStore(page)).prefs.currentWeight).toBe(95.5);
  expect((await readStore(page)).prefs.currentWeightDate).toBe('2026-11-02');
});

test('new profiles assign the profile weight date automatically without a date input', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false, currentWeight: null, currentWeightDate: null }, foods: [], weights: [] });
  await page.locator('#onboarding-choice-guest').click();
  await expect(page.locator('#onboard-weight-date-field')).toBeHidden();
  await page.evaluate(() => {
    const nameEl = document.querySelector('#onboard-name');
    if (nameEl) { nameEl.value = 'Guest User'; nameEl.dispatchEvent(new Event('input', { bubbles: true })); }
    const el = document.querySelector('#onboard-weight'); el.value = '70'; el.dispatchEvent(new Event('input', { bubbles: true }));
    const birth = document.querySelector('#onboard-birth'); birth.value = '1990-01-01'; birth.dispatchEvent(new Event('change', { bubbles: true }));
    const height = document.querySelector('#onboard-height'); height.value = '170'; height.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#onboarding-save').click();
  await expect.poll(async () => (await readStore(page)).prefs.currentWeightDate).toBe('2026-11-02');
  await page.evaluate(() => showView('settings'));
  await expect(page.locator('#view-settings')).toHaveClass(/active/);
  await expect(page.locator('#profile-weight-date-field')).toBeHidden();
});

test('legacy profiles without a saved weight date keep the manual backfill field', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, name: 'Legacy profile', currentWeight: 97, currentWeightDate: null }, foods: [], weights: [] });
  await openView(page, 'settings');
  await expect(page.locator('#profile-weight-date-field')).toBeVisible();
  await page.locator('#profile-weight-date').click();
  await expect(page.locator('#cal-title')).toBeVisible();
});

test('weight and kg stay on one line in mobile weight history', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openApp(page, {
    prefs: { ...BASE_PREFS, currentWeight: 97, currentWeightDate: '2026-10-25' },
    foods: [],
    weights: [{ id: 'w-mobile', value: 95.5, date: '2026-11-02' }],
  });
  const value = page.locator('#weight-history .weight-value').first();
  await expect(value).toContainText('kg');
  await expect.poll(() => value.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
  const dimensions = await value.evaluate(el => ({
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight) || (parseFloat(getComputedStyle(el).fontSize || '14') * 1.2),
  }));
  expect(dimensions.height).toBeLessThanOrEqual(dimensions.lineHeight + 1);
});

test('home weight card uses the newest date across profile and diary records', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, currentWeight: 95.5, currentWeightDate: '2026-11-02' },
    foods: [],
    weights: [{ id: 'w-older', value: 97, date: '2026-11-01' }],
  });
  await expect(page.locator('#home-weight')).toHaveText('95.5');
  await expect(page.locator('#weight-date')).toContainText('11/2/2026');
  await expect(page.locator('#weight-history .food-row').first()).toContainText('95.5');
});

test('profile weight change makes every earlier weigh-in inactive without deleting records', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, name: 'Weight baseline tester', lang: 'en', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 70 },
    foods: [],
    weights: [
      { id: 'w-old-high', value: 101, date: '2026-10-10' },
      { id: 'w-old-lower', value: 94, date: '2026-10-20' },
      { id: 'w-pre-baseline-high', value: 98, date: '2026-10-30' },
      { id: 'w-current', value: 95.5, date: '2026-11-03' },
    ],
  });
  await openView(page, 'settings');
  await page.fill('#profile-weight', '95.5');
  await page.locator('#profile-weight').dispatchEvent('change');
  await expect(page.locator('#profile-weight-date')).toHaveValue('2026-11-03');
  await page.locator('#save-profile').click();
  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('saved');
  await openView(page, 'stats');
  const result = await page.evaluate(() => ({
    all: allWeightObservations().map(x => [x.d, x.v]),
    active: weightObservations().map(x => [x.d, x.v]),
    inactive: weightHistoryRows().filter(x => x.inactive).map(x => [x.date, x.value]),
    savedWeightCount: state.weights.length,
  }));
  expect(result.all).toHaveLength(4);
  expect(result.active).toEqual([['2026-11-03', 95.5]]);
  expect(result.inactive).toEqual([['2026-10-30', 98], ['2026-10-20', 94], ['2026-10-10', 101]]);
  expect(result.savedWeightCount).toBe(4);
  await expect(page.locator('#weight-chart .weight-point-inactive')).toHaveCount(3);
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00'));
  await page.evaluate(() => { state.weights.push({ id: 'w-new-after-baseline', value: 96, date: '2026-11-04' }); save(); render(); });
  expect(await page.evaluate(() => weightObservations().map(x => [x.d, x.v]))).toEqual([['2026-11-03', 95.5], ['2026-11-04', 96]]);
});

test('future profile weight dates cannot appear as recorded observations', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, name: 'Future date tester', currentWeight: 95.5, currentWeightDate: '2026-11-03' },
    foods: [],
    weights: [{ id: 'w-today', value: 97, date: '2026-11-02' }, { id: 'w-future', value: 94, date: '2026-11-04' }],
  });
  expect(await page.evaluate(() => weightObservations())).toEqual([{ d: '2026-11-02', v: 97, source: 'weigh-in' }]);
  expect(await page.evaluate(() => weightHistoryRows().map(({ date, value }) => ({ date, value })))).toEqual([{ date: '2026-11-02', value: 97 }, { date: '', value: 95.5 }]);
  await expect(page.locator('#home-weight')).toHaveText('97.0');
  await openView(page, 'settings');
  await page.locator('#profile-weight-date').click();
  await expect(page.locator('[data-cal-date="2026-11-03"]')).toBeDisabled();
  await expect(page.locator('[data-cal-date="2026-11-02"]')).toBeEnabled();
  await page.locator('#cal-cancel').click();
  await page.locator('#save-profile').click();
  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('cannot be in the future');
});

test('diary weigh-in takes precedence over a profile weight on the same date', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, currentWeight: 97, currentWeightDate: '2026-11-01' },
    foods: [],
    weights: [{ id: 'w-same-day', value: 95.5, date: '2026-11-01' }],
  });
  expect(await page.evaluate(() => weightObservations())).toEqual([{ d: '2026-11-01', v: 95.5, source: 'weigh-in' }]);
  expect(await page.evaluate(() => progressInfo().rate)).toBeNull();
});

test('weight rate and forecast start on day seven, use all weigh-ins, and refresh daily', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-31T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, targetWeight: 70 },
    foods: [],
    weights: [
      { id: 'w-day-1', value: 80, date: '2026-10-25' },
      { id: 'w-day-3', value: 79.6, date: '2026-10-28' },
      { id: 'w-day-6', value: 79.2, date: '2026-10-31' },
      { id: 'w-day-7', value: 79.1, date: '2026-11-01' },
    ],
  });
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#view-stats')).toHaveClass(/active/);
  const recentRate = page.locator('#progress-stats .metric').nth(3).locator('strong');
  await expect.poll(() => page.evaluate(() => progressInfo().rate)).toBeNull();
  await expect(page.locator('#progress-stats .metric').nth(4).locator('strong')).toHaveText('—');
  await expect(recentRate).toHaveText('—');
  await expect(page.locator('#progress-notes')).toContainText('at least 7 days');

  await page.clock.setFixedTime(new Date('2026-11-01T12:01:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => page.evaluate(() => progressInfo().rate)).not.toBeNull();
  await expect(page.locator('#progress-notes')).not.toContainText('at least 7 days');
  const forecast = page.locator('#progress-stats .metric').nth(4).locator('strong');
  await expect(forecast).not.toHaveText('—');
  const firstForecast = await forecast.textContent();

  await page.clock.setFixedTime(new Date('2026-11-02T12:02:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(forecast).not.toHaveText(firstForecast);

  await page.evaluate(() => {
    state.weights.push({ id: 'w-older-than-28-days', value: 100, date: '2026-09-01' });
    save();
  });
  const allHistoryRate = await page.evaluate(() => progressInfo().rate);
  const recentWeekRate = await page.evaluate(() => progressInfo().lastWeekRate);
  const expectedAllHistoryRate = await page.evaluate(() => {
    const points = weightObservations().map((item) => ({ n: dayNum(item.d), v: item.v }));
    return slopePerDay(points) * 7;
  });
  const recentWindowRate = await page.evaluate(() => {
    const today = dayNum(iso());
    const points = weightObservations().filter((item) => dayNum(item.d) > today - 28).map((item) => ({ n: dayNum(item.d), v: item.v }));
    return slopePerDay(points) * 7;
  });
  expect(allHistoryRate).toBeCloseTo(expectedAllHistoryRate, 8);
  expect(recentWeekRate).toBeNull();
  expect(allHistoryRate).not.toBeCloseTo(recentWindowRate, 2);
  expect((await readStore(page)).weights).toHaveLength(5);
});

test('latest weight card keeps only the adjacent shortcut to weight trend', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [{ id: 'w-1', value: 74.5, date: '2026-10-30' }] });
  await expect(page.locator('.weight-card')).toBeVisible();
  await expect(page.locator('.weight-trend-btn')).toHaveCount(0);
  await expect(page.locator('.weight-chart-action')).toBeVisible();

  await page.locator('.weight-chart-action').click();
  await expect(page.locator('#view-stats')).toHaveClass(/active/);
  await expect(page.locator('#card-weight-trend')).toBeVisible();
});

test('full weight history opens in a scrollable dialog and retains delete controls', async ({ page }) => {
  const weights = Array.from({ length: 5 }, (_, i) => ({ id: `w-${i}`, value: 74 + i / 10, date: `2026-10-${String(30 - i).padStart(2, '0')}` }));
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights });
  await openView(page, 'stats');
  await expect(page.locator('#weight-history .food-row')).toHaveCount(3);
  await page.locator('#weight-history-more-wrap [data-action="open-weight-history"]').click();
  await expect(page.locator('#weight-history-modal')).toHaveClass(/open/);
  await expect(page.locator('#weight-history-modal-list .food-row')).toHaveCount(5);
  await expect(page.locator('#weight-history-modal-list [data-delete-weight]')).toHaveCount(5);
  await page.locator('#weight-history-done').click();
  await expect(page.locator('#weight-history-modal')).not.toHaveClass(/open/);
});

test('calendar opens above the weight-entry dialog', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
  await page.locator('[data-action="add-weight"]').click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await page.locator('#weight-date-input').click();
  await expect(page.locator('#cal-modal')).toHaveClass(/open/);
  const zIndexes = await page.evaluate(() => ({ calendar: Number(getComputedStyle(document.querySelector('#cal-modal')).zIndex), entry: Number(getComputedStyle(document.querySelector('#modal')).zIndex) }));
  expect(zIndexes.calendar).toBeGreaterThan(zIndexes.entry);
});

test('calendar highlights meals in diary and only weigh-ins in weight entry', async ({ page }) => {
  const foodDate = '2026-10-25';
  const weightDate = '2026-10-28';
  await page.clock.install({ time: new Date('2026-10-29T12:00:00') });
  await openApp(page, {
    prefs: BASE_PREFS,
    foods: [{ id: 'f-cal-1', name: 'Apple', meal: 'breakfast', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14, date: foodDate, createdAt: 1 }],
    weights: [{ id: 'w-cal-1', value: 72.4, date: weightDate, createdAt: 1 }],
  });

  // 1. Check diary calendar: foodDate is marked, weightDate is NOT marked
  await openView(page, 'diary');
  await page.locator('#diary-date').click();
  await expect(page.locator('#cal-modal')).toHaveClass(/open/);
  await expect(page.locator('#cal-title')).toHaveText('October 2026');
  await expect(page.locator(`[data-cal-date="${foodDate}"]`)).toHaveClass(/has-entries/);
  await expect(page.locator(`[data-cal-date="${weightDate}"]`)).not.toHaveClass(/has-entries/);
  await page.locator('#cal-cancel').click();
  await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);

  // 2. Check weight entry calendar: weightDate is marked, foodDate is NOT marked
  await openView(page, 'home');
  await page.locator('[data-action="add-weight"]').click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await page.locator('#weight-date-input').click();
  await expect(page.locator('#cal-modal')).toHaveClass(/open/);
  await expect(page.locator('#cal-title')).toHaveText('October 2026');
  await expect(page.locator(`[data-cal-date="${weightDate}"]`)).toHaveClass(/has-entries/);
  await expect(page.locator(`[data-cal-date="${foodDate}"]`)).not.toHaveClass(/has-entries/);
  await page.locator('#cal-cancel').click();
  await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);
});

test('adding food defaults to today even when a past diary date was viewed, and announces meal and date', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk' },
    foods: [],
    weights: [],
  });

  // 1. Switch to Diary and select yesterday
  await openView(page, 'diary');
  await selectDiaryDate(page, '2026-11-01');
  await expect(page.locator('#diary-date')).toHaveValue('2026-11-01');

  // 2. Switch back to Home (today) and add food to Snack
  await openView(page, 'home');
  await page.locator('#home-meals [data-toggle-meal]').filter({ hasText: 'Перекус' }).click();
  await page.locator('#home-meals [data-action="add-food"][data-meal="snack"]').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await expect(page.locator('#food-date')).toHaveValue('2026-11-02');

  // 3. Fill and save food
  await page.fill('#food-name', 'Яблуко');
  await page.fill('#food-grams', '150');
  await page.fill('#food-kcal', '75');
  await page.locator('#food-save').click();

  // 4. Toast must indicate the meal and today's date
  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Перекус');
  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Сьогодні');

  // 5. Food must be saved under today's date (2026-11-02), not yesterday
  const foods = await page.evaluate(() => state.foods);
  expect(foods).toHaveLength(1);
  expect(foods[0].date).toBe('2026-11-02');
  expect(foods[0].meal).toBe('snack');
});

test('adding food directly from diary retains historical date and announces meal and date in toast', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk' },
    foods: [],
    weights: [],
  });

  await openView(page, 'diary');
  await selectDiaryDate(page, '2026-10-25');

  await page.locator('#diary-meals [data-toggle-meal]').filter({ hasText: 'Обід' }).click();
  await page.locator('#diary-meals [data-action="add-food"][data-meal="lunch"]').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await expect(page.locator('#food-date')).toHaveValue('2026-10-25');

  await page.fill('#food-name', 'Гречка');
  await page.fill('#food-grams', '200');
  await page.fill('#food-kcal', '220');
  await page.locator('#food-save').click();

  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Обід');
  const foods = await page.evaluate(() => state.foods);
  expect(foods).toHaveLength(1);
  expect(foods[0].date).toBe('2026-10-25');
  expect(foods[0].meal).toBe('lunch');
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

test.describe('Smoke: calorie deficit fills goals and keeps pace', () => {
  const profileWithTarget = {
    ...BASE_PREFS,
    name: 'Pace tester',
    birthDate: '1995-05-10',
    sex: 'female',
    height: 165,
    currentWeight: 70,
    currentWeightDate: new Date().toLocaleDateString('en-CA'),
    targetWeight: 60,
    activity: 'low',
    pace: 20,
  };

  test('choosing a deficit fills goals, and the pace survives moving to another block', async ({ page }) => {
    await openApp(page, { prefs: profileWithTarget, foods: [], weights: [] });
    await openView(page, 'settings');
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-btn').click();
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-opt').nth(3).click();
    await expect(page.locator('#pref-kcal')).not.toHaveValue('2000');
    const kcalAfterPick = await page.locator('#pref-kcal').inputValue();
    await page.locator('#pref-lang').locator('xpath=..').locator('.dd-btn').click();
    await expect.poll(async () => (await readStore(page)).prefs.pace).toBe(25);
    await expect(page.locator('#profile-pace')).toHaveValue('25');
    const stored = await readStore(page);
    expect(stored.prefs.kcal).toBe(Number(kcalAfterPick));
    expect(stored.prefs.pace).toBe(25);
  });

  test('a deficit without a target weight explains what is missing and leaves goals unchanged', async ({ page }) => {
    await openApp(page, { prefs: { ...profileWithTarget, targetWeight: null }, foods: [], weights: [] });
    await openView(page, 'settings');
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-btn').click();
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-opt').nth(3).click();
    await expect(page.locator('#profile-pace-preview')).toContainText('target weight');
    await expect(page.locator('#pref-kcal')).toHaveValue('2000');
  });
});

test.describe('Smoke: assistant buttons hide on interaction', () => {
  test('the assistant action buttons close on a tap, a drag or a scroll', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    const mascot = page.locator('#bot-peeker');
    await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
    const openButtons = async () => {
      await mascot.click();
      await expect(page.locator('body')).toHaveClass(/bot-actions-open/);
    };
    await openButtons();
    await page.locator('main h1').first().click();
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
    await openButtons();
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
    await openButtons();
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 200);
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
  });
});

test.describe('Smoke: app user count', () => {
  test('Friends shows the number of app users and lists their nicknames on tap', async ({ page }) => {
    const backend = createBackend();
    await startAlice(page, backend);
    await openView(page, 'settings');
    await expect(page.locator('#app-users')).toBeVisible();
    await expect(page.locator('#app-users-count')).toHaveText('2');
    await expect(page.locator('#app-users-list')).toBeHidden();
    await page.locator('#app-users-toggle').click();
    await expect(page.locator('#app-users-list')).toContainText('Alice');
    await expect(page.locator('#app-users-list')).toContainText('Bob');
    await expect(page.locator('#app-users-list')).not.toContainText('AAAA2222');
    await page.locator('#app-users-toggle').click();
    await expect(page.locator('#app-users-list')).toBeHidden();
  });

  test('Friends opens a popup with the nicknames when there are more than five app users', async ({ page }) => {
    const backend = createBackend();
    for (const name of ['Carol', 'Dave', 'Erin', 'Frank']) backend.tables.profiles.push({ user_id: `u-${name}`, display_name: name, friend_code: `C${name.toUpperCase()}1` });
    await startAlice(page, backend);
    await openView(page, 'settings');
    await expect(page.locator('#app-users-count')).toHaveText('6');
    await page.locator('#app-users-toggle').click();
    await expect(page.locator('#app-users-modal')).toHaveClass(/open/);
    await expect(page.locator('#app-users-modal-list')).toContainText('Dave');
    await expect(page.locator('#app-users-list')).toBeHidden();
    await page.locator('#app-users-modal-close').click();
    await expect(page.locator('#app-users-modal')).not.toHaveClass(/open/);
  });

  test('the dietitian dialog sits above the assistant and closes other windows when it opens', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    const mascot = page.locator('#bot-peeker');
    await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
    await mascot.click();
    await expect(page.locator('body')).toHaveClass(/bot-actions-open/);
    await page.evaluate(() => document.getElementById('confirm-modal').classList.add('open'));
    await page.evaluate(() => openAsk());
    await expect(page.locator('#ask-panel')).toHaveClass(/open/);
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/open/);
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
    await expect(page.locator('#ask-panel')).toHaveCSS('z-index', '300');
  });
});

test('swiping the assistant flings it past the opposite edge and keeps the new side after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot', botSide: 'right' }, foods: [], weights: [] });
  const bot = page.locator('#bot-peeker');
  await expect(bot).toHaveClass(/is-arrived/);
  await expect(bot).not.toHaveClass(/bot-side-left/);
  await waitForTransformTransition(bot);
  const box = await bot.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx - i * 40, cy);
  await expect.poll(() => bot.evaluate((el) => el.style.transform)).not.toBe('');
  await page.mouse.up();
  await expect(bot).toHaveClass(/bot-side-left/, { timeout: 5000 });
  await expect.poll(async () => (await readStore(page)).prefs.botSide).toBe('left');
  await page.reload();
  await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
  await expect(page.locator('#bot-peeker')).toHaveClass(/bot-side-left/);
  await expect(page.locator('#bot-peeker')).toHaveClass(/is-arrived/);
  expect((await readStore(page)).prefs.botSide).toBe('left');
  await waitForTransformTransition(bot);

  const box2 = await page.locator('#bot-peeker').boundingBox();
  const lx = box2.x + box2.width / 2;
  const ly = box2.y + box2.height / 2;
  await page.mouse.move(lx, ly);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(lx + i * 40, ly);
  await page.mouse.up();
  await expect(page.locator('#bot-peeker')).not.toHaveClass(/bot-side-left/, { timeout: 5000 });
  await expect.poll(async () => (await readStore(page)).prefs.botSide).toBe('right');
});

test('a small drag snaps the assistant back and keeps its side on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot', botSide: 'right' }, foods: [], weights: [] });
  const bot = page.locator('#bot-peeker');
  await expect(bot).toHaveClass(/is-arrived/);
  await waitForTransformTransition(bot);
  const box = await bot.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 20, cy);
  await expect.poll(() => bot.evaluate((el) => el.style.transform)).not.toBe('');
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => document.getElementById('bot-peeker').style.transform)).toBe('');
  await expect(bot).not.toHaveClass(/bot-side-left/);
  expect((await readStore(page)).prefs.botSide).toBe('right');
});

test('assistant celebrates nutrition goals and shows its target-overage and sleep reactions', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 90, targetWeight: 80 },
    foods: [],
    weights: [],
  });
  const mascot = page.locator('#bot-peeker');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });

  await page.evaluate(async () => addFood({
    name: 'Тестова страва', meal: 'lunch', grams: 200, kcal: 1800,
    protein: 80, fat: 20, carbs: 200, date: iso(),
  }));
  await expect(page.locator('#confetti-canvas')).toHaveCount(1);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'celebration');

  await page.evaluate(async () => addFood({
    name: 'Ще одна тестова страва', meal: 'dinner', grams: 100, kcal: 300,
    protein: 10, fat: 10, carbs: 30, date: iso(),
  }));
  await expect(mascot).toHaveAttribute('data-spine-mood', 'oops');

  await page.clock.fastForward(3000);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'idle');
  await expect(page.locator('#bot-zzz')).not.toHaveClass(/is-sleeping/);
  await page.mouse.move(200, 200);
  await expect.poll(() => page.evaluate(() => window.botGaze?.t)).toBeGreaterThan(0);
});


test('assistant welcome pools are localized by tone and stay silent while asleep', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T02:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
  const pools = await page.evaluate(() => ({
    ukMessages: I.uk.botWelcomeMessages,
    enPolite: I.en.botWelcomePolite,
    enPlayful: I.en.botWelcomePlayful,
  }));
  expect(pools.ukMessages).toHaveLength(30);
  expect(pools.enPolite).toHaveLength(8);
  expect(pools.enPlayful).toHaveLength(7);
  const topical = /Україн|ЗСУ|Росій|захисник|стрій|бореться|темряв/iu;
  expect(pools.ukMessages.slice(0, 10).filter(text => topical.test(text))).toHaveLength(10);
  expect(pools.ukMessages.slice(10).filter(text => topical.test(text))).toHaveLength(0);
  expect(pools.enPolite.join(' ')+pools.enPlayful.join(' ')).not.toMatch(/ЗСУ|Україн|Ukraine|Russia|Putin/i);
  const mascot = page.locator('#bot-peeker');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await page.clock.fastForward(4500);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleeping');
  await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);
});

test('assistant welcomes use profile names and match Ukrainian gender', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk', name: 'Олена', sex: 'female', aiTone: 'playful' }, foods: [], weights: [] });
  const result = await page.evaluate(() => {
    const source = '💙 Привіт! Україна прекрасна, а ти вже зробив/-ла крок до турботи про себе.';
    const female = personalizeBotWelcome(source, true);
    state.prefs.sex = 'male';
    const male = personalizeBotWelcome(source, true);
    state.prefs.sex = 'other';
    const neutral = personalizeBotWelcome(source, true);
    state.prefs.lang = 'en';
    const english = personalizeBotWelcome('🌿 Hi! Ready for a fresh start?', true);
    return { female, male, neutral, english };
  });
  expect(result.female).toContain('Олена');
  expect(result.female).toContain('зробила крок');
  expect(result.female).toContain('моя бусічко');
  expect(result.male).toContain('зробив крок');
  expect(result.male).toContain('мій котику');
  expect(result.neutral).toContain('зробив/-ла крок');
  expect(result.english).toContain('👋 Hi, Олена!');
  const parity = await page.evaluate(() => Object.keys(I.en).sort().join('|') === Object.keys(I.uk).sort().join('|'));
  expect(parity).toBe(true);
  expect(await page.evaluate(() => I.uk.botWelcomeUniversalPlayful)).toHaveLength(4);
});


test('Ukrainian assistant startup welcome uses one of the 30 approved messages and stays until touched', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk', name: 'Олена', aiTone: 'playful' }, foods: [], weights: [] });
  await page.clock.fastForward(2999);
  const bubble = page.locator('#bot-comic');
  await expect(bubble).not.toHaveClass(/is-visible/);
  await page.clock.fastForward(1001);
  await expect(bubble).toHaveClass(/is-visible/, { timeout: 5000 });
  const welcome = await page.evaluate(() => ({
    text: document.querySelector('#bot-comic .bot-comic-text').textContent,
    allowed: I.uk.botWelcomeMessages,
  }));
  expect(welcome.allowed).toHaveLength(30);
  expect(welcome.allowed).toContain(welcome.text);
  await page.clock.fastForward(15000);
  await expect(bubble).toHaveClass(/is-visible/);
  await page.locator('body').dispatchEvent('pointerdown');
  await expect(bubble).not.toHaveClass(/is-visible/);
});

test('assistant follows local night, morning, day, and evening routines', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T02:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const mascot = page.locator('#bot-peeker');
  const zzz = page.locator('#bot-zzz');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await expect(mascot).toHaveAttribute('data-time-period', 'night');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleeping');
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  const pajamaSlots = () => page.evaluate(() => {
    botSpineRig.skeleton.setToSetupPose();
    applyBotSleepwearSlots(botSpineRig);
    return Object.fromEntries(['pj_cap', 'pj_shirt', 'pj_upper_arm_l', 'pj_forearm_l'].map(name => [name, botSpineRig.skeleton.findSlot(name).attachment?.name ?? null]));
  });
  await expect.poll(pajamaSlots).toEqual({ pj_cap: 'pj_cap', pj_shirt: 'pj_shirt', pj_upper_arm_l: 'pj_upper_arm_l', pj_forearm_l: 'pj_forearm_l' });
  expect(await page.evaluate(() => ({
    pj_cap: botSpineRig.skeleton.findSlot('pj_cap').bone.data.name,
    pj_shirt: botSpineRig.skeleton.findSlot('pj_shirt').bone.data.name,
    pj_upper_arm_l: botSpineRig.skeleton.findSlot('pj_upper_arm_l').bone.data.name,
    pj_forearm_l: botSpineRig.skeleton.findSlot('pj_forearm_l').bone.data.name,
  }))).toEqual({ pj_cap: 'head', pj_shirt: 'torso', pj_upper_arm_l: 'upper_arm_l', pj_forearm_l: 'forearm_l' });
  const isArmMirroredBehindBack = () => page.evaluate(() => {
    let order = botSpineRig.skeleton.drawOrder.map(s => s.data.name);
    let torsoIndex = order.indexOf('torso');
    let armSlots = ['upper_arm_l', 'pj_upper_arm_l', 'forearm_l', 'pj_forearm_l', 'hand_l'];
    let bone = botSpineRig.bones.upper_arm_l;
    let elbow = botSpineRig.bones.forearm_l;
    let wrist = botSpineRig.bones.hand_l;
    return torsoIndex >= 0 && armSlots.every(name => order.indexOf(name) >= 0 && order.indexOf(name) < torsoIndex) && bone.scaleY === -1 && Math.abs(bone.rotation - 70) < 5 && elbow.worldX < bone.worldX && wrist.worldX <= elbow.worldX + 20;
  });
  await expect.poll(isArmMirroredBehindBack).toBe(true);

  await mascot.click();
  await expect(mascot).toHaveAttribute('data-spine-mood', 'surprise');
  await expect(zzz).not.toHaveClass(/is-sleeping/);
  await page.clock.fastForward(1200);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await page.clock.fastForward(15000);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleeping');
  await expect(zzz).toHaveClass(/is-sleeping/);

  const setTime = async (date) => {
    await page.clock.setSystemTime(new Date(date));
    await page.evaluate(() => syncBotTimePeriod());
  };
  await setTime('2026-11-03T04:59:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'night');
  await setTime('2026-11-03T05:00:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'morning');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect.poll(isArmMirroredBehindBack).toBe(true);
  await expect(zzz).not.toHaveClass(/is-sleeping/);
  await setTime('2026-11-03T08:59:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'morning');
  await setTime('2026-11-03T09:00:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'idle');
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
  await expect(zzz).not.toHaveClass(/is-sleeping/);
  await expect.poll(pajamaSlots).toEqual({ pj_cap: null, pj_shirt: null, pj_upper_arm_l: null, pj_forearm_l: null });
  const isArmInFront = () => page.evaluate(() => {
    let order = botSpineRig.skeleton.drawOrder.map(s => s.data.name);
    let bone = botSpineRig.bones.upper_arm_l;
    return order.indexOf('upper_arm_l') > order.indexOf('torso') && bone.scaleY === 1 && Math.abs(bone.rotation) < 5;
  });
  await expect.poll(isArmInFront).toBe(true);
  await setTime('2026-11-03T19:59:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await setTime('2026-11-03T20:00:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'evening');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect(zzz).not.toHaveClass(/is-sleeping/);
  await setTime('2026-11-03T23:59:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'evening');
  await setTime('2026-11-04T00:00:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'night');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleeping');
  await expect(zzz).toHaveClass(/is-sleeping/);
});

test('assistant waits fully off-screen until its entrance on load', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot', botSide: 'right' }, foods: [], weights: [] });
  const canvas = page.locator('#bot-peeker .bot-spine-canvas');
  await page.evaluate(() => document.getElementById('bot-peeker').classList.remove('is-arrived'));
  const right = await canvas.boundingBox();
  expect(right.x).toBeGreaterThanOrEqual(390);
  await page.evaluate(() => document.getElementById('bot-peeker').classList.add('bot-side-left'));
  const left = await canvas.boundingBox();
  expect(left.x + left.width).toBeLessThanOrEqual(0);
});

test('assistant stays sleepy instead of cheerful while wearing pajamas', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T21:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const mascot = page.locator('#bot-peeker');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await expect(mascot).toHaveAttribute('data-time-period', 'evening');
  await page.evaluate(() => nutritionBot.celebration());
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await page.evaluate(() => nutritionBot.wave());
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await page.clock.setSystemTime(new Date('2026-11-03T12:00:00'));
  await page.evaluate(() => syncBotTimePeriod());
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await page.evaluate(() => nutritionBot.celebration());
  await expect(mascot).toHaveAttribute('data-spine-mood', 'celebration');
});

test('hidden service menu forces assistant states until it is closed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const mascot = page.locator('#bot-peeker');
  const modal = page.locator('#bot-service-modal');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  const mouthScale = () => page.evaluate(() => botSpineRig.skeleton.findBone('mouth').scaleY);
  const eyeScale = () => page.evaluate(() => botSpineRig.skeleton.findBone('eye_l').scaleY);
  const isArmBehind = () => page.evaluate(() => {
    let order = botSpineRig.skeleton.drawOrder.map(s => s.data.name);
    let torsoIndex = order.indexOf('torso');
    let armSlots = ['upper_arm_l', 'pj_upper_arm_l', 'forearm_l', 'pj_forearm_l', 'hand_l'];
    let bone = botSpineRig.bones.upper_arm_l;
    let elbow = botSpineRig.bones.forearm_l;
    let wrist = botSpineRig.bones.hand_l;
    return torsoIndex >= 0 && armSlots.every(name => order.indexOf(name) >= 0 && order.indexOf(name) < torsoIndex) && bone.scaleY === -1 && Math.abs(bone.rotation - 70) < 5 && elbow.worldX < bone.worldX && wrist.worldX <= elbow.worldX + 20;
  });
  const dayMouth = await mouthScale();
  const dayEye = await eyeScale();
  await openView(page, 'settings');
  const title = page.locator('#bot-appearance-title');
  for (let i = 0; i < 4; i++) await title.click();
  await expect(modal).not.toHaveClass(/open/);
  await title.click();
  await expect(modal).toHaveClass(/open/);
  await modal.getByRole('button', { name: 'Asleep' }).click();
  await expect(mascot).toHaveAttribute('data-time-period', 'night');
  await expect.poll(isArmBehind).toBe(true);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleeping');
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect(page.locator('#bot-zzz')).toHaveClass(/is-sleeping/);
  await expect.poll(mouthScale).toBeLessThan(dayMouth * 0.9);
  await modal.getByRole('button', { name: 'Sleepy' }).click();
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await expect.poll(eyeScale).toBeLessThan(dayEye * 0.8);
  await expect.poll(isArmBehind).toBe(true);
  await expect(page.locator('#bot-zzz')).not.toHaveClass(/is-sleeping/);
  await modal.getByRole('button', { name: 'Awake' }).click();
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
  await modal.getByRole('button', { name: 'Put on pajamas' }).click();
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect.poll(isArmBehind).toBe(true);
  await modal.getByRole('button', { name: 'Take off pajamas' }).click();
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
  const isArmNormal = () => page.evaluate(() => {
    let order = botSpineRig.skeleton.drawOrder.map(s => s.data.name);
    let bone = botSpineRig.bones.upper_arm_l;
    return order.indexOf('upper_arm_l') > order.indexOf('torso') && bone.scaleY === 1 && Math.abs(bone.rotation) < 5;
  });
  await expect.poll(isArmNormal).toBe(true);
  await modal.locator('#bot-service-close').click();
  await expect(modal).not.toHaveClass(/open/);
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'idle');
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
});

test('comic assistant cloud artwork mirrors without mirroring text', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const result = await page.evaluate(() => {
    const bubble = document.querySelector('#bot-comic');
    const text = bubble.querySelector('.bot-comic-text');
    text.textContent = 'Readable on both sides';
    bubble.dataset.placement = 'top';
    bubble.dataset.side = 'right';
    fitBotComicCloud(bubble, 18, .75, 12);
    const path = bubble.querySelector('.bot-comic-shape path');
    const rightPath = path.getAttribute('d');
    const rightText = { value: text.textContent, transform: getComputedStyle(text).transform, parent: text.parentElement.className };
    bubble.dataset.side = 'left';
    fitBotComicCloud(bubble, 18, .25, 12);
    return { rightPath, leftPath: path.getAttribute('d'), pathTransform: path.getAttribute('transform'), artworkTransform: bubble.querySelector('.bot-comic-art').style.transform, text: { value: text.textContent, transform: getComputedStyle(text).transform, parent: text.parentElement.className }, dots: bubble.querySelectorAll('.bot-comic-thought-dot').length };
  });
  expect(result.leftPath).toBe(result.rightPath);
  expect(result.pathTransform).toBeNull();
  expect(result.artworkTransform).toBe('scaleX(-1)');
  expect(result.text.value).toBe('Readable on both sides');
  expect(result.text.parent).toBe('bot-comic');
  expect(result.text.transform).not.toMatch(/matrix\(-1/);
  expect(result.dots).toBe(3);
});

test('comic assistant cloud keeps a usable text area for very long messages on narrow screens', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const bubble = page.locator('#bot-comic');
  const longMessage = 'unbroken-message-'.repeat(45);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 780 });
    const layout = await page.evaluate(message => {
      const bubble = document.querySelector('#bot-comic');
      bubble.dataset.side = 'right';
      bubble.dataset.placement = 'top';
      bubble.querySelector('.bot-comic-text').textContent = message;
      positionBotComic();
      const bounds = bubble.getBoundingClientRect();
      const text = bubble.querySelector('.bot-comic-text');
      const textBounds = text.getBoundingClientRect();
      return { fit: bubble.dataset.fit, width: bounds.width, height: bounds.height, textWidth: textBounds.width, padding: getComputedStyle(bubble).padding };
    }, longMessage);
    expect(layout.width).toBeLessThanOrEqual(width - 47);
    expect(layout.height).toBeLessThanOrEqual(732);
    expect(layout.textWidth).toBeGreaterThan(120);
    expect(layout.padding).toMatch(/^14px 18px 32px$/);
    expect(layout.fit).toBe('ok');
    await expect(bubble.locator('.bot-comic-text')).toHaveText(longMessage);
  }
});

test('comic assistant message fits, stays until touch, and preview settings are temporary', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en', aiTone: 'playful' }, foods: [], weights: [] });
  await page.clock.fastForward(2999);
  const bubble = page.locator('#bot-comic');
  await expect(bubble).not.toHaveClass(/is-visible/);
  await page.clock.fastForward(1001);
  await expect(bubble).toHaveClass(/is-visible/, { timeout: 5000 });
  const welcome = await page.evaluate(() => ({ text: document.querySelector('#bot-comic .bot-comic-text').textContent, allowed: I.en.botWelcomePlayful }));
  expect(welcome.allowed).toHaveLength(7);
  expect(welcome.allowed.some(message => welcome.text.startsWith(message))).toBe(true);
  const uaWelcome = await page.evaluate(() => I.uk.botWelcomeMessages);
  expect(uaWelcome).toHaveLength(30);
  const topical = /Україн|ЗСУ|Росій|захисник|стрій|бореться|темряв/iu;
  expect(uaWelcome.slice(0, 10).filter(text => topical.test(text))).toHaveLength(10);
  expect(uaWelcome.slice(10).filter(text => topical.test(text))).toHaveLength(0);
  const fit = await bubble.evaluate(el => {
    const box = el.getBoundingClientRect();
    const path = el.querySelector('.bot-comic-shape path');
    const text = el.querySelector('.bot-comic-text');
    const textMatrix = new DOMMatrixReadOnly(getComputedStyle(text).transform);
    const angle = Math.atan2(textMatrix.b, textMatrix.a);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let textInside = true;
    for (let a = -1; a <= 1; a += .5) {
      for (let b = -1; b <= 1; b += .5) {
        if (Math.abs(a) < 1 && Math.abs(b) < 1) continue;
        const x = a * text.offsetWidth * .24;
        const y = b * text.offsetHeight * .22;
        if (!path.isPointInFill(new DOMPoint(text.offsetLeft + text.offsetWidth / 2 + x * cos - y * sin, text.offsetTop + text.offsetHeight / 2 + x * sin + y * cos))) textInside = false;
      }
    }
    return { withinViewport: box.left >= 0 && box.right <= innerWidth, withinHeight: box.top >= 0 && box.bottom <= innerHeight, textFits: text.scrollWidth <= text.clientWidth + 1, textAngle: angle * 180 / Math.PI, fontSize: getComputedStyle(el).fontSize, side: el.dataset.side, placement: el.dataset.placement, alpha: getComputedStyle(path).fill, cloud: Boolean(path.getAttribute('d')), textInside, hasCloseCross: Boolean(el.querySelector('.bot-comic-close')), sparkCount: el.querySelectorAll('.bot-comic-spark').length, outline: getComputedStyle(path).stroke, thoughtDots: el.querySelectorAll('.bot-comic-thought-dot').length, artworkTransform: el.querySelector('.bot-comic-art').style.transform, bubbleBackground: getComputedStyle(el).backgroundColor, shapeShadow: getComputedStyle(el.querySelector('.bot-comic-shape')).filter };
  });
  expect(fit.withinViewport).toBe(true);
  expect(fit.withinHeight).toBe(true);
  expect(fit.textFits).toBe(true);
  expect(fit.textAngle).toBe(0);
  expect(await bubble.evaluate(el => getComputedStyle(el).maxWidth)).toBe('340px');
  expect(fit.fontSize).toBe('17px');
  expect(fit.alpha).toMatch(/rgba/);
  expect(fit.cloud).toBe(true);
  const outlineArcCount = await bubble.locator('.bot-comic-shape path').getAttribute('d').then(d => (d.match(/A/g) || []).length);
  expect(outlineArcCount).toBeGreaterThanOrEqual(7);
  expect(fit.textInside).toBe(true);
  expect(fit.hasCloseCross).toBe(false);
  expect(fit.sparkCount).toBe(4);
  expect(fit.outline).toBe('rgb(40, 117, 79)');
  expect(fit.side).toBe('right');
  expect(fit.thoughtDots).toBe(3);
  expect(fit.artworkTransform).toBe('');
  expect(fit.bubbleBackground).toBe('rgba(0, 0, 0, 0)');
  expect(fit.shapeShadow).toBe('none');
  await page.evaluate(() => window.nutritionBot.say('Hi!'));
  const shortMessageWidth = await bubble.evaluate(el => el.getBoundingClientRect().width);
  await page.evaluate(() => window.nutritionBot.say('A longer assistant note should use more horizontal space and avoid looking like a narrow column.'));
  const longMessageWidth = await bubble.evaluate(el => el.getBoundingClientRect().width);
  expect(longMessageWidth).toBeGreaterThan(shortMessageWidth + 10);
  expect(longMessageWidth).toBeLessThanOrEqual(364);
  await page.setViewportSize({ width: 390, height: 844 });
  await bubble.evaluate(() => positionBotComic());
  const mobile = await bubble.evaluate(el => { const r=el.getBoundingClientRect(); return { centered: Math.abs(r.left+r.width/2-innerWidth/2)<2, left:r.left,width:r.width,screen:innerWidth }; });
  expect(mobile.centered).toBe(true);
  await page.evaluate(() => { document.querySelector('#bot-comic .bot-comic-text').textContent = 'A short note ✨'; positionBotComic(); });
  await page.locator('#bot-peeker').evaluate(el => { el.classList.add('bot-side-left'); el.style.left='8px'; el.style.right='auto'; positionBotComic(); });
  const leftSide = await bubble.getAttribute('data-side');
  await expect(bubble).toHaveAttribute('data-fit', 'ok');
  expect(leftSide).toBe('left');
  expect(await bubble.locator('.bot-comic-art').evaluate(el => el.style.transform)).toBe('scaleX(-1)');
  const leftOutlineArcCount = await bubble.locator('.bot-comic-shape path').getAttribute('d').then(d => (d.match(/A/g) || []).length);
  expect(leftOutlineArcCount).toBeGreaterThanOrEqual(7);
  await expect(bubble.locator('.bot-comic-shape path')).toHaveAttribute('d', /A/);
  await expect(bubble).toHaveAttribute('data-side', 'left');
  await expect(bubble.locator('.bot-comic-text')).toHaveCSS('--comic-text-angle', '0deg');
  expect(await bubble.locator('.bot-comic-shape').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBe(1);
  const leftBounds = await bubble.evaluate(el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; });
  expect(leftBounds.left).toBeGreaterThanOrEqual(0);
  expect(leftBounds.right).toBeLessThanOrEqual(390);
  expect(leftBounds.top).toBeGreaterThanOrEqual(0);
  expect(leftBounds.bottom).toBeLessThanOrEqual(844);
  await page.evaluate(() => window.nutritionBot.say('This is a much longer assistant message to verify that the entire comic cloud remains within the visible screen area. '.repeat(8), { duration: 60 }));
  await expect.poll(() => bubble.evaluate(el => { const r=el.getBoundingClientRect(); return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight; })).toBe(true);
  await page.evaluate(() => { document.querySelector('#bot-comic .bot-comic-text').textContent = 'A short note ✨'; positionBotComic(); });
  await page.locator('#bot-peeker').evaluate(el => { el.classList.remove('bot-side-left'); el.style.left=''; el.style.right=''; positionBotComic(); });
  const rightSide = await bubble.getAttribute('data-side');
  
  await expect(bubble).toHaveAttribute('data-fit', 'ok');
  expect(rightSide).toBe('right');
  expect(await bubble.locator('.bot-comic-art').evaluate(el => el.style.transform)).toBe('');
  const rightBounds = await bubble.evaluate(el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; });
  expect(rightBounds.left).toBeGreaterThanOrEqual(0);
  expect(rightBounds.right).toBeLessThanOrEqual(390);
  expect(rightBounds.top).toBeGreaterThanOrEqual(0);
  expect(rightBounds.bottom).toBeLessThanOrEqual(844);
  await expect(bubble).toHaveAttribute('data-side', 'right');
  await expect(bubble.locator('.bot-comic-text')).toHaveCSS('--comic-text-angle', '0deg');
  expect(await bubble.locator('.bot-comic-thought-dot').count()).toBe(3);
  await expect(bubble.locator('.bot-comic-shape path')).toHaveAttribute('d', /A/);
  await page.evaluate(() => window.nutritionBot.say('Timer test', { duration: 1 }));
  await page.clock.fastForward(1400);
  await expect(bubble).not.toHaveClass(/is-visible/);
  await page.locator('body').dispatchEvent('pointerdown');
  await expect(bubble).not.toHaveClass(/is-visible/);

  await openView(page, 'settings');
  const title = page.locator('#bot-appearance-title');
  for (let i = 0; i < 5; i++) await title.click();
  const modal = page.locator('#bot-service-modal');
  await expect(modal).toHaveClass(/open/);
  await page.setViewportSize({ width: 390, height: 844 });
  await modal.locator('#bot-comic-preview-toggle').click();
  const preview = page.locator('#bot-comic');
  await expect(preview).toHaveClass(/bot-comic-preview/);
  expect(await preview.evaluate(el => el.parentElement === document.body)).toBe(true);
  const previewGeometry = await page.evaluate(() => { const a=document.querySelector('#bot-comic').getBoundingClientRect(), b=document.querySelector('#bot-peeker').getBoundingClientRect(); return {fixed:getComputedStyle(document.querySelector('#bot-comic')).position,zIndex:+getComputedStyle(document.querySelector('#bot-comic')).zIndex,left:a.left,right:a.right,top:a.top,bottom:a.bottom,nearRobot:Math.abs((a.left+a.right)/2-(b.left+b.right)/2)<200}; });
  expect(previewGeometry.fixed).toBe('fixed');
  expect(previewGeometry.zIndex).toBeGreaterThan(100);
  expect(previewGeometry.left).toBeGreaterThanOrEqual(0);
  expect(previewGeometry.right).toBeLessThanOrEqual(390);
  expect(previewGeometry.top).toBeGreaterThanOrEqual(0);
  expect(previewGeometry.bottom).toBeLessThanOrEqual(844);
  expect(previewGeometry.nearRobot).toBe(true);
  await page.locator('body').dispatchEvent('pointerdown');
  await expect(preview).toHaveClass(/is-visible/);
  await modal.locator('#bot-comic-text').fill('A tiny preview ✨');
  await expect(preview).toHaveText('A tiny preview ✨');
  await modal.locator('#bot-comic-font').evaluate(el => { el.value = '22'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('font-size', '22px');
  await modal.locator('#bot-comic-padding').evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('padding', '22px 26px 40px');
  await modal.locator('#bot-comic-duration').evaluate(el => { el.value = '8'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(modal.locator('#bot-comic-duration-value')).toHaveText('8 s');
  await modal.locator('#bot-comic-alpha').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(preview.locator('.bot-comic-shape path')).toHaveCSS('fill', 'rgba(255, 255, 255, 0.5)');
  await modal.locator('#bot-comic-width').evaluate(el => { el.value = '200'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('max-width', '200px');
  await modal.locator('#bot-comic-radius').evaluate(el => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('--comic-radius', '30px');
  await modal.locator('#bot-comic-border').evaluate(el => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('--comic-border', '4px');
  await modal.locator('#bot-comic-outline').evaluate(el => { el.value = '#28754f'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('--comic-outline', '#28754f');
  await modal.locator('#bot-comic-bg').evaluate(el => { el.value = '#ffeecc'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview.locator('.bot-comic-shape path')).toHaveCSS('fill', 'rgba(255, 238, 204, 0.5)');
  await modal.locator('#bot-comic-color').evaluate(el => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('--comic-color', '#123456');
  await modal.locator('#bot-comic-weight').selectOption('600');
  await expect(preview).toHaveCSS('font-weight', '600');
  await modal.locator('#bot-comic-placement').selectOption('bottom');
  await expect(preview).toHaveAttribute('data-placement', 'bottom');
  await modal.locator('#bot-comic-gap').evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await modal.locator('#bot-comic-offset-x').evaluate(el => { el.value = '12'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await modal.locator('#bot-comic-offset-y').evaluate(el => { el.value = '12'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const adjustedBubble = await preview.evaluate(el => { const r=el.getBoundingClientRect(); return {left:r.left,top:r.top}; });
  expect(adjustedBubble.left).toBeGreaterThan(0);
  expect(adjustedBubble.top).toBeGreaterThan(0);
  await modal.locator('#bot-comic-motion').selectOption('float');
  await expect(preview).toHaveAttribute('data-motion', 'float');
  await modal.locator('#bot-comic-dismiss').selectOption('shrink');
  await expect(preview).toHaveAttribute('data-dismiss', 'shrink');
  await modal.locator('#bot-comic-dismiss-test').click();
  await expect(preview).not.toHaveClass(/is-visible/);
  await expect(preview).toHaveClass(/is-visible/, { timeout: 2000 });
  await expect(preview.locator('.bot-comic-text')).toHaveCSS('--comic-text-angle', '0deg');
  await expect(preview.locator('.bot-comic-thought-dot')).toHaveCount(3);
  await modal.locator('#bot-service-close').click();
  await expect(modal).not.toHaveClass(/open/);
  await expect(preview).not.toHaveClass(/is-visible/);
  expect(await page.evaluate(() => localStorage.getItem('smartdiet-v1'))).not.toContain('A tiny preview');
  for (let i = 0; i < 5; i++) await title.click();
  await modal.locator('#bot-comic-preview-toggle').click();
  await expect(preview).toHaveText('Hi! 🌿 I’m ready to help you today ✨');
  await expect(preview).toHaveCSS('font-size', '17px');
  await expect(preview).toHaveCSS('--comic-alpha', '0.95');
  await expect(preview).toHaveCSS('--comic-radius', '30px');
  await expect(modal.locator('#bot-comic-offset-y')).toHaveValue('35');
  await expect(modal.locator('#bot-comic-placement')).toHaveValue('auto');
  await modal.locator('#bot-service-close').click();
  await page.evaluate(() => window.nutritionBot.say('Saved! 🎉', { duration: 2 }));
  await expect(bubble).toHaveText('Saved! 🎉');
  await page.clock.fastForward(2100);
  await expect(bubble).not.toHaveClass(/is-visible/);
});

test('assistant action message stays until a choice is pressed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  await page.clock.fastForward(4500);
  const bubble = page.locator('#bot-comic');
  await expect(bubble).toHaveClass(/is-visible/);
  await page.evaluate(() => { window.__assistantChoice = window.nutritionBot.ask('Save this choice?', [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }]); });
  await expect(bubble).toContainText('Save this choice?');
  await expect(bubble.locator('.bot-comic-actions button')).toHaveCount(2);
  await page.clock.fastForward(30_000);
  await page.locator('body').dispatchEvent('pointerdown');
  await expect(bubble).toHaveClass(/is-visible/);
  await bubble.locator('.bot-comic-actions button').first().click();
  await expect(bubble).not.toHaveClass(/is-visible/);
  await expect.poll(() => page.evaluate(() => window.__assistantChoice)).toBe('yes');
});

test('putting on and taking off pajamas plays a sparkle transition', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const mascot = page.locator('#bot-peeker');
  const modal = page.locator('#bot-service-modal');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await page.clock.fastForward(3500);
  await openView(page, 'settings');
  const title = page.locator('#bot-appearance-title');
  for (let i = 0; i < 5; i++) await title.click();
  await expect(modal).toHaveClass(/open/);
  await modal.getByRole('button', { name: 'Put on pajamas' }).click();
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await page.clock.fastForward(200);
  expect(await page.evaluate(() => botSpineRig.pajamaFx?.dir)).toBe('on');
  expect(await page.evaluate(() => botSpineRig.pajamaFx.particles.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => botSpineRig.skeleton.findSlot('pj_cap').color.a)).toBeLessThan(1);
  await page.clock.fastForward(3000);
  expect(await page.evaluate(() => botSpineRig.pajamaFx)).toBeNull();
  expect(await page.evaluate(() => botSpineRig.skeleton.findSlot('pj_cap').color.a)).toBe(1);
  await modal.getByRole('button', { name: 'Take off pajamas' }).click();
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
  await page.clock.fastForward(200);
  expect(await page.evaluate(() => botSpineRig.pajamaFx?.dir)).toBe('off');
  expect(await page.evaluate(() => botSpineRig.skeleton.findSlot('pj_cap').attachment?.name ?? null)).toBe('pj_cap');
  await page.clock.fastForward(3000);
  expect(await page.evaluate(() => botSpineRig.pajamaFx)).toBeNull();
  expect(await page.evaluate(() => botSpineRig.skeleton.findSlot('pj_cap').attachment?.name ?? null)).toBeNull();
});

test('legacy profile initialization migrates the birth date without blocking app startup', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('smartdiet-v1', JSON.stringify({
    prefs: { name: 'Legacy profile', age: 35, currentWeight: 100, height: 180, targetWeight: 80, pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70, lang: 'en' },
    foods: [],
    weights: [],
    products: [],
  })));
  await page.reload();
  await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
  expect((await readStore(page)).prefs.birthDate).toBeTruthy();
});

test('a qualifying weigh-in offers a plan update and acceptance preserves the profile baseline', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  const candidateKcal = 1781;
  expect(2236 - candidateKcal).toBeGreaterThanOrEqual(50);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  const bubble = page.locator('#bot-comic');
  await expect(bubble).toContainText(`Update your weight-loss plan?`);
  await expect(bubble.locator('.bot-comic-actions button')).toHaveCount(2);
  await bubble.locator('.bot-comic-actions button').first().click();
  await expect(bubble).not.toHaveClass(/is-visible/);
  const saved = await readStore(page);
  expect(saved.prefs.kcal).toBe(candidateKcal);
  expect(saved.prefs.currentWeight).toBe(100);
  expect(saved.prefs.currentWeightDate).toBe('2026-10-01');
  expect(saved.weights.map(item => item.value)).toContain(90);
});

test('a qualifying weigh-in can keep the existing plan and a drop under 50 kcal does not prompt', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  const bubble = page.locator('#bot-comic');
  await expect(bubble).toContainText('Update your weight-loss plan?');
  await bubble.locator('.bot-comic-actions button').nth(1).click();
  expect((await readStore(page)).prefs.kcal).toBe(2236);

  await page.reload();
  await page.clock.fastForward(2200);
  await page.evaluate(() => { state.prefs = { ...state.prefs, kcal: 1925 }; save(); });
  expect(1925 - 1876).toBe(49);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '99.9');
  await page.locator('#weight-save').click();
  await expect(bubble).not.toHaveClass(/is-visible/);
  const afterSmallDrop = await readStore(page);
  expect(afterSmallDrop.prefs.currentWeight).toBe(100);
  expect(afterSmallDrop.weights.map(item => item.value)).toContain(99.9);
});

test('logging weight closer to the goal celebrates progress', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, currentWeight: 90, currentWeightDate: '2026-10-01', targetWeight: 80 },
    foods: [],
    weights: [],
  });
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '89');
  await page.locator('#weight-save').click();
  await expect(page.locator('#confetti-canvas')).toHaveCount(1);
  await expect(page.locator('#bot-peeker')).toHaveAttribute('data-spine-mood', 'celebration');
  expect(await page.evaluate(() => state.weights.map((item) => item.value))).toContain(89);
});
