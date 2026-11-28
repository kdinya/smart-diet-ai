const { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate } = require('./smoke.helpers');

test.describe('Smoke: shared product catalog', () => {
  test('toggles between my products and catalog view and updates header and buttons', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openView(page, 'products');

    const toggleBtn = page.locator('#catalog-toggle-btn');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveText('Каталог');

    await toggleBtn.click();
    await expect(page.locator('#view-products')).toHaveClass(/in-catalog-view/);
    await expect(page.locator('#view-products .view-title')).toHaveText('Спільний каталог');
    await expect(toggleBtn).toHaveText('← Мої продукти');
    await expect(page.locator('#product-new')).toBeHidden();

    await toggleBtn.click();
    await expect(page.locator('#view-products')).not.toHaveClass(/in-catalog-view/);
    await expect(page.locator('#view-products .view-title')).toHaveText('Мої продукти');
    await expect(toggleBtn).toHaveText('Каталог');
    await expect(page.locator('#product-new')).toBeVisible();
  });

  test('guest can browse and gets an authorization warning from the visibly inactive copy button', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const backend = createBackend();
    backend.tables.catalog_products.push({
      id: 'cat-test-1', name: 'Greek Yogurt', grams: 100, kcal: 59, protein: 10,
      fat: 0.4, carbs: 3.6, verified: true, companions: [], components: [], note: 'Rich in protein',
    });

    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products: [], foods: [], weights: [] });
    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();
    await expect(page.locator('#products-list')).toContainText('Greek Yogurt');

    const card = page.locator('#products-list .catalog-product-item').first();
    await card.locator('.product-toggle-main').click();
    const moreBtn = card.locator('[data-more-product]');
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();
    const copyBtn = card.locator('[data-copy-catalog-product]');
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toHaveClass(/is-guest/);
    await expect(copyBtn).toHaveAttribute('aria-disabled', 'true');
    await expect(copyBtn).toHaveCSS('cursor', 'not-allowed');
    await expect(copyBtn).not.toHaveAttribute('disabled');
    const copyBox = await copyBtn.boundingBox();
    expect(copyBox).not.toBeNull();
    await page.mouse.click(copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2);

    await expect(page.locator('.toast-msg').last()).toContainText('Будь ласка, зареєструйтеся або увійдіть');
    expect((await readStore(page)).products || []).toHaveLength(0);
  });

  test('catalog marks an existing product and omits its add action', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const backend = createBackend();
    backend.tables.catalog_products.push({
      id: 'cat-already-saved', name: 'Greek Yogurt', grams: 100, kcal: 59, protein: 10,
      fat: 0.4, carbs: 3.6, verified: true, companions: [], components: [], note: 'Rich in protein',
    });

    await mockSupabase(page, backend);
    await openApp(page, {
      prefs: { ...BASE_PREFS, lang: 'uk' },
      products: [{ id: 'mine-greek-yogurt', name: 'Greek Yogurt', grams: 100, kcal: 59, protein: 10, fat: 0.4, carbs: 3.6 }],
      foods: [], weights: [],
    });
    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();

    const card = page.locator('#products-list .catalog-product-item').first();
    await expect(card).toHaveClass(/is-in-my-products/);
    await expect(card.locator('.catalog-owned-badge')).toHaveAttribute('aria-label', 'Вже є у ваших продуктах');
    await expect(card.locator('.catalog-owned-badge svg')).toHaveCount(1);
    await expect(card.locator('[data-copy-catalog-product]')).toHaveCount(0);
  });

  test.skip('catalog cards share product collapse behavior and mobile controls align cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const backend = createBackend();
    backend.tables.catalog_products.push({
      id: 'cat-mobile-layout', name: 'Fresh Strawberries', grams: 100, kcal: 32, protein: 0.7,
      fat: 0.3, carbs: 7.7, verified: false, companions: [], components: [], note: '',
    });

    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products: [], foods: [], weights: [] });
    await openView(page, 'products');

    const toolbar = page.locator('#products-toolbar');
    const controls = page.locator('#products-controls');
    const sortBox = await controls.locator('.dd-btn').boundingBox();
    const legendBox = await page.locator('#products-legend-btn').boundingBox();
    const lupaBox = await page.locator('#product-search-toggle').boundingBox();
    const controlsBox = await controls.boundingBox();
    const catalogBox = await page.locator('#catalog-toggle-btn').boundingBox();
    const newProductBox = await page.locator('#product-new').boundingBox();
    expect(sortBox).not.toBeNull();
    expect(legendBox).not.toBeNull();
    expect(lupaBox).not.toBeNull();
    expect(catalogBox).not.toBeNull();
    expect(newProductBox).not.toBeNull();
    expect(Math.abs(sortBox.width - legendBox.width)).toBeLessThanOrEqual(1);
    expect(sortBox.height).toBeCloseTo(legendBox.height, 0);
    expect(lupaBox.width).toBeCloseTo(lupaBox.height, 0);
    expect(lupaBox.height).toBeCloseTo(sortBox.height, 0);
    expect(lupaBox.x + lupaBox.width).toBeLessThanOrEqual(controlsBox.x + controlsBox.width + 1);
    await expect(page.locator('#product-search')).not.toBeInViewport();
    expect(catalogBox.y).toBeCloseTo(newProductBox.y, 0);
    expect(catalogBox.x).toBeLessThan(newProductBox.x);
    expect(newProductBox.x + newProductBox.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await expect(toolbar).toBeVisible();

    await page.locator('#catalog-toggle-btn').click();
    const card = page.locator('#products-list .catalog-product-item').first();
    await expect(card).toHaveClass(/collapsed/);
    await expect(card.locator('.product-row')).toBeHidden();
    await card.locator('.product-toggle-main').click();
    await expect(card.locator('.product-row')).toBeVisible();
    await expect(card.locator('.catalog-copy-btn svg')).toHaveCount(1);
    await expect(card.locator('.catalog-copy-btn svg')).toHaveAttribute('aria-hidden', 'true');
    await page.mouse.move(1, 1);
    await expect(card).toHaveCSS('border-left-color', 'rgb(141, 154, 158)');
    await card.locator('.product-toggle-expand').click();
    await expect(card.locator('.product-row')).toBeHidden();
    await expect(page.locator('#view-products')).toHaveCSS('background-image', /linear-gradient/);
  });

  test('catalog product note opens from the badge and actions menu only when present', async ({ page }) => {
    const backend = createBackend();
    backend.tables.catalog_products.push(
      { id: 'cat-note-1', name: 'Product with note', grams: 100, kcal: 100, protein: 10, fat: 2, carbs: 5, verified: true, companions: [], components: [], note: 'Use the cooked weight.' },
      { id: 'cat-note-2', name: 'Product without note', grams: 100, kcal: 80, protein: 8, fat: 1, carbs: 4, verified: true, companions: [], components: [], note: '' },
    );
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products: [], foods: [], weights: [] });
    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();

    const noted = page.locator('#products-list .catalog-product-item').filter({ hasText: 'Product with note' });
    const plain = page.locator('#products-list .catalog-product-item').filter({ hasText: 'Product without note' });
    await expect(noted.locator('[data-note-product]')).toHaveCount(1);
    await expect(plain.locator('[data-note-product]')).toHaveCount(0);
    await noted.locator('[data-note-product]').click();
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-note-modal-title')).toHaveText('Product with note');
    await expect(page.locator('#product-note-modal-view-text')).toHaveText('Use the cooked weight.');
    await page.locator('#product-note-modal-ok').click();
    await noted.locator('.product-toggle-main').click();

    await noted.locator('[data-more-product]').click();
    await expect(noted.locator('[data-info-product]')).toHaveCount(1);
    await noted.locator('[data-info-product]').click();
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-note-modal-view-text')).toHaveText('Use the cooked weight.');
    await page.locator('#product-note-modal-ok').click();

    await plain.locator('.product-toggle-main').click();
    await expect(plain.locator('[data-more-product]')).toBeVisible();
    await plain.locator('[data-more-product]').click({ force: true });
    await expect(plain.locator('[data-info-product]')).toHaveCount(0);
  });
  test('authenticated non-admin can copy from the mobile catalog and the open menu survives rerender', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const backend = createBackend();
    backend.tables.catalog_products.push({
      id: 'cat-test-2', name: 'Blueberries', grams: 100, kcal: 57, protein: 0.7,
      fat: 0.3, carbs: 14.5, verified: true, companions: [], components: [], note: 'Fresh wild berries',
    });

    await mockSupabase(page, backend);
    await startAlice(page, backend);
    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();
    await expect(page.locator('#products-list')).toContainText('Blueberries');

    const card = page.locator('#products-list .catalog-product-item').first();
    await card.locator('.product-toggle-main').click();
    const moreBtn = card.locator('[data-more-product]');
    await moreBtn.click();
    await expect(moreBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(card.locator('[data-edit-catalog-product], [data-delete-catalog-product]')).toHaveCount(0);
    await page.evaluate(() => renderProducts());
    await expect(card.locator('[data-more-product]')).toHaveAttribute('aria-expanded', 'true');
    const copyBtn = card.locator('[data-copy-catalog-product]');
    await expect(copyBtn).toBeVisible();
    await page.evaluate(() => {
      const originalAnimate = Element.prototype.animate;
      window.__catalogFlightCalls = 0;
      Element.prototype.animate = function (...args) {
        if (this.classList.contains('catalog-copy-flight')) window.__catalogFlightCalls += 1;
        return originalAnimate.call(this, ...args);
      };
    });
    await copyBtn.click();
    await expect.poll(() => page.evaluate(() => window.__catalogFlightCalls)).toBe(1);

    await expect(page.locator('.toast-msg').last()).toContainText(await page.evaluate(() => toastT('productAddedToMine').replace('{name}', 'Blueberries')));
    await expect(card).toHaveClass(/is-in-my-products/);
    await expect(card.locator('.catalog-owned-badge')).toHaveAttribute('aria-label', await page.evaluate(() => t('catalogAlreadyInMineTitle')));
    await expect(card.locator('.catalog-owned-badge svg')).toHaveCount(1);
    await expect(card.locator('[data-copy-catalog-product]')).toHaveCount(0);
    await page.locator('#catalog-toggle-btn').click();
    await expect(page.locator('#products-list')).toContainText('Blueberries');

    const stored = await readStore(page);
    const copied = stored.products.find((p) => p.name === 'Blueberries');
    expect(copied).toBeDefined();
    expect(copied.kcal).toBe(57);
    expect(copied.note).toBe('Fresh wild berries');
  });

  test('admin can publish, edit, copy and delete catalog products from a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const backend = createBackend();
    backend.tables.app_admins.push({ user_id: 'user-alice' });

    await mockSupabase(page, backend);
    const oatmeal = { id: 'oat-1', name: 'Oatmeal', grams: 100, kcal: 360, protein: 13, fat: 6, carbs: 65 };
    await startAlice(page, backend);
    await autoConfirm(page, true);
    await page.evaluate((item) => putProduct(item), oatmeal);
    await openView(page, 'products');

    const ownCard = page.locator('#products-list .product-item').filter({ hasText: 'Oatmeal' });
    await expect(ownCard).toBeVisible();
    await ownCard.locator('.product-toggle-main').click();
    await ownCard.locator('[data-more-product]').click();
    await ownCard.locator('[data-publish-catalog]').click();
    await expect(page.locator('.toast-msg').last()).toContainText(await page.evaluate(() => toastT('catalogPublishedSuccess').replace('{name}', 'Oatmeal')));
    expect(backend.tables.catalog_products.some((product) => product.name === 'Oatmeal')).toBe(true);

    await page.locator('#catalog-toggle-btn').click();
    const card = page.locator('#products-list .catalog-product-item').filter({ hasText: 'Oatmeal' });
    await expect(card).toContainText('Oatmeal');
    await card.locator('.product-toggle-main').click();
    const moreBtn = card.locator('[data-more-product]');
    await moreBtn.click();
    await expect(card.locator('[data-edit-catalog-product]')).toBeVisible();
    await expect(card.locator('[data-delete-catalog-product]')).toBeVisible();
    await page.evaluate(() => renderProducts());
    await expect(card.locator('[data-more-product]')).toHaveAttribute('aria-expanded', 'true');

    await card.locator('[data-edit-catalog-product]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await page.fill('#food-name', 'Oatmeal edited');
    await page.fill('#food-kcal', '375');
    await page.locator('#food-save').click();
    await expect(page.locator('.toast-msg').last()).toContainText(await page.evaluate(() => toastT('catalogUpdatedSuccess').replace('{name}', 'Oatmeal edited')));
    await expect.poll(() => backend.tables.catalog_products.find((product) => product.name === 'Oatmeal edited')?.kcal).toBe(375);

    const editedCard = page.locator('#products-list .catalog-product-item').filter({ hasText: 'Oatmeal edited' });
    await editedCard.locator('[data-more-product]').click();
    await editedCard.locator('[data-copy-catalog-product]').click();
    await expect(page.locator('.toast-msg').last()).toContainText(await page.evaluate(() => toastT('productAddedToMine').replace('{name}', 'Oatmeal edited')));
    expect((await readStore(page)).products.some((product) => product.name === 'Oatmeal edited' && product.kcal === 375)).toBe(true);

    await editedCard.locator('[data-more-product]').click();
    await editedCard.locator('[data-delete-catalog-product]').click();
    await expect(page.locator('.toast-msg').last()).toContainText(await page.evaluate(() => toastT('catalogDeletedSuccess').replace('{name}', 'Oatmeal edited')));
    await expect(editedCard).toHaveCount(0);
    expect(backend.tables.catalog_products.some((product) => product.name === 'Oatmeal edited')).toBe(false);
  });

  test('admin can edit a composite catalog product', async ({ page }) => {
    const backend = createBackend();
    backend.tables.app_admins.push({ user_id: 'user-alice' });
    backend.tables.catalog_products.push({
      id: 'cat-composite-1', name: 'Protein Bowl', grams: 250, kcal: 320, protein: 28,
      fat: 8, carbs: 30, verified: true, companions: [], note: '',
      components: [{ id: 'component-1', name: 'Greek Yogurt', grams: 200, kcal: 118, protein: 20, fat: 0.8, carbs: 7.2, enabled: true }],
    });
    await mockSupabase(page, backend);
    await startAlice(page, backend);
    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();
    const card = page.locator('#products-list .catalog-product-item').filter({ hasText: 'Protein Bowl' });
    await card.locator('.product-toggle-main').click();
    await card.locator('[data-more-product]').click();
    await card.locator('[data-edit-catalog-product]').click();
    await expect(page.locator('#composite-modal')).toHaveClass(/open/);
    await page.fill('#composite-name', 'Protein Bowl edited');
    await page.locator('#composite-save-btn').click();
    await expect(page.locator('.toast-msg').last()).toContainText(await page.evaluate(() => toastT('catalogUpdatedSuccess').replace('{name}', 'Protein Bowl edited')));
    expect(backend.tables.catalog_products.find((product) => product.id === 'cat-composite-1')?.name).toBe('Protein Bowl edited');
    expect(backend.tables.catalog_products.find((product) => product.id === 'cat-composite-1')?.components).toHaveLength(1);
  });
  test('admin update does not report success when RLS returns no changed row', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const backend = createBackend();
    backend.tables.app_admins.push({ user_id: 'user-alice' });
    backend.tables.catalog_products.push({
      id: 'cat-noop-update', name: 'Greek Yogurt', grams: 100, kcal: 59, protein: 10,
      fat: 0.4, carbs: 3.6, verified: true, companions: [], components: [], note: '',
    });
    backend.silentCatalogMutations = true;

    await mockSupabase(page, backend);
    await startAlice(page, backend);
    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();
    const card = page.locator('#products-list .catalog-product-item').first();
    await card.locator('.product-toggle-main').click();
    await card.locator('[data-more-product]').click();
    await card.locator('[data-edit-catalog-product]').click();
    await page.fill('#food-kcal', '80');
    await page.locator('#food-save').click();

    await expect(page.locator('.toast-msg').last()).toContainText(await page.evaluate(() => t('catalogUpdateFailed')));
    await expect(page.locator('#modal')).toHaveClass(/open/);
    expect(backend.tables.catalog_products[0].kcal).toBe(59);
  });

  test('admin delete does not report success when RLS returns no deleted row', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const backend = createBackend();
    backend.tables.app_admins.push({ user_id: 'user-alice' });
    backend.tables.catalog_products.push({
      id: 'cat-noop-delete', name: 'Greek Yogurt', grams: 100, kcal: 59, protein: 10,
      fat: 0.4, carbs: 3.6, verified: true, companions: [], components: [], note: '',
    });
    backend.silentCatalogMutations = true;

    await mockSupabase(page, backend);
    await startAlice(page, backend);
    await autoConfirm(page, true);
    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();
    const card = page.locator('#products-list .catalog-product-item').first();
    await card.locator('.product-toggle-main').click();
    await card.locator('[data-more-product]').click();
    await card.locator('[data-delete-catalog-product]').click();

    await expect(page.locator('.toast-msg').last()).toContainText(await page.evaluate(() => t('catalogDeleteFailed')));
    await expect(card).toHaveCount(1);
    expect(backend.tables.catalog_products).toHaveLength(1);
  });

  test('loads catalog instantly from smart_diet_catalog_cache in localStorage', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const cachedCatalog = [
      { id: 'cat-cache-1', name: 'Кешований вівсяний батончик', grams: 60, kcal: 220, protein: 6, fat: 5, carbs: 38, verified: true, companions: [], components: [] },
    ];
    await page.addInitScript((items) => {
      localStorage.setItem('smart_diet_catalog_cache', JSON.stringify(items));
    }, cachedCatalog);

    const backend = createBackend();
    backend.tables.catalog_products.push({
      id: 'cat-cache-1', name: 'Кешований вівсяний батончик', grams: 60, kcal: 220, protein: 6, fat: 5, carbs: 38, verified: true, companions: [], components: [],
    });
    await mockSupabase(page, backend);

    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products: [], foods: [], weights: [] });

    // Verify localStorage key and helper functions
    const cached = await page.evaluate(() => ({
      key: CATALOG_CACHE_KEY,
      loaded: loadCachedCatalog(),
    }));
    expect(cached.key).toBe('smart_diet_catalog_cache');
    expect(cached.loaded).toHaveLength(1);
    expect(cached.loaded[0].name).toBe('Кешований вівсяний батончик');

    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();
    await expect(page.locator('#products-list')).toContainText('Кешований вівсяний батончик');
  });

  test('removes inner white card shell in catalog mode', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, products: [], foods: [], weights: [] });
    await openView(page, 'products');

    const cardEl = page.locator('#view-products > .card');
    await expect(cardEl).toBeVisible();

    await page.locator('#catalog-toggle-btn').click();
    await expect(page.locator('#view-products')).toHaveClass(/in-catalog-view/);

    const cardStyles = await cardEl.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        background: s.backgroundColor,
        boxShadow: s.boxShadow,
        borderWidth: s.borderTopWidth,
        padding: s.padding,
      };
    });

    expect(cardStyles.background).toBe('rgba(0, 0, 0, 0)');
    expect(cardStyles.boxShadow).toBe('none');
    expect(cardStyles.padding).toBe('0px');
  });

  test('catalog shows its own heading and an already-added note instead of an empty actions popup', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const backend = createBackend();
    backend.tables.catalog_products.push({
      id: 'cat-owned', name: 'Blueberries', grams: 100, kcal: 57, protein: 0.7, fat: 0.3, carbs: 14.5,
      verified: false, companions: [], components: [], note: '',
    });
    await mockSupabase(page, backend);
    await startAlice(page, backend);
    await page.evaluate(() => putProduct({ id: 'mine-blue', name: 'Blueberries', grams: 100, kcal: 57, protein: 0.7, fat: 0.3, carbs: 14.5 }));
    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();
    await expect(page.locator('#products-list-title')).toHaveText(/Product catalog|Каталог продуктів/);
    const card = page.locator('#products-list .catalog-product-item').first();
    await card.locator('.product-toggle-main').click();
    await card.locator('.product-more').click();
    const note = card.locator('.catalog-added-note');
    await expect(note).toBeVisible();
    await expect(note).toHaveText(/Already added|Вже додано/);
    await expect(card.locator('[data-copy-catalog-product]')).toHaveCount(0);
  });

  test('publishing a product with an add-on stores the add-on data inside the catalog entry', async ({ page }) => {
    const backend = createBackend();
    backend.tables.app_admins.push({ user_id: 'user-alice' });
    await mockSupabase(page, backend);
    await startAlice(page, backend);
    await page.evaluate(() => {
      putProduct({ id: 'milk-1', name: 'Milk', grams: 100, kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8 });
      putProduct({ id: 'coffee-1', name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, verified: true, note: 'Morning', companions: [{ id: 'milk-1', grams: 50, on: true }] });
    });
    await openView(page, 'products');
    await page.locator('#products-list .product-item', { hasText: 'Coffee' }).locator('.product-toggle-main').first().click();
    await page.locator('#products-list [data-publish-catalog]').first().click();
    await expect.poll(() => backend.tables.catalog_products.length).toBe(1);

    const row = backend.tables.catalog_products[0];
    expect(row.verified).toBe(true);
    expect(row.note).toBe('Morning');
    expect(row.companions).toEqual([{ id: 'milk-1', grams: 50, on: true, item: { name: 'Milk', grams: 100, kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8 } }]);

    await page.evaluate(() => deleteProduct?.('milk-1'));
    await page.locator('#catalog-toggle-btn').click();
    await page.locator('#products-list .product-toggle-main').first().click();
    await page.locator('#products-list [data-toggle-product-addons]').first().click();
    await expect(page.locator('#products-list [data-product-addons]')).toContainText('Milk');
  });

  test('copying a catalog product with add-ons gives an independent copy that includes them', async ({ page }) => {
    const backend = createBackend();
    backend.tables.catalog_products.push({
      id: 'cat-coffee', name: 'Coffee with milk', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, verified: true, note: '', components: [],
      companions: [{ id: 'admin-milk', grams: 50, on: true, item: { name: 'Milk', grams: 100, kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8 } }],
    });
    await mockSupabase(page, backend);
    await startAlice(page, backend);
    await openView(page, 'products');
    await page.locator('#catalog-toggle-btn').click();
    await page.locator('#products-list .product-toggle-main').first().click();
    await page.locator('#products-list [data-toggle-product-addons]').first().click();
    await expect(page.locator('#products-list [data-product-addons]')).toContainText('Milk');
    await page.locator('#products-list [data-copy-catalog-product]').first().click();

    await expect.poll(async () => (await readStore(page)).products.length).toBe(2);
    const stored = await readStore(page);
    const milk = stored.products.find((p) => p.name === 'Milk');
    const coffee = stored.products.find((p) => p.name === 'Coffee with milk');
    expect(milk).toBeDefined();
    expect(milk.id).not.toBe('admin-milk');
    expect(coffee.companions).toEqual([{ id: milk.id, grams: 50, on: true }]);
    expect(backend.tables.catalog_products[0].companions[0].id).toBe('admin-milk');

    await page.locator('#catalog-toggle-btn').click();
    await expect(page.locator('#products-list')).toContainText('Coffee with milk');
    await page.locator('#products-list .product-item', { hasText: 'Coffee with milk' }).locator('.product-toggle-main').first().click();
    await page.locator('#products-list [data-toggle-product-addons]').first().click();
    await expect(page.locator('#products-list [data-product-addons]')).toContainText('Milk');
  });

  test('keeps catalog navigation above the catalog list and pairs it with New product in My products', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openApp(page, { prefs: BASE_PREFS, products: [], foods: [], weights: [] });
    await openView(page, 'products');
    const catalogButton = page.locator('#catalog-toggle-btn');
    await expect(catalogButton).toBeVisible();
    await expect(page.locator('#product-new')).toBeVisible();
    expect(await catalogButton.evaluate((button) => button.parentElement?.id)).toBe('catalog-toggle-slot');
    expect(await page.locator('#product-new').evaluate((button) => button.parentElement?.id)).toBe('products-toolbar');
    const toolbarOrder = await page.locator('#products-toolbar').evaluate((toolbar) => [...toolbar.children].map((item) => item.id));
    expect(toolbarOrder).toEqual(['catalog-toggle-slot', 'product-new']);
    const catalogBox = await catalogButton.boundingBox();
    const newProductBox = await page.locator('#product-new').boundingBox();
    expect(catalogBox.y).toBeCloseTo(newProductBox.y, 0);
    expect(catalogBox.x).toBeLessThan(newProductBox.x);
    expect(newProductBox.x + newProductBox.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    await catalogButton.click();
    await expect(page.locator('#product-new')).toBeHidden();
    await expect(catalogButton).toBeVisible();
    const placement = await catalogButton.evaluate((button) => ({
      insideCard: Boolean(button.closest('.card')),
      insideProductsView: Boolean(button.closest('#view-products')),
      navigationSlot: button.parentElement?.id,
      aboveProductsView: (() => {
        const productsView = document.querySelector('#view-products');
        return Boolean(productsView && button.getBoundingClientRect().bottom <= productsView.getBoundingClientRect().top);
      })(),
      aboveCatalogList: (() => {
        const catalogCard = document.querySelector('#view-products .card');
        return Boolean(catalogCard && button.getBoundingClientRect().bottom <= catalogCard.getBoundingClientRect().top);
      })(),
    }));
    expect(placement.insideCard).toBe(false);
    expect(placement.insideProductsView).toBe(false);
    expect(placement.navigationSlot).toBe('catalog-nav-slot');
    expect(placement.aboveProductsView).toBe(true);
    expect(placement.aboveCatalogList).toBe(true);
    const slotBox = await page.locator('#catalog-nav-slot').boundingBox();
    const btnBox = await catalogButton.boundingBox();
    expect(btnBox.width).toBeCloseTo(slotBox.width, 1);
  });

  test('catalog navigation button is never visible on home, diary, stats, or settings views', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, products: [], foods: [], weights: [] });
    await openView(page, 'products');
    const catalogButton = page.locator('#catalog-toggle-btn');
    await expect(catalogButton).toBeVisible();

    await catalogButton.click();
    await expect(catalogButton).toBeVisible();

    await openView(page, 'home');
    await expect(catalogButton).toBeHidden();

    await openView(page, 'diary');
    await expect(catalogButton).toBeHidden();

    await openView(page, 'stats');
    await expect(catalogButton).toBeHidden();

    await openView(page, 'settings');
    await expect(catalogButton).toBeHidden();

    await openView(page, 'products');
    await expect(catalogButton).toBeVisible();
  });
});
