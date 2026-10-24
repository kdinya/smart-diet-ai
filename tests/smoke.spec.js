const { test, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://smoke-test.supabase.co';
const ANON_KEY = 'smoke-anon-key';
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
  await page.fill('#sb-url', SUPABASE_URL);
  await page.fill('#sb-anon', ANON_KEY);
  await page.click('#connect-sb');
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
