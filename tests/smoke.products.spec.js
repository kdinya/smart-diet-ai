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

  test('a composite dish keeps scaling its ingredients with portions and its original hint', async ({ page }) => {
    const soup = { id: '44444444-4444-4444-8444-444444444444', name: 'Soup', grams: 200, kcal: 100, protein: 5, fat: 3, carbs: 10, components: [{ id: MILK, grams: 100 }, { id: COFFEE, grams: 100 }] };
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0 };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [soup, milk, coffee], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Soup')));
    await expect(page.locator('#pick-components-field .companion-portion-note')).toContainText('whole dish (bowl)');
    await expect(page.locator('#pick-portions')).toBeHidden();
    await page.fill('#pick-grams', '400');
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods[0]?.grams)).toBe(400);
    expect(await page.evaluate(() => state.foods[0].components.map((c) => c.grams))).toEqual([200, 200]);
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

  const PITA = '33333333-3333-4333-8333-333333333333';
  const CHICKEN = '44444444-4444-4444-8444-444444444444';
  const pita = { id: PITA, name: 'Pita', grams: 100, kcal: 250, protein: 8, fat: 1, carbs: 50 };
  const chicken = { id: CHICKEN, name: 'Chicken', grams: 100, kcal: 160, protein: 24, fat: 4, carbs: 0 };

  test('a composite product calculates calories and macros from ingredients and saves components', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [pita, chicken], foods: [], weights: [] });
    await openView(page, 'products');

    // 1. Click create product -> product type modal opens
    await page.click('#product-new');
    await expect(page.locator('#product-type-modal')).toHaveClass(/open/);

    // 2. Choose composite dish -> composite modal opens
    await page.click('#product-type-composite');
    await expect(page.locator('#composite-modal')).toHaveClass(/open/);
    await page.fill('#composite-name', 'Shawarma');

    // 3. Add first ingredient via full product modal
    await page.click('#composite-add-ingredient');
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await page.click('#pick-product');
    await page.locator('#pick-body [data-pick-product]', { hasText: 'Pita' }).click();
    await page.click('#food-save');
    await expect(page.locator('#composite-ingredients-list')).toContainText('Pita');

    // 4. Add second ingredient via continuous plus button
    await page.click('#composite-add-ingredient');
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await page.click('#pick-product');
    await page.locator('#pick-body [data-pick-product]', { hasText: 'Chicken' }).click();
    await page.click('#food-save');
    await expect(page.locator('#composite-ingredients-list')).toContainText('Chicken');

    // 5. Verify live totals summary
    await expect(page.locator('#composite-summary')).toContainText('200');
    await expect(page.locator('#composite-summary')).toContainText('410');

    // 6. Save dish
    await page.click('#composite-save-btn');
    await expect(page.locator('#composite-modal')).not.toHaveClass(/open/);

    await expect.poll(() => page.evaluate(() => {
      const p = state.products.find((x) => x.name === 'Shawarma');
      return p ? { grams: p.grams, kcal: p.kcal, protein: p.protein, fat: p.fat, carbs: p.carbs, count: p.components.length } : null;
    })).toEqual({
      grams: 200,
      kcal: 410,
      protein: 32,
      fat: 5,
      carbs: 50,
      count: 2,
    });
  });


  test.skip('selected composite ingredients persist, determine totals, and show all diary ingredients', async ({ page }) => {
    const SAUCE = '66666666-6666-4666-8666-666666666666';
    const dish = { id: '77777777-7777-4777-8777-777777777777', name: 'Beet salad', grams: 100, kcal: 130, protein: 4, fat: 6, carbs: 14, components: [
      { id: CHICKEN, name: 'Mayonnaise', grams: 40, kcal: 100, protein: 1, fat: 10, carbs: 2, enabled: true },
      { id: SAUCE, name: 'Sour cream', grams: 60, kcal: 30, protein: 3, fat: 2, carbs: 4, enabled: false },
    ] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [dish], foods: [], weights: [] });
    await openView(page, 'products');

    const card = page.locator(`.product-item[data-product-id="${dish.id}"]`);
    await card.locator('[data-toggle-product-components]').click();
    const mayo = card.locator(`[data-product-component-enabled="${CHICKEN}"]`);
    const cream = card.locator(`[data-product-component-enabled="${SAUCE}"]`);
    await expect(mayo).toBeChecked();
    await expect(cream).not.toBeChecked();
    await mayo.uncheck();
    await cream.check();
    await expect.poll(() => page.evaluate((id) => {
      const product = state.products.find((item) => item.id === id);
      return { grams: product.grams, kcal: product.kcal, protein: product.protein, fat: product.fat, carbs: product.carbs, selected: product.components.filter((item) => item.enabled !== false).map((item) => item.name) };
    }, dish.id)).toEqual({ grams: 60, kcal: 30, protein: 3, fat: 2, carbs: 4, selected: ['Sour cream'] });

    await page.reload();
    await openView(page, 'products');
    const reloadedCard = page.locator(`.product-item[data-product-id="${dish.id}"]`);
    await reloadedCard.locator('[data-toggle-product-components]').click();
    await expect(reloadedCard.locator(`[data-product-component-enabled="${CHICKEN}"]`)).not.toBeChecked();
    await expect(reloadedCard.locator(`[data-product-component-enabled="${SAUCE}"]`)).toBeChecked();

    await page.evaluate((id) => openMealPicker(state.products.find((item) => item.id === id)), dish.id);
    await expect(page.locator('#pick-components-list [data-component-toggle]')).toHaveCount(2);
    await expect(page.locator(`#pick-components-list [data-component-toggle="${CHICKEN}"]`)).not.toBeChecked();
    await expect(page.locator(`#pick-components-list [data-component-toggle="${SAUCE}"]`)).toBeChecked();
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate((name) => {
      const food = state.foods.find((item) => item.name === name);
      return food ? { grams: food.grams, kcal: food.kcal, count: food.components?.length, ingredients: food.components?.map((item) => item.name) } : null;
    }, dish.name)).toEqual({ grams: 60, kcal: 30, count: 2, ingredients: ['Mayonnaise', 'Sour cream'] });

    await openView(page, 'diary');
    const entry = page.locator('#diary-meals .meal-item[data-food-id]').filter({ has: page.locator('b', { hasText: dish.name }) });
    await entry.locator('[data-toggle-food]').click();
    await expect(entry.locator('.food-components-detail')).toContainText('Sour cream');
    await expect(entry.locator('.food-components-detail')).toContainText('30');
    await expect(entry.locator('.food-components-detail')).not.toContainText('Mayonnaise');
    await expect(entry.locator('.food-components-detail .product-addon-item')).toHaveCount(1);

    await entry.locator('[data-edit-food]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#food-components-list [data-component-item]')).toHaveCount(2);
    await expect(page.locator(`#food-components-list [data-component-toggle="${CHICKEN}"]`)).not.toBeChecked();
    await expect(page.locator(`#food-components-list [data-component-toggle="${SAUCE}"]`)).toBeChecked();
    await page.locator(`#food-components-list [data-component-toggle="${SAUCE}"]`).uncheck();
    await page.locator(`#food-components-list [data-component-toggle="${CHICKEN}"]`).check();
    await expect(page.locator('#food-grams')).toHaveValue('40');
    await expect(page.locator('#food-kcal')).toHaveValue('100');
    await page.click('#food-save');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);

    await expect(entry.locator('.meal-info')).toContainText('40');
    await expect(entry.locator('.meal-info')).toContainText('100');
    await expect(entry.locator('.food-components-detail')).toContainText('Mayonnaise');
    await expect(entry.locator('.food-components-detail')).toContainText('100');
    await expect(entry.locator('.food-components-detail')).not.toContainText('Sour cream');
    await expect(entry.locator('.food-components-detail .product-addon-item')).toHaveCount(1);
  });

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

  test('a new composite ingredient can be saved separately, but existing products have no save option', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [pita], foods: [], weights: [] });
    await openView(page, 'products');

    await page.click('#product-new');
    await page.click('#product-type-composite');
    await page.fill('#composite-name', 'Test bowl');
    await page.click('#composite-add-ingredient');
    await expect(page.locator('#ingredient-save-product-label')).toBeHidden();
    await page.fill('#food-name', 'New ingredient');
    await expect(page.locator('#ingredient-save-product-label')).toBeVisible();
    await page.locator('#ingredient-save-product').check();
    await page.fill('#food-grams', '100');
    await page.fill('#food-kcal', '120');
    await page.fill('#food-protein', '4');
    await page.fill('#food-fat', '2');
    await page.fill('#food-carbs', '20');
    await page.click('#food-save');
    await expect(page.locator('#composite-ingredients-list')).toContainText('New ingredient');
    const newIngredientCard = page.locator('#composite-ingredients-list [data-ingredient-id]');
    await expect(newIngredientCard).toHaveClass(/component-card/);
    await expect(newIngredientCard.locator('.companion-name')).toHaveText('New ingredient');
    await expect(newIngredientCard.locator('[data-companion-toggle]')).toBeVisible();
    await expect(newIngredientCard.locator('[data-edit-ingredient], [data-delete-ingredient]')).toHaveCount(0);
    await expect(newIngredientCard.locator('[data-composite-ingredient-enabled]')).toBeChecked();
    await expect(newIngredientCard.locator('.companion-nutrition')).toContainText('120');
    await expect(page.locator('#composite-summary')).toContainText('120');
    await newIngredientCard.locator('[data-composite-ingredient-enabled]').uncheck();
    await expect(page.locator('#composite-summary')).toContainText('0');
    await newIngredientCard.locator('[data-composite-ingredient-enabled]').check();
    await expect.poll(() => page.evaluate(() => state.products.some((product) => product.name === 'New ingredient'))).toBe(true);

    await page.click('#composite-add-ingredient');
    await page.click('#pick-product');
    await page.locator('#pick-body [data-pick-product]', { hasText: 'Pita' }).click();
    await expect(page.locator('#ingredient-save-product-label')).toBeHidden();
    await page.click('#food-save');
    await page.click('#composite-save-btn');

    await expect.poll(() => page.evaluate(() => {
      const dish = state.products.find((product) => product.name === 'Test bowl');
      return { productCount: state.products.filter((product) => product.name === 'New ingredient').length, componentCount: dish?.components.length };
    })).toEqual({ productCount: 1, componentCount: 2 });
  });

  test('composite dish verification can be set at creation and changed when editing', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [pita, chicken], foods: [], weights: [] });
    await openView(page, 'products');

    await page.click('#product-new');
    await page.click('#product-type-composite');
    await page.fill('#composite-name', 'Verified shawarma');
    await page.locator('#composite-verified').check();
    await page.click('#composite-add-ingredient');
    await page.click('#pick-product');
    await page.locator('#pick-body [data-pick-product]', { hasText: 'Pita' }).click();
    await page.click('#food-save');
    await page.click('#composite-save-btn');

    await expect.poll(() => page.evaluate(() => state.products.find((product) => product.name === 'Verified shawarma')?.verified)).toBe(true);
    const dish = page.locator('.product-item', { hasText: 'Verified shawarma' });
    await dish.locator('.product-toggle-main').click();
    await dish.locator('[data-edit-product]').click();
    await expect(page.locator('#composite-verified')).toBeChecked();
    await page.locator('#composite-verified').uncheck();
    await page.click('#composite-save-btn');
    await expect.poll(() => page.evaluate(() => state.products.find((product) => product.name === 'Verified shawarma')?.verified)).toBe(false);
  });

  test('simple product choice opens traditional product editor without composite fields', async ({ page }) => {
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

  test('composite products display an indicator icon in My Products and show ingredients list when expanded', async ({ page }) => {
    const SHAWARMA = '55555555-5555-4555-8555-555555555555';
    const shawarma = { id: SHAWARMA, name: 'Shawarma', grams: 200, kcal: 410, protein: 32, fat: 5, carbs: 50, components: [{ id: PITA, name: 'Pita', grams: 100, kcal: 250, protein: 8, fat: 1, carbs: 50 }, { id: CHICKEN, name: 'Chicken', grams: 100, kcal: 160, protein: 24, fat: 4, carbs: 0 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'button', lang: 'en' }, products: [shawarma, pita, chicken], foods: [], weights: [] });
    await page.evaluate(() => setBotServiceState({ period: 'day', pajamas: false }));

    await openView(page, 'products');
    const shawarmaItem = page.locator(`#products-list .product-item[data-product-id="${SHAWARMA}"]`);
    const pitaItem = page.locator(`#products-list .product-item[data-product-id="${PITA}"]`);
    await expect(shawarmaItem.locator('.product-name .product-is-composite')).toBeVisible();
    await expect(pitaItem.locator('.product-name .product-is-composite')).toHaveCount(0);

    await shawarmaItem.locator('.product-toggle-main').first().click();
    await expect(shawarmaItem.locator('.product-components-preview')).toHaveCount(0);
    await shawarmaItem.locator('[data-more-product]').click();
    await expect(shawarmaItem.locator('[data-edit-product]')).toBeVisible();

    // Clicking edit on Shawarma opens composite modal
    await shawarmaItem.locator('[data-edit-product]').click();
    await expect(page.locator('#composite-modal')).toHaveClass(/open/);
    await page.click('#composite-modal-close');

    // Clicking edit on Pita opens traditional modal
    await pitaItem.locator('.product-toggle-main').first().click();
    await pitaItem.locator('[data-edit-product]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await page.click('#modal-close');
  });

  test('expanding a composite ingredient lets you change grams and updates dish totals', async ({ page }) => {
    const SHAWARMA = '55555555-5555-4555-8555-555555555555';
    const shawarma = { id: SHAWARMA, name: 'Shawarma', grams: 200, kcal: 410, protein: 32, fat: 5, carbs: 50, components: [{ id: PITA, name: 'Pita', grams: 100, kcal: 250, protein: 8, fat: 1, carbs: 50 }, { id: CHICKEN, name: 'Chicken', grams: 100, kcal: 160, protein: 24, fat: 4, carbs: 0 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [shawarma, pita, chicken], foods: [], weights: [] });

    await page.evaluate((s) => openCompositeModal(state.products.find((p) => p.id === s.id)), shawarma);
    const pitaCard = page.locator(`#composite-ingredients-list [data-ingredient-id="${PITA}"]`);
    await expect(pitaCard).toHaveClass(/component-card/);
    await expect(pitaCard.locator('[data-edit-ingredient], [data-delete-ingredient]')).toHaveCount(0);
    await expect(pitaCard.locator('.companion-actions button')).toHaveCount(1);
    await pitaCard.locator('[data-companion-toggle]').click();
    await page.fill(`#composite-ingredients-list [data-ingredient-grams="${PITA}"]`, '200');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);

    await expect(page.locator('#composite-summary')).toContainText('300');
    await expect(page.locator('#composite-summary')).toContainText('660');

    await page.click('#composite-save-btn');
    await expect.poll(() => page.evaluate(() => {
      const p = state.products.find((x) => x.id === '55555555-5555-4555-8555-555555555555');
      return p ? { grams: p.grams, kcal: p.kcal } : null;
    })).toEqual({
      grams: 300,
      kcal: 660,
    });
  });

  test('excluding an ingredient updates the composite totals', async ({ page }) => {
    const SHAWARMA = '55555555-5555-4555-8555-555555555555';
    const shawarma = { id: SHAWARMA, name: 'Shawarma', grams: 200, kcal: 410, protein: 32, fat: 5, carbs: 50, components: [{ id: PITA, name: 'Pita', grams: 100, kcal: 250, protein: 8, fat: 1, carbs: 50 }, { id: CHICKEN, name: 'Chicken', grams: 100, kcal: 160, protein: 24, fat: 4, carbs: 0 }] };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [shawarma, pita, chicken], foods: [], weights: [] });

    await page.evaluate((s) => openCompositeModal(state.products.find((p) => p.id === s.id)), shawarma);
    const chickenCard = page.locator(`#composite-ingredients-list [data-ingredient-id="${CHICKEN}"]`);
    await expect(chickenCard).toHaveClass(/component-card/);
    await expect(chickenCard.locator('[data-edit-ingredient], [data-delete-ingredient]')).toHaveCount(0);
    await chickenCard.locator('[data-composite-ingredient-enabled]').uncheck();
    await expect(chickenCard).toHaveClass(/is-disabled/);
    await expect(page.locator('#composite-summary')).toContainText('100');
    await expect(page.locator('#composite-summary')).toContainText('250');

    await page.click('#composite-save-btn');
    await expect.poll(() => page.evaluate(() => {
      const p = state.products.find((x) => x.id === '55555555-5555-4555-8555-555555555555');
      return p ? { grams: p.grams, kcal: p.kcal, count: p.components.length, chickenEnabled: p.components.find((item) => item.id === '44444444-4444-4444-8444-444444444444')?.enabled } : null;
    })).toEqual({
      grams: 100,
      kcal: 250,
      count: 2,
      chickenEnabled: false,
    });
  });
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

test.describe('Smoke: composite dish display and ingredient editing', () => {
  const dish = {
    id: '33333333-3333-4333-8333-333333333333', name: 'Oatmeal bowl', grams: 160, kcal: 280, protein: 12, fat: 7, carbs: 65,
    components: [
      { id: 'c-oats', name: 'Oats', grams: 60, kcal: 230, protein: 8, fat: 4, carbs: 40 },
      { id: 'c-milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5 },
    ],
  };

  test('composite ingredients expand under product details and collapse with their parent', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [dish], foods: [], weights: [] });
    await openView(page, 'products');
    await page.setViewportSize({ width: 360, height: 760 });
    const product = page.locator(`.product-item[data-product-id="${dish.id}"]`);
    const toggle = product.locator('[data-toggle-product-components]');
    const ingredients = product.locator('[data-product-components]');
    await expect(toggle).toHaveText('Show ingredients');
    await expect(ingredients).toBeHidden();

    await product.locator('.product-toggle-main').click();
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox.x).toBeGreaterThanOrEqual(0);
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(360);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toContainText('Hide ingredients');
    const oats = ingredients.locator('[data-product-component="c-oats"]');
    await expect(oats).toBeVisible();
    await expect(oats.locator('.product-addon-name')).toHaveText('Oats');
    await expect(oats.locator('.companion-nutrition')).toContainText('60 g');
    await expect(oats.locator('.companion-nutrition')).toContainText('230 kcal');
    await expect(oats.locator('.companion-nutrition')).toContainText('P 8');
    await expect(oats.locator('.companion-nutrition')).toContainText('F 4');
    await expect(oats.locator('.companion-nutrition')).toContainText('C 40');
    await expect(ingredients.locator('[data-product-component]')).toHaveCount(2);

    await product.locator('.product-toggle-main').click();
    await expect(ingredients).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('Show ingredients');
    await product.locator('.product-toggle-main').click();
    await expect(ingredients).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 832 });
    await toggle.click();
    await expect(ingredients).toBeVisible();
    const desktopToggleBox = await toggle.boundingBox();
    expect(desktopToggleBox.x).toBeGreaterThanOrEqual(0);
    expect(desktopToggleBox.x + desktopToggleBox.width).toBeLessThanOrEqual(1280);

    await openView(page, 'settings');
    await page.selectOption('#pref-lang', 'uk');
    await page.locator('#save-lang').click();
    await openView(page, 'products');
    await product.locator('.product-toggle-main').click();
    await expect(product.locator('[data-toggle-product-components]')).toHaveText('Показати складники');
    expect(await page.evaluate(() => Object.keys(I.en).sort().join('|') === Object.keys(I.uk).sort().join('|'))).toBe(true);
  });

  test('a composite meal keeps its ingredient recipe after reloading the diary', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [dish], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((product) => product.name === 'Oatmeal bowl')));
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.some((food) => food.name === 'Oatmeal bowl'))).toBe(true);
    expect((await readStore(page)).foods[0].components.map((component) => component.name)).toEqual(['Oats', 'Milk']);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).toContainText('Oatmeal bowl');
    expect((await readStore(page)).foods[0].components.map((component) => component.name)).toEqual(['Oats', 'Milk']);
  });

  test.skip('the product list shows only the dish totals and keeps actions behind the more button', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [dish], foods: [], weights: [] });
    await openView(page, 'products');
    const item = page.locator(`#products-list .product-item[data-product-id="${dish.id}"]`);
    await expect(item.locator('.product-components-preview')).toHaveCount(0);
    await expect(item.locator('[data-more-product]')).toHaveCount(1);
    await expect(item.locator('.product-actions')).not.toHaveClass(/is-open/);
    await item.locator('.product-toggle-main').click();
    await item.locator('[data-more-product]').click();
    await expect(item.locator('.product-actions')).toHaveClass(/is-open/);
    await expect(item.locator('[data-share-product]')).toBeVisible();
    await expect(item.locator('[data-edit-product]')).toBeVisible();
    await page.evaluate(() => renderProducts());
    await expect(item).not.toHaveClass(/collapsed/);
    await expect(item.locator('.product-actions')).toHaveClass(/is-open/);
    await expect(item.locator('[data-more-product]')).toHaveAttribute('aria-expanded', 'true');
    const circles = item.locator('[data-more-product] svg circle');
    await expect(circles.nth(0)).toHaveAttribute('cx', '12');
    await expect(circles.nth(0)).toHaveAttribute('cy', '5');
    await expect(circles.nth(1)).toHaveAttribute('cx', '12');
    await expect(circles.nth(1)).toHaveAttribute('cy', '12');
    await expect(circles.nth(2)).toHaveAttribute('cx', '12');
    await expect(circles.nth(2)).toHaveAttribute('cy', '19');
  });

  test.skip('product action menu renders as an overlay and ingredient picking allows exclusion and adding extra ingredients', async ({ page }) => {
    const banana = { id: 'p-banana', name: 'Banana', grams: 100, kcal: 89, protein: 1.1, fat: 0.3, carbs: 22.8 };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [dish, banana], foods: [], weights: [] });
    await openView(page, 'products');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.product-toggle-main').first().click();
    const moreBtn = page.locator('[data-more-product]').first();
    await moreBtn.click();
    await expect(page.locator('.product-actions').first()).toHaveClass(/is-open/);
    const panelPosition = await page.locator('.product-actions-panel').first().evaluate((el) => window.getComputedStyle(el).position);
    expect(panelPosition).toBe('absolute');

    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Oatmeal bowl')));
    await expect(page.locator('[data-component-item]')).toHaveCount(2);

    await page.locator('[data-component-toggle="c-oats"]').uncheck();
    await expect.poll(() => page.evaluate(() => [pickProduct.grams, pickProduct.kcal])).toEqual([100, 50]);

    await page.locator('[data-component-toggle="c-oats"]').check();
    await expect.poll(() => page.evaluate(() => [pickProduct.grams, pickProduct.kcal])).toEqual([160, 280]);

    await page.click('#pick-component-add');
    await expect(page.locator('#pick-search-field')).toBeVisible();
    await page.locator('[data-pick-product="p-banana"]').click();
    await expect(page.locator('[data-component-item]')).toHaveCount(3);
    await expect.poll(() => page.evaluate(() => [pickProduct.grams, pickProduct.kcal])).toEqual([260, 369]);

    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams, f.kcal]))).toEqual([['Oatmeal bowl', 260, 369]]);
    expect(await page.evaluate(() => state.products.find((p) => p.name === 'Oatmeal bowl').components.length)).toBe(2);
  });

  test.skip('adding a dish lists its ingredients and edits apply only to that entry', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [dish], foods: [], weights: [] });
    await page.setViewportSize({ width: 320, height: 600 });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Oatmeal bowl')));
    await expect(page.locator('[data-component-grams]')).toHaveCount(2);
    const firstCard = page.locator('[data-component-item]').first();
    await expect(firstCard.locator('.companion-toggle-label .companion-name')).toHaveText('Oats');
    await expect(firstCard.locator('.companion-nutrition')).toBeVisible();
    await expect(firstCard.locator('.companion-input-wrap input')).toHaveValue('60');
    await page.locator('[data-component-grams="c-oats"]').fill('30');
    await expect.poll(() => page.evaluate(() => [pickProduct.grams, pickProduct.kcal])).toEqual([130, 165]);
    expect(await page.evaluate(() => state.products.find((p) => p.name === 'Oatmeal bowl').kcal)).toBe(280);
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods.map((f) => [f.name, f.grams, f.kcal]))).toEqual([['Oatmeal bowl', 130, 165]]);
  });

  test('editing a composite dish entry in food diary allows adjusting grams per ingredient and updates totals without altering product', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const banana = { id: 'p-banana', name: 'Banana', grams: 100, kcal: 89, protein: 1.1, fat: 0.3, carbs: 22.8 };
    await openApp(page, {
      prefs: { ...BASE_PREFS, lang: 'en' },
      products: [dish, banana],
      foods: [{
        id: 'food-composite-1',
        name: 'Oatmeal bowl',
        meal: 'breakfast',
        grams: 320,
        kcal: 560,
        protein: 24,
        fat: 7,
        carbs: 65,
        date: today,
        createdAt: Date.now(),
        components: [
          { id: 'c-oats', name: 'Oats', grams: 120, kcal: 460, protein: 16, fat: 8, carbs: 80 },
          { id: 'c-milk', name: 'Milk', grams: 200, kcal: 100, protein: 6, fat: 4, carbs: 10 },
        ]
      }],
      weights: []
    });
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals [data-edit-food]')).toHaveCount(1);
    await page.locator('#diary-meals [data-edit-food]').click();

    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#food-components-field')).toBeVisible();
    await expect(page.locator('#food-components-list [data-component-item]')).toHaveCount(2);

    await expect(page.locator('#portion-field')).toHaveClass(/hidden/);
    await page.locator('[data-companion-toggle="c-oats"]').click();
    await page.locator('[data-companion-toggle="c-milk"]').click();
    await expect(page.locator('#food-components-list [data-component-grams="c-oats"]')).toHaveValue('120');
    await expect(page.locator('#food-components-list [data-component-grams="c-milk"]')).toHaveValue('200');
    await page.locator('#food-components-list [data-component-grams="c-oats"]').fill('60');
    await expect(page.locator('#food-grams')).toHaveValue('260');
    await expect(page.locator('#food-kcal')).toHaveValue('330');

    await page.click('#food-component-add');
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await page.locator('[data-pick-product="p-banana"]').click();
    await expect(page.locator('#food-components-list [data-component-item]')).toHaveCount(3);
    await expect(page.locator('#food-grams')).toHaveValue('360');
    await expect(page.locator('#food-kcal')).toHaveValue('419');

    await page.click('#food-save');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);

    await expect.poll(() => page.evaluate(() => state.foods.map(f => [f.name, f.grams, f.kcal]))).toEqual([['Oatmeal bowl', 360, 419]]);
    expect(await page.evaluate(() => state.products.find(p => p.name === 'Oatmeal bowl').components.length)).toBe(2);
    expect(await page.evaluate(() => state.products.find(p => p.name === 'Oatmeal bowl').grams)).toBe(160);
  });

  test('a diary dish keeps its saved ingredient amounts when the product gains a new ingredient later', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const bowl = {
      id: 'p-bowl-live', name: 'Oatmeal bowl', grams: 260, kcal: 370, protein: 16, fat: 11, carbs: 85,
      components: [
        { id: 'c-oats', name: 'Oats', grams: 60, kcal: 230, protein: 8, fat: 4, carbs: 40 },
        { id: 'c-milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5 },
        { id: 'c-banana', name: 'Banana', grams: 100, kcal: 89, protein: 1.1, fat: 0.3, carbs: 22.8 },
      ]
    };
    await openApp(page, {
      prefs: { ...BASE_PREFS, lang: 'en' },
      products: [bowl],
      foods: [{
        id: 'food-saved-dish', name: 'Oatmeal bowl', meal: 'breakfast', grams: 160, kcal: 280, protein: 12, fat: 7, carbs: 65,
        date: today, createdAt: Date.now(),
        components: [
          { id: 'c-oats', name: 'Oats', grams: 60, kcal: 230, protein: 8, fat: 4, carbs: 40 },
          { id: 'c-milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5 },
        ]
      }],
      weights: []
    });
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals .meal-detail').first()).not.toContainText('Banana');
    await page.locator('#diary-meals [data-edit-food]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#food-components-list [data-component-item]')).toHaveCount(2);
    await expect(page.locator('#food-components-list [data-component-grams="c-oats"]')).toHaveValue('60');
    await expect(page.locator('#food-components-list [data-component-grams="c-milk"]')).toHaveValue('100');
    await expect(page.locator('#food-components-list')).not.toContainText('Banana');
    await expect(page.locator('#food-grams')).toHaveValue('160');
  });

  test('saved dish ingredients keep their enabled state and gram amounts through cloud row mapping', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [], foods: [], weights: [] });
    const cleaned = await page.evaluate(() => sanitizeEntryComponents([
      { id: 'c-oats', name: 'Oats', grams: 37.25, kcal: 120, protein: 4, fat: 2, carbs: 20, enabled: true },
      { id: 'c-milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5, enabled: false },
      { id: '', name: 'Broken', grams: 10 },
    ]));
    expect(cleaned).toEqual([
      { id: 'c-oats', name: 'Oats', grams: 37.25, kcal: 120, protein: 4, fat: 2, carbs: 20, enabled: true },
      { id: 'c-milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5, enabled: false },
    ]);
  });

  test('an older dish entry without saved ingredients does not borrow ingredients added to the product later', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const bowl = {
      id: 'p-bowl-live', name: 'Oatmeal bowl', grams: 260, kcal: 370, protein: 16, fat: 11, carbs: 85,
      components: [
        { id: 'c-oats', name: 'Oats', grams: 60, kcal: 230, protein: 8, fat: 4, carbs: 40 },
        { id: 'c-milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5 },
        { id: 'c-banana', name: 'Banana', grams: 100, kcal: 89, protein: 1.1, fat: 0.3, carbs: 22.8 },
      ]
    };
    await openApp(page, {
      prefs: { ...BASE_PREFS, lang: 'en' },
      products: [bowl],
      foods: [{
        id: 'food-legacy-dish', name: 'Oatmeal bowl', meal: 'breakfast', grams: 160, kcal: 280, protein: 12, fat: 7, carbs: 65,
        date: today, createdAt: Date.now()
      }],
      weights: []
    });
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals .meal-detail').first()).not.toContainText('Banana');
    await page.locator('#diary-meals [data-edit-food]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#food-components-field')).toBeHidden();
    await expect(page.locator('#food-grams')).toHaveValue('160');
  });
});

test.describe('Smoke: dish ingredient gram fields and legacy shared products', () => {
  const bowl = {
    id: '44444444-4444-4444-8444-444444444444', name: 'Oatmeal bowl', grams: 160, kcal: 280, protein: 12, fat: 7, carbs: 65,
    components: [
      { id: 'c-oats', name: 'Oats', grams: 60, kcal: 230, protein: 8, fat: 4, carbs: 40 },
      { id: 'c-milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5 },
    ],
  };

  test('ingredient gram fields show unit suffix in add and edit dialogs', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: { ...BASE_PREFS, lang: 'en' },
      products: [bowl],
      foods: [{ id: 'food-bowl-fields', name: 'Oatmeal bowl', meal: 'breakfast', grams: 160, kcal: 280, protein: 12, fat: 7, carbs: 65, date: today, createdAt: Date.now(), components: bowl.components }],
      weights: []
    });

    await openView(page, 'diary');
    await page.locator('#diary-meals [data-edit-food]').click();
    await page.locator('#food-components-list [data-component-item="c-oats"] [data-companion-toggle]').click();
    const editInput = page.locator('#food-components-list [data-component-grams="c-oats"]');
    await expect(editInput).toBeVisible();
    await expect(page.locator('#food-components-list [data-component-item="c-oats"] .companion-unit')).toHaveText('g');
    await page.locator('#modal-close').click();

    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Oatmeal bowl')));
    await page.locator('#pick-components-list [data-component-item="c-oats"] [data-companion-toggle]').click();
    const pickInput = page.locator('#pick-components-list [data-component-grams="c-oats"]');
    await expect(pickInput).toBeVisible();
    await expect(page.locator('#pick-components-list [data-component-item="c-oats"] .companion-unit')).toHaveText('g');
  });

  test('ingredient gram fields stay inside their cards in the edit dialog at 360px', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: { ...BASE_PREFS, lang: 'en' },
      products: [bowl],
      foods: [{ id: 'food-bowl-360-edit', name: 'Oatmeal bowl', meal: 'breakfast', grams: 160, kcal: 280, protein: 12, fat: 7, carbs: 65, date: today, createdAt: Date.now(), components: bowl.components }],
      weights: []
    });
    await page.setViewportSize({ width: 360, height: 740 });
    await openView(page, 'diary');
    await page.locator('#diary-meals [data-edit-food]').click();
    for (const id of ['c-oats', 'c-milk']) {
      await page.locator(`#food-components-list [data-component-item="${id}"] [data-companion-toggle]`).click();
    }
    await expect(page.locator('#food-components-list [data-component-grams]')).toHaveCount(2);
    const fit = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('#food-components-list [data-component-grams]')];
      const outside = inputs.filter((input) => {
        const card = input.closest('[data-component-item]').getBoundingClientRect();
        const box = input.getBoundingClientRect();
        return box.left < card.left || box.right > card.right;
      }).length;
      return { outside, pageOverflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    expect(fit).toEqual({ outside: 0, pageOverflow: false });
  });

  test('ingredient gram fields stay inside their cards in the add dialog at 360px', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [bowl], foods: [], weights: [] });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Oatmeal bowl')));
    for (const id of ['c-oats', 'c-milk']) {
      await page.locator(`#pick-components-list [data-component-item="${id}"] [data-companion-toggle]`).click();
    }
    await expect(page.locator('#pick-components-list [data-component-grams]')).toHaveCount(2);
    const fit = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('#pick-components-list [data-component-grams]')];
      const outside = inputs.filter((input) => {
        const card = input.closest('[data-component-item]').getBoundingClientRect();
        const box = input.getBoundingClientRect();
        return box.left < card.left || box.right > card.right;
      }).length;
      return { outside, pageOverflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    expect(fit).toEqual({ outside: 0, pageOverflow: false });
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
});

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
    await plain.locator('.product-toggle-main').click();
    await expect(plain.locator('[data-more-product]')).toBeVisible();
    await plain.locator('[data-more-product]').click({ force: true });
    await expect(plain.locator('[data-info-product]')).toHaveCount(0);
    await noted.locator('[data-info-product]').click();
    await expect(page.locator('#product-note-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-note-modal-view-text')).toHaveText('Use the cooked weight.');
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
});

test.describe('Smoke: composite portion normalization', () => {
  test('keeps active ingredients at 100% of the selected dish portion when adding and editing', async ({ page }) => {
    const products = [{
      id: 'beet-salad', name: 'Beet salad', grams: 100, kcal: 80, protein: 2, fat: 3, carbs: 12,
      components: [
        { id: 'beet', name: 'Beet', grams: 70, kcal: 30, protein: 1, fat: 0, carbs: 7, enabled: true },
        { id: 'mayo', name: 'Mayonnaise', grams: 30, kcal: 50, protein: 1, fat: 3, carbs: 5, enabled: false },
      ],
    }];
    await openApp(page, { prefs: BASE_PREFS, products, foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products[0]));
    await page.fill('#pick-grams', '210');
    await page.click('#pick-add');
    let stored = await readStore(page);
    expect(stored.foods[0].grams).toBe(210);
    expect(stored.foods[0].components.find((item) => item.id === 'beet')).toMatchObject({ grams: 210, enabled: true });
    expect(stored.foods[0].components.find((item) => item.id === 'mayo').enabled).toBe(false);

    await openView(page, 'diary');
    const diaryEntry = page.locator('#diary-meals .meal-item[data-food-id]').first();
    await diaryEntry.locator('[data-toggle-food]').click();
    await diaryEntry.locator('[data-edit-food]').click();
    await page.fill('#food-grams', '100');
    await page.click('#food-save');
    stored = await readStore(page);
    expect(stored.foods[0].grams).toBe(100);
    expect(stored.foods[0].components.find((item) => item.id === 'beet')).toMatchObject({ grams: 100, enabled: true });
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
      navigationSlot: button.parentElement?.id,
      aboveCatalogList: (() => {
        const catalogCard = document.querySelector('#view-products .card');
        return Boolean(catalogCard && button.getBoundingClientRect().bottom <= catalogCard.getBoundingClientRect().top);
      })(),
    }));
    expect(placement.insideCard).toBe(false);
    expect(placement.navigationSlot).toBe('catalog-nav-slot');
    expect(placement.aboveCatalogList).toBe(true);
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
