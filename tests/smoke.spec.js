const { test, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://wscprmtjjbevesrchhjr.supabase.co';
const PASSWORD = 'correct-horse-battery';
const USERS = {
  'alice@example.test': 'user-alice',
  'bob@example.test': 'user-bob',
};

const BASE_PREFS = {
  name: '',
  kcal: 2000,
  protein: 100,
  carbs: 242,
  fat: 70,
  lang: 'en',
  setupComplete: true,
  setupDismissed: true,
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function userObject(id, email) {
  const now = new Date().toISOString();
  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: now,
    updated_at: now,
  };
}

function sessionFor(id, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = [base64url({ alg: 'HS256', typ: 'JWT' }), base64url({ sub: id, email, role: 'authenticated', exp }), 'sig'].join('.');
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh-${id}`,
    user: userObject(id, email),
  };
}

function userIdFromRequest(req) {
  const auth = req.headers()['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')).sub || null;
  } catch {
    return null;
  }
}

/**
 * In-memory stand-in for the Supabase REST and Auth endpoints used by the app.
 * Enforces the per-user ownership that RLS would enforce on the real project.
 */
function createBackend() {
  return {
    tables: { food_entries: [], weight_entries: [], user_profiles: [] },
    failDeletes: false,
    failProfiles: false,
  };
}

async function mockSupabase(page, backend) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) =>
      route.fulfill({
        status,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: body === undefined ? '' : JSON.stringify(body),
      });

    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }

    if (url.pathname === '/auth/v1/token') {
      const body = req.postDataJSON();
      const id = USERS[body.email];
      if (!id || body.password !== PASSWORD) {
        return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      return json(200, sessionFor(id, body.email));
    }

    if (url.pathname === '/auth/v1/logout') {
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }

    if (url.pathname === '/auth/v1/user') {
      const id = userIdFromRequest(req);
      const email = Object.keys(USERS).find((key) => USERS[key] === id);
      return id && email ? json(200, userObject(id, email)) : json(401, { message: 'invalid JWT' });
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      return handleRest(route, req, url, backend, json);
    }

    return json(404, { message: `Not mocked: ${url.pathname}` });
  });
}

function matchesFilters(row, params) {
  for (const [key, value] of params) {
    if (['select', 'order', 'on_conflict', 'limit', 'offset'].includes(key)) continue;
    if (!value.startsWith('eq.')) continue;
    if (String(row[key]) !== value.slice(3)) return false;
  }
  return true;
}

async function handleRest(route, req, url, backend, json) {
  const table = url.pathname.replace('/rest/v1/', '');
  const rows = backend.tables[table];
  const uid = userIdFromRequest(req);
  if (!rows) return json(404, { message: `Unknown table ${table}` });
  if (table === 'user_profiles' && backend.failProfiles) {
    return json(404, { code: 'PGRST205', message: "Could not find the table 'public.user_profiles' in the schema cache" });
  }
  if (!uid) return json(401, { message: 'JWT required' });

  const params = [...url.searchParams.entries()];

  if (req.method() === 'GET') {
    const found = rows.filter((row) => row.user_id === uid && matchesFilters(row, params));
    if ((req.headers()['accept'] || '').includes('vnd.pgrst.object+json')) {
      if (found.length === 1) return json(200, found[0]);
      return json(406, { code: 'PGRST116', details: null, hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
    }
    return json(200, found);
  }

  if (req.method() === 'POST') {
    const body = req.postDataJSON();
    const items = Array.isArray(body) ? body : [body];
    const merge = (req.headers()['prefer'] || '').includes('merge-duplicates');
    const conflictKeys = (url.searchParams.get('on_conflict') || (table === 'user_profiles' ? 'user_id' : 'id')).split(',');
    for (const item of items) {
      if (item.user_id !== uid) return json(403, { message: 'new row violates row-level security policy' });
      const index = rows.findIndex((row) => row.user_id === uid && conflictKeys.every((key) => row[key] === item[key]));
      if (index !== -1) {
        if (!merge) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        rows[index] = { ...rows[index], ...item };
      } else {
        rows.push({ created_at: new Date().toISOString(), ...item });
      }
    }
    return route.fulfill({ status: 201, headers: CORS, body: '' });
  }

  if (req.method() === 'DELETE') {
    if (backend.failDeletes) return json(500, { code: 'XX000', message: 'simulated delete failure' });
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].user_id === uid && matchesFilters(rows[i], params)) rows.splice(i, 1);
    }
    return route.fulfill({ status: 204, headers: CORS, body: '' });
  }

  return json(405, { message: 'Method not mocked' });
}

async function openApp(page, store = {}) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto('/');
  await page.evaluate((data) => localStorage.setItem('smartdiet-v1', JSON.stringify(data)), store);
  await page.reload();
  await expect(page.locator('#nav')).toBeVisible();
}

async function readStore(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('smartdiet-v1') || '{}'));
}

async function openView(page, view) {
  await page.locator(`#nav [data-view="${view}"]`).click();
  await expect(page.locator(`#view-${view}`)).toHaveClass(/active/);
}

async function connectSupabase(page) {
  await openView(page, 'settings');
  await expect(page.locator('#auth-panel')).toBeVisible();
}

async function signIn(page, email) {
  await openView(page, 'settings');
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', PASSWORD);
  await page.click('#auth-submit');
  await expect.poll(async () => (await readStore(page)).synced?.uid).toBe(USERS[email]);
}

async function signOut(page) {
  await openView(page, 'settings');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/auth/v1/logout')),
    page.click('#auth-out'),
  ]);
}

async function addFood(page, name, meal = 'lunch') {
  await page.locator(`#diary-meals [data-action="add-food"][data-meal="${meal}"]`).click();
  await page.fill('#food-name', name);
  await page.fill('#food-grams', '150');
  await page.fill('#food-kcal', '250');
  await page.fill('#food-protein', '10');
  await page.fill('#food-fat', '5');
  await page.fill('#food-carbs', '40');
  await page.click('#food-save');
  await expect(page.locator('#diary-meals')).toContainText(name);
}

function foodRow(page, name) {
  return page.locator('#diary-meals .meal-list > div', { hasText: name });
}

test.describe('Smoke: goals', () => {
  test('saves daily goals, keeps them after reload, and rejects invalid numbers', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });

    await openView(page, 'settings');
    await page.fill('#pref-kcal', '1800');
    await page.fill('#pref-protein', '120');
    await page.fill('#pref-carbs', '200');
    await page.fill('#pref-fat', '60');
    await page.click('#save-prefs');
    await expect(page.locator('#toast')).toHaveText('Goals saved.');

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
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
    await expect(page.locator('#toast')).toHaveText('Values must be zero or positive numbers.');

    await page.fill('#pref-kcal', '0');
    await page.click('#save-prefs');
    await expect(page.locator('#toast')).toHaveText('Values must be zero or positive numbers.');

    const stored = await readStore(page);
    expect(stored.prefs.kcal).toBe(1800);
    expect(stored.prefs.protein).toBe(120);
  });
});

test.describe('Smoke: food deletion', () => {
  test('deleting a local entry removes it and the deletion survives reload', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });

    await openView(page, 'diary');
    await addFood(page, 'Smoke rice');

    await foodRow(page, 'Smoke rice').locator('[data-delete-food]').click();
    await expect(page.locator('#toast')).toHaveText('Entry deleted.');
    await expect(foodRow(page, 'Smoke rice')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Smoke rice');
    expect((await readStore(page)).foods).toHaveLength(0);
  });

  test('deleting a synced entry removes it from the cloud', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await addFood(page, 'Smoke oats');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    await foodRow(page, 'Smoke oats').locator('[data-delete-food]').click();
    await expect(page.locator('#toast')).toHaveText('Entry deleted.');
    await expect.poll(() => backend.tables.food_entries.length).toBe(0);

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Smoke oats');
  });

  test('every change while signed in reaches the cloud at once', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await addFood(page, 'Instant rice');
    await expect.poll(() => backend.tables.food_entries.map((row) => row.name)).toEqual(['Instant rice']);

    await foodRow(page, 'Instant rice').locator('[data-edit-food]').first().click();
    await page.fill('#food-name', 'Instant brown rice');
    await page.click('#food-save');
    await expect.poll(() => backend.tables.food_entries.map((row) => row.name)).toEqual(['Instant brown rice']);

    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '71.5');
    await page.click('#weight-save');
    await expect.poll(() => backend.tables.weight_entries.map((row) => Number(row.value))).toEqual([71.5]);

    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '71.2');
    await page.click('#weight-save');
    await expect.poll(() => backend.tables.weight_entries.map((row) => Number(row.value))).toEqual([71.2]);
    expect(backend.tables.weight_entries).toHaveLength(1);
  });

  test('entries and weigh-ins still reach the cloud when the profile cannot be saved', async ({ page }) => {
    const backend = createBackend();
    backend.failProfiles = true;
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await page.fill('#pref-kcal', '1800');
    await page.click('#save-prefs');
    await expect.poll(async () => (await readStore(page)).prefs.kcal).toBe(1800);

    await openView(page, 'diary');
    await addFood(page, 'Buckwheat');
    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '70.4');
    await page.click('#weight-save');

    await expect.poll(() => backend.tables.food_entries.map((row) => row.name)).toEqual(['Buckwheat']);
    await expect.poll(() => backend.tables.weight_entries.map((row) => Number(row.value))).toEqual([70.4]);
    await expect.poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('smartdiet-sync-queue') || '{}'))).foods).toEqual([]);
  });

  test('goals saved on one device are loaded on a fresh device after sign-in', async ({ page, browser }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    await page.fill('#pref-kcal', '1800');
    await page.click('#save-prefs');
    await expect.poll(() => backend.tables.user_profiles.map((row) => row.data.kcal)).toEqual([1800]);

    const other = await browser.newContext({ serviceWorkers: 'block' });
    const second = await other.newPage();
    await mockSupabase(second, backend);
    await openApp(second, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await connectSupabase(second);
    await signIn(second, 'alice@example.test');
    await expect.poll(async () => (await readStore(second)).prefs.kcal).toBe(1800);
    expect(backend.tables.user_profiles[0].data.kcal).toBe(1800);
    await other.close();
  });

  test('a new device that was touched before sign-in does not overwrite the saved profile', async ({ page, browser }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    await page.fill('#pref-kcal', '1800');
    await page.click('#save-prefs');
    await expect.poll(() => backend.tables.user_profiles.map((row) => row.data.kcal)).toEqual([1800]);

    const other = await browser.newContext({ serviceWorkers: 'block' });
    const second = await other.newPage();
    await mockSupabase(second, backend);
    await openApp(second, { prefs: { ...BASE_PREFS, updatedAt: new Date(Date.now() + 60000).toISOString() }, foods: [], weights: [] });
    await connectSupabase(second);
    await signIn(second, 'alice@example.test');
    await expect.poll(async () => (await readStore(second)).prefs.kcal).toBe(1800);
    expect(backend.tables.user_profiles[0].data.kcal).toBe(1800);
    await other.close();
  });

  test('a failed cloud delete keeps the entry and reports the error', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await addFood(page, 'Smoke eggs');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    backend.failDeletes = true;
    await foodRow(page, 'Smoke eggs').locator('[data-delete-food]').click();
    await expect(page.locator('#toast')).toContainText('Saved locally; sync failed:');
    await expect(foodRow(page, 'Smoke eggs')).toHaveCount(1);
    expect(backend.tables.food_entries).toHaveLength(1);
  });
});

test.describe('Smoke: account switching', () => {
  test('data from one account is not uploaded to another and is restored on return', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);

    await signIn(page, 'alice@example.test');
    await openView(page, 'diary');
    await addFood(page, 'Alice breakfast', 'breakfast');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    await signOut(page);
    await signIn(page, 'bob@example.test');

    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Alice breakfast');
    expect((await readStore(page)).foods).toHaveLength(0);
    expect(backend.tables.food_entries.filter((row) => row.user_id === 'user-bob')).toHaveLength(0);

    const setAside = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('smartdiet-foreign-user-alice-'))
        .map((key) => JSON.parse(localStorage.getItem(key)))
    );
    expect(setAside).toHaveLength(1);
    expect(setAside[0].foods.map((food) => food.name)).toEqual(['Alice breakfast']);

    await signOut(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).toContainText('Alice breakfast');
    const aliceFoods = (await readStore(page)).foods.filter((food) => food.name === 'Alice breakfast');
    expect(aliceFoods).toHaveLength(1);
    expect(backend.tables.food_entries.filter((row) => row.user_id === 'user-alice')).toHaveLength(1);
  });
});

const OLD_FOOD = {
  id: 'old-food',
  name: 'Old local entry',
  meal: 'dinner',
  grams: 100,
  kcal: 500,
  protein: 20,
  fat: 10,
  carbs: 40,
  date: '2026-10-20',
  createdAt: 1,
};

const IMPORT_BACKUP = {
  app: 'smart-diet-ai',
  version: 1,
  exportedAt: '2026-10-24T10:00:00.000Z',
  foods: [
    { id: 'import-food-1', name: 'Imported oatmeal', meal: 'breakfast', grams: 200, kcal: 300, protein: 10, fat: 5, carbs: 50, date: '2026-10-24', createdAt: 1 },
    { id: 'import-food-2', name: 'Imported soup', meal: 'lunch', grams: 300, kcal: 250, protein: 12, fat: 8, carbs: 30, date: '2026-10-23', createdAt: 2 },
  ],
  weights: [{ id: 'import-weight-1', value: 80.2, date: '2026-10-24' }],
  prefs: {
    ...BASE_PREFS,
    name: 'Imported',
    kcal: 1800,
    protein: 120,
    carbs: 200,
    fat: 60,
    birthDate: '1990-05-01',
    sex: 'male',
    height: 180,
    currentWeight: 80.2,
    targetWeight: 75,
    activity: 'light',
    pace: 0.5,
  },
};

function backupFile(content) {
  return {
    name: 'smart-diet-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)),
  };
}

test.describe('Smoke: backup import', () => {
  test('confirmed import replaces local data and keeps it after reload', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      dialog.accept();
    });

    await openApp(page, { prefs: BASE_PREFS, foods: [OLD_FOOD], weights: [{ id: 'old-weight', value: 90, date: '2026-10-20' }] });
    await openView(page, 'settings');

    await page.setInputFiles('#import-file', backupFile(IMPORT_BACKUP));

    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('Replace the data on this device');
    await expect(page.locator('#toast')).toHaveText('Imported 2 entries and 1 weigh-ins.');

    const imported = await readStore(page);
    expect(imported.foods.map((food) => food.name).sort()).toEqual(['Imported oatmeal', 'Imported soup']);
    expect(imported.weights.map((weight) => [weight.date, weight.value])).toEqual([['2026-10-24', 80.2]]);
    expect(imported.prefs.kcal).toBe(1800);
    expect(imported.prefs.name).toBe('Imported');

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    const reloaded = await readStore(page);
    expect(reloaded.foods.map((food) => food.name)).not.toContain('Old local entry');
    expect(reloaded.foods).toHaveLength(2);

    await openView(page, 'settings');
    await expect(page.locator('#pref-kcal')).toHaveValue('1800');
  });

  test('declining the confirmation keeps the current local data', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      dialog.dismiss();
    });

    await openApp(page, { prefs: BASE_PREFS, foods: [OLD_FOOD], weights: [] });
    await openView(page, 'settings');

    await page.setInputFiles('#import-file', backupFile(IMPORT_BACKUP));

    await expect.poll(() => dialogs.length).toBe(1);
    const stored = await readStore(page);
    expect(stored.foods.map((food) => food.name)).toEqual(['Old local entry']);
    expect(stored.prefs.kcal).toBe(2000);
  });

  test('a file that is not a backup is rejected without changing data', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      dialog.accept();
    });

    await openApp(page, { prefs: BASE_PREFS, foods: [OLD_FOOD], weights: [] });
    await openView(page, 'settings');

    await page.setInputFiles('#import-file', backupFile({ hello: 'world' }));
    await expect(page.locator('#toast')).toHaveText('This file is not a Smart Diet AI backup.');
    expect(dialogs).toHaveLength(0);
    expect((await readStore(page)).foods.map((food) => food.name)).toEqual(['Old local entry']);

    await page.setInputFiles('#import-file', backupFile('{"foods": [ broken'));
    await expect(page.locator('#toast')).toHaveText('This file is not a Smart Diet AI backup.');
    expect(dialogs).toHaveLength(0);

    const stored = await readStore(page);
    expect(stored.foods.map((food) => food.name)).toEqual(['Old local entry']);
    expect(stored.prefs.kcal).toBe(2000);
  });
});

test.describe('Smoke: sign-out and data transfer', () => {
  test('sign out hides the button and shows a status', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await signOut(page);
    await expect(page.locator('#auth-out')).toBeHidden();
    await expect(page.locator('#auth-status')).toHaveText('Signed out.');
  });

  test('signed-in state shows the account, hides the form, and survives reload', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await expect(page.locator('#auth-form')).toBeVisible();

    await signIn(page, 'alice@example.test');
    await expect(page.locator('#auth-form')).toBeHidden();
    await expect(page.locator('#auth-signed')).toBeVisible();
    await expect(page.locator('#auth-who')).toContainText('alice@example.test');

    await page.reload();
    await openView(page, 'settings');
    await expect(page.locator('#auth-signed')).toBeVisible();
    await expect(page.locator('#auth-form')).toBeHidden();
    await expect(page.locator('#auth-who')).toContainText('alice@example.test');

    await signOut(page);
    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(page.locator('#auth-signed')).toBeHidden();
  });

  test('accepting the transfer moves local entries into the new account', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);

    await signIn(page, 'alice@example.test');
    await openView(page, 'diary');
    await addFood(page, 'Shared lunch', 'lunch');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    await signOut(page);
    page.once('dialog', (dialog) => dialog.accept());
    await signIn(page, 'bob@example.test');

    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).toContainText('Shared lunch');
    await expect.poll(() => backend.tables.food_entries.filter((row) => row.user_id === 'user-bob').length).toBe(1);
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

    await openView(page, 'home');
    await expect(page.locator('#home-meals .meal-card')).toHaveCount(4);
    await expect(page.locator('#home-meals')).toContainText('Apple');
    await expect(page.locator('#chat-meal option[value="snack"]')).toHaveCount(1);
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
    await expect(totals.nth(0)).toContainText('2000 / 2000');
    await expect(totals.nth(0)).toHaveClass(/ok/);
    await expect(totals.nth(1)).toContainText('20 / 10');
    await expect(totals.nth(1)).toHaveClass(/over/);
    await expect(totals.nth(2)).toContainText('140 / 70');
    await expect(totals.nth(2)).toHaveClass(/over/);
    await expect(totals.nth(3)).toContainText('600 / 242');
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

  test('meal is picked from a styled dropdown in the dietitian chat', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.click('#chat-fab');
    await page.click('#chat-panel .dd-btn');
    await expect(page.locator('#chat-panel .dd')).toHaveClass(/open/);
    await page.click('#chat-panel .dd-opt[data-value="snack"]');
    await expect(page.locator('#chat-meal')).toHaveValue('snack');
    await expect(page.locator('#chat-panel .dd')).not.toHaveClass(/open/);
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

  test('dietitian chat picks the meal by time of day', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const meals = await page.evaluate(() => [8, 12, 15, 16, 21].map((h) => autoMeal(h)));
    expect(meals).toEqual(['breakfast', 'lunch', 'lunch', 'dinner', 'dinner']);
    await page.click('#chat-fab');
    await expect(page.locator('#chat-meal')).toHaveValue(await page.evaluate(() => autoMeal()));
  });

  test('dietitian input grows up to five lines and then scrolls', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.click('#chat-fab');
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
