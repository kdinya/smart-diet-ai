const { test, expect, BASE_PREFS, createBackend, mockSupabase, openApp, signIn, openView, readStore } = require('./smoke.helpers');

const STAMP = '2026-11-01T10:00:00.000Z';

function catRow(row) {
  return { grams: 100, kcal: 0, protein: 0, fat: 0, carbs: 0, verified: false, note: '', companions: [], components: [], source_id: null, created_at: STAMP, updated_at: STAMP, ...row };
}

function seedCatalog(backend) {
  backend.tables.catalog_products.push(
    catRow({ id: 'cat-rice', name: 'Cooked rice', kcal: 130, protein: 2.7, fat: 0.3, carbs: 28, verified: true, note: 'Boiled without salt' }),
    catRow({ id: 'cat-milk', name: 'Milk', kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8, verified: true }),
    catRow({ id: 'cat-coffee', name: 'Coffee with milk', grams: 200, kcal: 4, protein: 0.3, fat: 0.1, carbs: 0.8, companions: [{ id: 'cat-milk', grams: 50, on: false }] }),
    catRow({
      id: 'cat-salad',
      name: 'Beet salad',
      grams: 180,
      kcal: 65,
      protein: 2.4,
      fat: 0.2,
      carbs: 14,
      components: [
        { id: 'ing-beet', name: 'Beet', grams: 150, kcal: 65, protein: 2.4, fat: 0.2, carbs: 14, enabled: true },
        { id: 'ing-mayo', name: 'Mayonnaise', grams: 30, kcal: 200, protein: 0.4, fat: 20, carbs: 0.6, enabled: false },
      ],
    }),
  );
}

const MY_MILK = { id: 'p-milk', name: 'Milk', grams: 100, kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8, updatedAt: 1 };
const MY_COFFEE = { id: 'p-coffee', name: 'Coffee with milk', grams: 200, kcal: 4, protein: 0.3, fat: 0.1, carbs: 0.8, verified: true, note: 'My usual', companions: [{ id: 'p-milk', grams: 50, on: false }], updatedAt: 2 };

async function start(page, backend, { email, products = [] } = {}) {
  await mockSupabase(page, backend);
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products: email ? [] : products });
  if (!email) return;
  await signIn(page, email);
  // products are created after signing in, so no upload confirmation interferes with the scenario
  await page.evaluate((list) => list.forEach((item) => putProduct(item)), products);
}

async function openCatalog(page) {
  await openView(page, 'products');
  await page.click('#catalog-open');
  await expect(page.locator('#view-catalog')).toBeVisible();
}

const card = (page, name) => page.locator('#catalog-list .product-item', { hasText: name }).first();
const cardById = (page, id) => page.locator(`#catalog-list .product-item[data-product-id="${id}"]`);
const mine = (page, name) => page.locator('#products-list .product-item', { hasText: name }).first();
const mineById = (page, id) => page.locator(`#products-list .product-item[data-product-id="${id}"]`);

async function expand(item) {
  if (await item.evaluate((el) => el.classList.contains('collapsed'))) await item.locator('[data-toggle-product]').first().click();
}

test.describe('Smoke: shared product catalog', () => {
  test('a guest sees the catalog with all details but cannot add products', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    await start(page, backend);
    await openCatalog(page);

    await expect(page.locator('#catalog-list .product-item')).toHaveCount(4);
    const rice = card(page, 'Cooked rice');
    await expand(rice);
    await expect(rice).toContainText('130');
    await expect(rice.locator('[data-catalog-note]').first()).toBeVisible();
    await expect(rice.locator('[data-catalog-add]')).toHaveAttribute('aria-disabled', 'true');
    await expect(rice.locator('[data-catalog-edit], [data-catalog-delete], [data-catalog-send]')).toHaveCount(0);

    await rice.locator('[data-catalog-add]').click({ force: true });
    await expect(page.locator('#confirm-message')).toContainText('sign in or register');
    await page.click('#confirm-ok');
    await expect(page.locator('#view-settings')).toBeVisible();
    expect((await readStore(page)).products ?? []).toHaveLength(0);
  });

  test('add-ons and ingredient checkboxes are shown read-only in the catalog', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    await start(page, backend);
    await openCatalog(page);
    const coffee = card(page, 'Coffee with milk');
    await expect(coffee).toContainText('Milk');
    expect(await coffee.locator('input[type="checkbox"]:not([disabled])').count()).toBe(0);
    const salad = card(page, 'Beet salad');
    expect(await salad.locator('input[type="checkbox"]:not([disabled])').count()).toBe(0);
  });

  test('a signed-in user only gets the add button and receives an independent copy with add-ons', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    await start(page, backend, { email: 'alice@example.test' });
    await openCatalog(page);

    const coffee = card(page, 'Coffee with milk');
    await expand(coffee);
    await expect(coffee.locator('[data-catalog-add]')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(coffee.locator('[data-catalog-edit], [data-catalog-delete], [data-catalog-send]')).toHaveCount(0);
    await coffee.locator('[data-catalog-add]').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Added to My products: Coffee with milk');

    const products = (await readStore(page)).products;
    const copy = products.find((p) => p.name === 'Coffee with milk');
    const milk = products.find((p) => p.name === 'Milk');
    expect(copy).toMatchObject({ grams: 200, kcal: 4, protein: 0.3, fat: 0.1, carbs: 0.8 });
    expect(milk).toMatchObject({ kcal: 64 });
    expect(copy.id).not.toBe('cat-coffee');
    expect(milk.id).not.toBe('cat-milk');
    expect(copy.companions).toEqual([{ id: milk.id, grams: 50, on: false }]);

    // the copy is independent: editing or deleting it never touches the catalog
    const before = JSON.stringify(backend.tables.catalog_products);
    await page.evaluate(() => putProduct({ ...state.products.find((p) => p.name === 'Coffee with milk'), kcal: 999 }));
    await page.evaluate(() => deleteProduct(state.products.find((p) => p.name === 'Milk').id));
    expect(JSON.stringify(backend.tables.catalog_products)).toBe(before);
  });

  test('a dish with ingredients keeps its ingredients, checkboxes, verified mark and note when copied', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    backend.tables.catalog_products.find((row) => row.id === 'cat-salad').verified = true;
    backend.tables.catalog_products.find((row) => row.id === 'cat-salad').note = 'From grandma';
    await start(page, backend, { email: 'alice@example.test' });
    await openCatalog(page);
    const salad = card(page, 'Beet salad');
    await expand(salad);
    await salad.locator('[data-catalog-add]').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Added to My products: Beet salad');
    const copy = (await readStore(page)).products.find((p) => p.name === 'Beet salad');
    expect(copy).toMatchObject({ grams: 180, kcal: 65, verified: true, note: 'From grandma' });
    expect(copy.components.map((c) => [c.name, c.grams, c.enabled])).toEqual([['Beet', 150, true], ['Mayonnaise', 30, false]]);
  });

  test('a product with the same name is added as a copy only after the user agrees', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    await start(page, backend, { email: 'alice@example.test', products: [{ id: 'p-rice', name: 'Cooked rice', grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 20, updatedAt: 1 }] });
    await openCatalog(page);
    const rice = card(page, 'Cooked rice');
    await expand(rice);

    await rice.locator('[data-catalog-add]').click();
    await expect(page.locator('#confirm-message')).toContainText('Cooked rice (copy)');
    await page.click('#confirm-cancel');
    expect((await readStore(page)).products.map((p) => p.name)).toEqual(['Cooked rice']);

    await rice.locator('[data-catalog-add]').click();
    await page.click('#confirm-ok');
    await expect.poll(async () => (await readStore(page)).products.map((p) => p.name).sort()).toEqual(['Cooked rice', 'Cooked rice (copy)']);

    await rice.locator('[data-catalog-add]').click();
    await expect(page.locator('#confirm-message')).toContainText('Cooked rice (copy 2)');
    await page.click('#confirm-cancel');
  });

  test('an administrator can edit and delete catalog products and still add them to My products', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    backend.tables.app_admins.push({ user_id: 'user-alice' });
    await start(page, backend, { email: 'alice@example.test' });
    await openCatalog(page);
    await expect(page.locator('#catalog-admin-note')).toBeVisible();

    const rice = card(page, 'Cooked rice');
    await expand(rice);
    await expect(rice.locator('[data-catalog-add], [data-catalog-edit], [data-catalog-delete]')).toHaveCount(3);

    await rice.locator('[data-catalog-edit]').click();
    await expect(page.locator('#catalog-edit-modal')).toHaveClass(/open/);
    await page.fill('#catalog-edit-name', 'Boiled rice');
    await page.fill('#catalog-edit-kcal', '150');
    await page.click('#catalog-edit-save');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Catalog updated: Boiled rice');
    expect(backend.tables.catalog_products.find((row) => row.id === 'cat-rice')).toMatchObject({ name: 'Boiled rice', kcal: 150 });
    await expect(card(page, 'Boiled rice')).toBeVisible();

    const milk = cardById(page, 'cat-milk');
    await expand(milk);
    await milk.locator('[data-catalog-delete]').click();
    await expect(page.locator('#confirm-message')).toContainText('Copies in users’ own products are not affected');
    await page.click('#confirm-ok');
    await expect.poll(() => backend.tables.catalog_products.some((row) => row.id === 'cat-milk')).toBe(false);
    await expect(cardById(page, 'cat-milk')).toHaveCount(0);
  });

  test('editing a dish with ingredients locks its calories and macros', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    backend.tables.app_admins.push({ user_id: 'user-alice' });
    await start(page, backend, { email: 'alice@example.test' });
    await openCatalog(page);
    const salad = card(page, 'Beet salad');
    await expand(salad);
    await salad.locator('[data-catalog-edit]').click();
    await expect(page.locator('#catalog-edit-kcal')).toBeDisabled();
    await expect(page.locator('#catalog-edit-locked')).toBeVisible();
    await page.fill('#catalog-edit-note', 'Updated note');
    await page.click('#catalog-edit-save');
    await expect.poll(() => backend.tables.catalog_products.find((row) => row.id === 'cat-salad').note).toBe('Updated note');
    expect(backend.tables.catalog_products.find((row) => row.id === 'cat-salad').components).toHaveLength(2);
  });

  test('a regular user sees no admin controls and the database refuses their writes', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    backend.tables.app_admins.push({ user_id: 'user-alice' });
    await start(page, backend, { email: 'bob@example.test', products: [MY_MILK] });
    await openCatalog(page);
    await expect(page.locator('#catalog-admin-note')).toBeHidden();
    await expect(page.locator('[data-catalog-edit], [data-catalog-delete]')).toHaveCount(0);

    const before = JSON.stringify(backend.tables.catalog_products);
    const outcome = await page.evaluate(async () => {
      const update = await sb.from('catalog_products').update({ kcal: 1 }).eq('id', 'cat-rice').select('id');
      const remove = await sb.from('catalog_products').delete().eq('id', 'cat-rice').select('id');
      const insert = await sb.from('catalog_products').insert({ name: 'Hack' });
      const admin = await sb.from('app_admins').insert({ user_id: 'user-bob' });
      return { updated: update.data.length, deleted: remove.data.length, insertCode: insert.error?.code, adminCode: admin.error?.code };
    });
    expect(outcome).toEqual({ updated: 0, deleted: 0, insertCode: '42501', adminCode: '42501' });
    expect(JSON.stringify(backend.tables.catalog_products)).toBe(before);

    await openView(page, 'products');
    await mine(page, 'Milk').locator('[data-toggle-product]').first().click();
    await expect(page.locator('[data-catalog-send]')).toHaveCount(0);
  });

  test('an administrator sends a product with its add-ons and the button disappears afterwards', async ({ page }) => {
    const backend = createBackend();
    backend.tables.app_admins.push({ user_id: 'user-alice' });
    await start(page, backend, { email: 'alice@example.test', products: [MY_MILK, MY_COFFEE] });
    await openView(page, 'products');
    const coffee = mine(page, 'Coffee with milk');
    await expand(coffee);
    await coffee.locator('[data-catalog-send]').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Sent to the catalog: Coffee with milk (add-ons: Milk)');

    const rows = backend.tables.catalog_products;
    expect(rows).toHaveLength(2);
    const milkRow = rows.find((row) => row.name === 'Milk');
    const coffeeRow = rows.find((row) => row.name === 'Coffee with milk');
    expect(milkRow.id).not.toBe('p-milk');
    expect(coffeeRow).toMatchObject({ source_id: 'p-coffee', verified: true, note: 'My usual', grams: 200 });
    expect(coffeeRow.companions).toEqual([{ id: milkRow.id, grams: 50, on: false }]);

    await expect(mine(page, 'Coffee with milk').locator('[data-catalog-send]')).toHaveCount(0);
    await expand(mineById(page, 'p-milk'));
    await expect(mineById(page, 'p-milk').locator('[data-catalog-send]')).toHaveCount(0);

    // the catalog is independent of My products
    await page.evaluate(() => deleteProduct('p-coffee'));
    expect(backend.tables.catalog_products).toHaveLength(2);
  });

  test('sending a product whose name is already in the catalog asks before adding a copy', async ({ page }) => {
    const backend = createBackend();
    backend.tables.app_admins.push({ user_id: 'user-alice' });
    backend.tables.catalog_products.push(catRow({ id: 'cat-existing', name: 'Milk', kcal: 60 }));
    await start(page, backend, { email: 'alice@example.test', products: [MY_MILK] });
    await openView(page, 'products');
    const milk = mineById(page, 'p-milk');
    await expand(milk);

    await milk.locator('[data-catalog-send]').click();
    await expect(page.locator('#confirm-message')).toContainText('Milk (copy)');
    await page.click('#confirm-cancel');
    expect(backend.tables.catalog_products).toHaveLength(1);
    await expect(milk.locator('[data-catalog-send]')).toBeVisible();

    await milk.locator('[data-catalog-send]').click();
    await page.click('#confirm-ok');
    await expect.poll(() => backend.tables.catalog_products.map((row) => row.name).sort()).toEqual(['Milk', 'Milk (copy)']);
    expect(backend.tables.catalog_products.find((row) => row.name === 'Milk').kcal).toBe(60);
  });

  test('the catalog opens from My products, uses its own colours and fits a phone screen', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    await page.setViewportSize({ width: 360, height: 740 });
    await start(page, backend);
    await openView(page, 'products');
    const button = page.locator('#catalog-open');
    await expect(button).toBeVisible();
    const productsCard = await page.locator('#view-products .card').evaluate((el) => getComputedStyle(el).backgroundColor);
    await button.click();
    await expect(page.locator('#view-catalog')).toBeVisible();
    const catalogCard = await page.locator('#view-catalog .card').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(catalogCard).not.toBe(productsCard);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.click('#catalog-back');
    await expect(page.locator('#view-products')).toBeVisible();
  });

  test('reopening the catalog picks up added and removed products', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    await start(page, backend);
    await openCatalog(page);
    await expect(page.locator('#catalog-list .product-item')).toHaveCount(4);

    backend.tables.catalog_products = backend.tables.catalog_products.filter((row) => row.id !== 'cat-milk');
    backend.tables.catalog_products.push(catRow({ id: 'cat-beans', name: 'Beans', kcal: 120, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
    await page.click('#catalog-back');
    await page.click('#catalog-open');
    await expect(page.locator('#catalog-list')).toContainText('Beans');
    await expect(page.locator('#catalog-list .product-item')).toHaveCount(4);
    await expect(page.locator('#catalog-list .product-item', { hasText: /^Milk/ })).toHaveCount(0);
  });

  test('a catalog loading failure is reported without breaking My products', async ({ page }) => {
    const backend = createBackend();
    seedCatalog(backend);
    backend.failCatalog = true;
    await start(page, backend);
    await openCatalog(page);
    await expect(page.locator('#catalog-status')).toContainText('Could not load the catalog');
    await page.click('#catalog-back');
    await expect(page.locator('#view-products')).toBeVisible();
  });
});
