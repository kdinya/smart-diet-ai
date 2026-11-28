const { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate } = require('./smoke.helpers');

  test('author support modal is localized and links to the Monobank jar', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products: [], foods: [], weights: [] });
    await openView(page, 'settings');
    await page.click('#author-support-open');
    await expect(page.locator('#author-support-modal')).toHaveClass(/open/);
    await expect(page.locator('#author-support-modal')).toContainText('Тепла підтримка');
    await expect(page.locator('#author-support-modal')).toContainText('Кава для автора?');
    await expect(page.locator('#author-support-modal a[data-i18n="authorSupportDonate"]')).toHaveAttribute('href', 'https://send.monobank.ua/jar/e9Z2mHngN');
    await page.click('#author-support-later');
    await expect(page.locator('#author-support-modal')).not.toHaveClass(/open/);

    await page.selectOption('#pref-lang', 'en');
    await page.locator('#save-lang').click();
    await page.click('#author-support-open');
    await expect(page.locator('#author-support-modal')).toContainText('Coffee for the author?');
    await expect(page.locator('#author-support-later')).toHaveText('Maybe later');
    const modal = await page.locator('#author-support-modal .modal').boundingBox();
    expect(modal.width).toBeLessThanOrEqual(360);
  });

  test('verified checkbox stays available for simple-product creation and editing', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [], foods: [], weights: [] });
    await openView(page, 'products');

    await page.click('#product-new');
    await page.click('#product-type-simple');
    await expect(page.locator('#product-verified-label')).toBeVisible();
    await page.locator('#product-verified').check();
    await page.fill('#food-name', 'Verified oats');
    await page.fill('#food-grams', '100');
    await page.fill('#food-kcal', '150');
    await page.click('#food-save');
    await expect.poll(() => page.evaluate(() => state.products.find((product) => product.name === 'Verified oats')?.verified)).toBe(true);

    const product = page.locator('.product-item', { hasText: 'Verified oats' });
    await product.locator('.product-toggle-main').click();
    await product.locator('[data-edit-product]').click();
    await expect(page.locator('#product-verified-label')).toBeVisible();
    await expect(page.locator('#product-verified')).toBeChecked();
    await page.locator('#product-verified').uncheck();
    await page.click('#food-save');
    await expect.poll(() => page.evaluate(() => state.products.find((item) => item.name === 'Verified oats')?.verified)).toBe(false);
  });

  test('simple product choice opens traditional product editor without composite fields', async ({ page }) => {
    const pita = { id: 'p-pita', name: 'Pita', grams: 100, kcal: 250, protein: 8, fat: 1, carbs: 50 };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [pita], foods: [], weights: [] });
    await openView(page, 'products');

    await page.click('#product-new');
    await expect(page.locator('#product-type-modal')).toHaveClass(/open/);

    await page.click('#product-type-simple');
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#product-calc-field')).toBeVisible();
    await expect(page.locator('#composite-modal')).not.toHaveClass(/open/);
    await page.click('#modal-close');
  });

test('floating nutrition summary mirrors home and selected diary cards as they leave the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  const dates = await page.evaluate(() => {
    const today = new Date();
    const previous = new Date(today);
    previous.setDate(previous.getDate() - 1);
    const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { today: iso(today), previous: iso(previous) };
  });
  const food = (id, date, kcal, protein, fat, carbs) => ({
    id, name: 'Nutrition summary test', meal: 'breakfast', grams: 100,
    kcal, protein, fat, carbs, date, createdAt: 1,
  });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', kcal: 2000, protein: 172, fat: 70, carbs: 242 },
    foods: [
      food('aaaa1111-1111-4111-8111-111111111111', dates.today, 500, 56, 20, 80),
      food('bbbb2222-2222-4222-8222-222222222222', dates.previous, 900, 90, 35, 120),
    ],
    weights: [],
  });

  const badge = page.locator('#nutrition-badge');
  const typeSizes = await page.evaluate(() => ({
    calories: getComputedStyle(document.querySelector('.nutrition-badge-calories')).fontSize,
    weight: getComputedStyle(document.querySelector('.weight-badge-value')).fontSize,
    macros: getComputedStyle(document.querySelector('.nutrition-badge-macros')).fontSize,
    weightLabel: getComputedStyle(document.querySelector('.weight-badge-label')).fontSize,
  }));
  expect(typeSizes.calories).toBe(typeSizes.weight);
  expect(typeSizes.macros).toBe(typeSizes.weightLabel);
  await expect(badge).not.toHaveClass(/is-floating/);
  await page.evaluate(() => {
    const tile = document.querySelector('#view-home [data-nutrition-key="kcal"]');
    window.scrollTo(0, window.scrollY + tile.getBoundingClientRect().bottom - 35);
  });
  await expect(page.locator('#weight-badge')).toHaveClass(/is-floating/);
  await expect(badge).toHaveClass(/is-floating/);
  const floatingLayers = await page.evaluate(() => {
    const weight = document.querySelector('#weight-badge');
    const nutrition = document.querySelector('#nutrition-badge');
    const actions = document.querySelector('#home-meals .meal-analyze')?.closest('.meal-actions');
    const hitsBadgeOnOverlap = badge => {
      const badgeRect = badge.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const left = Math.max(badgeRect.left, actionsRect.left);
      const right = Math.min(badgeRect.right, actionsRect.right);
      const top = Math.max(badgeRect.top, actionsRect.top);
      const bottom = Math.min(badgeRect.bottom, actionsRect.bottom);
      if (right <= left || bottom <= top) return true;
      return document.elementFromPoint((left + right) / 2, (top + bottom) / 2)?.closest(`#${badge.id}`) === badge;
    };
    return {
      z: [getComputedStyle(weight).zIndex, getComputedStyle(nutrition).zIndex, getComputedStyle(actions).zIndex],
      weightCoversActions: hitsBadgeOnOverlap(weight),
      nutritionCoversActions: hitsBadgeOnOverlap(nutrition),
    };
  });
  expect(floatingLayers.z.map(Number)).toEqual([55, 54, 4]);
  expect(floatingLayers.weightCoversActions).toBe(true);
  expect(floatingLayers.nutritionCoversActions).toBe(true);
  const badgeSpacing = await badge.evaluate(el => {
    const style = getComputedStyle(el);
    return { top: style.paddingTop, bottom: style.paddingBottom, between: style.rowGap };
  });
  expect(badgeSpacing).toEqual({ top: '10px', bottom: '10px', between: '5px' });
  await expect(badge.locator('.nutrition-badge-calories')).toContainText('500/2000');
  await expect(badge.locator('.nutrition-badge-calories')).toContainText('ккал');
  const assertMacroMatchesTile = async key => {
    const expected = await page.evaluate(key => {
      const root = document.querySelector('#view-home.active, #view-diary.active');
      const rect = root?.querySelector(`[data-nutrition-key="${key}"]`)?.getBoundingClientRect();
      return !!rect && (key === 'fat' ? rect.top <= -(rect.height / 2) : rect.bottom <= 0);
    }, key);
    if (expected) await expect(badge.locator(`[data-macro="${key}"]`)).toHaveClass(/is-visible/);
    else await expect(badge.locator(`[data-macro="${key}"]`)).not.toHaveClass(/is-visible/);
  };
  await assertMacroMatchesTile('protein');

  const revealMacro = async key => {
    await page.evaluate(key => {
      const tile = document.querySelector(`#view-home.active [data-nutrition-key="${key}"], #view-diary.active [data-nutrition-key="${key}"]`);
      const rect = tile.getBoundingClientRect();
      const delta = key === 'fat' ? rect.top + rect.height / 2 + 12 : rect.bottom + 12;
      window.scrollTo(0, Math.max(0, window.scrollY + delta));
    }, key);
    await page.waitForTimeout(100);
    await expect(badge.locator(`[data-macro="${key}"]`)).toHaveClass(/is-visible/);
  };
  await revealMacro('protein');
  await expect(badge.locator('[data-macro="protein"]')).toContainText('Б56/172');
  await revealMacro('fat');
  await expect(badge.locator('[data-macro="fat"]')).toContainText('Ж20/70');
  await revealMacro('carbs');
  await expect(badge.locator('[data-macro="carbs"]')).toContainText('В80/242');
  await expect(badge.locator('[data-macro="protein"] strong')).toHaveClass(/under/);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(badge.locator('.nutrition-macro.is-visible')).toHaveCount(0);
  await expect(badge).not.toHaveClass(/is-floating/);

  await openView(page, 'diary');
  await page.evaluate(date => {
    const input = document.querySelector('#diary-date');
    input.value = date;
    input.dispatchEvent(new Event('change'));
  }, dates.previous);
  await expect(page.locator('#diary-summary [data-nutrition-key="kcal"] > strong').first()).toHaveText('900');
  await page.evaluate(() => {
    const tile = document.querySelector('#view-diary [data-nutrition-key="kcal"]');
    window.scrollTo(0, window.scrollY + tile.getBoundingClientRect().bottom + 12);
  });
  await expect(badge).toHaveClass(/is-floating/);
  await expect(badge.locator('.nutrition-badge-calories')).toContainText('900/2000');
  await assertMacroMatchesTile('protein');
  await revealMacro('protein');
  await expect(badge.locator('[data-macro="protein"]')).toContainText('Б90/172');
});

test('adaptive calorie target stays below the saved profile goal', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-12T12:00:00') });
  const foods = [];
  const weights = [];
  const start = new Date('2026-10-28T12:00:00');
  for (let i = 0; i < 15; i += 1) {
    const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    const value = 97 - i * 0.13230519480519742;
    if (i > 0) weights.push({ id: `w-${i}`, value: +value.toFixed(3), date });
    for (const [meal, kcal] of [['breakfast', 500], ['lunch', 794], ['dinner', 1000]]) {
      foods.push({ id: `f-${i}-${meal}`, name: meal, meal, grams: 100, kcal, protein: 30, fat: 20, carbs: 70, date, createdAt: i * 10 + foods.length });
    }
  }
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', age: 45, sex: 'male', height: 185, currentWeight: 97, currentWeightDate: '2026-10-28', targetWeight: 85, activity: 'low', pace: 25, kcal: 1721, protein: 172, carbs: 141, fat: 52 },
    foods,
    weights,
  });
  const result = await page.evaluate(() => {
    const series = trendSeries().filter(x => dayNum(x.d) > dayNum(iso()) - 28);
    const days = {};
    const meals = {};
    state.foods.forEach(food => {
      if (!foodIsCounted(food) || dayNum(food.date) >= dayNum(iso())) return;
      days[food.date] = (days[food.date] || 0) + (+food.kcal || 0);
      (meals[food.date] = meals[food.date] || new Set()).add(food.meal);
    });
    const calories = Object.keys(days).filter(date => ['breakfast', 'lunch', 'dinner'].every(meal => meals[date]?.has(meal)) && days[date] >= 800).map(date => days[date]);
    const estimatedMaintenance = Math.round(calories.reduce((sum, value) => sum + value, 0) / calories.length - slopePerDay(series.map(point => ({ n: dayNum(point.d), v: point.tr }))) * KCAL_KG);
    return { profileGoal: state.prefs.kcal, estimatedMaintenance, adaptive: adaptiveTarget() };
  });
  expect(result.estimatedMaintenance).toBe(3109);
  expect(result.adaptive).toBeNull();
  expect(result.profileGoal).toBe(1721);
  await expect(page.locator('#progress-notes')).not.toContainText('2332');
  const lowerGoalResult = await page.evaluate(() => { state.prefs.kcal = 2500; return adaptiveTarget(); });
  expect(lowerGoalResult.kcal).toBe(2332);
  expect(lowerGoalResult.kcal).toBeLessThan(2500);
  expect(await page.evaluate(() => { state.prefs.kcal = 1500; return adaptiveTarget(); })).toBeNull();
});

  test('a product shared without ingredients by an older version is accepted as a plain product', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const result = await page.evaluate(async () => {
      const chain = { delete() { return this; }, eq() { return this; }, select() { return this; }, then(resolve) { resolve({ data: [{ id: 'share-legacy' }], error: null }); } };
      sb = { from: () => chain };
      runSync = async () => {};
      user = { id: 'u-recipient' };
      inboxRows = [{ id: 'share-legacy', name: 'Old oats', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25, from_user: 'u-sender' }];
      renderInbox();
      const inbox = document.querySelector('[data-share-id="share-legacy"]');
      const inboxText = inbox ? inbox.textContent : '';
      await resolveShare('share-legacy', true);
      renderProducts();
      const product = state.products.find((item) => item.name === 'Old oats');
      const card = document.querySelector(`#products-list [data-product-id="${product?.id}"]`);
      return { inboxText, saved: !!product, components: product ? (product.components || []) : null, hasIcon: !!card?.querySelector('.product-is-composite') };
    });
    expect(result.inboxText).toContain('Old oats');
    expect(result.saved).toBe(true);
    expect(result.components).toEqual([]);
    expect(result.hasIcon).toBe(false);
  });

  test('preserves scroll position in products view after opening and closing modals', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const products = Array.from({ length: 25 }, (_, i) => ({
      id: `p-scroll-${i}`,
      name: `Продукт ${String(i).padStart(2, '0')}`,
      grams: 100,
      kcal: 100 + i,
      protein: 10,
      fat: 2,
      carbs: 10,
      note: i === 12 ? 'Важлива примітка' : undefined,
    }));
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products, foods: [], weights: [] });
    await openView(page, 'products');

    await page.evaluate(() => window.scrollTo(0, 450));
    await page.waitForTimeout(100);
    const scrolledBefore = await page.evaluate(() => window.scrollY);
    expect(scrolledBefore).toBeGreaterThan(300);

    // Open note modal from a product in view at the scrolled position
    await page.locator('[data-note-product="p-scroll-12"]').dispatchEvent('click');
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);

    await page.locator('#product-note-modal-close').click();
    await expect(page.locator('#product-note-modal')).not.toHaveClass(/open/);
    await page.waitForTimeout(150);

    const scrolledAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(scrolledAfter - scrolledBefore)).toBeLessThan(10);
  });

  test('warns and proposes copy suffix when creating a simple product or composite dish with duplicate name', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const existing = [
      { id: 'p-orig-1', name: 'Сир кисломолочний', grams: 100, kcal: 110, protein: 18, fat: 2, carbs: 3 },
    ];
    const confirmations = [];
    await autoConfirm(page, true, confirmations);
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products: existing, foods: [], weights: [] });
    await openView(page, 'products');

    await page.locator('#product-new').click();
    await page.locator('#product-type-simple').click();
    await page.fill('#food-name', 'сир кисломолочний');
    await page.fill('#food-grams', '150');
    await page.fill('#food-kcal', '165');
    await page.click('#food-save');

    await expect(page.locator('#products-list')).toContainText('сир кисломолочний (копія)');
    expect(confirmations.some((msg) => msg.includes('вже є у ваших продуктах') && msg.includes('(копія)'))).toBe(true);

    confirmations.length = 0;
    await page.locator('#product-new').click();
    await page.locator('#product-type-composite').click();
    await page.fill('#composite-name', 'Сир кисломолочний');
    await page.locator('#composite-add-ingredient').click();
    await page.fill('#food-name', 'Сметана');
    await page.fill('#food-grams', '50');
    await page.fill('#food-kcal', '80');
    await page.click('#food-save');
    await page.click('#composite-save-btn');

    await expect(page.locator('#products-list')).toContainText('Сир кисломолочний (копія)');
  });
  test('aligns product row icons with info icon to the left of sync/owned icon and expand button to the right', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const myProducts = [
      { id: 'p-sync-test', name: 'Авокадо', grams: 100, kcal: 160, protein: 2, fat: 15, carbs: 9, note: 'Корисні жири' },
    ];
    const backend = createBackend();
    backend.tables.catalog_products.push({
      id: 'cat-sync-test', name: 'Авокадо', grams: 100, kcal: 160, protein: 2, fat: 15, carbs: 9, verified: true, note: 'Стиглий сорт Хаас', companions: [], components: [],
    });

    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products: myProducts, foods: [], weights: [] });
    await openView(page, 'products');

    const myItem = page.locator('#products-list .product-item').first();
    const myInfoBtn = myItem.locator('.product-note-badge');
    const mySyncBadge = myItem.locator('.catalog-sync-badge');
    const myExpandBtn = myItem.locator('.product-toggle-expand');

    await expect(myInfoBtn).toBeVisible();
    await expect(mySyncBadge).toBeVisible();
    await expect(myExpandBtn).toBeVisible();

    const infoBoxMy = await myInfoBtn.boundingBox();
    const syncBoxMy = await mySyncBadge.boundingBox();
    const expandBoxMy = await myExpandBtn.boundingBox();

    expect(infoBoxMy.x).toBeLessThan(syncBoxMy.x);
    expect(syncBoxMy.x).toBeLessThan(expandBoxMy.x);

    await page.locator('#catalog-toggle-btn').click();
    const catItem = page.locator('#products-list .catalog-product-item').first();
    const catInfoBtn = catItem.locator('.product-note-badge');
    const catOwnedBadge = catItem.locator('.catalog-owned-badge');
    const catExpandBtn = catItem.locator('.product-toggle-expand');

    await expect(catInfoBtn).toBeVisible();
    await expect(catOwnedBadge).toBeVisible();
    await expect(catExpandBtn).toBeVisible();

    const infoBoxCat = await catInfoBtn.boundingBox();
    const ownedBoxCat = await catOwnedBadge.boundingBox();
    const expandBoxCat = await catExpandBtn.boundingBox();

    expect(infoBoxCat.x).toBeLessThan(ownedBoxCat.x);
    expect(ownedBoxCat.x).toBeLessThan(expandBoxCat.x);
  });

  test('products controls: equal sort and legend buttons, square search icon, animated search with clear button', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const products = [
      { id: 'p-apple', name: 'Apple', grams: 100, kcal: 52, protein: 0.3, fat: 0.2, carbs: 14 },
      { id: 'p-bread', name: 'Bread', grams: 100, kcal: 250, protein: 8, fat: 3, carbs: 48 },
    ];
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products, foods: [], weights: [] });
    await openView(page, 'products');

    await expect(page.locator('#products-list-title')).toHaveText('Мої продукти');
    const box = page.locator('#product-search-box');
    const toggle = page.locator('#product-search-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await box.evaluate((el) => el.getBoundingClientRect().height)).toBe(0);

    await page.locator('#products-list').evaluate((el) => { el.style.minHeight = '1400px'; });
    await page.evaluate(async () => {
      const controls = document.querySelector('#products-controls');
      const box = document.querySelector('#product-search-box');
      const input = document.querySelector('#product-search');
      const target = Math.max(0, controls.getBoundingClientRect().top + window.scrollY - 12);
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, Math.max(0, target - 90));
      await new Promise(requestAnimationFrame);
      window.__productSearchOrder = [];
      box.addEventListener('transitionend', (event) => { if (event.propertyName === 'height') window.__productSearchOrder.push('field'); });
      window.addEventListener('scroll', () => window.__productSearchOrder.push('scroll'), { passive: true });
      input.addEventListener('focus', () => window.__productSearchOrder.push('focus'));
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#product-search')).toBeFocused();
    await expect.poll(() => box.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(40);
    const searchOrder = await page.evaluate(() => window.__productSearchOrder);
    expect(searchOrder.indexOf('field')).toBeGreaterThanOrEqual(0);
    expect(searchOrder.indexOf('field')).toBeLessThan(searchOrder.indexOf('scroll'));
    expect(searchOrder.indexOf('scroll')).toBeLessThan(searchOrder.indexOf('focus'));
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('#products-controls').getBoundingClientRect().top))).toBe(48);
    const geometry = await page.evaluate(() => {
      const c = document.querySelector('#products-controls').getBoundingClientRect();
      const b = document.querySelector('#product-search-box').getBoundingClientRect();
      const s = document.querySelector('#products-controls .dd-btn').getBoundingClientRect();
      return { sameWidth: Math.abs(b.width - c.width) < 2, below: b.top >= s.bottom };
    });
    expect(geometry).toEqual({ sameWidth: true, below: true });

    const target = await page.evaluate(() => Math.max(0, document.querySelector('#products-controls').getBoundingClientRect().top + window.scrollY - 12));
    await page.evaluate((top) => window.scrollTo(0, Math.max(0, top - 90)), target);
    await page.locator('#product-search').click();
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('#products-controls').getBoundingClientRect().top))).toBe(48);

    await expect(page.locator('#product-search-clear')).toHaveCSS('opacity', '0');
    await page.keyboard.type('app');
    await expect(page.locator('#products-list .product-name')).toHaveText(['Apple']);
    await expect(page.locator('#product-search-clear')).toHaveCSS('opacity', '1');
    await page.locator('#product-search-clear').click();
    await expect(page.locator('#product-search')).toHaveValue('');
    await expect(page.locator('#products-list .product-name')).toHaveText(['Apple', 'Bread']);
    await expect(page.locator('#product-search')).toBeFocused();

    await page.keyboard.type('bre');
    await openView(page, 'stats');
    await openView(page, 'products');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#product-search')).toHaveValue('');
    await expect(page.locator('#products-list .product-name')).toHaveText(['Apple', 'Bread']);
  });

  test('product search uses the same anchor in My Products and catalog with reduced motion', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [], foods: [], weights: [] });
    await openView(page, 'products');
    await page.locator('#products-list').evaluate((el) => { el.style.minHeight = '1400px'; });

    const checkOpenAndClickPosition = async () => {
      const target = await page.evaluate(() => Math.max(0, document.querySelector('#products-controls').getBoundingClientRect().top + window.scrollY - 12));
      await page.evaluate((top) => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, Math.max(0, top - 90)); }, target);
      await page.locator('#product-search-toggle').click();
      await expect(page.locator('#product-search')).toBeFocused();
      await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('#products-controls').getBoundingClientRect().top))).toBe(48);
      const openTop = await page.evaluate(() => Math.round(document.querySelector('#products-controls').getBoundingClientRect().top));
      await page.evaluate((top) => window.scrollTo(0, Math.max(0, top - 90)), target);
      await page.locator('#product-search').click();
      await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('#products-controls').getBoundingClientRect().top))).toBe(48);
      const clickTop = await page.evaluate(() => Math.round(document.querySelector('#products-controls').getBoundingClientRect().top));
      await page.locator('#product-search-toggle').click();
      await expect(page.locator('#product-search-toggle')).toHaveAttribute('aria-expanded', 'false');
      return { openTop, clickTop };
    };

    const myProducts = await checkOpenAndClickPosition();
    await page.evaluate(() => { catalogProducts = Array.from({ length: 8 }, (_, index) => ({ id: `catalog-${index}`, name: `Catalog product ${index + 1}`, grams: 100, kcal: 120, protein: 4, fat: 3, carbs: 18, verified: false, companions: [], components: [], note: '' })); });
    await page.locator('#catalog-toggle-btn').click();
    await expect(page.locator('#view-products')).toHaveClass(/in-catalog-view/);
    const catalog = await checkOpenAndClickPosition();
    expect(myProducts).toEqual({ openTop: 48, clickTop: 48 });
    expect(catalog).toEqual({ openTop: 48, clickTop: 48 });
  });

  test('legend modal explains the product icons and closes', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products: [], foods: [], weights: [] });
    await openView(page, 'products');
    await page.locator('#products-legend-btn').click();
    const modal = page.locator('#products-legend-modal');
    await expect(modal).toHaveClass(/open/);
    await expect(modal.locator('.legend-item')).toHaveCount(15);
    await expect(modal).toContainText('Перевірений продукт');
    await expect(modal).toContainText('Галочка біля додатка');
    await expect(modal).not.toContainText('лише адміністратор');
    await modal.locator('#products-legend-close').click();
    await expect(modal).not.toHaveClass(/open/);
  });
