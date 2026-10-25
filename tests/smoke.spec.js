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
    tables: {
      food_entries: [],
      weight_entries: [],
      user_profiles: [],
      products: [],
      profiles: [
        { user_id: 'user-alice', friend_code: 'AAAA2222', display_name: 'Alice' },
        { user_id: 'user-bob', friend_code: 'BBBB3333', display_name: 'Bob' },
      ],
      friendships: [],
      product_shares: [],
    },
    friendAttempts: {},
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

    if (url.pathname === '/rest/v1/rpc/request_friend') {
      return handleRequestFriend(req, backend, json);
    }

    if (url.pathname === '/rest/v1/weight_entries' && req.method() === 'POST' && backend.delayWeightWrites) {
      await new Promise((resolve) => setTimeout(resolve, backend.delayWeightWrites));
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
    if (value.startsWith('in.(')) {
      if (!value.slice(4, -1).split(',').map((part) => part.replace(/^"|"$/g, '')).includes(String(row[key]))) return false;
      continue;
    }
    if (!value.startsWith('eq.')) continue;
    if (String(row[key]) !== value.slice(3)) return false;
  }
  return true;
}

const SOCIAL_TABLES = ['profiles', 'friendships', 'product_shares'];
const FRIEND_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

function areFriends(backend, a, b, status) {
  return backend.tables.friendships.some(
    (f) => ((f.requester === a && f.addressee === b) || (f.requester === b && f.addressee === a)) && (!status || f.status === status),
  );
}

function handleRequestFriend(req, backend, json) {
  const uid = userIdFromRequest(req);
  if (!uid) return json(401, { message: 'JWT required' });
  const now = Date.now();
  const attempts = backend.friendAttempts[uid];
  if (!attempts || now - attempts.startedAt > 3600_000) backend.friendAttempts[uid] = { startedAt: now, count: 1 };
  else if (attempts.count >= 10) return json(200, 'rate_limited');
  else attempts.count += 1;

  const code = String(req.postDataJSON().code || '').trim().toUpperCase();
  const target = FRIEND_CODE.test(code) ? backend.tables.profiles.find((row) => row.friend_code === code) : null;
  if (!target || target.user_id === uid) return json(200, 'not_found');
  const existing = backend.tables.friendships.find(
    (f) => (f.requester === uid && f.addressee === target.user_id) || (f.requester === target.user_id && f.addressee === uid),
  );
  if (existing) {
    if (existing.status === 'pending' && existing.requester === target.user_id) {
      existing.status = 'accepted';
      return json(200, 'accepted');
    }
    return json(200, 'already');
  }
  backend.tables.friendships.push({ id: `friendship-${backend.tables.friendships.length + 1}`, requester: uid, addressee: target.user_id, status: 'pending', created_at: new Date().toISOString() });
  return json(200, 'ok');
}

const SHARE_VALUE_KEYS = ['grams', 'kcal', 'protein', 'fat', 'carbs'];

async function handleSocial(route, req, url, backend, json, table, uid) {
  const rows = backend.tables[table];
  const params = [...url.searchParams.entries()];
  const visible = (row) => {
    if (table === 'profiles') return row.user_id === uid || areFriends(backend, uid, row.user_id);
    if (table === 'friendships') return row.requester === uid || row.addressee === uid;
    return row.from_user === uid || row.to_user === uid;
  };

  if (req.method() === 'GET') {
    const found = rows.filter((row) => visible(row) && matchesFilters(row, params));
    if ((req.headers()['accept'] || '').includes('vnd.pgrst.object+json')) {
      if (found.length === 1) return json(200, found[0]);
      return json(406, { code: 'PGRST116', details: null, hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
    }
    return json(200, found);
  }

  if (req.method() === 'PATCH') {
    const body = req.postDataJSON();
    for (const row of rows) {
      if (!matchesFilters(row, params)) continue;
      if (table === 'profiles' && row.user_id === uid && 'display_name' in body) row.display_name = String(body.display_name).slice(0, 40);
      if (table === 'friendships' && row.addressee === uid && row.status === 'pending' && body.status === 'accepted') row.status = 'accepted';
    }
    return route.fulfill({ status: 204, headers: CORS, body: '' });
  }

  if (req.method() === 'POST' && table === 'product_shares') {
    const item = req.postDataJSON();
    if (item.from_user !== uid || !areFriends(backend, uid, item.to_user, 'accepted')) {
      return json(403, { code: '42501', message: 'new row violates row-level security policy for table "product_shares"' });
    }
    if (!item.name || item.name.length > 120 || SHARE_VALUE_KEYS.some((key) => !(item[key] >= 0 && item[key] <= 10000))) {
      return json(400, { code: '23514', message: 'new row for relation "product_shares" violates check constraint' });
    }
    if (rows.filter((row) => row.from_user === uid && row.to_user === item.to_user).length >= 20) {
      return json(400, { code: 'P0001', message: 'Share limit reached' });
    }
    rows.push({ id: `share-${rows.length + 1}-${Date.now()}`, created_at: new Date().toISOString(), ...item });
    return route.fulfill({ status: 201, headers: CORS, body: '' });
  }

  if (req.method() === 'DELETE') {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      const allowed = table === 'product_shares' ? row.to_user === uid || row.from_user === uid : visible(row);
      if (allowed && matchesFilters(row, params)) rows.splice(i, 1);
    }
    return route.fulfill({ status: 204, headers: CORS, body: '' });
  }

  return json(405, { message: 'Method not mocked' });
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
  if (SOCIAL_TABLES.includes(table)) return handleSocial(route, req, url, backend, json, table, uid);

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

function setupConfirmWatch(plan) {
  window.__confirmPlan = plan;
  if (window.__confirmWatchInstalled) return true;
  const install = () => {
    if (window.__confirmWatchInstalled) return true;
    const modal = document.getElementById('confirm-modal');
    if (!modal) return false;
    window.__confirmWatchInstalled = true;
    new MutationObserver(() => {
      if (!modal.classList.contains('open')) return;
      const current = window.__confirmPlan || { queue: [], fallback: false };
      const accept = current.queue.length ? current.queue.shift() : current.fallback;
      if (window.__confirmAsked) window.__confirmAsked(document.getElementById('confirm-message').textContent);
      document.getElementById(accept ? 'confirm-ok' : 'confirm-cancel').click();
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    return true;
  };
  if (!install()) document.addEventListener('DOMContentLoaded', install);
  return true;
}

async function autoConfirm(page, answers = true, log = null) {
  const plan = Array.isArray(answers) ? { queue: [...answers], fallback: false } : { queue: [], fallback: answers };
  if (log) await page.exposeFunction('__confirmAsked', (message) => log.push(message)).catch(() => {});
  await page.addInitScript(setupConfirmWatch, plan);
  await page.evaluate(setupConfirmWatch, plan);
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
    await expect(page.locator('#toast')).toHaveText('Values must be numbers from 0 to 10000.');

    await page.fill('#pref-kcal', '0');
    await page.click('#save-prefs');
    await expect(page.locator('#toast')).toHaveText('Values must be numbers from 0 to 10000.');

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

    const dialogs = [];
    await autoConfirm(page, true, dialogs);
    await foodRow(page, 'Smoke rice').locator('[data-delete-food]').click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toBe('Delete “Smoke rice” from the diary (lunch)?');
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

    await autoConfirm(page, true);
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
    await autoConfirm(page, true);
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
    await autoConfirm(page, false);
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
    await autoConfirm(page, true, dialogs);

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
    await autoConfirm(page, false, dialogs);

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
    await autoConfirm(page, true, dialogs);

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

test.describe('Smoke: input limits and resilience', () => {
  test('values above the database limits are rejected in the forms', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(() => openModal('food', 'breakfast'));
    await page.fill('#food-name', 'Huge portion');
    await page.fill('#food-kcal', '99999999');
    await page.click('#food-save');
    await expect(page.locator('#toast')).toHaveText('Values must be numbers from 0 to 10000.');
    expect((await readStore(page)).foods).toHaveLength(0);

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '1000');
    await page.click('#weight-save');
    await expect(page.locator('#toast')).toHaveText('Enter a weight from 1 to 500 kg.');
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
    await expect(page.locator('#nav')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('unreadable', { timeout: 20_000 });
    const kept = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('smartdiet-corrupt-')).map((key) => localStorage.getItem(key)));
    expect(kept).toEqual(['{broken json']);
  });

  test('wrongly shaped saved data is repaired instead of crashing', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: 'oops', weights: 5, products: { a: 1 } });
    await expect(page.locator('#nav')).toBeVisible();
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
    await expect(page.locator('#nav')).toBeVisible();
    expect(external).toEqual([]);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('cdn.jsdelivr.net');
    expect(await page.evaluate(() => typeof window.supabase?.createClient)).toBe('function');
  });
});

test.describe('Smoke: accessibility', () => {
  test('settings fields and the diary date have accessible names', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const ids = ['auth-email', 'auth-password', 'pref-name', 'pref-lang', 'pref-kcal', 'pref-protein', 'pref-carbs', 'pref-fat', 'profile-birth', 'profile-sex', 'profile-height', 'profile-weight', 'profile-target', 'profile-activity', 'profile-pace', 'profile-notes', 'diary-date'];
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
    await expect(page.locator('#local-owner')).toContainText('alice@example.test');
    const dialogs = [];
    await autoConfirm(page, true, dialogs);
    await signIn(page, 'bob@example.test');

    await expect.poll(() => dialogs.length).toBe(3);
    expect(dialogs[0]).toContain('alice@example.test');
    expect(dialogs[0]).toContain('bob@example.test');
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).toContainText('Shared lunch');
    await expect.poll(() => backend.tables.food_entries.filter((row) => row.user_id === 'user-bob').length).toBe(1);
    await expect(page.locator('#local-owner')).toContainText('bob@example.test');
  });

  test('declining any confirmation uploads nothing and keeps the data separate', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);

    await signIn(page, 'alice@example.test');
    await openView(page, 'diary');
    await addFood(page, 'Private dinner', 'dinner');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    await signOut(page);
    const asked = [];
    await autoConfirm(page, [true, true, false], asked);
    await signIn(page, 'bob@example.test');

    await expect.poll(() => asked.length).toBe(3);
    expect(backend.tables.food_entries.filter((row) => row.user_id === 'user-bob')).toHaveLength(0);
    expect((await readStore(page)).foods).toHaveLength(0);
    const setAside = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('smartdiet-foreign-user-alice-')).length);
    expect(setAside).toBe(1);
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

const EMPTY_STORE = { prefs: BASE_PREFS, foods: [], weights: [] };

async function setDisplayName(page, backend, userId, name) {
  await openView(page, 'settings');
  await page.fill('#pref-name', name);
  await page.click('#save-profile');
  await expect.poll(() => backend.tables.profiles.find((row) => row.user_id === userId).display_name).toBe(name);
}

async function startUser(page, backend, email, name) {
  await mockSupabase(page, backend);
  await openApp(page, EMPTY_STORE);
  await connectSupabase(page);
  await signIn(page, email);
  await setDisplayName(page, backend, USERS[email], name);
}

const startAlice = (page, backend) => startUser(page, backend, 'alice@example.test', 'Alice');

async function openAsUser(browser, backend, email, name) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await startUser(page, backend, email, name);
  return { context, page };
}

function befriend(backend) {
  backend.tables.friendships.push({ id: 'friendship-seed', requester: 'user-alice', addressee: 'user-bob', status: 'accepted', created_at: new Date().toISOString() });
}

async function addProduct(page, name, kcal) {
  await openView(page, 'products');
  await page.click('#product-new');
  await page.fill('#food-name', name);
  await page.fill('#food-kcal', kcal);
  await page.click('#food-save');
  await expect(page.locator('#products-list')).toContainText(name);
}

async function shareFirstProductWith(page, friend) {
  await openView(page, 'settings');
  await expect(page.locator('#friends-list')).toContainText(friend);
  await openView(page, 'products');
  await page.locator('#products-list [data-toggle-product]').first().click();
  await page.locator('#products-list [data-share-product]').first().click();
  await expect(page.locator('#share-modal')).toHaveClass(/open/);
  await page.locator('#share-body label', { hasText: friend }).locator('input').check();
  await page.click('#share-confirm');
}

test.describe('Smoke: friends', () => {
  test('a request sent by code is accepted by the other person and both see each other', async ({ page, browser }) => {
    const backend = createBackend();
    await startAlice(page, backend);
    await expect(page.locator('#my-friend-code')).toHaveText('AAAA2222');

    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await bob.page.fill('#friend-code-input', 'aaaa2222');
    await bob.page.click('#friend-add');
    await expect(bob.page.locator('#toast')).toHaveText('Friend request sent.');
    await expect(bob.page.locator('#sent-requests')).toContainText('Alice');
    expect(backend.tables.friendships).toMatchObject([{ requester: 'user-bob', addressee: 'user-alice', status: 'pending' }]);

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await openView(page, 'settings');
    await expect(page.locator('#friend-requests')).toContainText('Bob');
    await page.click('[data-friend-accept]');
    await expect(page.locator('#toast')).toHaveText('Request accepted.');
    await expect(page.locator('#friends-list')).toContainText('Bob');
    expect(backend.tables.friendships[0].status).toBe('accepted');
    await bob.context.close();
  });

  test('unknown codes, own code and repeated requests are reported', async ({ page }) => {
    const backend = createBackend();
    await startAlice(page, backend);
    await expect(page.locator('#my-friend-code')).toHaveText('AAAA2222');

    for (const code of ['ZZZZ9999', 'AAAA2222', 'short']) {
      await page.fill('#friend-code-input', code);
      await page.click('#friend-add');
      await expect(page.locator('#toast')).toHaveText('User not found.');
      await expect(page.locator('#friend-code-input')).toHaveValue('');
      expect(backend.tables.friendships).toHaveLength(0);
    }

    await page.fill('#friend-code-input', 'BBBB3333');
    await page.click('#friend-add');
    await expect(page.locator('#toast')).toHaveText('Friend request sent.');
    await page.fill('#friend-code-input', 'BBBB3333');
    await page.click('#friend-add');
    await expect(page.locator('#toast')).toHaveText('Request or friendship already exists.');
    expect(backend.tables.friendships).toHaveLength(1);
  });

  test('too many lookups are rate limited', async ({ page }) => {
    const backend = createBackend();
    backend.friendAttempts['user-alice'] = { startedAt: Date.now(), count: 10 };
    await startAlice(page, backend);
    await page.fill('#friend-code-input', 'BBBB3333');
    await page.click('#friend-add');
    await expect(page.locator('#toast')).toHaveText('Too many attempts. Try again later.');
    expect(backend.tables.friendships).toHaveLength(0);
  });

  test('a pending request can be declined, and a friend can be removed', async ({ page, browser }) => {
    const backend = createBackend();
    backend.tables.friendships.push({ id: 'pending-1', requester: 'user-bob', addressee: 'user-alice', status: 'pending', created_at: new Date().toISOString() });
    await startAlice(page, backend);
    await expect(page.locator('#friend-requests')).toContainText('Bob');
    await page.click('[data-friend-reject]');
    await expect(page.locator('#friend-requests')).toContainText('No incoming requests.');
    expect(backend.tables.friendships).toHaveLength(0);

    befriend(backend);
    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await openView(page, 'settings');
    await expect(page.locator('#friends-list')).toContainText('Bob');
    await autoConfirm(page, true);
    await page.click('[data-friend-remove]');
    await expect(page.locator('#friends-list')).toContainText('Add a friend before sharing a product.');
    expect(backend.tables.friendships).toHaveLength(0);
  });
});

test.describe('Smoke: product sharing', () => {
  test('without friends a product cannot be sent', async ({ page }) => {
    const backend = createBackend();
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await page.locator('#products-list [data-toggle-product]').first().click();
    await page.locator('#products-list [data-share-product]').first().click();
    await expect(page.locator('#share-body')).toContainText('Add a friend before sharing a product.');
    await expect(page.locator('#share-confirm')).toBeDisabled();
  });

  test('a sent product reaches the inbox and is added to My products on accept', async ({ page, browser }) => {
    const backend = createBackend();
    befriend(backend);
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await shareFirstProductWith(page, 'Bob');
    await expect(page.locator('#toast')).toHaveText('Product sent.');
    expect(backend.tables.product_shares).toMatchObject([{ from_user: 'user-alice', to_user: 'user-bob', name: 'Oats', kcal: 150 }]);

    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await openView(bob.page, 'products');
    await expect(bob.page.locator('#inbox-open')).toHaveText('Inbox (1)');
    await bob.page.click('#inbox-open');
    await expect(bob.page.locator('#inbox-body')).toContainText('Alice');
    await expect(bob.page.locator('#inbox-body')).toContainText('Oats');
    await bob.page.click('[data-share-accept]');
    await expect(bob.page.locator('#toast')).toHaveText('Product added to My products.');
    await expect.poll(async () => (await readStore(bob.page)).products.map((item) => item.name)).toEqual(['Oats']);
    expect(backend.tables.product_shares).toHaveLength(0);
    await bob.context.close();
  });

  test('a declined product is removed from the inbox and not saved', async ({ page, browser }) => {
    const backend = createBackend();
    befriend(backend);
    backend.tables.product_shares.push({ id: 'share-1', from_user: 'user-alice', to_user: 'user-bob', name: 'Oats', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25, created_at: new Date().toISOString() });
    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await openView(bob.page, 'products');
    await bob.page.click('#inbox-open');
    await bob.page.click('[data-share-decline]');
    await expect(bob.page.locator('#toast')).toHaveText('Product declined.');
    await expect(bob.page.locator('#inbox-body')).toContainText('No new products.');
    expect(backend.tables.product_shares).toHaveLength(0);
    expect((await readStore(bob.page)).products || []).toHaveLength(0);
    await bob.context.close();
  });

  test('the sender can recall a product that has not been answered yet', async ({ page, browser }) => {
    const backend = createBackend();
    befriend(backend);
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await shareFirstProductWith(page, 'Bob');
    await expect(page.locator('#toast')).toHaveText('Product sent.');

    await openView(page, 'settings');
    await expect(page.locator('#sent-shares')).toContainText('Bob');
    await expect(page.locator('#sent-shares')).toContainText('Oats');
    await page.click('[data-share-recall]');
    await expect(page.locator('#toast')).toHaveText('Product recalled.');
    await expect(page.locator('#sent-shares')).toContainText('No sent products.');
    expect(backend.tables.product_shares).toHaveLength(0);

    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await openView(bob.page, 'products');
    await expect(bob.page.locator('#inbox-banner')).toBeHidden();
    await bob.context.close();
  });

  test('the twenty-product limit per friend is reported to the sender', async ({ page }) => {
    const backend = createBackend();
    befriend(backend);
    for (let i = 0; i < 20; i += 1) {
      backend.tables.product_shares.push({ id: `queued-${i}`, from_user: 'user-alice', to_user: 'user-bob', name: `Item ${i}`, grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, created_at: new Date().toISOString() });
    }
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await shareFirstProductWith(page, 'Bob');
    await expect(page.locator('#toast')).toHaveText('Could not send: this friend already has 20 products waiting in the inbox.');
    expect(backend.tables.product_shares).toHaveLength(20);
  });

  test('an incoming product with a name that already exists asks before replacing it', async ({ page, browser }) => {
    const backend = createBackend();
    befriend(backend);
    backend.tables.product_shares.push({ id: 'share-1', from_user: 'user-alice', to_user: 'user-bob', name: 'Oats', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25, created_at: new Date().toISOString() });
    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await addProduct(bob.page, 'Oats', '90');
    await bob.page.click('#inbox-open');
    await autoConfirm(bob.page, false);
    await bob.page.click('[data-share-accept]');
    expect(backend.tables.product_shares).toHaveLength(1);
    expect((await readStore(bob.page)).products.map((item) => item.kcal)).toEqual([90]);
    await autoConfirm(bob.page, true);
    await bob.page.click('[data-share-accept]');
    await expect.poll(async () => (await readStore(bob.page)).products.map((item) => item.kcal)).toEqual([150]);
    expect(backend.tables.product_shares).toHaveLength(0);
    await bob.context.close();
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
    await expect(metric.locator('.left-line')).toHaveText('left 1500 kcal');
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
    await expect(kcalLine).toHaveText('перебір 400 ккал');
    await expect(kcalLine).toHaveClass(/over/);
  });
});

const AI_STORE = (order) => ({
  prefs: BASE_PREFS,
  foods: [],
  weights: [],
  ai: { order, keys: { gemini: 'g-key', openai: 'sk-test', anthropic: 'a-key', groq: 'gsk_test', xai: 'xai-test' } },
});

test.describe('Smoke: AI provider fallback', () => {
  test('a failing provider is skipped and the next one answers', async ({ page }) => {
    await openApp(page, AI_STORE(['openai', 'groq']));
    const calls = [];
    await page.route('https://api.openai.com/**', (route) => {
      calls.push('openai');
      return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { message: 'upstream failure' } }) });
    });
    await page.route('https://api.groq.com/**', (route) => {
      calls.push('groq');
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'answer from groq' } }] }) });
    });
    const out = await page.evaluate(() => callAi('hello', false));
    expect(out).toBe('answer from groq');
    expect(calls).toEqual(['openai', 'groq']);
    expect(await page.evaluate(() => lastAi.name)).toBe('Groq');
  });

  test('providers that all hang give up within the shared time budget', async ({ page }) => {
    await openApp(page, AI_STORE(['gemini', 'openai', 'anthropic', 'groq', 'xai']));
    const calls = [];
    for (const [name, pattern] of [
      ['gemini', 'https://generativelanguage.googleapis.com/**'],
      ['openai', 'https://api.openai.com/**'],
      ['anthropic', 'https://api.anthropic.com/**'],
      ['groq', 'https://api.groq.com/**'],
      ['xai', 'https://api.x.ai/**'],
    ]) {
      await page.route(pattern, () => { calls.push(name); });
    }
    await page.clock.install();
    const result = page.evaluate(() => callAi('hello', false).then((value) => ({ value }), (error) => ({ error: error.message })));
    let settled = false;
    result.then(() => { settled = true; });
    for (let i = 0; i < 80 && !settled; i += 1) {
      await page.clock.runFor(1000);
      await page.waitForTimeout(25);
    }
    expect(settled).toBe(true);
    const { error } = await result;
    expect(error).toContain('Google Gemini');
    expect(error).toContain('OpenAI');
    expect(error).toContain('Anthropic Claude');
    expect(error).not.toContain('Groq');
    expect(error).not.toContain('xAI Grok');
    expect(calls).toEqual(['gemini', 'openai', 'anthropic']);
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

test.describe('Smoke: meal analysis, dietitian questions, calendar and intro', () => {
  test('calendar keeps the chosen day until Done, and Cancel discards it', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');
    const before = await page.locator('#diary-date').inputValue();
    await page.click('#diary-date');
    const first = await page.locator('.cal-day:not(.today)').first().getAttribute('data-cal-date');
    await page.locator(`[data-cal-date="${first}"]`).click();
    await expect(page.locator('#cal-modal')).toHaveClass(/open/);
    await expect(page.locator('#diary-date')).toHaveValue(before);
    await page.click('#cal-done');
    await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#diary-date')).toHaveValue(first);

    await page.click('#diary-date');
    const second = await page.locator(`.cal-day:not(.today):not([data-cal-date="${first}"])`).first().getAttribute('data-cal-date');
    await page.locator(`[data-cal-date="${second}"]`).click();
    await page.click('#cal-cancel');
    await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#diary-date')).toHaveValue(first);
  });

  test('overview expands only the meal where food was added last, and survives reload', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Oats', meal: 'breakfast', grams: 80, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: 1000 },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Soup', meal: 'lunch', grams: 300, kcal: 200, protein: 8, fat: 6, carbs: 25, date: today, createdAt: 2000 },
      ],
      weights: [],
    });
    const card = (meal) => page.locator(`#home-meals .meal-card[data-meal-key="home|${today}|${meal}"]`);
    await expect(card('lunch')).not.toHaveClass(/collapsed/);
    await expect(card('breakfast')).toHaveClass(/collapsed/);

    await page.evaluate((date) => {
      state.foods = state.foods.filter((f) => !(f.meal === 'lunch' && f.date === date));
      save();
    }, today);
    await expect(card('breakfast')).not.toHaveClass(/collapsed/);
    await expect(card('lunch')).toHaveClass(/collapsed/);

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await expect(card('breakfast')).not.toHaveClass(/collapsed/);
    await expect(card('lunch')).toHaveClass(/collapsed/);
  });

  test('meal and whole-day analysis send only today’s entries and show the answer', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    await page.clock.setFixedTime(noon);
    await openApp(page, {
      ...AI_STORE(['groq']),
      foods: [
        { id: '33333333-3333-4333-8333-333333333333', name: 'Rice bowl', meal: 'lunch', grams: 250, kcal: 420, protein: 12, fat: 8, carbs: 70, date: today, createdAt: 3000 },
        { id: '44444444-4444-4444-8444-444444444444', name: 'Old tea', meal: 'lunch', grams: 200, kcal: 5, protein: 0, fat: 0, carbs: 1, date: '2020-01-01', createdAt: 1 },
      ],
    });
    let body = '';
    await page.route('https://api.groq.com/**', (route) => {
      body = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Balanced lunch. Add vegetables.' } }] }) });
    });

    await page.click('#view-home [data-analyze="lunch"]');
    await expect(page.locator('#analysis-modal')).toHaveClass(/open/);
    await expect(page.locator('#analysis-body')).toContainText('Balanced lunch. Add vegetables.');
    expect(body).toContain('Rice bowl');
    expect(body).not.toContain('Old tea');
    await page.click('#analysis-close');
    await expect(page.locator('#analysis-modal')).not.toHaveClass(/open/);

    await page.click('#view-home [data-analyze="dinner"]');
    await expect(page.locator('#analysis-body')).toContainText('Nothing is logged here yet');
    await page.click('#analysis-close');

    await page.click('#view-home [data-analyze="day"]');
    await expect(page.locator('#analysis-title')).toHaveText('Analysis: Whole day');
    await expect(page.locator('#analysis-body')).toContainText('Balanced lunch. Add vegetables.');
    expect(body).toContain('Rice bowl');
    expect(body).toContain('Current time: 12:00');
    expect(body).toContain('Not logged, but later meals are already recorded: breakfast. These were most likely skipped.');
    expect(body).toContain('Still ahead today: dinner');
    await page.keyboard.press('Escape');
    await expect(page.locator('#analysis-modal')).not.toHaveClass(/open/);
  });

  test('diary analysis buttons sit on each meal and the day, and analyze the selected date', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      ...AI_STORE(['groq']),
      foods: [
        { id: '55555555-5555-4555-8555-555555555555', name: 'Rice bowl', meal: 'lunch', grams: 250, kcal: 420, protein: 12, fat: 8, carbs: 70, date: today, createdAt: 3000 },
        { id: '66666666-6666-4666-8666-666666666666', name: 'Old tea', meal: 'lunch', grams: 200, kcal: 5, protein: 0, fat: 0, carbs: 1, date: '2020-01-01', createdAt: 1 },
      ],
    });
    let body = '';
    await page.route('https://api.groq.com/**', (route) => {
      body = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Light lunch. Add protein.' } }] }) });
    });

    await openView(page, 'diary');
    await page.evaluate(() => { $('#diary-date').value = '2020-01-01'; render(); });
    await expect(page.locator('#diary-meals .meal-card[data-meal-key^="diary|2020-01-01|lunch"] .meal-head [data-analyze]')).toHaveCount(0);
    await page.click('#diary-meals [data-analyze="lunch"]');
    await expect(page.locator('#analysis-body')).toContainText('Light lunch. Add protein.');
    expect(body).toContain('Old tea');
    expect(body).not.toContain('Rice bowl');
    await page.keyboard.press('Escape');
    await expect(page.locator('#analysis-modal')).not.toHaveClass(/open/);

    await page.click('#diary-summary [data-analyze="day"]');
    await expect(page.locator('#analysis-title')).toHaveText('Analysis: Whole day');
    expect(body).toContain('Old tea');
    expect(body).not.toContain('Rice bowl');
  });

  test('whole-day analysis treats a skipped breakfast as skipped when lunch and dinner are logged', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const evening = new Date();
    evening.setHours(20, 0, 0, 0);
    await page.clock.setFixedTime(evening);
    await openApp(page, {
      ...AI_STORE(['groq']),
      foods: [
        { id: '77777777-7777-4777-8777-777777777777', name: 'Soup', meal: 'lunch', grams: 300, kcal: 200, protein: 8, fat: 6, carbs: 25, date: today, createdAt: 2000 },
        { id: '88888888-8888-4888-8888-888888888888', name: 'Fish', meal: 'dinner', grams: 200, kcal: 350, protein: 30, fat: 14, carbs: 5, date: today, createdAt: 4000 },
      ],
    });
    let body = '';
    await page.route('https://api.groq.com/**', (route) => {
      body = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Add breakfast tomorrow.' } }] }) });
    });
    await page.click('#view-home [data-analyze="day"]');
    await expect(page.locator('#analysis-body')).toContainText('Add breakfast tomorrow.');
    expect(body).toContain('Not logged, but later meals are already recorded: breakfast.');
    expect(body).not.toContain('Still ahead today');
    expect(body).toContain('do not suggest making up for it with fasting');
  });

  test('Ask the Dietitian sends no diary or profile data and keeps its history', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      ...AI_STORE(['groq']),
      prefs: { ...BASE_PREFS, name: 'Denys', birthDate: '1990-01-01' },
      foods: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Secret pear', meal: 'snack', grams: 100, kcal: 60, protein: 1, fat: 0, carbs: 15, date: today, createdAt: 4000 }],
    });
    let body = '';
    await page.route('https://api.groq.com/**', (route) => {
      body = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Aim for protein at every meal.' } }] }) });
    });

    await page.click('[data-action="open-ask"]');
    await expect(page.locator('#ask-panel')).toHaveClass(/open/);
    await expect(page.locator('#chat-panel')).not.toHaveClass(/open/);
    await page.fill('#ask-input', 'How much protein do I need?');
    await page.click('#ask-send');
    await expect(page.locator('#ask-box')).toContainText('Aim for protein at every meal.');
    expect(body).toContain('How much protein do I need?');
    expect(body).not.toContain('Secret pear');
    expect(body).not.toContain('1990-01-01');
    expect(body).not.toContain('Denys');

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await page.click('[data-action="open-ask"]');
    await expect(page.locator('#ask-box')).toContainText('How much protein do I need?');
    await expect(page.locator('#ask-box')).toContainText('Aim for protein at every meal.');

    await page.click('#ask-clear');
    await page.locator('#confirm-ok').click();
    await expect(page.locator('#ask-box .bubble:not(#ask-welcome)')).toHaveCount(0);
  });

  test('the system launch screen uses the intro colour, so no light flash shows first', async ({ page }) => {
    const manifest = await (await page.request.get('/manifest.json')).json();
    expect(manifest.background_color).toBe('#0d4b2a');
    expect(manifest.theme_color).toBe('#0d4b2a');
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0d4b2a');
  });

  test('the launch intro shows the app mark and then leaves the screen', async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#intro .intro-word')).toHaveText('Smart Diet AI');
    await expect(page.locator('#intro')).toHaveCount(0, { timeout: 6000 });
  });
});

test.describe('Smoke: dialog focus', () => {
  test('opening the dietitian chat does not open the keyboard by itself', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.locator('#chat-fab').click();
    await expect(page.locator('#chat-panel')).toHaveClass(/open/);
    await expect(page.locator('#chat-input')).not.toBeFocused();
  });
});

test.describe('Smoke: weigh-in deletion in the cloud', () => {
  test('a weigh-in deleted while its upload is still in flight does not come back', async ({ page }) => {
    const backend = createBackend();
    backend.delayWeightWrites = 1500;
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, currentWeight: 97 }, foods: [], weights: [] });
    await connectSupabase(page);
    await autoConfirm(page, true);
    await signIn(page, 'alice@example.test');

    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '96');
    await page.click('#weight-save');
    await openView(page, 'stats');
    await page.locator('#weight-history [data-delete-weight]').first().click();
    await expect(page.locator('#weight-history')).not.toContainText('96');
    await page.waitForTimeout(2500);

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await openView(page, 'stats');
    await expect(page.locator('#weight-history')).not.toContainText('96');
    expect(backend.tables.weight_entries).toHaveLength(0);
  });

  test('a deleted weigh-in stays deleted after reload and the profile weight is shown again', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, currentWeight: 97 }, foods: [], weights: [] });
    await connectSupabase(page);
    await autoConfirm(page, true);
    await signIn(page, 'alice@example.test');

    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '96');
    await page.click('#weight-save');
    await expect.poll(() => backend.tables.weight_entries.map((row) => Number(row.value))).toEqual([96]);

    await openView(page, 'stats');
    await autoConfirm(page, true);
    await page.locator('#weight-history [data-delete-weight]').first().click();
    await expect.poll(() => backend.tables.weight_entries.length).toBe(0);
    await expect(page.locator('#weight-history')).not.toContainText('96');

    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await expect.poll(() => backend.tables.weight_entries.length).toBe(0);
    await openView(page, 'stats');
    await expect(page.locator('#weight-history')).not.toContainText('96');
    await openView(page, 'home');
    await expect(page.locator('#home-weight')).toHaveText('97.0');
  });
});

test.describe('Smoke: AI character', () => {
  test('the playful character changes app texts and the choice survives reload', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await expect(page.locator('#chat-welcome')).not.toContainText('croissant');
    await openView(page, 'settings');
    await expect(page.locator('#pref-tone')).toHaveValue('polite');
    await page.selectOption('#pref-tone', 'playful');
    await page.click('#save-tone');
    await expect(page.locator('#chat-welcome')).toContainText('just one more croissant');
    await page.reload();
    await expect(page.locator('#nav')).toBeVisible();
    await openView(page, 'settings');
    await expect(page.locator('#pref-tone')).toHaveValue('playful');
    expect((await readStore(page)).prefs.aiTone).toBe('playful');
  });
});
