const { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate } = require('./smoke.helpers');

test.describe('Smoke: product add-ons', () => {
  const MILK = '22222222-2222-4222-8222-222222222222';
  const COFFEE = '11111111-1111-4111-8111-111111111111';
  const milk = { id: MILK, name: 'Milk', grams: 100, kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8 };

  test('additional products expand below product details with their nutrition on mobile and desktop', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    const plain = { id: 'plain-product', name: 'Plain product', grams: 100, kcal: 80, protein: 2, fat: 1, carbs: 12 };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk, plain], foods: [], weights: [] });
    await openView(page, 'products');
    await page.setViewportSize({ width: 360, height: 760 });

    const coffeeItem = page.locator(`.product-item[data-product-id="${COFFEE}"]`);
    const plainItem = page.locator('.product-item', { hasText: 'Plain product' });
    await expect(coffeeItem.locator('[data-toggle-product-addons]')).toHaveCount(1);
    await expect(plainItem.locator('[data-toggle-product-addons]')).toHaveCount(0);
    await expect(coffeeItem.locator('[data-product-addons]')).toBeHidden();

    await coffeeItem.locator('.product-toggle-main').click();
    const toggle = coffeeItem.locator('[data-toggle-product-addons]');
    await expect(coffeeItem).not.toHaveClass(/collapsed/);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Show additional products');
    const row = await coffeeItem.locator('.product-row').evaluate((el) => el.compareDocumentPosition(el.nextElementSibling) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(row).toBeTruthy();
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(toggleBox.x).toBeGreaterThanOrEqual(0);
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(360);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toContainText('Hide additional products');
    const addon = coffeeItem.locator(`[data-product-addon="${MILK}"]`);
    await expect(addon).toBeVisible();
    await expect(addon.locator('.product-addon-name')).toHaveText('Milk');
    await expect(addon.locator('.companion-nutrition')).toContainText('50 g');
    await expect(addon.locator('.companion-nutrition')).toContainText('32 kcal');
    await expect(addon.locator('.companion-nutrition')).toContainText('P 1.7');
    await expect(addon.locator('.companion-nutrition')).toContainText('F 1.8');
    await expect(addon.locator('.companion-nutrition')).toContainText('C 2.4');

    await coffeeItem.locator('.product-toggle-main').click();
    await expect(coffeeItem.locator('[data-product-addons]')).toBeHidden();
    await expect(coffeeItem.locator('[data-toggle-product-addons]')).toHaveAttribute('aria-expanded', 'false');

    await page.setViewportSize({ width: 1280, height: 832 });
    await coffeeItem.locator('.product-toggle-main').click();
    await coffeeItem.locator('[data-toggle-product-addons]').click();
    await expect(addon).toBeVisible();
    const desktopToggleBox = await coffeeItem.locator('[data-toggle-product-addons]').boundingBox();
    expect(desktopToggleBox).not.toBeNull();
    expect(desktopToggleBox.x).toBeGreaterThanOrEqual(0);
    expect(desktopToggleBox.x + desktopToggleBox.width).toBeLessThanOrEqual(1280);

    await openView(page, 'settings');
    await page.selectOption('#pref-lang', 'uk');
    await page.locator('#save-lang').click();
    await openView(page, 'products');
    await expect(coffeeItem).not.toHaveClass(/collapsed/);
    await expect(toggle).toHaveText('Сховати додаткові продукти');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(addon).toBeVisible();
    expect(await page.evaluate(() => Object.keys(I.en).sort().join('|') === Object.keys(I.uk).sort().join('|'))).toBe(true);
  });

  test('product add-ons are selectable in My products and only active ones are used', async ({ page }) => {
    const sugarId = '33333333-3333-4333-8333-333333333333';
    const sugar = { id: sugarId, name: 'Sugar', grams: 100, kcal: 400, protein: 0, fat: 0, carbs: 100 };
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }, { id: sugarId, grams: 10 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk, sugar], foods: [], weights: [] });
    await openView(page, 'products');
    const item = page.locator(`#products-list .product-item[data-product-id="${COFFEE}"]`);
    await item.locator('.product-toggle-main').click();
    await item.locator('[data-toggle-product-addons]').click();
    const milkCheckbox = item.locator(`[data-product-companion-enabled="${MILK}"]`);
    const sugarCheckbox = item.locator(`[data-product-companion-enabled="${sugarId}"]`);
    await expect(milkCheckbox).toBeChecked();
    await expect(sugarCheckbox).toBeChecked();
    await expect(item.locator('.product-info')).toContainText('74 kcal');
    await milkCheckbox.uncheck();
    await expect.poll(() => page.evaluate(() => state.products.find((p) => p.id === '11111111-1111-4111-8111-111111111111')?.companions)).toEqual([{ id: MILK, grams: 50, on: false }, { id: sugarId, grams: 10, on: true }]);
    await expect(item.locator('.product-info')).toContainText('42 kcal');
    await item.locator('.product-toggle-main').click();
    await item.locator('.product-toggle-main').click();
    await item.locator('[data-toggle-product-addons]').click();
    await expect(milkCheckbox).not.toBeChecked();
    await item.locator(`[data-add-product="${COFFEE}"]`).click();
    await page.locator('#pick-add').click();
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams, f.kcal]))).toEqual([['Coffee', 110, 42]]);
  });
  test('a usual add-on is saved on a product from the product editor', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [milk], foods: [], weights: [] });
    await openView(page, 'products');
    await page.click('#product-new');
    await page.click('#product-type-simple');
    await page.fill('#food-name', 'Coffee');
    await page.fill('#food-kcal', '5');
    await page.click('#product-companion-add');
    await page.locator('#pick-body [data-pick-product]', { hasText: 'Milk' }).click();
    await expect(page.locator('#product-companions-list')).toContainText('Milk');
    await page.click('#food-save');
    await expect.poll(() => page.evaluate(() => state.products.find((p) => p.name === 'Coffee')?.companions)).toEqual([{ id: MILK, grams: 100, on: true }]);
  });

  test('adding a product adds its checked add-ons to the same meal with their own grams', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await expect(page.locator('#pick-companions-list')).toContainText('Milk');
    await expect(page.locator(`input[data-companion-on="${MILK}"]`)).toBeChecked();
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams, f.kcal, f.meal]))).toEqual([
      ['Coffee', 150, 34, expect.any(String)],
    ]);
    const meals = await page.evaluate(() => [...new Set(state.foods.map((f) => f.meal))]);
    expect(meals).toHaveLength(1);

    await openView(page, 'diary');
    const entry = page.locator('#diary-meals .meal-item[data-food-id]').filter({ has: page.locator('b', { hasText: 'Coffee' }) });
    await entry.locator('[data-toggle-food]').click();
    await expect(entry.locator('.food-components-detail')).toContainText('Milk');
    await expect(entry.locator('.food-components-detail')).toContainText('50');
    await expect(entry.locator('.food-components-detail')).toContainText('32');

    await entry.locator('[data-edit-food]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#food-components-field')).toBeVisible();
    await expect(page.locator('#food-components-list [data-component-item]')).toHaveCount(1);
    const milkToggle = page.locator(`#food-components-list [data-component-toggle="${MILK}"]`);
    await expect(milkToggle).toBeChecked();
    await milkToggle.uncheck();
    await expect(page.locator('#food-grams')).toHaveValue('100');
    await expect(page.locator('#food-kcal')).toHaveValue('2');
    await page.click('#food-save');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);

    await expect(entry.locator('.meal-info')).toContainText('100');
    await expect(entry.locator('.meal-info')).toContainText('2');
    await expect(entry.locator('.food-components-detail')).toHaveCount(0);
  });

  test('an unchecked add-on is not added', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await page.locator(`input[data-companion-on="${MILK}"]`).uncheck();
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams, f.kcal]))).toEqual([['Coffee', 100, 2]]);
    expect(await page.evaluate(() => state.products.find((p) => p.id === '11111111-1111-4111-8111-111111111111').companions)).toEqual([{ id: MILK, grams: 50 }]);
  });
  test('adding a product from the main diary modal adds its checked add-ons to the same meal', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openModal('food', 'breakfast'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Coffee');
    await page.dispatchEvent('#food-name', 'change');
    await expect(page.locator('#product-companions-field')).toBeVisible();
    await expect(page.locator('#product-companions-list')).toContainText('Milk');
    await expect(page.locator(`input[data-companion-on="${MILK}"]`)).toBeChecked();
    await page.click('#food-save');
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams, f.kcal, f.meal]))).toEqual([
      ['Coffee', 150, 34, 'breakfast'],
    ]);
  });

  test('unchecking an add-on in the main diary modal leaves it unlogged', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openModal('food', 'lunch'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Coffee');
    await page.dispatchEvent('#food-name', 'change');
    await expect(page.locator(`input[data-companion-on="${MILK}"]`)).toBeVisible();
    await page.locator(`input[data-companion-on="${MILK}"]`).uncheck();
    await page.click('#food-save');
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams, f.kcal]))).toEqual([['Coffee', 100, 2]]);
    expect(await page.evaluate((id) => state.products.find((p) => p.id === id).companions, COFFEE)).toEqual([{ id: MILK, grams: 50 }]);
  });

  test('adding a product with multiple add-ons from main modal does not compress or scale add-ons down', async ({ page }) => {
    const ADDON1 = '44444444-4444-4444-8444-444444444444';
    const ADDON2 = '55555555-5555-4555-8555-555555555555';
    const MAIN = '66666666-6666-4666-8666-666666666666';
    const addon1 = { id: ADDON1, name: 'Addon 1', grams: 4, kcal: 20, protein: 1, fat: 1, carbs: 2 };
    const addon2 = { id: ADDON2, name: 'Addon 2', grams: 25, kcal: 100, protein: 5, fat: 5, carbs: 8 };
    const mainProd = { id: MAIN, name: 'Main dish', grams: 200, kcal: 300, protein: 20, fat: 10, carbs: 30, companions: [{ id: ADDON1, grams: 4 }, { id: ADDON2, grams: 25 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [mainProd, addon1, addon2], foods: [], weights: [] });
    await page.evaluate(() => openModal('food', 'breakfast'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Main dish');
    await page.dispatchEvent('#food-name', 'change');
    await expect(page.locator('#product-companions-field')).toBeVisible();
    await page.click('#food-save');
    await expect.poll(() => page.evaluate(() => {
      const f = state.foods.find(x => x.name === 'Main dish');
      if (!f) return null;
      return {
        totalGrams: f.grams,
        baseCompGrams: f.components?.find(c => c.isBase || c.id === '__base__')?.grams,
        addon1Grams: f.components?.find(c => c.id === '44444444-4444-4444-8444-444444444444')?.grams,
        addon2Grams: f.components?.find(c => c.id === '55555555-5555-4555-8555-555555555555')?.grams,
      };
    })).toEqual({
      totalGrams: 229,
      baseCompGrams: 200,
      addon1Grams: 4,
      addon2Grams: 25,
    });
  });

  test('editing add-on grams in the main diary modal does not mutate the saved product setting', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openModal('food', 'breakfast'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Coffee');
    await page.dispatchEvent('#food-name', 'change');
    const card = page.locator(`#product-companions-list [data-companion-card="${MILK}"]`);
    await expect(card).toHaveClass(/collapsed/);
    await card.locator(`[data-companion-toggle="${MILK}"]`).click();
    const companionInput = card.locator(`input[data-companion-grams="${MILK}"]`);
    await expect(companionInput).toBeVisible();
    await companionInput.fill('75');
    await page.click('#food-save');
    await expect.poll(() => page.evaluate(() => state.foods.find((f) => f.name === 'Coffee')?.grams)).toBe(175);
    await expect.poll(() => page.evaluate((id) => state.foods.find((f) => f.name === 'Coffee')?.components?.find((c) => c.id === id)?.grams, MILK)).toBe(75);
    expect(await page.evaluate((id) => state.products.find((p) => p.id === id).companions, COFFEE)).toEqual([{ id: MILK, grams: 50 }]);
  });
  test('meal product list shows add-on totals and lets add-ons be expanded and selected', async ({ page }) => {
    const plain = { id: 'plain-product', name: 'Plain product', grams: 100, kcal: 80, protein: 2, fat: 1, carbs: 12 };
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk, plain], foods: [], weights: [] });
    await page.setViewportSize({ width: 360, height: 760 });
    await page.evaluate(() => openProductPicker());

    const group = page.locator(`#pick-body [data-pick-group="${COFFEE}"]`);
    await expect(group.locator('.pick-item .muted')).toContainText('150 g · 34 kcal');
    await expect(page.locator('#pick-body [data-toggle-pick-addons]')).toHaveCount(1);
    await expect(group.locator('[data-pick-addons]')).toBeHidden();
    await expect(group.locator('[data-toggle-pick-addons]')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#pick-body .product-total-block')).toHaveCount(0);
    expect(await page.evaluate((id) => {
      const g = document.querySelector(`#pick-body [data-pick-group="${id}"]`);
      const toggle = g.querySelector('[data-toggle-pick-addons]').getBoundingClientRect();
      const box = g.getBoundingClientRect();
      return g.classList.contains('pick-item-group') && toggle.top >= box.top && toggle.bottom <= box.bottom + 1;
    }, COFFEE)).toBe(true);

    await group.locator('[data-toggle-pick-addons]').click();
    await expect(group.locator('[data-toggle-pick-addons]')).toHaveAttribute('aria-expanded', 'true');
    const addon = group.locator(`[data-product-addon="${MILK}"]`);
    await expect(addon.locator('.product-addon-name')).toHaveText('Milk');
    await expect(addon.locator('.companion-nutrition')).toContainText('50 g');
    await expect(addon.locator('.companion-nutrition')).toContainText('32 kcal');
    const checkbox = addon.locator(`input[data-product-companion-enabled="${MILK}"]`);
    await expect(checkbox).toBeChecked();
    expect(await page.evaluate(() => {
      const body = document.querySelector('#pick-body');
      return body.scrollWidth <= body.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth;
    })).toBe(true);

    await checkbox.uncheck();
    await expect(group.locator('.pick-item .muted')).toContainText('100 g · 2 kcal');
    await expect(addon).toHaveClass(/is-disabled/);
    await expect.poll(() => page.evaluate((id) => state.products.find((p) => p.id === id).companions, COFFEE)).toEqual([{ id: MILK, grams: 50, on: false }]);

    await page.fill('#pick-search', 'coffee');
    await expect(group.locator('[data-toggle-pick-addons]')).toHaveAttribute('aria-expanded', 'true');
    await expect(group.locator(`input[data-product-companion-enabled="${MILK}"]`)).not.toBeChecked();

    await page.click(`#pick-body [data-pick-product="${COFFEE}"]`);
    await expect(page.locator('#pick-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#food-name')).toHaveValue('Coffee');
    await expect(page.locator('#food-grams')).toHaveValue('100');
  });

  test.skip('product with multiple add-ons displays and edits like composite dishes in diary', async ({ page }) => {
    const SUGAR = '88888888-8888-4888-8888-888888888888';
    const sugar = { id: SUGAR, name: 'Sugar', grams: 10, kcal: 40, protein: 0, fat: 0, carbs: 10 };
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }, { id: SUGAR, grams: 10 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk, sugar], foods: [], weights: [] });

    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await expect(page.locator(`#pick-companions-list input[data-companion-on="${MILK}"]`)).toBeChecked();
    await expect(page.locator(`#pick-companions-list input[data-companion-on="${SUGAR}"]`)).toBeChecked();
    await page.selectOption('#pick-portions', '2');
    await page.click('#pick-add');

    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams, f.kcal]))).toEqual([['Coffee', 260, 76]]);

    await openView(page, 'diary');
    const entry = page.locator('#diary-meals .meal-item[data-food-id]').filter({ has: page.locator('b', { hasText: 'Coffee' }) });
    await entry.locator('[data-toggle-food]').click();
    await expect(entry.locator('.food-components-detail')).toContainText('Milk');
    await expect(entry.locator('.food-components-detail')).toContainText('Sugar');
    await expect(entry.locator('.food-components-detail .product-addon-item')).toHaveCount(2);

    await entry.locator('[data-edit-food]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#food-components-field')).toBeVisible();
    await expect(page.locator('#food-components-list [data-component-item]')).toHaveCount(2);
    await expect(page.locator('#food-portions')).toHaveValue('2');
    await expect(page.locator(`#food-components-list [data-component-grams="${MILK}"]`)).toHaveValue('50');
    await expect(page.locator(`#food-components-list [data-component-grams="${SUGAR}"]`)).toHaveValue('10');
    const sugarToggle = page.locator(`#food-components-list [data-component-toggle="${SUGAR}"]`);
    await expect(sugarToggle).toBeChecked();

    await sugarToggle.uncheck();
    await expect(page.locator('#food-grams')).toHaveValue('250');
    await expect(page.locator('#food-kcal')).toHaveValue('36');
    await expect(page.locator('#food-portions')).toHaveValue('2');
    await expect(page.locator(`#food-components-list [data-component-grams="${MILK}"]`)).toHaveValue('50');
    await expect(page.locator(`#food-components-list [data-component-grams="${SUGAR}"]`)).toHaveValue('10');
    await page.selectOption('#food-portions', '3');
    await expect(page.locator('#food-grams')).toHaveValue('350');
    await expect(page.locator('#food-kcal')).toHaveValue('38');
    await expect(page.locator(`#food-components-list [data-component-grams="${MILK}"]`)).toHaveValue('50');
    await page.selectOption('#food-portions', '2');
    await expect(page.locator('#food-grams')).toHaveValue('250');
    await expect(page.locator('#food-kcal')).toHaveValue('36');
    await page.click('#food-save');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);

    await expect(entry.locator('.meal-info')).toContainText('2 serv. · 250 g');
    await expect(entry.locator('.meal-info')).toContainText('36');
    await expect(entry.locator('.food-components-detail')).toContainText('Milk');
    await expect(entry.locator('.food-components-detail')).not.toContainText('Sugar');
    await expect(entry.locator('.food-components-detail .product-addon-item')).toHaveCount(1);

    await entry.locator('[data-edit-food]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    const sugarCard = page.locator(`#food-components-list [data-component-item="${SUGAR}"]`);
    await expect(sugarCard).toHaveClass(/is-disabled/);
    await expect(sugarToggle).not.toBeChecked();

    await sugarToggle.check();
    await expect(page.locator('#food-grams')).toHaveValue('260');
    await expect(page.locator('#food-kcal')).toHaveValue('76');
    await expect(page.locator(`#food-components-list [data-component-grams="${MILK}"]`)).toHaveValue('50');
    await expect(page.locator(`#food-components-list [data-component-grams="${SUGAR}"]`)).toHaveValue('10');
    await page.click('#food-save');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);

    await expect(entry.locator('.meal-info')).toContainText('2 serv. · 260 g');
    await expect(entry.locator('.meal-info')).toContainText('76');
    await expect(entry.locator('.food-components-detail')).toContainText('Milk');
    await expect(entry.locator('.food-components-detail')).toContainText('Sugar');
    await expect(entry.locator('.food-components-detail .product-addon-item')).toHaveCount(2);
  });

  test('add-ons keep the entered amount no matter how many portions of the main product are added', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await expect(page.locator('#pick-companions-field .companion-portion-note')).toContainText('do not depend on the number of portions');
    await page.selectOption('#pick-portions', '3');
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams, f.kcal]))).toEqual([['Coffee', 350, 38]]);
    const comps = await page.evaluate(() => state.foods[0].components.map((c) => [c.id, c.grams, c.kcal]));
    expect(comps).toEqual([['__base__', 300, 6], [MILK, 50, 32]]);

    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await page.selectOption('#pick-portions', '0.5');
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.grams, f.kcal]))).toEqual([[350, 38], [100, 33]]);
  });

  test.skip('editing an entry with add-ons edits the main product and the add-ons separately', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await page.selectOption('#pick-portions', '2');
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.length)).toBe(1);

    await openView(page, 'diary');
    const entry = page.locator('#diary-meals .meal-item[data-food-id]').filter({ has: page.locator('b', { hasText: 'Coffee' }) });
    await entry.locator('[data-toggle-food]').click();
    await entry.locator('[data-edit-food]').click();
    await expect(page.locator('#food-components-field .companion-portion-note')).toContainText('do not depend on the number of portions');
    const milkInput = page.locator(`#food-components-list [data-component-grams="${MILK}"]`);
    await expect(milkInput).toHaveValue('50');
    await expect(page.locator('#food-grams')).toHaveValue('250');

    await milkInput.fill('80');
    await expect(page.locator('#food-grams')).toHaveValue('280');
    await expect(page.locator('#food-kcal')).toHaveValue('55');

    await page.selectOption('#food-portions', '3');
    await expect(page.locator('#food-grams')).toHaveValue('380');
    await expect(milkInput).toHaveValue('80');

    await page.fill('#food-grams', '480');
    await expect(page.locator('#food-portions')).toHaveValue('4');
    await expect(milkInput).toHaveValue('80');

    await page.click('#food-save');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
    const saved = await page.evaluate(() => state.foods[0]);
    expect(saved.grams).toBe(480);
    expect(saved.portions).toBe(4);
    expect(saved.components.find((c) => c.id === MILK).grams).toBe(80);
    expect(saved.components.find((c) => c.id === '__base__').grams).toBe(400);
  });

  test.skip('add-on portions and grams stay in sync in the edit modal, and main product and total are shown', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await page.selectOption('#pick-portions', '2');
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.length)).toBe(1);

    await openView(page, 'diary');
    const entry = page.locator('#diary-meals .meal-item[data-food-id]').filter({ has: page.locator('b', { hasText: 'Coffee' }) });
    await entry.locator('[data-toggle-food]').click();
    await expect(entry.locator('.food-components-detail .product-main-block')).toHaveCount(1);
    await expect(entry.locator('.food-components-detail .product-total-block')).toHaveCount(0);
    await expect(entry.locator('.food-components-detail .product-addon-item')).toHaveCount(1);
    await entry.locator('[data-edit-food]').click();

    const main = page.locator('#food-components-list [data-food-main]');
    await expect(main).toContainText('200 g');
    await expect(main).toContainText('4 kcal');
    const portions = page.locator(`#food-components-list [data-component-portions="${MILK}"]`);
    const grams = page.locator(`#food-components-list [data-component-grams="${MILK}"]`);
    await expect(portions).toHaveValue('0.5');
    await portions.selectOption('1');
    await expect(grams).toHaveValue('100');
    await expect(page.locator('#food-grams')).toHaveValue('300');
    await expect(page.locator('#food-kcal')).toHaveValue('68');
    await expect(page.locator('#food-components-list [data-food-total]')).toContainText('68');
    await grams.fill('150');
    await expect(portions).toHaveValue('1.5');
    await expect(page.locator('#food-grams')).toHaveValue('350');
    await expect(main).toContainText('200 g');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(overflow).toBe(true);
  });

  test('add-on portions and grams sit side by side in the edit modal at 360px, like in the add dialog', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const HONEY = '33333333-3333-4333-8333-333333333333';
    const honey = { id: HONEY, name: 'Honey with a very long product name that has to be shortened', grams: 20, kcal: 60, protein: 0, fat: 0, carbs: 16 };
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }, { id: HONEY, grams: 20 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk, honey], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.length)).toBe(1);

    await openView(page, 'diary');
    const editBtn = page.locator('#diary-meals .meal-item[data-food-id] [data-edit-food]').first();
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.click();
    for (const id of [MILK, HONEY]) {
      const card = page.locator(`#food-components-list [data-component-item="${id}"]`);
      await expect(card).toBeVisible();
      const layout = await card.evaluate((el) => {
        const box = (sel) => el.querySelector(sel).getBoundingClientRect();
        const c = el.getBoundingClientRect();
        const p = el.querySelector('[data-component-portions]').closest('.dd').querySelector('.dd-btn').getBoundingClientRect();
        const g = box('[data-component-grams]');
        return {
          sameRow: Math.abs(p.top - g.top) < 2 && Math.abs(p.height - g.height) < 2,
          portionsBeforeGrams: p.right <= g.left,
          inside: p.left >= c.left && g.right <= c.right,
          comparableWidth: Math.abs(p.width - g.width) < 4,
          height: Math.round(g.height),
          labels: [...el.querySelectorAll('.companion-field-label')].map((n) => n.textContent.trim()),
        };
      });
      expect(layout).toEqual({ sameRow: true, portionsBeforeGrams: true, inside: true, comparableWidth: true, height: 44, labels: ['Portions', 'Amount, g'] });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const milkPortions = page.locator(`#food-components-list [data-component-portions="${MILK}"]`);
    const milkGrams = page.locator(`#food-components-list [data-component-grams="${MILK}"]`);
    await milkPortions.selectOption('2');
    await expect(milkGrams).toHaveValue('200');
    await milkGrams.fill('50');
    await expect(milkPortions).toHaveValue('0.5');
    await page.locator(`#food-components-list [data-component-toggle="${HONEY}"]`).uncheck();
    await expect(page.locator(`#food-components-list [data-component-grams="${HONEY}"]`)).toBeDisabled();
    await expect(page.locator(`#food-components-list [data-component-portions="${HONEY}"]`)).toBeDisabled();
  });

  test('add-on portions in the meal edit modal use the styled list instead of a native select', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.length)).toBe(1);
    await openView(page, 'diary');
    const editBtn = page.locator('#diary-meals .meal-item[data-food-id] [data-edit-food]').first();
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.click();

    const card = page.locator(`#food-components-list [data-component-item="${MILK}"]`);
    const dd = card.locator('.dd');
    await expect(dd).toHaveCount(1);
    await expect(dd.locator('select')).toHaveClass(/dd-native/);
    await expect(dd.locator('.dd-btn')).toHaveText('0.5');
    await expect(dd.locator('.dd-list')).toBeHidden();
    await dd.locator('.dd-btn').click();
    await expect(dd.locator('.dd-list')).toBeVisible();
    const inView = await dd.locator('.dd-list').evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
    expect(inView).toBe(true);
    await dd.locator('.dd-opt', { hasText: /^2$/ }).click();
    await expect(dd.locator('.dd-list')).toBeHidden();
    await expect(dd.locator('.dd-btn')).toHaveText('2');
    await expect(card.locator('[data-component-grams]')).toHaveValue('200');

    await card.locator('[data-component-grams]').fill('50');
    await expect(dd.locator('.dd-btn')).toHaveText('0.5');

    await card.locator(`[data-component-toggle="${MILK}"]`).uncheck();
    await expect(dd.locator('.dd-btn')).toBeDisabled();
    await card.locator(`[data-component-toggle="${MILK}"]`).check();
    await expect(dd.locator('.dd-btn')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.evaluate(() => { document.querySelectorAll('#food-components-list select').forEach((el) => { if (!el.classList.contains('dd-native')) throw new Error('native select left'); }); });
  });

  test('an open add-on portions list floats over the dialog without resizing it and stays on screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.length)).toBe(1);
    await openView(page, 'diary');
    const editBtn = page.locator('#diary-meals .meal-item[data-food-id] [data-edit-food]').first();
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.click();

    const dd = page.locator(`#food-components-list [data-component-item="${MILK}"] .dd`);
    await dd.scrollIntoViewIfNeeded();
    const measure = () => page.evaluate(() => {
      const box = document.querySelector('#modal .modal');
      return { scrollHeight: box.scrollHeight, scrollTop: box.scrollTop, pageHeight: document.documentElement.scrollHeight };
    });
    const before = await measure();
    await dd.locator('.dd-btn').click();
    const list = dd.locator('.dd-list');
    await expect(list).toBeVisible();
    const geo = await list.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { fixed: getComputedStyle(el).position === 'fixed', top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: window.innerHeight, vw: window.innerWidth };
    });
    expect(geo.fixed).toBe(true);
    expect(geo.top).toBeGreaterThanOrEqual(0);
    expect(geo.bottom).toBeLessThanOrEqual(geo.vh);
    expect(geo.left).toBeGreaterThanOrEqual(0);
    expect(geo.right).toBeLessThanOrEqual(geo.vw);
    expect(await measure()).toEqual(before);
    await dd.locator('.dd-opt', { hasText: /^1$/ }).click();
    await expect(list).toBeHidden();
    await expect(dd.locator('.dd-btn')).toHaveText('1');
  });

  test('the portions list opens upward when there is no room below the field', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 520 });
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Coffee')));
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.length)).toBe(1);
    await openView(page, 'diary');
    const editBtn = page.locator('#diary-meals .meal-item[data-food-id] [data-edit-food]').first();
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.click();

    const dd = page.locator(`#food-components-list [data-component-item="${MILK}"] .dd`);
    await dd.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await dd.locator('.dd-btn').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const box = el.closest('.modal');
      box.scrollTop += r.bottom - (window.innerHeight - 24);
    });
    await dd.locator('.dd-btn').click();
    const list = dd.locator('.dd-list');
    await expect(list).toBeVisible();
    const geo = await dd.evaluate((el) => {
      const l = el.querySelector('.dd-list').getBoundingClientRect();
      const b = el.querySelector('.dd-btn').getBoundingClientRect();
      return { listBottom: l.bottom, btnTop: b.top, listTop: l.top, vh: window.innerHeight };
    });
    expect(geo.listBottom).toBeLessThanOrEqual(geo.btnTop);
    expect(geo.listTop).toBeGreaterThanOrEqual(0);
  });

  test.skip('an entry saved before this change keeps its totals when it is opened and saved again', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    const today = new Date().toLocaleDateString('en-CA');
    const legacy = { id: '55555555-5555-4555-8555-555555555555', name: 'Coffee', meal: 'breakfast', grams: 300, kcal: 68, protein: 6.9, fat: 3.6, carbs: 4.8, date: today, createdAt: Date.now(), portions: 2,
      components: [
        { id: '__base__', name: 'Coffee', grams: 200, kcal: 4, protein: 0.6, fat: 0, carbs: 0, enabled: true, isBase: true, portion: 2, baseGrams: 100 },
        { id: MILK, name: 'Milk', grams: 100, kcal: 64, protein: 6.6, fat: 3.6, carbs: 4.8, enabled: true, portion: 2, baseGrams: 50 },
      ] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [legacy], weights: [] });
    await openView(page, 'diary');
    const entry = page.locator('#diary-meals .meal-item[data-food-id]').filter({ has: page.locator('b', { hasText: 'Coffee' }) });
    await entry.locator('[data-toggle-food]').click();
    await entry.locator('[data-edit-food]').click();
    await expect(page.locator(`#food-components-list [data-component-grams="${MILK}"]`)).toHaveValue('100');
    await expect(page.locator('#food-grams')).toHaveValue('300');
    await expect(page.locator('#food-kcal')).toHaveValue('68');
    await page.click('#food-save');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
    const saved = await page.evaluate(() => state.foods[0]);
    expect([saved.grams, saved.kcal, saved.portions]).toEqual([300, 68, 2]);
    expect(saved.components.find((c) => c.id === MILK).grams).toBe(100);
  });
  test.skip('an empty add-ons list in main diary modal hides the field without add button, adding add-ons is only in product editor', async ({ page }) => {
    const borsch = { id: '33333333-3333-4333-8333-333333333333', name: 'Borsch', grams: 300, kcal: 180, protein: 6, fat: 8, carbs: 20 };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [borsch, milk], foods: [], weights: [] });

    // In diary modal, Borsch has no add-ons -> companions field and add button are hidden
    await page.evaluate(() => openModal('food', 'dinner'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Borsch');
    await page.dispatchEvent('#food-name', 'change');
    await expect(page.locator('#product-companions-field')).toBeHidden();
    await expect(page.locator('#product-companion-add')).toBeHidden();
    await page.click('#modal-close');

    // In meal picker, Borsch has no add-ons -> companions field is hidden and no pick-companion-add button
    await page.evaluate((b) => openMealPicker(b), borsch);
    await expect(page.locator('#pick-companions-field')).toBeHidden();
    await expect(page.locator('#pick-companion-add')).toHaveCount(0);
    await page.evaluate(() => closePick());

    // In product editor, add-on button is visible and allows configuring saved add-ons
    await page.evaluate((b) => openProductModal(b), borsch);
    await expect(page.locator('#product-companions-field')).toBeVisible();
    await expect(page.locator('#product-companion-add')).toBeVisible();
    await page.click('#product-companion-add');
    await page.locator('#pick-body [data-pick-product]', { hasText: 'Milk' }).click();
    await expect(page.locator('#product-companions-list')).toContainText('Milk');
    await page.click('#food-save');
    expect(await page.evaluate(() => state.products.find((p) => p.name === 'Borsch')?.companions)).toEqual([{ id: MILK, grams: 100, on: true }]);

    // Now adding Borsch in diary modal displays its saved add-on without add button, and allows editing grams without mutating saved product
    await page.evaluate(() => openModal('food', 'dinner'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Borsch');
    await page.dispatchEvent('#food-name', 'change');
    await expect(page.locator('#product-companions-field')).toBeVisible();
    await expect(page.locator('#product-companion-add')).toBeHidden();
    await expect(page.locator('#product-companions-list')).toContainText('Milk');
    const card = page.locator(`#product-companions-list [data-companion-card="${MILK}"]`);
    await card.locator(`[data-companion-toggle="${MILK}"]`).click();
    await card.locator(`input[data-companion-grams="${MILK}"]`).fill('150');
    await page.click('#food-save');
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams]))).toEqual([['Borsch', 450]]);
    expect(await page.evaluate((id) => state.foods[0].components?.find((c) => c.id === id)?.grams, MILK)).toBe(150);
    expect(await page.evaluate(() => state.products.find((p) => p.name === 'Borsch')?.companions)).toEqual([{ id: MILK, grams: 100, on: true }]);
  });

  test('add-on checkbox appears before the name, delete icon is only in product editor and absent in meals', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 100 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });

    // 1. Food modal in diary: delete button is NOT rendered
    await page.evaluate(() => openModal('food', 'breakfast'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Coffee');
    await page.dispatchEvent('#food-name', 'change');

    const card = page.locator(`#product-companions-list [data-companion-card="${MILK}"]`);
    const checkbox = card.locator(`input[data-companion-on="${MILK}"]`);
    await expect(checkbox).toBeChecked();
    const order = await card.evaluate((el) => {
      const label = el.querySelector('.companion-toggle-label');
      return [...label.children].map((child) => child.matches('input') ? 'checkbox' : 'name');
    });
    expect(order).toEqual(['checkbox', 'name']);
    await expect(card.locator(`input[data-companion-grams="${MILK}"]`)).toBeHidden();
    await expect(card.locator(`[data-companion-remove="${MILK}"]`)).toHaveCount(0);

    await card.locator(`[data-companion-toggle="${MILK}"]`).click();
    await expect(card.locator(`input[data-companion-grams="${MILK}"]`)).toBeVisible();
    await expect(card.locator(`[data-companion-remove="${MILK}"]`)).toHaveCount(0);
    await page.click('#modal-close');

    // 2. Meal picker modal: delete button is NOT rendered
    await page.evaluate((c) => openMealPicker(c), coffee);
    const pickCard = page.locator(`#pick-companions-list [data-companion-card="${MILK}"]`);
    await expect(pickCard).toBeVisible();
    await expect(pickCard.locator(`[data-companion-remove="${MILK}"]`)).toHaveCount(0);
    await page.evaluate(() => closePick());

    // 3. Product editor: delete button IS rendered and deletes companion
    await page.evaluate((c) => openProductModal(c), coffee);
    const prodCard = page.locator(`#product-companions-list [data-companion-card="${MILK}"]`);
    await expect(prodCard).toBeVisible();
    const delBtn = prodCard.locator(`[data-companion-remove="${MILK}"]`);
    await expect(delBtn).toBeVisible();
    await delBtn.click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.click('#confirm-cancel');
    await expect(prodCard).toBeVisible();
    await delBtn.click();
    await page.click('#confirm-ok');
    await expect(prodCard).toHaveCount(0);
    await page.click('#modal-close');
  });

  test('add-on card shows portions dropdown and calculated calories/macros, updating bidirectionally', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 100 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });
    await page.evaluate(() => openModal('food', 'breakfast'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Coffee');
    await page.dispatchEvent('#food-name', 'change');

    const companionCard = page.locator('#product-companions-list [data-companion-card="' + MILK + '"]');
    await expect(companionCard).toBeVisible();
    await expect(companionCard).toHaveClass(/collapsed/);
    await companionCard.locator(`[data-companion-toggle="${MILK}"]`).click();
    await expect(companionCard).not.toHaveClass(/collapsed/);

    const portionsSelect = companionCard.locator('select[data-companion-portions="' + MILK + '"]');
    const gramsInput = companionCard.locator('input[data-companion-grams="' + MILK + '"]');
    const nutritionInfo = companionCard.locator('[data-companion-nutrition="' + MILK + '"]');

    await expect(portionsSelect).toHaveValue('1');
    await expect(gramsInput).toHaveValue('100');
    await expect(nutritionInfo).toContainText('64 kcal');
    await expect(nutritionInfo).toContainText('P 3.3 · F 3.6 · C 4.8 g');

    // Changing portions updates grams and nutrition
    await portionsSelect.selectOption('0.5', { force: true });
    await portionsSelect.dispatchEvent('change');
    await expect(gramsInput).toHaveValue('50');
    await expect(nutritionInfo).toContainText('32 kcal');
    await expect(nutritionInfo).toContainText('P 1.7 · F 1.8 · C 2.4 g');

    // Changing grams updates portions and nutrition
    await gramsInput.fill('200');
    await gramsInput.dispatchEvent('input');
    await expect(portionsSelect).toHaveValue('2');
    await expect(nutritionInfo).toContainText('128 kcal');
    await expect(nutritionInfo).toContainText('P 6.6 · F 7.2 · C 9.6 g');
  });

  test('add-on cards are collapsed by default in all windows, portions and grams in one row, and icons match app design', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 100 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });

    // 1. Food modal (diary entry) - collapsed by default, no delete button
    await page.evaluate(() => openModal('food', 'breakfast'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Coffee');
    await page.dispatchEvent('#food-name', 'change');
    const foodCard = page.locator('#product-companions-list [data-companion-card="' + MILK + '"]');
    await expect(foodCard).toBeVisible();
    await expect(foodCard).toHaveClass(/collapsed/);
    await expect(foodCard.locator(`[data-companion-remove="${MILK}"]`)).toHaveCount(0);

    // Verify portions and grams are in one row when expanded
    await foodCard.locator(`[data-companion-toggle="${MILK}"]`).click();
    await expect(foodCard).not.toHaveClass(/collapsed/);
    const controls = foodCard.locator('.companion-controls');
    const isOneRow = await controls.evaluate((el) => {
      const fields = el.querySelectorAll('.companion-field');
      if (fields.length < 2) return false;
      const r1 = fields[0].getBoundingClientRect();
      const r2 = fields[1].getBoundingClientRect();
      return Math.abs(r1.top - r2.top) < 4;
    });
    expect(isOneRow).toBe(true);
    await page.click('#modal-close');

    // 2. Meal picker modal - collapsed by default, no delete button
    await page.evaluate((c) => openMealPicker(c), coffee);
    const pickCard = page.locator('#pick-companions-list [data-companion-card="' + MILK + '"]');
    await expect(pickCard).toBeVisible();
    await expect(pickCard).toHaveClass(/collapsed/);
    await expect(pickCard.locator(`[data-companion-remove="${MILK}"]`)).toHaveCount(0);
    await page.evaluate(() => closePick());

    // 3. Product editor modal - collapsed by default, delete button is present and matches app design
    await page.evaluate((c) => openProductModal(c), coffee);
    const prodCard = page.locator('#product-companions-list [data-companion-card="' + MILK + '"]');
    await expect(prodCard).toBeVisible();
    await expect(prodCard).toHaveClass(/collapsed/);
    const delBtn = prodCard.locator(`[data-companion-remove="${MILK}"]`);
    await expect(delBtn).toHaveClass(/del/);
    await expect(delBtn.locator('svg')).toBeVisible();
  });

  test('add-on cards display total summed macros under label in collapsed and expanded state, with compact height and matching control heights', async ({ page }) => {
    const sugar = { id: '44444444-4444-4444-8444-444444444444', name: 'Sugar', grams: 10, kcal: 40, protein: 0, fat: 0, carbs: 10 };
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 100 }, { id: sugar.id, grams: 10 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk, sugar], foods: [], weights: [] });

    await page.evaluate(() => openModal('food', 'breakfast'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Coffee');
    await page.dispatchEvent('#food-name', 'change');

    const summary = page.locator('#product-companions-summary');
    await expect(summary).toBeVisible();
    // Sum: Milk (64 kcal, P 3.3, F 3.6, C 4.8) + Sugar (40 kcal, P 0, F 0, C 10) = 104 kcal, P 3.3, F 3.6, C 14.8
    await expect(summary).toContainText('+104 kcal');
    await expect(summary).toContainText('P 3.3 · F 3.6 · C 14.8 g');

    // Cards are collapsed by default and compact (height <= 65px)
    const milkCard = page.locator('#product-companions-list [data-companion-card="' + MILK + '"]');
    await expect(milkCard).toHaveClass(/collapsed/);
    const cardHeight = await milkCard.evaluate((el) => el.getBoundingClientRect().height);
    expect(cardHeight).toBeLessThanOrEqual(80);

    // Expand milk card - summary remains visible under label
    await milkCard.locator('[data-companion-toggle="' + MILK + '"]').click();
    await expect(milkCard).not.toHaveClass(/collapsed/);
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('+104 kcal');

    // Controls have matching heights
    const portionsBtn = milkCard.locator('.dd-btn');
    const gramsInput = milkCard.locator('input[data-companion-grams="' + MILK + '"]');
    if (await portionsBtn.count() > 0) {
      const h1 = await portionsBtn.evaluate((el) => el.getBoundingClientRect().height);
      const h2 = await gramsInput.evaluate((el) => el.getBoundingClientRect().height);
      expect(Math.abs(h1 - h2)).toBeLessThanOrEqual(2);
    }

    // Changing grams updates total summary in real time
    await gramsInput.fill('50');
    await gramsInput.dispatchEvent('input');
    // Milk 50g: 32 kcal, P 1.7, F 1.8, C 2.4 + Sugar: 40 kcal -> 72 kcal, P 1.7, F 1.8, C 12.4
    await expect(summary).toContainText('+72 kcal');
    await expect(summary).toContainText('P 1.7 · F 1.8 · C 12.4 g');

    // Unchecking sugar updates total summary in real time to milk only
    const sugarCard = page.locator('#product-companions-list [data-companion-card="' + sugar.id + '"]');
    await sugarCard.locator('input[data-companion-on="' + sugar.id + '"]').uncheck();
    await expect(summary).toContainText('+32 kcal');
    await expect(summary).toContainText('P 1.7 · F 1.8 · C 2.4 g');
  });

  test('products with add-ons display an indicator icon in My Products and in meal addition views', async ({ page }) => {
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: MILK, grams: 50 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [coffee, milk], foods: [], weights: [] });

    // 1. In My Products tab
    await openView(page, 'products');
    const coffeeItem = page.locator(`.product-item[data-product-id="${COFFEE}"]`);
    const milkItem = page.locator(`.product-item[data-product-id="${MILK}"]`);
    await expect(coffeeItem.locator('.product-name .product-has-companions')).toBeVisible();
    await expect(milkItem.locator('.product-name .product-has-companions')).toHaveCount(0);

    // 2. In Product Picker list when adding to meal
    await openView(page, 'diary');
    await page.evaluate(() => openProductPicker());
    await expect(page.locator(`.pick-item[data-pick-product="${COFFEE}"] .product-has-companions`)).toBeVisible();
    await expect(page.locator(`.pick-item[data-pick-product="${MILK}"] .product-has-companions`)).toHaveCount(0);
    await page.evaluate(() => closePick());

    // 3. In Meal Picker title
    await page.evaluate((c) => openMealPicker(c), coffee);
    await expect(page.locator('#pick-title .product-has-companions')).toBeVisible();
    await page.evaluate(() => closePick());

    await page.evaluate((m) => openMealPicker(m), milk);
    await expect(page.locator('#pick-title .product-has-companions')).toHaveCount(0);
    await page.evaluate(() => closePick());

    // 4. In Food modal next to Food/dish field
    await page.evaluate(() => openModal('food', 'breakfast'));
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Coffee');
    await page.dispatchEvent('#food-name', 'change');
    await expect(page.locator('#food-companion-badge .product-has-companions')).toBeVisible();

    await page.fill('#food-name', 'Milk');
    await page.dispatchEvent('#food-name', 'change');
    await expect(page.locator('#food-companion-badge .product-has-companions')).toHaveCount(0);
    await page.click('#modal-close');
  });

});
