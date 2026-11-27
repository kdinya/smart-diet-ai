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


test.describe('Smoke: app version', () => {
  test('shows the current release version in Settings in both interface languages', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    const release = await page.evaluate(() => ({
      version: APP_VERSION,
      newestFirst: APP_RELEASES.slice().reverse().map((item) => item.version),
      latest: APP_RELEASES[APP_RELEASES.length - 1],
    }));
    expect(release.newestFirst[0]).toBe(release.version);
    expect(release.latest.description.en).toBe('Modularized localization dictionaries for improved loading and streamlined updates.');
    expect(release.latest.description.uk).toBe('Модуляризація словників локалізації для швидшого завантаження та зручніших оновлень.');
    expect(release.latest.added.en.some((item) => item.includes('translation dictionaries'))).toBe(true);
    expect(release.latest.added.uk.some((item) => item.includes('словники перекладів'))).toBe(true);
    const v11 = await page.evaluate(() => APP_RELEASES.find((item) => item.version === '2026.11.11'));
    expect(v11.added.en.some((item) => item.includes('last sign-in date and time'))).toBe(true);
    expect(v11.added.uk.some((item) => item.includes('дату й час останнього входу'))).toBe(true);
    const currentRelease = await page.evaluate(() => APP_RELEASES.find((item) => item.version === '2026.11.12'));
    expect(currentRelease.added.en.some((item) => item.includes('last opened the app'))).toBe(false);
    expect(currentRelease.added.uk.some((item) => item.includes('востаннє відкривав застосунок'))).toBe(false);
    expect(v11.fixed.en.some((item) => item.includes('Add-ons of shared catalog products'))).toBe(true);
    expect(v11.fixed.uk.some((item) => item.includes('Додатки продуктів зі спільного каталогу'))).toBe(true);
    expect(v11.improved.en.some((item) => item.includes('A clearer catalog design, easier product controls on mobile, and a visible mark for items already saved.'))).toBe(true);
    expect(v11.improved.uk.some((item) => item.includes('Виразніше оформлення каталогу, зручніше керування продуктами на телефоні та помітне позначення вже збережених продуктів.'))).toBe(true);
    expect(v11.improved.en.some((item) => item.includes('Search now scrolls consistently in My products and the shared catalog'))).toBe(true);
    expect(v11.improved.uk.some((item) => item.includes('Прокручування пошуку узгоджене'))).toBe(true);
    expect(v11.improved.en.some((item) => item.includes('Improved tablet page layouts and password visibility controls.'))).toBe(true);
    expect(v11.improved.uk.some((item) => item.includes('Покращено розкладку сторінок на планшеті та керування видимістю пароля.'))).toBe(true);
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
  test('parses Russian labels, plural names and same-line values without mixing them', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page, { prefs: BASE_PREFS, products: [], foods: [], weights: [] });
    await openView(page, 'products');
    await page.click('#product-new');
    await page.click('#product-type-simple');
    await page.fill('#food-name', 'Parser product');
    await page.evaluate(async () => navigator.clipboard.writeText('Энергетическая ценность\t263 ккал\nБелки\t6.93 г\nЖиры\t1.2 г\nУглеводы\t45 г'));
    await page.click('#product-import-clipboard');
    await expect(page.locator('#product-import-modal')).toHaveClass(/open/);
    await expect(page.locator('#import-kcal')).toHaveValue('263');
    await expect(page.locator('#import-protein')).toHaveValue('6.93');
    await expect(page.locator('#import-fat')).toHaveValue('1.2');
    await expect(page.locator('#import-carbs')).toHaveValue('45');
    await page.click('#product-import-close');
    await expect(page.locator('#product-import-modal')).not.toHaveClass(/open/);

    await page.evaluate(async () => navigator.clipboard.writeText('263kcal Proteins 6.9g Fat 1.2g Carbs 45g'));
    await page.click('#product-import-clipboard');
    await expect(page.locator('#product-import-modal')).toHaveClass(/open/);
    await expect(page.locator('#import-kcal')).toHaveValue('263');
    await expect(page.locator('#import-protein')).toHaveValue('6.9');
    await expect(page.locator('#import-fat')).toHaveValue('1.2');
    await expect(page.locator('#import-carbs')).toHaveValue('45');
  });

  test('shows copied nutrition text and editable parsed values before filling product form', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page, { prefs: BASE_PREFS, products: [], foods: [], weights: [] });
    await page.evaluate(async () => navigator.clipboard.writeText(`263 ккал\nТакож 1,100 кДж ● Енергія\nБілки\n6.93 г\nРекомендована добова норма споживання: 118 г\nВуглеводи\n30 г\nРекомендована добова норма споживання: 182 г\nЦукор\n12 г\nЖири\n11.93 г\nРекомендована добова норма споживання: 53 г\nНасичені жирні кислоти\n8 г`));
    await openView(page, 'products');
    await page.click('#product-new');
    await page.click('#product-type-simple');
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
    await page.locator('#products-list .product-toggle-main').first().click();
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
    await page.click('#product-type-simple');
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
    await page.click('#product-type-simple');
    await page.fill('#food-name', 'Test product');
    await page.click('#product-import-clipboard');
    await expect(page.locator('#product-import-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#notif-stack')).toContainText('Could not confidently find calories');
  });
});

test.describe('Smoke: input limits and resilience', () => {
  test('values above the database limits are rejected in the forms', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(() => openModal('food', 'breakfast'));
    await page.locator('#food-add-manual').click();
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
    await page.locator('#food-add-manual').click();
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

  test('registration confirms the password and immediately opens the signed-in profile', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.locator('#onboarding-choice-signup').click();
    await expect(page.locator('#onboard-auth-submit')).toContainText('Create account');
    await expect(page.locator('#onboard-auth-password')).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.locator('#onboard-username-field')).toBeVisible();
    await expect(page.locator('#onboard-confirm-password-field')).toBeVisible();
    await expect(page.locator('#onboard-password-hint')).toHaveText('Minimum password length: 6 characters.');
    await page.locator('#onboard-auth-password-toggle').click();
    await expect(page.locator('#onboard-auth-password')).toHaveAttribute('type', 'text');
    await page.locator('#onboard-auth-password-toggle').click();
    await expect(page.locator('#onboard-auth-password')).toHaveAttribute('type', 'password');
    await page.locator('#onboard-confirm-password-toggle').click();
    await expect(page.locator('#onboard-confirm-password')).toHaveAttribute('type', 'text');
    await expect(page.locator('#onboard-confirm-password-toggle')).toHaveAttribute('aria-label', 'Hide password');
    await page.locator('#onboard-confirm-password-toggle').click();
    await expect(page.locator('#onboard-confirm-password')).toHaveAttribute('type', 'password');
    const toggleBounds = await page.locator('#onboard-auth-password-toggle').boundingBox();
    const confirmBounds = await page.locator('#onboard-confirm-password').boundingBox();
    expect(toggleBounds.x + toggleBounds.width).toBeLessThanOrEqual(360);
    expect(confirmBounds.x + confirmBounds.width).toBeLessThanOrEqual(360);
    await page.fill('#onboard-username', 'Alice');
    await page.fill('#onboard-auth-email', '  new@example.test  ');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.fill('#onboard-confirm-password', PASSWORD);
    await expect(page.locator('#onboard-confirm-password-status')).toHaveText('Passwords match.');
    await page.locator('#onboard-auth-submit').click();
    await expect.poll(async () => backend.authEvents).toEqual([{ action: 'signup', email: 'new@example.test', displayName: 'Alice' }]);
    await expect.poll(async () => (await readStore(page)).synced?.uid).toBe(USERS['new@example.test']);
    await expect(page.locator('#onboarding-profile')).toBeVisible();
    await expect(page.locator('#onboarding-greeting')).toHaveText('Welcome, Alice!');
    await expect(page.locator('#onboard-name')).toHaveValue('Alice');
    await expect(page.locator('#onboard-auth-status')).not.toContainText('If you just created an account');
  });

  test('signup requires a repeated password and rejects a mismatch in Ukrainian', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk', setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await page.fill('#onboard-username', 'Олена');
    await page.fill('#onboard-auth-email', 'new@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Повтори пароль для перевірки.');
    expect(backend.authEvents).toEqual([]);
    await page.fill('#onboard-confirm-password', `${PASSWORD}different`);
    await expect(page.locator('#onboard-confirm-password-status')).toHaveText('Паролі не збігаються.');
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Паролі не збігаються.');
    expect(backend.authEvents).toEqual([]);
    await page.fill('#onboard-confirm-password', PASSWORD);
    await expect(page.locator('#onboard-confirm-password-status')).toHaveText('Паролі збігаються.');
  });

  test('settings signup shows the name and confirmation fields only in signup mode', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.setViewportSize({ width: 360, height: 800 });
    await openView(page, 'settings');
    await page.locator('[data-auth="signup"]').click();
    await expect(page.locator('#auth-password-hint')).toBeVisible();
    await expect(page.locator('#auth-signup-name-field')).toBeVisible();
    await expect(page.locator('#auth-confirm-password-field')).toBeVisible();
    await expect(page.locator('#auth-confirm-password')).toHaveAttribute('autocomplete', 'new-password');
    for (const selector of ['#auth-password', '#auth-password-toggle', '#auth-confirm-password', '#auth-confirm-password-toggle']) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
    }
    await page.locator('[data-auth="signin"]').click();
    await expect(page.locator('#auth-signup-name-field')).toBeHidden();
    await expect(page.locator('#auth-confirm-password-field')).toBeHidden();
    await page.locator('[data-auth="signup"]').click();
    await page.locator('#auth-password-toggle').click();
    await expect(page.locator('#auth-password')).toHaveAttribute('type', 'text');
    await page.locator('#auth-password-toggle').click();
    await expect(page.locator('#auth-password')).toHaveAttribute('type', 'password');
    await page.locator('#auth-confirm-password-toggle').click();
    await expect(page.locator('#auth-confirm-password')).toHaveAttribute('type', 'text');
    await page.locator('#auth-confirm-password-toggle').click();
    await expect(page.locator('#auth-confirm-password')).toHaveAttribute('type', 'password');
  });

  test('settings signup saves the entered name in the profile', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'settings');
    await page.locator('[data-auth="signup"]').click();
    await page.fill('#auth-signup-name', 'Casey');
    await page.fill('#auth-email', 'new@example.test');
    await page.fill('#auth-password', PASSWORD);
    await page.fill('#auth-confirm-password', PASSWORD);
    await page.locator('#auth-submit').click();
    await expect.poll(async () => (await readStore(page)).synced?.uid).toBe(USERS['new@example.test']);
    const store = await readStore(page);
    expect(store.prefs.name).toBe('Casey');
    await expect(page.locator('#pref-name')).toHaveValue('Casey');
    expect(backend.authEvents).toEqual([{ action: 'signup', email: 'new@example.test', displayName: 'Casey' }]);
  });

  test('short signup passwords are rejected with a clear message before calling Supabase', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await page.fill('#onboard-username', 'Alice');
    await page.fill('#onboard-auth-email', 'new@example.test');
    await page.fill('#onboard-auth-password', '12345');
    await page.fill('#onboard-confirm-password', '12345');
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Use at least 6 characters for the password.');
    expect(backend.authEvents).toEqual([]);
  });

  test('signup without a session stays on the confirmation step and gives privacy-safe guidance', async ({ page }) => {
    const backend = createBackend();
    backend.signupWithoutSession = true;
    backend.signupIdentities = [];
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await page.fill('#onboard-username', 'Alice');
    await page.fill('#onboard-auth-email', 'new@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.fill('#onboard-confirm-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toContainText('If you just created an account');
    await expect(page.locator('#onboarding-auth')).toBeVisible();
    await expect(page.locator('#onboarding-profile')).toBeHidden();
    expect((await readStore(page)).synced?.uid).toBeUndefined();
  });

  test('invalid signup email response is translated into a clear message', async ({ page }) => {
    const backend = createBackend();
    backend.signupError = { msg: 'Invalid email address' };
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await page.fill('#onboard-username', 'Alice');
    await page.fill('#onboard-auth-email', 'new@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.fill('#onboard-confirm-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Enter a valid email address.');
    await expect(page.locator('#onboarding-auth')).toBeVisible();
  });

  test('signup does not reveal whether an email address is already registered', async ({ page }) => {
    const backend = createBackend();
    backend.signupError = { msg: 'User already registered' };
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await page.fill('#onboard-username', 'Alice');
    await page.fill('#onboard-auth-email', 'new@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.fill('#onboard-confirm-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('We could not create the account. Check your details and try again.');
    await expect(page.locator('#onboard-auth-status')).not.toContainText('registered');
  });

  test('signup rate limits stay on the form with a clear message', async ({ page }) => {
    const backend = createBackend();
    backend.signupError = { msg: 'email rate limit exceeded' };
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await page.fill('#onboard-username', 'Alice');
    await page.fill('#onboard-auth-email', 'new@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.fill('#onboard-confirm-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Too many emails have been requested. Wait a while before trying again.');
    await expect(page.locator('#onboarding-auth')).toBeVisible();
    expect((await readStore(page)).synced?.uid).toBeUndefined();
  });

  test('network errors during signup return a retryable message without signing in', async ({ page }) => {
    const backend = createBackend();
    backend.authNetworkFailure = 'signup';
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await page.fill('#onboard-username', 'Alice');
    await page.fill('#onboard-auth-email', 'new@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.fill('#onboard-confirm-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('We could not create the account. Check your details and try again.');
    await expect(page.locator('#onboarding-auth')).toBeVisible();
    expect((await readStore(page)).synced?.uid).toBeUndefined();
  });

  test('invalid sign-ins use the same privacy-safe message and never create a session', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signin').click();
    await page.fill('#onboard-auth-email', 'alice@example.test');
    await page.fill('#onboard-auth-password', 'wrong-password');
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Incorrect email address or password.');
    await page.fill('#onboard-auth-email', 'missing@example.test');
    await page.fill('#onboard-auth-password', 'any-password');
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Incorrect email address or password.');
    await expect(page.locator('#onboarding-auth')).toBeVisible();
    expect((await readStore(page)).synced?.uid).toBeUndefined();
  });

  test('network errors during sign-in return a retryable message without creating a session', async ({ page }) => {
    const backend = createBackend();
    backend.authNetworkFailure = 'signin';
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signin').click();
    await page.fill('#onboard-auth-email', 'alice@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Sign-in failed. Check your details and try again.');
    await expect(page.locator('#onboarding-auth')).toBeVisible();
    expect((await readStore(page)).synced?.uid).toBeUndefined();
  });

  test('registration without a username is blocked before Supabase signup', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await page.fill('#onboard-auth-email', 'noname@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.fill('#onboard-confirm-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect(page.locator('#onboard-auth-status')).toHaveText('Enter a username to create an account.');
    expect(backend.authEvents).toEqual([]);
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
    await expect(page.locator('#save-prefs')).toBeDisabled();
    await expect(page.locator('#goal-min-hint')).toContainText('1500');
    await page.fill('#pref-kcal', '1600');
    await expect(page.locator('#save-prefs')).toBeEnabled();
    await expect(page.locator('#goal-min-hint')).toBeHidden();
    await page.fill('#pref-kcal', '2000');
    await page.fill('#pref-kcal', '2000');
    await page.evaluate(() => {
      document.getElementById('pref-protein').value = '200';
      document.getElementById('pref-carbs').value = '300';
      document.getElementById('pref-fat').value = '70';
    });
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

  test('accepting a shared composite dish preserves its recipe and displays the recipe icon', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const result = await page.evaluate(async () => {
      const components = [
        { id: 'sender-oats', name: 'Oats', grams: 60, kcal: 230, protein: 8, fat: 4, carbs: 40 },
        { id: 'sender-milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5 },
      ];
      const sentProduct = sharedProductPayload({ id: 'dish-id', name: 'Oat bowl', grams: 160, kcal: 280, protein: 11, fat: 6, carbs: 45, components });
      const chain = { delete() { return this; }, eq() { return this; }, select() { return this; }, then(resolve) { resolve({ data: [{ id: 'share-composite' }], error: null }); } };
      sb = { from: () => chain };
      runSync = async () => {};
      user = { id: 'u-recipient' };
      inboxRows = [{ id: 'share-composite', name: 'Oat bowl', grams: 160, kcal: 280, protein: 11, fat: 6, carbs: 45, from_user: 'u-sender', components }];
      renderInbox();
      const inbox = document.querySelector('[data-share-id="share-composite"]');
      const inboxBeforeAccept = { names: inbox.textContent, hasIcon: !!inbox.querySelector('.product-is-composite') };
      await resolveShare('share-composite', true);
      renderProducts();
      const product = state.products.find(item => item.name === 'Oat bowl');
      const card = document.querySelector(`#products-list [data-product-id="${product?.id}"]`);
      return { sentComponents: sentProduct.components, inboxBeforeAccept, components: product?.components, productComponentsHidden: !!card?.querySelector('[data-product-components].hidden'), hasAcceptedIcon: !!card?.querySelector('.product-is-composite') };
    });
    expect(result.sentComponents.map(item => item.name)).toEqual(['Oats', 'Milk']);
    expect(result.inboxBeforeAccept.names).toContain('Oats');
    expect(result.inboxBeforeAccept.names).toContain('Milk');
    expect(result.inboxBeforeAccept.hasIcon).toBe(true);
    expect(result.components.map(item => item.name)).toEqual(['Oats', 'Milk']);
    expect(result.components.map(item => item.kcal)).toEqual([230, 50]);
    expect(result.productComponentsHidden).toBe(true);
    expect(result.hasAcceptedIcon).toBe(true);
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

test('settings sections offer localized help dialogs in both languages', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  await openView(page, 'settings');
  const headings = page.locator('#view-settings h2[data-settings-help]');
  await expect(headings).toHaveCount(9);
  const parity = await page.evaluate(() => Object.keys(I.en).sort().join('|') === Object.keys(I.uk).sort().join('|'));
  expect(parity).toBe(true);
  await expect(page.locator('#view-settings .settings-info-btn')).toHaveCount(9);
  const iconStylesMatchStatistics = await page.evaluate(() => {
    const settings = getComputedStyle(document.querySelector('#view-settings .settings-info-btn'));
    const statisticsIcon = document.createElement('button');
    statisticsIcon.className = 'metric-info-btn';
    document.body.append(statisticsIcon);
    const statistics = getComputedStyle(statisticsIcon);
    const matches = ['width', 'height', 'borderRadius', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'backgroundColor', 'color', 'fontFamily', 'fontSize', 'fontWeight'].every((property) => settings[property] === statistics[property]);
    statisticsIcon.remove();
    return matches;
  });
  expect(iconStylesMatchStatistics).toBe(true);
  await page.setViewportSize({ width: 360, height: 800 });
  const multilineHeading = page.locator('#view-settings h2[data-settings-help="aiProvider"]');
  const multilineTitleState = await multilineHeading.evaluate((heading) => {
    const textNode = [...heading.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const originalText = textNode.textContent;
    textNode.textContent = 'AI provider configuration and model options across several lines';
    const range = document.createRange();
    range.selectNode(textNode);
    const lines = [...range.getClientRects()];
    const icon = heading.querySelector('.settings-info-btn').getBoundingClientRect();
    const title = heading.getBoundingClientRect();
    textNode.textContent = originalText;
    return { lineCount: lines.length, iconOffset: icon.top - title.top };
  });
  expect(multilineTitleState.lineCount).toBeGreaterThan(1);
  expect(Math.abs(multilineTitleState.iconOffset)).toBeLessThanOrEqual(1);
  const englishHelp = await page.evaluate(() => Object.fromEntries(Object.keys(I.en).filter((key) => key.startsWith('settingsHelp') && key.endsWith('Body')).map((key) => { const suffix = key.slice('settingsHelp'.length, -'Body'.length); return [suffix, [I.en[`settingsHelp${suffix}Title`], I.en[key]]]; })));
  for (const heading of await headings.all()) {
    const key = await heading.getAttribute('data-settings-help');
    const button = heading.locator('.settings-info-btn');
    await expect(button).toHaveAttribute('aria-label', 'About this section');
    await expect(button).toHaveText('i');
    await button.click();
    const suffix = key[0].toUpperCase() + key.slice(1);
    await expect(page.locator('#info-title')).toHaveText(englishHelp[suffix][0]);
    await expect(page.locator('#info-body')).toHaveText(englishHelp[suffix][1]);
    await page.locator('#info-close').click();
  }

  await page.selectOption('#pref-lang', 'uk');
  await page.locator('#save-lang').click();
  const ukrainianHelp = await page.evaluate(() => Object.fromEntries(Object.keys(I.uk).filter((key) => key.startsWith('settingsHelp') && key.endsWith('Body')).map((key) => { const suffix = key.slice('settingsHelp'.length, -'Body'.length); return [suffix, [I.uk[`settingsHelp${suffix}Title`], I.uk[key]]]; })));
  for (const heading of await headings.all()) {
    const key = await heading.getAttribute('data-settings-help');
    const button = heading.locator('.settings-info-btn');
    await expect(button).toHaveAttribute('aria-label', 'Про цей розділ');
    await expect(button).toHaveText('i');
    await button.click();
    const suffix = key[0].toUpperCase() + key.slice(1);
    await expect(page.locator('#info-title')).toHaveText(ukrainianHelp[suffix][0]);
    await expect(page.locator('#info-body')).toHaveText(ukrainianHelp[suffix][1]);
    await page.locator('#info-close').click();
  }
});

test.describe('Smoke: pediatric calorie goals', () => {
  test('child maintenance is estimated separately and target weight does not change calories', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-16T12:00:00') });
    const prefs = { ...BASE_PREFS, name: 'Teen', birthDate: '2012-11-16', sex: 'male', height: 186, currentWeight: 80, currentWeightDate: '2026-11-16', targetWeight: 72, activity: 'moderate', pace: 0 };
    await openApp(page, { prefs, foods: [], weights: [] });
    await openView(page, 'settings');
    await expect(page.locator('#profile-pace')).toHaveValue('0');
    await expect(page.locator('#profile-target-field')).toBeVisible();
    await expect(page.locator('#profile-pace-preview')).toContainText('3675');
    await page.locator('#save-profile').click();
    const saved = await readStore(page);
    expect(saved.prefs.targetWeight).toBe(72);
    expect(saved.prefs.kcal).toBe(3675);
    await page.reload();
    await expect(page.locator('#profile-target')).toHaveValue('72');
    await expect(page.locator('#profile-pace-preview')).toContainText('3675');
  });

  test('child deficit requires pediatrician-set calories and persists in both languages', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-16T12:00:00') });
    const prefs = { ...BASE_PREFS, name: 'Teen', birthDate: '2012-11-16', sex: 'male', height: 186, currentWeight: 80, currentWeightDate: '2026-11-16', targetWeight: 72, activity: 'moderate', pace: 0 };
    await openApp(page, { prefs, foods: [], weights: [] });
    await openView(page, 'settings');
    await page.locator('#profile-pace').evaluate((el) => { el.value = '-1'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(page.locator('#profile-pediatric-kcal-field')).toBeVisible();
    await expect(page.locator('#profile-pediatric-notice')).toBeVisible();
    await page.locator('#save-profile').click();
    await expect.poll(async () => (await readStore(page)).prefs?.pace).toBe(0);
    await page.fill('#profile-pediatric-kcal', '3400');
    await page.locator('#profile-pediatric-kcal').dispatchEvent('change');
    await page.fill('#profile-target', '75');
    await page.locator('#profile-target').dispatchEvent('change');
    await page.locator('#profile-pace').evaluate((el) => { el.value = '-1'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.locator('#save-profile').click();
    await expect.poll(async () => (await readStore(page)).prefs?.pace).toBe(-1);
    let saved = await readStore(page);
    expect(saved.prefs.targetWeight).toBe(75);
    expect(saved.prefs.pediatricTargetKcal).toBe(3400);
    expect(saved.prefs.kcal).toBe(3400);
    await page.selectOption('#pref-lang', 'uk');
    await page.locator('#save-lang').click();
    await expect(page.locator('#profile-pediatric-kcal')).toBeVisible();
    await page.reload();
    saved = await readStore(page);
    expect(saved.prefs.pace).toBe(-1);
    expect(saved.prefs.pediatricTargetKcal).toBe(3400);
    expect(await page.evaluate(() => Object.keys(I.en).sort().join('|') === Object.keys(I.uk).sort().join('|'))).toBe(true);
  });

  test('child onboarding accepts a child birth date and keeps adult guidance out of the saved goal', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await page.clock.install({ time: new Date('2026-11-16T12:00:00') });
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-guest').click();
    await page.evaluate(() => {
      const set = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('onboard-name', 'Teen'); set('onboard-birth', '2012-11-16'); set('onboard-height', '186'); set('onboard-weight', '80'); set('onboard-target', '72'); set('onboard-pace', '0');
    });
    await expect(page.locator('#onboard-pace')).toHaveValue('0');
    await expect(page.locator('#onboard-pediatric-notice')).toBeVisible();
    await page.locator('#onboarding-save').click();
    await expect.poll(async () => (await readStore(page)).prefs?.setupComplete).toBe(true);
    const saved = await readStore(page);
    expect(saved.prefs.kcal).toBe(2698);
    expect(saved.prefs.targetWeight).toBe(72);
    await expect(page.locator('#onboarding-modal')).not.toHaveClass(/open/);
    await openView(page, 'settings');
    await expect(page.locator('#view-settings')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('child calorie prescription and desired weight survive backup parsing', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS }, foods: [], weights: [] });
    const parsed = await page.evaluate(() => parseBackup(JSON.stringify({
      foods: [], weights: [], products: [],
      prefs: { name: 'Teen', birthDate: '2012-11-16', sex: 'male', height: 186, currentWeight: 80, targetWeight: 72, pediatricTargetKcal: 3400, pace: -1, activity: 'moderate', kcal: 3400, recommendation: { pediatric: true, clinicianSet: true, maintenance: false }, setupComplete: true },
    })).prefs);
    expect(parsed.targetWeight).toBe(72);
    expect(parsed.pediatricTargetKcal).toBe(3400);
    expect(parsed.pace).toBe(-1);
    expect(parsed.recommendation.clinicianSet).toBe(true);
  });

  test('user can add, view, edit and delete additional information note for simple product and composite dish; note icon shows only when note is present', async ({ page }) => {
    const PROD_WITH_NOTE = '77777777-7777-4777-8777-777777777777';
    const PROD_WITHOUT_NOTE = '88888888-8888-4888-8888-888888888888';
    const COMP_WITH_NOTE = '99999999-9999-4999-8999-999999999999';
    const prodWithNote = { id: PROD_WITH_NOTE, name: 'Greek Yogurt', grams: 100, kcal: 59, protein: 10, fat: 0, carbs: 4, note: 'Brand X, low fat' };
    const prodWithoutNote = { id: PROD_WITHOUT_NOTE, name: 'Apple', grams: 100, kcal: 52, protein: 0.3, fat: 0.2, carbs: 14 };
    const compWithNote = { id: COMP_WITH_NOTE, name: 'Fruit Bowl', grams: 200, kcal: 111, protein: 10.3, fat: 0.2, carbs: 18, note: 'Best served chilled', components: [{ id: PROD_WITH_NOTE, name: 'Greek Yogurt', grams: 100, kcal: 59, protein: 10, fat: 0, carbs: 4 }, { id: PROD_WITHOUT_NOTE, name: 'Apple', grams: 100, kcal: 52, protein: 0.3, fat: 0.2, carbs: 14 }] };

    await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'button', lang: 'en' }, products: [prodWithNote, prodWithoutNote, compWithNote], foods: [], weights: [] });

    await openView(page, 'products');
    const itemWithNote = page.locator(`#products-list .product-item[data-product-id="${PROD_WITH_NOTE}"]`);
    const itemWithoutNote = page.locator(`#products-list .product-item[data-product-id="${PROD_WITHOUT_NOTE}"]`);
    const compItem = page.locator(`#products-list .product-item[data-product-id="${COMP_WITH_NOTE}"]`);

    await expect(itemWithNote.locator('[data-info-product]')).toHaveCount(1);
    await expect(itemWithoutNote.locator('[data-info-product]')).toHaveCount(0);
    await expect(compItem.locator('[data-info-product]')).toHaveCount(1);
    await expect(itemWithNote.locator('.product-has-note')).toHaveCount(1);
    await expect(itemWithNote.locator('.product-note-badge')).toHaveAttribute('title', 'Has additional information');
    await expect(itemWithoutNote.locator('.product-has-note')).toHaveCount(0);
    await expect(compItem.locator('.product-has-note')).toHaveCount(1);
    await expect(compItem.locator('.product-note-badge')).toHaveAttribute('title', 'Has additional information');

    await page.setViewportSize({ width: 1280, height: 832 });
    await itemWithNote.locator('.product-note-badge').click();
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-note-modal-title')).toHaveText('Greek Yogurt');
    await expect(page.locator('#product-note-modal-view-text')).toHaveText('Brand X, low fat');
    await expect(itemWithNote).toHaveClass(/collapsed/);
    await page.click('#product-note-modal-ok');

    await page.setViewportSize({ width: 360, height: 760 });
    await compItem.locator('.product-note-badge').click();
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-note-modal-title')).toHaveText('Fruit Bowl');
    await expect(page.locator('#product-note-modal-view-text')).toHaveText('Best served chilled');
    await page.click('#product-note-modal-ok');

    await itemWithNote.locator('.product-toggle-main').first().click();
    await expect(itemWithNote.locator('.product-toggle-main').first()).toHaveAttribute('aria-expanded', 'true');
    await itemWithNote.locator('.product-toggle-expand').click();
    await expect(itemWithNote).toHaveClass(/collapsed/);
    await itemWithNote.locator('.product-toggle-main').first().click();
    await itemWithNote.locator('[data-more-product]').click();
    await expect(itemWithNote.locator('[data-info-product]')).toBeVisible();
    await itemWithNote.locator('[data-info-product]').click();
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-note-modal-title')).toHaveText('Greek Yogurt');
    await expect(page.locator('#product-note-view-section')).toBeVisible();
    await expect(page.locator('#product-note-edit-section')).toBeHidden();
    await expect(page.locator('#product-note-modal-view-text')).toHaveText('Brand X, low fat');
    await expect(page.locator('#product-note-view-edit')).toBeVisible();
    await expect(page.locator('#product-note-view-delete')).toBeVisible();
    await expect(page.locator('#product-note-modal-ok')).toBeVisible();
    for (const selector of ['#product-note-view-edit', '#product-note-view-delete', '#product-note-modal-ok']) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      expect(box.y + box.height).toBeLessThanOrEqual(760);
    }

    // Cancel edit returns to view mode with original note
    await page.click('#product-note-view-edit');
    await expect(page.locator('#product-note-view-section')).toBeHidden();
    await expect(page.locator('#product-note-edit-section')).toBeVisible();
    await expect(page.locator('#product-note-modal-text')).toHaveValue('Brand X, low fat');
    await page.fill('#product-note-modal-text', 'Temporary unsaved note');
    await page.click('#product-note-modal-cancel');
    await expect(page.locator('#product-note-view-section')).toBeVisible();
    await expect(page.locator('#product-note-edit-section')).toBeHidden();
    await expect(page.locator('#product-note-modal-view-text')).toHaveText('Brand X, low fat');

    // Edit and save returns to view mode with updated note, OK closes
    await page.click('#product-note-view-edit');
    await page.fill('#product-note-modal-text', 'Brand X, updated note');
    await page.click('#product-note-modal-save');
    await expect(page.locator('#product-note-view-section')).toBeVisible();
    await expect(page.locator('#product-note-edit-section')).toBeHidden();
    await expect(page.locator('#product-note-modal-view-text')).toHaveText('Brand X, updated note');
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);
    await page.click('#product-note-modal-ok');
    await expect(page.locator('#product-note-modal')).not.toHaveClass(/open/);
    await page.setViewportSize({ width: 1280, height: 832 });

    let store = await readStore(page);
    expect(store.products.find(p => p.id === PROD_WITH_NOTE).note).toBe('Brand X, updated note');

    // Reopen info to delete note with confirmation
    if (await itemWithNote.evaluate((element) => element.classList.contains('collapsed'))) await itemWithNote.locator('.product-toggle-main').click();
    if (!(await itemWithNote.locator('.product-actions').evaluate((element) => element.classList.contains('is-open')))) await itemWithNote.locator('[data-more-product]').click();
    await itemWithNote.locator('[data-info-product]').click();
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-note-view-section')).toBeVisible();
    await page.click('#product-note-view-delete');
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.click('#confirm-ok');
    await expect(page.locator('#product-note-modal')).not.toHaveClass(/open/);

    store = await readStore(page);
    expect(store.products.find(p => p.id === PROD_WITH_NOTE).note).toBeUndefined();
    await expect(itemWithNote.locator('[data-info-product]')).toHaveCount(0);
    await expect(itemWithNote.locator('.product-has-note')).toHaveCount(0);

    await itemWithoutNote.locator('.product-toggle-main').click();
    await itemWithoutNote.locator('[data-more-product]').click();
    await itemWithoutNote.locator('[data-edit-product]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#product-note-toggle')).toBeVisible();
    await expect(page.locator('#product-note-field')).toBeHidden();
    await page.click('#product-note-toggle');
    await expect(page.locator('#product-note-field')).toBeVisible();
    await page.fill('#product-note-input', 'Fuji apple');
    await page.click('#food-save');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);

    store = await readStore(page);
    expect(store.products.find(p => p.id === PROD_WITHOUT_NOTE).note).toBe('Fuji apple');
    await expect(itemWithoutNote.locator('[data-info-product]')).toHaveCount(1);
    await expect(itemWithoutNote.locator('.product-has-note')).toHaveCount(1);
    await page.setViewportSize({ width: 360, height: 760 });
    await expect(itemWithoutNote.locator('.product-has-note')).toBeVisible();
    await openView(page, 'settings');
    await page.selectOption('#pref-lang', 'uk');
    await page.locator('#save-lang').click();
    await openView(page, 'products');
    await expect(itemWithoutNote.locator('.product-note-badge')).toHaveAttribute('title', 'Має додаткову інформацію');

    const backupJson = JSON.stringify({
      foods: [], weights: [],
      products: [{ id: 'b1', name: 'Note product', grams: 100, kcal: 100, protein: 5, fat: 2, carbs: 10, note: 'Saved in backup' }],
      prefs: { ...BASE_PREFS }
    });
    const parsed = await page.evaluate((json) => parseBackup(json), backupJson);
    expect(parsed.products[0].note).toBe('Saved in backup');

    if (await itemWithoutNote.evaluate((element) => element.classList.contains('collapsed'))) await itemWithoutNote.locator('.product-toggle-main').click();
    if (!(await itemWithoutNote.locator('.product-actions').evaluate((element) => element.classList.contains('is-open')))) await itemWithoutNote.locator('[data-more-product]').click();
    await itemWithoutNote.locator('[data-info-product]').click();
    await page.click('#product-note-view-edit');
    await page.fill('#product-note-modal-text', '');
    await page.click('#product-note-modal-save');
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-note-view-section')).toBeVisible();
    await expect(page.locator('#product-note-modal-view-text')).toBeEmpty();
    await page.click('#product-note-modal-ok');
    await expect(page.locator('#product-note-modal')).not.toHaveClass(/open/);
    store = await readStore(page);
    expect(store.products.find(p => p.id === PROD_WITHOUT_NOTE).note).toBeUndefined();
    await expect(itemWithoutNote.locator('[data-info-product]')).toHaveCount(0);
  });
});
