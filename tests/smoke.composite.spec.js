const { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate } = require('./smoke.helpers');

const MILK = '22222222-2222-4222-8222-222222222222';
const COFFEE = '11111111-1111-4111-8111-111111111111';
const milk = { id: MILK, name: 'Milk', grams: 100, kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8 };

  test('a composite dish keeps scaling its ingredients with portions and its original hint', async ({ page }) => {
    const soup = { id: '44444444-4444-4444-8444-444444444444', name: 'Soup', grams: 200, kcal: 100, protein: 5, fat: 3, carbs: 10, components: [{ id: MILK, grams: 100 }, { id: COFFEE, grams: 100 }] };
    const coffee = { id: COFFEE, name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0 };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [soup, milk, coffee], foods: [], weights: [] });
    await page.evaluate(() => openMealPicker(state.products.find((p) => p.name === 'Soup')));
    await expect(page.locator('#pick-components-field .companion-portion-note')).toContainText('whole dish (bowl)');
    await expect(page.locator('#pick-portions')).toBeVisible();
    await page.fill('#pick-grams', '400');
    await page.click('#pick-add');
    await expect.poll(() => page.evaluate(() => state.foods[0]?.grams)).toBe(400);
    expect(await page.evaluate(() => state.foods[0].components.map((c) => c.grams))).toEqual([200, 200]);
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

test.describe('Smoke: dish ingredient gram fields', () => {
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
});
