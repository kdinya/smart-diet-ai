const { test, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://wscprmtjjbevesrchhjr.supabase.co';
const PASSWORD = 'correct-horse-battery';
const USERS = {
  'alice@example.test': 'user-alice',
  'bob@example.test': 'user-bob',
  'new@example.test': 'user-new',
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
    foodWriteStarted: false,
    foodWriteRelease: null,
    failDeletes: false,
    failProfiles: false,
    authEvents: [],
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

    if (url.pathname === '/auth/v1/signup') {
      const body = req.postDataJSON();
      backend.authEvents.push({ action: 'signup', email: body.email });
      const id = USERS[body.email];
      if (!id || body.password !== PASSWORD) return json(400, { msg: 'Invalid signup request' });
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
    if (url.pathname === '/rest/v1/food_entries' && req.method() === 'POST' && backend.delayFoodWrites) {
      backend.foodWriteStarted = true;
      await new Promise((resolve) => { backend.foodWriteRelease = resolve; });
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
    const removed = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      const allowed = table === 'product_shares' ? row.to_user === uid || row.from_user === uid : visible(row);
      if (allowed && matchesFilters(row, params)) {
        removed.unshift(row);
        rows.splice(i, 1);
      }
    }
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(removed) });
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
  await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
}

async function readStore(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('smartdiet-v1') || '{}'));
}

async function openView(page, view) {
  await page.locator(`#nav:visible [data-view="${view}"], #mobile-nav:visible [data-view="${view}"]`).click();
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

test.describe('Smoke: app version', () => {
  test('shows the current release version in Settings in both interface languages', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openView(page, 'settings');
    await expect(page.locator('#app-version')).toHaveText('2026.10.2');
    await expect(page.locator('[data-i18n="appVersion"]')).toHaveText('Версія застосунку');
    await page.selectOption('#pref-lang', 'en');
    await page.locator('#save-lang').click();
    await expect(page.locator('#app-version')).toHaveText('2026.10.2');
    await expect(page.locator('[data-i18n="appVersion"]')).toHaveText('App version');
    await page.locator('#app-version').click();
    await expect(page.locator('#release-history-modal')).toBeVisible();
    const versions = page.locator('#release-history-list > details');
    await expect(versions).toHaveCount(3);
    await expect(versions.nth(0).locator('summary')).toContainText('2026.10.2');
    await expect(versions.nth(1).locator('summary')).toContainText('2026.10.1');
    await expect(versions.nth(2).locator('summary')).toContainText('2026.10.0');
    const latest = versions.first();
    await expect(latest.locator('summary')).toContainText('2026.10.2');
    await latest.locator('summary').click();
    await expect(latest).toHaveAttribute('open', '');
    await expect(latest).toContainText('Expandable release history in Settings.');
    await expect(versions.nth(2)).toContainText('bilingual food diary');
    await expect(versions.nth(2)).toContainText('Added');
    await page.locator('#release-history-close').click();
    await page.selectOption('#pref-lang', 'uk');
    await page.locator('#save-lang').click();
    await page.locator('#app-version').click();
    const latestUk = page.locator('#release-history-list > details').first();
    await expect(latestUk.locator('summary')).toContainText('2026.10.2');
    await latestUk.locator('summary').click();
    await expect(latestUk).toContainText('Розгортаний журнал версій у налаштуваннях.');
    const initialUk = page.locator('#release-history-list > details').last();
    await expect(initialUk.locator('summary')).toContainText('2026.10.0');
    await initialUk.locator('summary').click();
    await expect(initialUk).toContainText('Smart Diet AI — двомовний харчовий щоденник');
    await expect(initialUk).toContainText('Додано');
  });
});

test.describe('Smoke: goals', () => {
  test('saves daily goals, keeps them after reload, and rejects invalid numbers', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });

    await openView(page, 'settings');
    await page.fill('#pref-kcal', '1800');
    await page.fill('#pref-protein', '120');
    await page.fill('#pref-carbs', '200');
    await page.fill('#pref-fat', '60');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Goals saved.');

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
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
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Values must be numbers from 0 to 10000.');

    await page.fill('#pref-kcal', '0');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Values must be numbers from 0 to 10000.');

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
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Entry deleted.');
    await expect(foodRow(page, 'Smoke rice')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Smoke rice');
    expect((await readStore(page)).foods).toHaveLength(0);
    expect(await page.evaluate(() => syncQueue.delFoods)).toHaveLength(0);
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
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Entry deleted.');
    await expect.poll(() => backend.tables.food_entries.length).toBe(0);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Smoke oats');
  });

  test('a deletion during an in-flight food upload stays deleted after reload', async ({ page }) => {
    const backend = createBackend();
    backend.delayFoodWrites = true;
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    await openView(page, 'diary');
    await addFood(page, 'Race condition oats');
    await expect.poll(() => backend.foodWriteStarted).toBe(true);
    await foodRow(page, 'Race condition oats').locator('[data-delete-food]').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.locator('#confirm-ok').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Entry deleted.');
    backend.foodWriteRelease();
    await expect.poll(() => backend.tables.food_entries.length).toBe(0, { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => syncQueue.delFoods.length)).toBe(0, { timeout: 10000 });
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Race condition oats');
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
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Saved locally; sync failed:');
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/open/);
    await expect(foodRow(page, 'Smoke eggs')).toHaveCount(1);
    expect(backend.tables.food_entries).toHaveLength(1);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    expect((await readStore(page)).foods.map((food) => food.name)).toContain('Smoke eggs');
    expect(await page.evaluate(() => syncQueue.delFoods[0]?.food?.name)).toBe('Smoke eggs');
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
    mealActivity: { '2026-10-24|lunch': false },
    snackPositions: { '2026-10-24|snack-id': { after:'breakfast', order:0 } },
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
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Imported 2 entries and 1 weigh-ins.');

    const imported = await readStore(page);
    expect(imported.foods.map((food) => food.name).sort()).toEqual(['Imported oatmeal', 'Imported soup']);
    expect(imported.weights.map((weight) => [weight.date, weight.value])).toEqual([['2026-10-24', 80.2]]);
    expect(imported.prefs.kcal).toBe(1800);
    expect(imported.prefs.name).toBe('Imported');
    expect(imported.prefs.mealActivity['2026-10-24|lunch']).toBe(false);
    expect(imported.prefs.snackPositions['2026-10-24|snack-id']).toEqual({after:'breakfast',order:0});

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
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
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('This file is not a Smart Diet AI backup.');
    expect(dialogs).toHaveLength(0);
    expect((await readStore(page)).foods.map((food) => food.name)).toEqual(['Old local entry']);

    await page.setInputFiles('#import-file', backupFile('{"foods": [ broken'));
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('This file is not a Smart Diet AI backup.');
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
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Values must be numbers from 0 to 10000.');
    expect((await readStore(page)).foods).toHaveLength(0);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '1000');
    await page.click('#weight-save');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Enter a weight from 1 to 500 kg.');
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
    await expect(page.locator('#onboard-auth-submit')).toHaveText('Sign in');
    await page.fill('#onboard-auth-email', 'alice@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect.poll(async () => (await readStore(page)).synced?.uid).toBe(USERS['alice@example.test']);
    await expect(page.locator('#onboarding-profile')).toBeVisible();
    await expect(page.locator('#onboarding-modal')).toHaveClass(/open/);
  });

  test('registration opens a signup form and submits email and password to Supabase signup', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false }, foods: [], weights: [] });
    await page.locator('#onboarding-choice-signup').click();
    await expect(page.locator('#onboard-auth-submit')).toHaveText('Create account');
    await expect(page.locator('#onboard-auth-password')).toHaveAttribute('autocomplete', 'new-password');
    await page.fill('#onboard-auth-email', 'new@example.test');
    await page.fill('#onboard-auth-password', PASSWORD);
    await page.locator('#onboard-auth-submit').click();
    await expect.poll(async () => backend.authEvents).toEqual([{ action: 'signup', email: 'new@example.test' }]);
    await expect.poll(async () => (await readStore(page)).synced?.uid).toBe(USERS['new@example.test']);
    await expect(page.locator('#onboarding-profile')).toBeVisible();
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
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 1' })).toHaveCount(1);

    await openView(page, 'home');
    await expect(page.locator('#home-meals .meal-card')).toHaveCount(4);
    await expect(page.locator('#home-meals')).toContainText('Apple');
    await expect(page.locator('#chat-meal')).toHaveCount(0);
  });

  test('multiple snack events are numbered, grouped, and survive reload', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => { window.__testNow = Date.now(); Date.now = () => window.__testNow; window.__advanceTestClock = ms => { window.__testNow += ms; }; });
    await openView(page, 'diary');
    await addFood(page, 'Apple', 'snack');
    let first = page.locator('#diary-meals [data-meal-key*="|snack|"]').first();
    await first.locator('[data-action="add-food"]').click();
    for (const [id, value] of [['#food-name','Pear'],['#food-grams','100'],['#food-kcal','50'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','12']]) await page.fill(id,value);
    await page.click('#food-save');
    await page.evaluate(() => window.__advanceTestClock(60 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    for (const [id, value] of [['#food-name','Banana'],['#food-grams','100'],['#food-kcal','90'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','23']]) await page.fill(id,value);
    await page.click('#food-save');
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 1' })).toHaveCount(1);
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 2' })).toHaveCount(1);
    const foods = (await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(foods).toHaveLength(3);
    expect(foods[0].snackId).toBe(foods[1].snackId);
    expect(foods[2].snackId).not.toBe(foods[0].snackId);
    await page.reload();
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 1' })).toHaveCount(1);
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 2' })).toHaveCount(1);
  });

  test('meal activity icons toggle totals while preserving food entries', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); });
    await openApp(page, { prefs: BASE_PREFS, foods: [
      { id:'aaaa1111-1111-4111-8111-111111111111', name:'Today oats', meal:'lunch', grams:100, kcal:300, protein:10, fat:5, carbs:50, date:today, createdAt:1 },
      { id:'bbbb2222-2222-4222-8222-222222222222', name:'Tomorrow oats', meal:'lunch', grams:100, kcal:600, protein:20, fat:10, carbs:100, date:tomorrow, createdAt:2 },
    ], weights:[] });
    await openView(page,'diary');
    await page.evaluate(date=>{let input=document.querySelector('#diary-date');input.value=date;input.dispatchEvent(new Event('change'))},tomorrow);
    const future=page.locator('#diary-meals .meal-card').nth(1);
    await expect(future).toHaveClass(/excluded/);
    await expect(future.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'closed');
    await expect(future.locator('.meal-activity-status')).toHaveCount(0);
    const futureHeader = await future.locator('.meal-top').evaluate(el => {
      const eye = el.querySelector('[data-meal-activity]').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el.querySelector('.meal-title'));
      const title = range.getBoundingClientRect();
      return { eyeRight: eye.right, titleLeft: title.left };
    });
    expect(futureHeader.eyeRight).toBeLessThanOrEqual(futureHeader.titleLeft);
    await expect(future.locator('.meal-list')).toContainText('Tomorrow oats');
    await expect(future.locator('.meal-kcal')).toContainText('600 / 700');
    await future.locator('[data-meal-activity]').click();
    await expect(future).not.toHaveClass(/excluded/);
    await expect(future.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await expect(future.locator('.meal-kcal')).toContainText('600 / 700');
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(true);

    const confirmations=[]; await autoConfirm(page,true,confirmations);
    await openView(page,'diary');
    const current=page.locator('#diary-meals .meal-card').nth(1);
    await expect(current.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await current.locator('[data-meal-activity]').click();
    await expect.poll(()=>confirmations.length).toBe(1);
    await expect(current).toHaveClass(/excluded/);
    await expect(current.locator('.meal-list')).toContainText('Today oats');
    await expect(current.locator('.meal-kcal')).toContainText('300 / 700');
    expect((await readStore(page)).prefs.mealActivity[`${today}|lunch`]).toBe(false);
  });

  test('inactive meal keeps its own stats, anchors snacks, and stays excluded after date rollover', async ({ page }) => {
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en', mealActivity: {
      [`${tomorrow}|breakfast`]: true,
      [`${tomorrow}|lunch`]: false,
      [`${tomorrow}|dinner`]: true,
    } }, foods: [
      { id:'aaaa1111-1111-4111-8111-111111111111', name:'Breakfast oats', meal:'breakfast', grams:100, kcal:100, protein:5, fat:2, carbs:15, date:tomorrow, createdAt:100 },
      { id:'bbbb2222-2222-4222-8222-222222222222', name:'Lunch rice', meal:'lunch', grams:100, kcal:600, protein:12, fat:4, carbs:80, date:tomorrow, createdAt:200 },
      { id:'cccc3333-3333-4333-8333-333333333333', name:'Afternoon apple', meal:'snack', grams:100, kcal:80, protein:0, fat:0, carbs:20, date:tomorrow, createdAt:300, snackId:'afternoon-snack' },
      { id:'dddd4444-4444-4444-8444-444444444444', name:'Dinner fish', meal:'dinner', grams:100, kcal:300, protein:25, fat:12, carbs:5, date:tomorrow, createdAt:400 },
    ], weights:[] });
    await openView(page, 'diary');
    await page.evaluate(date => { const input=document.querySelector('#diary-date'); input.value=date; input.dispatchEvent(new Event('change')); }, tomorrow);
    const titles = () => page.locator('#diary-meals .meal-title').allTextContents();
    expect(await titles()).toEqual(['Breakfast', 'Lunch', 'Snack 1', 'Dinner']);
    let lunch = page.locator('#diary-meals .meal-card').nth(1);
    await expect(lunch).toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-kcal')).toContainText('600 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('400');

    const nextDayTime = await page.evaluate(date => new Date(`${date}T12:00:00`).getTime(), tomorrow);
    await page.addInitScript(time => {
      const NativeDate = Date;
      class FixedDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
      }
      Object.defineProperty(window, 'Date', { value: FixedDate });
    }, nextDayTime);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    lunch = page.locator('#diary-meals .meal-card').nth(1);
    await expect(lunch).toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'closed');
    await expect(lunch.locator('.meal-kcal')).toContainText('600 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('480');
    expect(await titles()).toEqual(['Breakfast', 'Lunch', 'Snack 1', 'Dinner']);

    await lunch.locator('[data-meal-activity]').click();
    await expect(lunch).not.toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('1080');
    expect(await titles()).toEqual(['Breakfast', 'Lunch', 'Snack 1', 'Dinner']);
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(true);
  });

  test('food added for tomorrow remains excluded after that date arrives until activated', async ({ page }) => {
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); });
    const nextDayTime = await page.evaluate(date => new Date(`${date}T12:00:00`).getTime(), tomorrow);
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights:[] });
    await openView(page, 'diary');
    await page.evaluate(date => { const input=document.querySelector('#diary-date'); input.value=date; input.dispatchEvent(new Event('change')); }, tomorrow);
    await page.locator('#diary-meals .meal-card').nth(1).locator('[data-toggle-meal]').click();
    await addFood(page, 'Tomorrow lunch', 'lunch');
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(false);
    await expect(page.locator('#diary-meals .meal-card').nth(1)).toHaveClass(/excluded/);
    await expect(page.locator('#diary-meals .meal-card').nth(1).locator('.meal-kcal')).toContainText('250 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('0');

    await page.addInitScript(time => {
      const NativeDate = Date;
      class FixedDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
      }
      Object.defineProperty(window, 'Date', { value: FixedDate });
    }, nextDayTime);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    const lunch = page.locator('#diary-meals .meal-card').nth(1);
    await expect(lunch).toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'closed');
    await expect(lunch.locator('.meal-kcal')).toContainText('250 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('0');
    await lunch.locator('[data-meal-activity]').click();
    await expect(lunch).not.toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('250');
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(true);
  });

  test('past meal activity is always counted and eye controls appear only for today and tomorrow', async ({ page }) => {
    const dates = await page.evaluate(() => {
      const today = new Date();
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      return { today: today.toLocaleDateString('en-CA'), yesterday: yesterday.toLocaleDateString('en-CA'), dayAfterTomorrow: dayAfterTomorrow.toLocaleDateString('en-CA') };
    });
    await openApp(page, { prefs: { ...BASE_PREFS, mealActivity: { [`${dates.yesterday}|lunch`]: false } }, foods: [
      { id:'51515151-5151-4151-8151-515151515151', name:'Вчорашня каша', meal:'lunch', grams:100, kcal:300, protein:10, fat:5, carbs:50, date:dates.yesterday, createdAt:1 },
      { id:'61616161-6161-4161-8161-616161616161', name:'Пізній запис', meal:'lunch', grams:100, kcal:400, protein:15, fat:8, carbs:60, date:dates.dayAfterTomorrow, createdAt:2 },
    ], weights:[] });
    await openView(page, 'diary');
    const selectDiaryDate = async (date) => {
      await page.click('#diary-date');
      while (true) {
        const visibleMonth = (await page.locator('#cal-days .cal-day').first().getAttribute('data-cal-date')).slice(0, 7);
        if (visibleMonth === date.slice(0, 7)) break;
        await page.locator(visibleMonth < date.slice(0, 7) ? '#cal-next' : '#cal-prev').click();
      }
      await page.locator(`[data-cal-date="${date}"]`).click();
      await page.click('#cal-done');
    };
    await selectDiaryDate(dates.yesterday);
    const yesterdayCard = page.locator('#diary-meals .meal-card').nth(1);
    await expect(yesterdayCard.locator('.meal-title')).toContainText('Lunch');
    await expect(yesterdayCard).not.toHaveClass(/excluded/);
    await expect(yesterdayCard.locator('[data-meal-activity]')).toHaveCount(0);
    await expect(yesterdayCard.locator('.meal-kcal')).toContainText('300 / 700');

    await selectDiaryDate(dates.dayAfterTomorrow);
    const futureCard = page.locator('#diary-meals .meal-card').nth(1);
    await expect(futureCard.locator('[data-meal-activity]')).toHaveCount(0);
    await expect(futureCard).toHaveClass(/excluded/);
    await expect(futureCard.locator('.meal-kcal')).toContainText('400 / 700');
  });

  test('snack arrows move a snack across fixed main meals and persist', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page,{prefs:{...BASE_PREFS,lang:'en'},foods:[
      {id:'cccc1111-1111-4111-8111-111111111111',name:'Breakfast food',meal:'breakfast',grams:100,kcal:200,protein:5,fat:3,carbs:30,date:today,createdAt:100,mealOrder:1},
      {id:'dddd2222-2222-4222-8222-222222222222',name:'Snack food',meal:'snack',grams:100,kcal:100,protein:2,fat:1,carbs:20,date:today,createdAt:200,mealOrder:2,snackId:'snack-a'},
      {id:'eeee3333-3333-4333-8333-333333333333',name:'Lunch food',meal:'lunch',grams:100,kcal:300,protein:10,fat:5,carbs:40,date:today,createdAt:300,mealOrder:3},
      {id:'ffff4444-4444-4444-8444-444444444444',name:'Dinner food',meal:'dinner',grams:100,kcal:400,protein:20,fat:8,carbs:50,date:today,createdAt:400,mealOrder:4},
    ],weights:[]});
    await openView(page,'diary');
    const cards=page.locator('#diary-meals .meal-card');
    await expect(cards).toHaveCount(4);
    let titles=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(titles).toEqual(['Breakfast','Snack 1','Lunch','Dinner']);
    const snack=page.locator('#diary-meals [data-meal-key*="|snack|"]').first();
    await snack.locator('[data-snack-move="1"]').click();
    titles=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(titles).toEqual(['Breakfast','Lunch','Snack 1','Dinner']);
    await snack.locator('[data-snack-move="-1"]').click();
    titles=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(titles).toEqual(['Breakfast','Snack 1','Lunch','Dinner']);
    await page.reload();
    await expect(page.locator('#diary-meals .meal-title')).toHaveText(['Breakfast','Snack 1','Lunch','Dinner']);
  });

  test('main meals stay in breakfast-lunch-dinner order when added out of order', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openView(page, 'diary');
    await addFood(page, 'Dinner food', 'dinner');
    await addFood(page, 'Breakfast food', 'breakfast');
    await addFood(page, 'Lunch food', 'lunch');
    const labels=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(labels.indexOf('Сніданок')).toBeLessThan(labels.indexOf('Обід'));
    expect(labels.indexOf('Обід')).toBeLessThan(labels.indexOf('Вечеря'));
    await page.locator('#diary-meals [data-meal="snack"]').first().click();
    for (const [id, value] of [['#food-name','Snack food'],['#food-grams','100'],['#food-kcal','90'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','23']]) await page.fill(id,value);
    await page.click('#food-save');
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Перекус 1' })).toHaveCount(1);
    const ordered=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(ordered.indexOf('Сніданок')).toBeLessThan(ordered.indexOf('Обід'));
    expect(ordered.indexOf('Обід')).toBeLessThan(ordered.indexOf('Вечеря'));
    expect(ordered.indexOf('Вечеря')).toBeLessThan(ordered.indexOf('Перекус 1'));
  });

  test('snacks added less than an hour apart share the same snack event', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => { window.__testNow = Date.now(); Date.now = () => window.__testNow; window.__advanceTestClock = ms => { window.__testNow += ms; }; });
    await openView(page, 'diary');
    await addFood(page, 'Apple', 'snack');
    const firstId=(await readStore(page)).foods.find(f=>f.meal==='snack').snackId;
    await page.evaluate(() => window.__advanceTestClock(59 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    for (const [id, value] of [['#food-name','Pear'],['#food-grams','100'],['#food-kcal','50'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','12']]) await page.fill(id,value);
    await page.click('#food-save');
    let foods=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(foods).toHaveLength(2);
    expect(foods[0].snackId).toBe(firstId);
    expect(foods[1].snackId).toBe(firstId);
    await page.evaluate(() => window.__advanceTestClock(60 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    for (const [id, value] of [['#food-name','Banana'],['#food-grams','100'],['#food-kcal','90'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','23']]) await page.fill(id,value);
    await page.click('#food-save');
    foods=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(foods).toHaveLength(3);
    expect(foods[2].snackId).not.toBe(firstId);
  });

  test('a main meal interrupts the snack hour but an existing snack can still receive food', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => { window.__testNow = Date.now(); Date.now = () => window.__testNow; window.__advanceTestClock = ms => { window.__testNow += ms; }; });
    await openView(page, 'diary');
    await addFood(page, 'Apple', 'snack');
    const firstId=(await readStore(page)).foods.find(f=>f.meal==='snack').snackId;
    await page.evaluate(() => window.__advanceTestClock(15 * 60 * 1000));
    await addFood(page, 'Lunch', 'lunch');
    await page.evaluate(() => window.__advanceTestClock(10 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    for (const [id, value] of [['#food-name','Pear'],['#food-grams','100'],['#food-kcal','50'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','12']]) await page.fill(id,value);
    await page.click('#food-save');
    let snacks=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(snacks).toHaveLength(2);
    expect(snacks[0].snackId).toBe(firstId);
    expect(snacks[1].snackId).not.toBe(firstId);
    const firstCard=page.locator(`#diary-meals [data-meal-key*="|snack|${firstId}"]`).first();
    await firstCard.locator('[data-action="add-food"]').click();
    for (const [id, value] of [['#food-name','Orange'],['#food-grams','100'],['#food-kcal','45'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','11']]) await page.fill(id,value);
    await page.click('#food-save');
    snacks=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(snacks).toHaveLength(3);
    expect(snacks[2].snackId).toBe(firstId);
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

  test('dietitian has no meal selector and shows meal choice only in add configuration', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.click('#chat-fab');
    await expect(page.locator('#chat-meal')).toHaveCount(0);
    await expect(page.locator('#chat-panel .chat-context select')).toHaveCount(0);
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

  test('dietitian has no separate meal selection control', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const meals = await page.evaluate(() => [8, 12, 15, 16, 21].map((h) => autoMeal(h)));
    expect(meals).toEqual(['breakfast', 'lunch', 'lunch', 'dinner', 'dinner']);
    await page.click('#chat-fab');
    await expect(page.locator('#chat-meal')).toHaveCount(0);
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
    await expect(page.locator('#pick-dates [data-pick-date="tomorrow"]')).toBeVisible();
    await page.locator('#pick-dates [data-pick-date="today"]').click();
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

  test('saved-product selectors use the My products font size and alphabetical order', async ({ page }) => {
    const products = [
      { id: 'product-z', name: 'Zucchini', grams: 100, kcal: 20, protein: 1, fat: 0, carbs: 4 },
      { id: 'product-b', name: 'Buckwheat', grams: 100, kcal: 110, protein: 4, fat: 1, carbs: 22 },
      { id: 'product-a', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14 },
    ];
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });

    await openView(page, 'products');
    const savedNames = page.locator('#products-list .product-name');
    await expect(savedNames).toHaveText(['Apple', 'Buckwheat', 'Zucchini']);
    await expect(savedNames.first()).toHaveCSS('font-size', '14px');

    await openView(page, 'home');
    await page.locator('#meal-plan-open').click();
    const planNames = page.locator('#meal-plan-products .meal-plan-picker-name');
    await expect(planNames).toHaveText(['Apple', 'Buckwheat', 'Zucchini']);
    await expect(planNames.first()).toHaveCSS('font-size', '14px');
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').first()).toHaveCSS('padding-top', '7px');
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').first()).toHaveCSS('padding-bottom', '7px');
    await page.locator('[data-close-meal-plan]').first().click();

    await page.locator('#view-home .section-head > [data-action="add-food"]').click();
    await page.locator('#pick-product').click();
    const pickerNames = page.locator('#pick-body .pick-item b');
    await expect(pickerNames).toHaveText(['Apple', 'Buckwheat', 'Zucchini']);
    await expect(pickerNames.first()).toHaveCSS('font-size', '14px');
    await expect(page.locator('#pick-body .pick-item').first()).toHaveCSS('padding-top', '8px');
    await expect(page.locator('#pick-body .pick-item').first()).toHaveCSS('padding-bottom', '8px');
    await expect(page.locator('#pick-body .pick-item .muted').first()).toHaveCSS('font-size', '12px');
  });

  test('food entry modal puts product picker first and hides date for a chosen meal', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');

    await page.locator('#diary-meals [data-action="add-food"][data-meal="breakfast"]').click();
    await expect(page.locator('#food-form > #pick-product')).toHaveCount(1);
    await expect(page.locator('#food-date').locator('xpath=..')).toBeHidden();
    await page.locator('#modal-close').click();

    await page.locator('#view-diary .toolbar [data-action="add-food"]').click();
    await expect(page.locator('#food-form > #pick-product')).toHaveCount(1);
    await expect(page.locator('#food-date').locator('xpath=..')).toBeVisible();
  });

  test('reopened dialogs return to the top without changing product pickers', async ({ page }) => {
    const products = Array.from({ length: 28 }, (_, i) => ({
      id: `scroll-product-${i}`,
      name: `Scroll product ${String(i).padStart(2, '0')}`,
      grams: 100,
      kcal: 120,
      protein: 5,
      fat: 2,
      carbs: 20,
    }));
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });
    await page.setViewportSize({ width: 390, height: 640 });
    await page.evaluate(() => {
      let prototype = HTMLElement.prototype;
      while (prototype && !Object.getOwnPropertyDescriptor(prototype, 'scrollTop')) prototype = Object.getPrototypeOf(prototype);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'scrollTop');
      window.__pickScrollWrites = 0;
      Object.defineProperty(prototype, 'scrollTop', {
        ...descriptor,
        set(value) {
          if (this.closest?.('#pick-modal')) window.__pickScrollWrites += 1;
          return descriptor.set.call(this, value);
        },
      });
    });
    await openView(page, 'diary');

    const addEntry = page.locator('#view-diary .toolbar [data-action="add-food"]');
    const entryModal = page.locator('#modal .modal');
    await addEntry.click();
    await entryModal.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await entryModal.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.locator('#modal-close').click();
    await addEntry.click();
    await expect.poll(() => entryModal.evaluate((el) => el.scrollTop)).toBe(0);

    await page.locator('#pick-product').click();
    await expect(page.locator('#pick-modal .pick-item')).toHaveCount(28);
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    expect(await page.evaluate(() => window.__pickScrollWrites)).toBe(0);
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
    await expect(bob.page.locator('#notif-stack .toast-msg').last()).toHaveText('Friend request sent.');
    await expect(bob.page.locator('#sent-requests')).toContainText('Alice');
    expect(backend.tables.friendships).toMatchObject([{ requester: 'user-bob', addressee: 'user-alice', status: 'pending' }]);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'settings');
    await expect(page.locator('#friend-requests')).toContainText('Bob');
    await page.click('[data-friend-accept]');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Request accepted.');
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
      await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('User not found.');
      await expect(page.locator('#friend-code-input')).toHaveValue('');
      expect(backend.tables.friendships).toHaveLength(0);
    }

    await page.fill('#friend-code-input', 'BBBB3333');
    await page.click('#friend-add');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Friend request sent.');
    await page.fill('#friend-code-input', 'BBBB3333');
    await page.click('#friend-add');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Request or friendship already exists.');
    expect(backend.tables.friendships).toHaveLength(1);
  });

  test('too many lookups are rate limited', async ({ page }) => {
    const backend = createBackend();
    backend.friendAttempts['user-alice'] = { startedAt: Date.now(), count: 10 };
    await startAlice(page, backend);
    await page.fill('#friend-code-input', 'BBBB3333');
    await page.click('#friend-add');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Too many attempts. Try again later.');
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
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
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
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Product sent.');
    expect(backend.tables.product_shares).toMatchObject([{ from_user: 'user-alice', to_user: 'user-bob', name: 'Oats', kcal: 150 }]);

    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await openView(bob.page, 'products');
    await expect(bob.page.locator('#inbox-open')).toHaveText('Inbox (1)');
    await bob.page.click('#inbox-open');
    await expect(bob.page.locator('#inbox-body')).toContainText('Alice');
    await expect(bob.page.locator('#inbox-body')).toContainText('Oats');
    await bob.page.click('[data-share-accept]');
    await expect(bob.page.locator('#notif-stack .toast-msg').last()).toHaveText('Product added to My products.');
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
    await expect(bob.page.locator('#notif-stack .toast-msg').last()).toHaveText('Product declined.');
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
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Product sent.');

    await openView(page, 'settings');
    await expect(page.locator('#sent-shares')).toContainText('Bob');
    await expect(page.locator('#sent-shares')).toContainText('Oats');
    await page.click('[data-share-recall]');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Product recalled.');
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
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText('Could not send: this friend already has 20 products waiting in the inbox.');
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

test.describe('Smoke: meal plan', () => {
  test("tomorrow plan ignores today's fully used calorie budget and saves for tomorrow", async ({ page }) => {
    const products = [
      { id: 'meal-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'meal-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'meal-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
    ];
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      ...AI_STORE(['gemini']),
      prefs: { ...BASE_PREFS, kcal: 2000 },
      products,
      foods: [{ id: 'today-full', name: 'Already eaten', date: today, meal: 'lunch', grams: 500, kcal: 2000, protein: 80, fat: 60, carbs: 220 }],
    });
    let requestBody;
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          items: [{ id: 'meal-oats', grams: 100, meal: 'breakfast' }],
        }) }] } }] }),
      });
    });
    await page.locator('#meal-plan-open').click();
    await page.locator('#meal-plan-dates [data-meal-plan-date="tomorrow"]').click();
    await page.locator('#meal-plan-products [data-plan-product]').first().check();
    await page.locator('#meal-plan-products [data-plan-product]').nth(1).check();
    await page.locator('#meal-plan-products [data-plan-product]').nth(2).check();
    await page.locator('#meal-plan-run').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Plan saved as a draft');
    expect(requestBody.contents[0].parts[0].text).toContain('tomorrow');
    expect(requestBody.contents[0].parts[0].text).toContain('Already logged for this day: 0 kcal');
    const drafts = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('smartdiet-meal-drafts-v1:'))
      .flatMap(([, value]) => JSON.parse(value)));
    const tomorrow = await page.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA');
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].date).toBe(tomorrow);
  });

  test('draft lock keeps a draft after its day, and the bin deletes it even when locked', async ({ page }) => {
    const dayOffset = (days) => page.evaluate((n) => {
      const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA');
    }, days);
    const today = await dayOffset(0);
    const yesterday = await dayOffset(-1);
    const draft = (id, date, locked) => ({
      id, date, items: [{ name: id, meal: 'lunch', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25 }],
      ...(locked === undefined ? {} : { locked }),
    });
    const draftKey = 'smartdiet-meal-drafts-v1:local';
    await page.goto('/');
    await page.evaluate((data) => localStorage.setItem('smartdiet-v1', JSON.stringify(data)), { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [draftKey, [
      draft('old-open', yesterday), draft('old-locked', yesterday, true), draft('today-open', today),
    ]]);
    await page.reload();
    const storedIds = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).map((d) => d.id), draftKey);
    expect(await storedIds()).toEqual(['old-locked', 'today-open']);
    await expect(page.locator('#meal-drafts-open')).toBeVisible();
    await page.locator('#meal-drafts-open').click();
    await expect(page.locator('#meal-drafts-modal')).toHaveClass(/open/);
    await expect(page.locator('[data-plan-lock="old-locked"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-plan-lock="today-open"]').click();
    await expect(page.locator('[data-plan-lock="today-open"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-plan-delete="old-locked"]').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.locator('#confirm-ok').click();
    await expect(page.locator('[data-plan-delete="old-locked"]')).toHaveCount(0);
    expect(await storedIds()).toEqual(['today-open']);
    await page.reload();
    expect(await storedIds()).toEqual(['today-open']);
  });

  test('meal-plan validation toast stays above the open modal', async ({ page }) => {
    const products = [
      { id: 'meal-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'meal-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'meal-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
    ];
    await openApp(page, { ...AI_STORE(['gemini']), products });
    await page.locator('#meal-plan-open').click();
    await page.locator('#meal-plan-run').click();
    const toast = page.locator('#notif-stack .toast-msg').last();
    await expect(toast).toBeVisible();
    const layers = await page.evaluate(() => ({
      toast: Number(getComputedStyle(document.querySelector('#notif-stack')).zIndex),
      modal: Number(getComputedStyle(document.querySelector('#meal-plan-modal')).zIndex),
    }));
    expect(layers.toast).toBeGreaterThan(layers.modal);
    await expect(page.locator('#meal-plan-modal')).toHaveClass(/open/);
  });

  test('keeps actions visible and saves an AI-generated plan', async ({ page }) => {
    const products = [
      { id: 'meal-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'meal-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'meal-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
      { id: 'meal-apple', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14 },
    ];
    await openApp(page, { ...AI_STORE(['gemini']), products });
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          items: [{ id: 'meal-oats', grams: 150, meal: 'breakfast' }],
        }) }] } }],
      }),
    }));

    await page.locator('#meal-plan-open').click();
    const modal = page.locator('#meal-plan-modal .meal-plan-modal');
    const list = page.locator('#meal-plan-products');
    const run = page.locator('#meal-plan-run');
    await list.evaluate((el) => { el.style.height = '90px'; el.style.flex = '0 0 90px'; });
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(run).toBeInViewport();
    await expect(page.locator('#meal-plan-modal')).toHaveClass(/open/);

    const checks = page.locator('#meal-plan-products [data-plan-product]');
    for (let i = 0; i < 3; i += 1) await checks.nth(i).check();
    await run.click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Plan saved as a draft');
    const drafts = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('smartdiet-meal-drafts-v1:'))
      .flatMap(([, value]) => JSON.parse(value)));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toEqual([{ id: 'meal-oats', name: 'Oats', meal: 'breakfast', grams: 150, kcal: 525, protein: 18, fat: 9, carbs: 90 }]);
    expect(await modal.isVisible()).toBe(false);
  });
});

test.describe('Smoke: AI provider fallback', () => {
  test('add to diary uses the meal picked after the answer', async ({ page }) => {
    await openApp(page, AI_STORE(['gemini']));
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          items: [{ name: 'Chicken', grams: 150, kcal: 248, protein: 46, fat: 5, carbs: 0 }],
          total: { kcal: 248, protein: 46, fat: 5, carbs: 0 },
          note: 'ok',
        }) }] } }],
      }),
    }));
    await page.locator('#chat-fab').click();
    await page.locator('#chat-input').fill('chicken');
    await page.locator('#chat-send').click();
    const addButton = page.locator('#chatbox .chat-product-plus');
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(page.locator('#ask-product-action-modal')).toHaveClass(/open/);
    await page.locator('#ask-product-action-diary').click();
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await page.locator('#pick-meals [data-pick-meal="lunch"]').click();
    await page.locator('#pick-dates [data-pick-date="tomorrow"]').click();
    await page.locator('#pick-add').click();
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); });
    await expect.poll(async () => (await readStore(page)).foods.map((f) => [f.meal, f.date])).toEqual([['lunch', tomorrow]]);
  });

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
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
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
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
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
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
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
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await expect.poll(() => backend.tables.weight_entries.length).toBe(0);
    await openView(page, 'stats');
    await expect(page.locator('#weight-history')).not.toContainText('96');
    await openView(page, 'home');
    await expect(page.locator('#home-weight')).toHaveText('97.0');
  });

  test('a weigh-in deleted before a relaunch is not restored from the local safety copy', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, currentWeight: 97 }, foods: [], weights: [{ id: 'safety-96', value: 96, date: '2026-10-24' }] });
    await connectSupabase(page);
    await autoConfirm(page, true);
    await signIn(page, 'alice@example.test');
    await expect.poll(() => backend.tables.weight_entries.length).toBe(1);

    await openView(page, 'stats');
    await autoConfirm(page, true);
    await page.locator('#weight-history [data-delete-weight]').first().click();
    await expect.poll(() => backend.tables.weight_entries.length).toBe(0);
    await expect.poll(async () => (await readStore(page)).weights.length).toBe(0);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await expect.poll(() => backend.tables.weight_entries.length).toBe(0);
    await openView(page, 'stats');
    await expect(page.locator('#weight-history')).not.toContainText('96');
    expect((await readStore(page)).weights).toHaveLength(0);
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
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'settings');
    await expect(page.locator('#pref-tone')).toHaveValue('playful');
    expect((await readStore(page)).prefs.aiTone).toBe('playful');
  });
});

test.describe('Smoke: dialog close, AI models and storage cleanup', () => {
  test('all close buttons share one style', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const info = await page.$$eval('button', bs => bs.filter(b => /✕|×/.test(b.textContent) && !b.closest('.install-banner')).map(b => ({ cls: b.className, id: b.id })));
    expect(info.length).toBeGreaterThanOrEqual(9);
    for (const b of info) expect(b.cls).toContain('modal-x');
    const sizes = await page.$$eval('button.modal-x', bs => bs.map(b => { const s = getComputedStyle(b); return [s.width, s.height, s.backgroundColor, s.borderRadius, s.fontSize].join('|'); }));
    expect(new Set(sizes).size).toBe(1);
  });

  test('model dropdown, custom id validation, warning and test button', async ({ page }) => {
    await page.route('https://api.groq.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) }));
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'settings');
    await expect(page.locator('[data-ai-warn="gemini"]')).toBeVisible();
    await expect(page.locator('[data-ai-warn="groq"]')).toBeHidden();
    await page.locator('.ai-row[data-prov="gemini"] .dd-btn').click();
    await page.locator('.ai-row[data-prov="gemini"] .dd-opt[data-value="custom"]').click();
    await expect(page.locator('[data-ai-custom="gemini"]')).toBeVisible();
    await page.fill('[data-ai-custom="gemini"]', 'bad id!');
    await page.click('#save-ai');
    await expect(page.locator('#toast, .toast').first()).toContainText(/Model ID|ID моделі/);
    await page.fill('[data-ai-custom="gemini"]', 'gemini-my-model');
    await page.click('#save-ai');
    await page.reload();
    await openView(page, 'settings');
    const st = await readStore(page);
    expect(st.ai.models.gemini).toBe('gemini-my-model');
    await expect(page.locator('[data-ai-custom="gemini"]')).toHaveValue('gemini-my-model');
    // test button without key
    await page.click('[data-ai-test="groq"]');
    await expect(page.locator('[data-ai-result="groq"]')).toContainText('Add the API key first');
    // test button with a key, auto model
    await page.fill('[data-ai-key="groq"]', 'gsk_test_key_123');
    await page.click('[data-ai-test="groq"]');
    await expect(page.locator('[data-ai-result="groq"]')).toContainText('Works: openai/gpt-oss-120b');
  });

  test('storage full: old synced entries are offered for removal and removed only after OK', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const r = await page.evaluate(() => {
      const oldDate = '2024-01-05', newDate = iso();
      state.foods = [
        { id: '11111111-1111-4111-8111-111111111111', name: 'old a', meal: 'lunch', grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, date: oldDate },
        { id: '22222222-2222-4222-8222-222222222222', name: 'old pending', meal: 'lunch', grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, date: oldDate },
        { id: '33333333-3333-4333-8333-333333333333', name: 'new', meal: 'lunch', grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, date: newDate },
        { id: '44444444-4444-4444-8444-444444444444', name: 'old unconfirmed', meal: 'lunch', grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, date: oldDate },
      ];
      sb = {}; user = { id: 'tester' };
      state.synced = { uid: 'tester', email: '', foods: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'], weights: [], products: [] };
      syncQueue.foods = ['22222222-2222-4222-8222-222222222222'];
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === storeKey && !window.__allowWrite) throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
      return staleSyncedFoods().map(f => f.name);
    });
    expect(r).toEqual(['old a']);
    await page.evaluate(() => { writeLocal(storeKey, '{}'); });
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.evaluate(() => { window.__allowWrite = true; });
    await page.click('#confirm-ok');
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/open/);
    const names = await page.evaluate(() => state.foods.map(f => f.name));
    expect(names.sort()).toEqual(['new', 'old pending', 'old unconfirmed'].sort());
  });
});

test.describe('Smoke: Gemini default and styled settings pickers', () => {
  test('Auto uses the fast Gemini model first and settings selects use the app dropdown', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    expect(await page.evaluate(() => AI_MODELS.gemini.auto)).toEqual(['gemini-3.5-flash-lite']);
    await openView(page, 'settings');
    for (const id of ['#pref-lang', '#profile-sex', '#profile-activity', '#profile-pace']) {
      await expect(page.locator(id)).toHaveClass(/dd-native/);
    }
    const pace = page.locator('#profile-pace');
    const values = await pace.evaluate(s => [...s.options].map(o => o.value));
    await pace.locator('xpath=..').locator('.dd-btn').click();
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-opt').nth(1).click();
    await expect(pace).toHaveValue(values[1]);
    await page.locator('#pref-lang').locator('xpath=..').locator('.dd-btn').click();
    await page.locator('#pref-lang').locator('xpath=..').locator('.dd-opt[data-value="uk"]').click();
    await page.click('#save-lang');
    expect((await readStore(page)).prefs.lang).toBe('uk');
  });
});


test.describe('Smoke: review fixes', () => {
  test('goal form rejects empty, out-of-range and inconsistent values', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'settings');
    await page.fill('#pref-kcal', '500');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('1000');
    await page.fill('#pref-kcal', '2000');
    await page.fill('#pref-protein', '200');
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

  test('meal plan rejects carbohydrate totals above the remaining target even when calories fit', async ({ page }) => {
    const products = ['A', 'B', 'C'].map((name, i) => ({ id: `macro-${i}`, name, grams: 100, kcal: 10, protein: 1, fat: 0, carbs: 100 }));
    await openApp(page, { ...AI_STORE(['gemini']), products, prefs: { ...BASE_PREFS, kcal: 2000, carbs: 242 } });
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200, headers: CORS, contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: products.map(p => ({ id: p.id, grams: 100, meal: 'lunch' })) }) }] } }] }),
    }));
    await page.locator('#meal-plan-open').click();
    for (const check of await page.locator('#meal-plan-products [data-plan-product]').all()) await check.check();
    await page.locator('#meal-plan-run').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('daily remainder exceeded');
    expect(await page.evaluate(() => mealDrafts())).toHaveLength(0);
  });

  test('accepting a product that was already recalled does not save it', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const saved = await page.evaluate(async () => {
      const chain = { delete() { return this; }, eq() { return this; }, select() { return Promise.resolve({ data: [], error: null }); } };
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

test.describe('Smoke: mobile layout at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('main screens have no horizontal overflow and the settings dropdown stays on screen', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    for (const v of ['home', 'diary', 'products', 'stats', 'settings']) {
      await page.locator(`#nav:visible [data-view="${v}"], #mobile-nav:visible [data-view="${v}"]`).first().click();
      await expect(page.locator(`#view-${v}`)).toHaveClass(/active/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await page.locator('#profile-activity').locator('xpath=..').locator('.dd-btn').click();
    const box = await page.evaluate(() => {
      const b = document.querySelector('#profile-activity').parentElement.querySelector('.dd-list').getBoundingClientRect();
      return { left: b.left, right: b.right, W: innerWidth };
    });
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.W);
  });

  test('meal eyes stay crisp and nutrition details align below them on narrow screens', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [
      { id:'11111111-1111-4111-8111-111111111111', name:'Вівсянка', meal:'breakfast', grams:100, kcal:200, protein:5, fat:3, carbs:30, date:today, createdAt:1 },
      { id:'22222222-2222-4222-8222-222222222222', name:'Яблуко', meal:'snack', grams:100, kcal:80, protein:1, fat:0, carbs:20, date:today, createdAt:2, snackId:'snack-a' },
      { id:'33333333-3333-4333-8333-333333333333', name:'Курка', meal:'lunch', grams:100, kcal:300, protein:30, fat:5, carbs:0, date:today, createdAt:3 },
      { id:'44444444-4444-4444-8444-444444444444', name:'Риба', meal:'dinner', grams:100, kcal:250, protein:25, fat:10, carbs:0, date:today, createdAt:4 },
    ], weights:[] });
    await openView(page, 'diary');
    const cards = page.locator('#diary-meals .meal-card');
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) {
      const bounds = await card.locator('.meal-top').evaluate(el => {
        const box = el.getBoundingClientRect();
        const eyeButton = el.querySelector('[data-meal-activity]');
        const icon = eyeButton.querySelector('.meal-activity-icon');
        const details = el.querySelector('.meal-details').getBoundingClientRect();
        const eyeBox = eyeButton.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el.querySelector('.meal-title'));
        const titleText = range.getBoundingClientRect();
        return { left: box.left, right: box.right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          eye: eyeBox, icon: iconBox, title: titleText, details,
          eyeBg: getComputedStyle(eyeButton).backgroundColor, iconBg: getComputedStyle(icon).backgroundColor,
          iconBorder: getComputedStyle(icon).borderWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(360);
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
      expect(bounds.title.left).toBeGreaterThanOrEqual(bounds.eye.right);
      expect(bounds.title.left - bounds.eye.right).toBeLessThanOrEqual(8);
      expect(Math.abs(bounds.icon.width - bounds.icon.height)).toBeLessThanOrEqual(0.5);
      expect(bounds.eyeBg).toBe('rgba(0, 0, 0, 0)');
      expect(bounds.iconBg).toBe('rgba(0, 0, 0, 0)');
      expect(bounds.iconBorder).toBe('0px');
      expect(Math.abs(bounds.details.left - bounds.eye.left)).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
});


test.describe('Smoke: legacy snack ordering', () => {
  test('old and current snack records share one chronological order when mealOrder is absent or null', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, { prefs: BASE_PREFS, foods: [
      { id: 'old-snack-food', name: 'Old snack', meal: 'snack', grams: 100, kcal: 20, protein: 1, fat: 0, carbs: 3, date: today, createdAt: 1000, mealOrder: null },
      { id: 'new-snack-food', name: 'New snack', meal: 'snack', grams: 100, kcal: 20, protein: 1, fat: 0, carbs: 3, date: today, createdAt: 2000, mealOrder: 9999999999999, snackId: 'new-snack' },
      { id: 'breakfast-anchor', name: 'Breakfast', meal: 'breakfast', grams: 100, kcal: 100, protein: 5, fat: 2, carbs: 10, date: today, createdAt: 500 },
    ], weights: [] });
    const names = await page.evaluate((date) => mealTimeline(date).filter(x => x.type === 'snack').map(x => x.event.foods[0].name), today);
    expect(names).toEqual(['Old snack', 'New snack']);
  });
});

test.describe('Smoke: data safety under slow uploads', () => {
  test('an edit made while an upload is in flight is sent after it, not lost', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let held = 0;
    await page.route(/\/rest\/v1\/food_entries/, async (route) => {
      if (route.request().method() === 'POST') {
        held += 1;
        await gate;
      }
      await route.fallback();
    });
    await openView(page, 'diary');
    await addFood(page, 'Draft eggs');
    await expect.poll(() => held).toBe(1);
    await page.evaluate(() => {
      const f = state.foods.find((x) => x.name === 'Draft eggs');
      f.name = 'Final eggs';
      persistFood(f);
      save();
    });
    release();
    await expect.poll(() => backend.tables.food_entries.map((r) => r.name)).toContain('Final eggs');
    await expect.poll(() => page.evaluate(() => syncQueue.foods.length)).toBe(0);
  });
});

test.describe('Smoke: dietitian answer display and spacing', () => {
  test('response length can be chosen in Settings and the dietitian panel', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'en' } });
    await openView(page, 'settings');
    const select = page.locator('#pref-verbosity');
    await select.locator('xpath=..').locator('.dd-btn').click();
    await select.locator('xpath=..').locator('.dd-opt[data-value="brief"]').click();
    await page.locator('#save-tone').click();
    await expect.poll(async () => (await readStore(page)).prefs.aiVerbosity).toBe('brief');
    expect(await page.evaluate(() => askPrompt([], 'How much protein?'))).toContain('very briefly');
    await select.locator('xpath=..').locator('.dd-btn').click();
    await select.locator('xpath=..').locator('.dd-opt[data-value="detailed"]').click();
    await page.locator('#save-tone').click();
    expect(await page.evaluate(() => askPrompt([], 'How much protein?'))).toContain('in detail');
  });
  test('saved JSON comparison replies render as readable text instead of raw JSON', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'en' } });
    const json = '```json\n{"comparison":[{"name":"Coffee with honey","calories_kcal":21,"carbs_g":5.7,"sugar_g":5.7,"notes":"A light natural sweetener."},{"name":"Coffee with sugar","calories_kcal":16,"carbs_g":4,"sugar_g":4,"notes":"A quick sweet option."}],"summary":"Honey has about 5 kcal more."}\n```';
    await page.evaluate((value) => localStorage.setItem('smartdiet-ask-v1', JSON.stringify([{ role: 'ai', text: value }])), json);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await page.click('[data-action="open-ask"]');
    const bubble = page.locator('#ask-box .bubble.ai').last();
    await expect(bubble).toContainText('Coffee with honey');
    await expect(bubble).toContainText('21 kcal');
    await expect(bubble).toContainText('Honey has about 5 kcal more.');
    await expect(bubble).not.toContainText('```json');
    await expect(bubble).not.toContainText('"comparison"');
  });
  test('Ask the Dietitian renders recommended foods as rows with plus actions and a destination dialog', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'uk' } });
    const json = JSON.stringify({ items: [
      { name: 'Вівсянка', grams: 50, kcal: 190, protein: 7, fat: 3, carbs: 32 },
      { name: 'Йогурт', grams: 120, kcal: 90, protein: 8, fat: 2, carbs: 10 },
    ], summary: 'Орієнтовні порції для перекусу.' });
    await page.route('https://api.groq.com/**', (route) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: json } }] }) }));
    await page.click('[data-action="open-ask"]');
    await page.fill('#ask-input', 'Що можна додати до перекусу?');
    await page.click('#ask-send');

    const rows = page.locator('#ask-box .ask-product-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Вівсянка');
    await expect(rows.nth(1)).toContainText('Йогурт');
    await expect(rows.nth(0).locator('.ask-product-plus')).toHaveText('+');
    await expect(rows.nth(0).locator('.ask-product-plus')).toHaveAttribute('aria-label', 'Вибрати, куди додати Вівсянка');

    await rows.nth(0).locator('.ask-product-plus').click();
    await expect(page.locator('#ask-product-action-modal')).toHaveClass(/open/);
    await expect(page.locator('#ask-product-action-name')).toHaveText('Вівсянка');
    await page.locator('#ask-product-action-save').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#food-name')).toHaveValue('Вівсянка');
    await page.locator('#food-save').click();
    await expect.poll(async () => (await readStore(page)).products.map((x) => x.name)).toContain('Вівсянка');

    await rows.nth(1).locator('.ask-product-plus').click();
    await expect(page.locator('#ask-product-action-modal')).toHaveClass(/open/);
    await page.locator('#ask-product-action-diary').click();
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await page.locator('#pick-meals [data-pick-meal="breakfast"]').click();
    await page.locator('#pick-add').click();
    await expect.poll(async () => (await readStore(page)).foods.map((x) => x.name)).toContain('Йогурт');
  });

  test('floating dietitian chat displays each recommended product on its own row', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'uk' } });
    const json = JSON.stringify({ items: [
      { name: 'Вівсянка', grams: 50, kcal: 190, protein: 7, fat: 3, carbs: 32 },
      { name: 'Йогурт', grams: 120, kcal: 90, protein: 8, fat: 2, carbs: 10 },
    ], total: { kcal: 280, protein: 15, fat: 5, carbs: 42 }, note: '' });
    await page.route('https://api.groq.com/**', (route) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: json } }] }) }));
    await page.locator('#chat-fab').click();
    await page.locator('#chat-input').fill('перекус');
    await page.locator('#chat-send').click();

    const rows = page.locator('#chatbox .chat-product-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Вівсянка');
    await expect(rows.nth(1)).toContainText('Йогурт');
    await expect(rows.nth(0).locator('.chat-product-title')).toHaveText('Вівсянка:');
    await expect(rows.nth(0).locator('.chat-product-details')).toContainText('50');
    const titleStyles = await rows.nth(0).locator('.chat-product-title').evaluate(el => {
      const style = getComputedStyle(el);
      return { fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight) };
    });
    const detailSize = await rows.nth(0).locator('.chat-product-details').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(titleStyles.fontWeight).toBeGreaterThanOrEqual(600);
    expect(detailSize).toBeLessThan(titleStyles.fontSize);
    const productRowStyle = await rows.nth(0).evaluate(el => {
      const style = getComputedStyle(el);
      return { borderColor: style.borderTopColor, borderStyle: style.borderTopStyle, borderRadius: style.borderTopLeftRadius };
    });
    expect(productRowStyle.borderColor).toBe('rgb(126, 184, 134)');
    expect(productRowStyle.borderStyle).toBe('solid');
    expect(productRowStyle.borderRadius).toBe('10px');
    const rowTops = await rows.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(rowTops[1]).toBeGreaterThan(rowTops[0]);
    await rows.nth(0).locator('.chat-product-plus').click();
    await expect(page.locator('#ask-product-action-modal')).toHaveClass(/open/);
    await expect(page.locator('#ask-product-action-name')).toHaveText('Вівсянка');
    const summary = page.locator('#chatbox .bubble.ai').last().locator('.chat-product-total');
    await expect(summary.locator('.ai-info-btn')).toHaveCount(1);
    const infoSize = await summary.locator('.ai-info-btn').evaluate(el => {
      const style = getComputedStyle(el);
      return { width: parseFloat(style.width), height: parseFloat(style.height) };
    });
    expect(infoSize.width).toBeLessThanOrEqual(20);
    expect(infoSize.height).toBeLessThanOrEqual(20);
    const bubbleChildren = await page.locator('#chatbox .bubble.ai').last().locator('> *').evaluateAll(nodes => nodes.map(n => n.className));
    expect(bubbleChildren.slice(-2)).toEqual(['chat-product-total', 'ai-meta hidden']);
    const listGap = await page.locator('#chatbox .chat-product-list').evaluate(el => parseFloat(getComputedStyle(el).rowGap));
    expect(listGap).toBeGreaterThanOrEqual(8);
    const messageGap = await page.locator('#chatbox').evaluate(el => parseFloat(getComputedStyle(el).rowGap));
    expect(messageGap).toBeGreaterThanOrEqual(12);
  });

  test('floating dietitian chat history survives close and reload, clears with confirmation, and remains account-scoped', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'uk' } });
    const reply = JSON.stringify({ items: [{ name: 'Вівсянка', grams: 50, kcal: 190, protein: 7, fat: 3, carbs: 32 }], total: { kcal: 190, protein: 7, fat: 3, carbs: 32 }, note: 'Орієнтовна порція.' });
    await page.route('https://api.groq.com/**', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: reply } }] }) }));
    await page.locator('#chat-fab').click();
    await page.locator('#chat-input').fill('вівсянка');
    await page.locator('#chat-send').click();
    await expect(page.locator('#chatbox .chat-product-row')).toHaveCount(1);
    await page.locator('#chat-close').click();
    await page.locator('#chat-fab').click();
    await expect(page.locator('#chatbox .chat-product-row')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await page.locator('#chat-fab').click();
    await expect(page.locator('#chatbox .chat-product-row')).toHaveCount(1);
    const savedKey = await page.evaluate(() => Object.keys(localStorage).find(key => key === 'smartdiet-dietitian-chat-v1:local'));
    expect(savedKey).toBe('smartdiet-dietitian-chat-v1:local');
    const accountKeys = await page.evaluate(() => {
      user = { id: 'dietitian-test-user' };
      switchDietitianChat();
      const accountWasInitiallyEmpty = dietitianChat.length === 0;
      appendDietitianChat({ id: 'account-only-message', role: 'user', text: 'private account chat' });
      user = null;
      switchDietitianChat();
      const guestHasAccountMessage = dietitianChat.some(message => message.text === 'private account chat');
      const guestHistoryLength = dietitianChat.length;
      user = { id: 'dietitian-test-user' };
      switchDietitianChat();
      const accountRestored = dietitianChat.some(message => message.text === 'private account chat');
      user = null;
      switchDietitianChat();
      return { accountWasInitiallyEmpty, guestHasAccountMessage, guestHistoryLength, accountRestored };
    });
    expect(accountKeys.accountWasInitiallyEmpty).toBe(true);
    expect(accountKeys.guestHasAccountMessage).toBe(false);
    expect(accountKeys.guestHistoryLength).toBeGreaterThan(0);
    expect(accountKeys.accountRestored).toBe(true);
    await page.locator('#chat-clear').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.locator('#confirm-cancel').click();
    await expect(page.locator('#chatbox .chat-product-row')).toHaveCount(1);
    await page.locator('#chat-clear').click();
    await page.locator('#confirm-ok').click();
    await expect(page.locator('#chatbox .bubble:not(#chat-welcome)')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('smartdiet-dietitian-chat-v1:local') || '[]'))).toEqual([]);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await page.locator('#chat-fab').click();
    await expect(page.locator('#chatbox .bubble:not(#chat-welcome)')).toHaveCount(0);
  });

  test('meal cards stack eye and title, then calories, then macros without horizontal overflow', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'en' }, foods: [
      { id: 'meal-layout-test', name: 'Oats', meal: 'breakfast', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60, date: today, createdAt: 1 },
    ] });
    await page.setViewportSize({ width: 360, height: 800 });
    await openView(page, 'diary');
    const card = page.locator('#diary-meals .meal-card').first();
    const positions = await card.evaluate(el => {
      const top = el.querySelector('.meal-top');
      const eye = top.querySelector('.meal-activity-icon').getBoundingClientRect();
      const titleRange = document.createRange();
      titleRange.selectNodeContents(top.querySelector('.meal-title'));
      const title = titleRange.getBoundingClientRect();
      const calories = top.querySelector('.meal-kcal').getBoundingClientRect();
      const macros = top.querySelector('.meal-macros').getBoundingClientRect();
      return { eye: { top: eye.top, left: eye.left, right: eye.right, bottom: eye.bottom }, title: { top: title.top, left: title.left, bottom: title.bottom }, calories: { top: calories.top, left: calories.left }, macros: { top: macros.top, left: macros.left }, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    });
    expect(positions.eye.top).toBeLessThan(positions.title.bottom);
    expect(positions.eye.bottom).toBeGreaterThan(positions.title.top);
    expect(positions.calories.top).toBeGreaterThan(positions.title.top);
    expect(positions.macros.top).toBeGreaterThan(positions.calories.top);
    expect(positions.macros.left).toBeCloseTo(positions.calories.left, 0);
    expect(positions.scrollWidth).toBeLessThanOrEqual(positions.innerWidth);
  });

  test('meal header keeps eye left, title close beside it, and snack arrows below analysis', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [
      { id: 'layout-breakfast', name: 'Oats', meal: 'breakfast', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60, date: today, createdAt: 1 },
      { id: 'layout-snack', name: 'Apple', meal: 'snack', snackId: 'layout-snack-event', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14, date: today, createdAt: 2 },
    ] });
    await page.setViewportSize({ width: 390, height: 844 });
    await openView(page, 'diary');
    const card = page.locator('#diary-meals .meal-card').filter({ has: page.locator('.meal-title', { hasText: 'Snack' }) }).first();
    const layout = await card.evaluate(el => {
      const rect = selector => { const r=el.querySelector(selector).getBoundingClientRect(); return {top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:r.width}; };
      const range=document.createRange();range.selectNodeContents(el.querySelector('.meal-title'));const text=range.getBoundingClientRect();const calorieRange=document.createRange();calorieRange.selectNodeContents(el.querySelector('.meal-kcal'));const calorieText=calorieRange.getBoundingClientRect();return { eye:rect('.meal-activity'), title:rect('.meal-title'), titleText:{left:text.left,right:text.right}, titleAlign:getComputedStyle(el.querySelector('.meal-title')).textAlign, chevronRight:getComputedStyle(el.querySelector('.meal-head'),'::after').right, analyze:rect('.meal-analyze'), arrows:rect('.snack-moves'), calories:rect('.meal-kcal'), calorieText:{left:calorieText.left,right:calorieText.right,top:calorieText.top,bottom:calorieText.bottom}, macros:rect('.meal-macros'), top:rect('.meal-top'), innerWidth:window.innerWidth, scrollWidth:document.documentElement.scrollWidth };
    });
    expect(layout.titleText.left).toBeGreaterThanOrEqual(layout.eye.right);
    expect(layout.titleText.left-layout.eye.right).toBeLessThanOrEqual(8);
    expect(layout.titleText.right).toBeLessThan(layout.analyze.left);
    expect(layout.titleAlign).toBe('left');
    expect(layout.chevronRight).toBe('96px');
    expect(layout.title.top).toBeLessThanOrEqual(layout.analyze.top+3);
    expect(layout.calories.top).toBeGreaterThanOrEqual(layout.title.bottom);
    expect(layout.calories.top-layout.title.bottom).toBeLessThanOrEqual(8);
    expect(layout.calorieText.right).toBeLessThan(layout.arrows.left);
    expect(Math.abs(layout.calorieText.top-layout.arrows.top)).toBeLessThanOrEqual(8);
    expect(layout.arrows.top).toBeGreaterThanOrEqual(layout.analyze.bottom);
    expect(layout.arrows.right).toBeCloseTo(layout.top.right,0);
    expect(layout.macros.top).toBeGreaterThan(layout.calories.top);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  });

  test('a prepared dish stays one nutrition item and mobile content clears the launcher', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'uk' } });
    let sent = '';
    await page.route('https://api.groq.com/**', async (route) => {
      sent = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ name: 'Млинці на молоці', grams: 180, kcal: 360, protein: 12, fat: 10, carbs: 55 }], total: { kcal: 360, protein: 12, fat: 10, carbs: 55 }, note: 'Орієнтовна оцінка готової страви.' }) } }] }) });
    });
    await page.locator('#chat-fab').click();
    await page.locator('#chat-input').fill('млинці на молоці');
    await page.locator('#chat-send').click();
    await expect.poll(() => sent).toContain('рахуй це як ОДНУ готову страву');
    await expect(page.locator('#chatbox')).toContainText('Млинці на молоці');
    await expect(page.locator('#chatbox')).not.toContainText('окреме молоко');
    await page.setViewportSize({ width: 390, height: 844 });
    const padding = await page.locator('.main').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(padding).toBeGreaterThanOrEqual(123);
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
    await page.locator('#notif-stack .toast').last().locator('.toast-x').click();
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
});


test.describe('Smoke: current date card', () => {
  test('shows weekday, a prominent right-aligned day number, and month in a wider card', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const date = page.locator('#today-label');
    const expected = await page.evaluate(() => Object.fromEntries(new Intl.DateTimeFormat(lang() === 'uk' ? 'uk-UA' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(new Date()).map((part) => [part.type, part.value])));
    await expect(date.locator('.date-weekday')).toHaveText(expected.weekday);
    await expect(date.locator('.date-day')).toHaveText(expected.day);
    await expect(date.locator('.date-month')).toHaveText(expected.month);
    const layout = await date.evaluate((el) => {
      const weekday = el.querySelector('.date-weekday');
      const month = el.querySelector('.date-month');
      return {
        width: el.getBoundingClientRect().width,
        widestLabel: Math.max(weekday.getBoundingClientRect().width, month.getBoundingClientRect().width),
        dayAlign: getComputedStyle(el.querySelector('.date-day')).textAlign,
        dayFontSize: parseFloat(getComputedStyle(el.querySelector('.date-day')).fontSize),
        weekdayFontSize: parseFloat(getComputedStyle(weekday).fontSize),
        monthFontSize: parseFloat(getComputedStyle(month).fontSize),
      };
    });
    expect(layout.width).toBeGreaterThan(layout.widestLabel + 20);
    expect(layout.width).toBeLessThan(layout.widestLabel + 50);
    expect(layout.dayAlign).toBe('right');
    expect(layout.dayFontSize).toBeCloseTo(15.4, 1);
    expect(layout.weekdayFontSize).toBeCloseTo(12.9, 1);
    expect(layout.monthFontSize).toBeCloseTo(12.9, 1);

    const bell = page.locator('#notif-bell');
    const headerBoxes = await page.evaluate(() => {
      const bell = document.querySelector('#notif-bell').getBoundingClientRect();
      const date = document.querySelector('#today-label').getBoundingClientRect();
      const title = document.querySelector('#greeting').getBoundingClientRect();
      const header = document.querySelector('.topline').getBoundingClientRect();
      return { bell: { left: bell.left, right: bell.right, top: bell.top, bottom: bell.bottom }, date: { left: date.left, right: date.right, top: date.top, bottom: date.bottom }, title: { left: title.left, right: title.right, top: title.top, bottom: title.bottom }, headerLeft: header.left };
    });
    expect(headerBoxes.bell.right <= headerBoxes.date.left || headerBoxes.date.right <= headerBoxes.bell.left || headerBoxes.bell.bottom <= headerBoxes.date.top || headerBoxes.date.bottom <= headerBoxes.bell.top).toBe(true);
    expect(headerBoxes.date.top).toBeGreaterThanOrEqual(headerBoxes.bell.bottom);
    expect(Math.abs(headerBoxes.bell.right - headerBoxes.date.right)).toBeLessThanOrEqual(1);
    expect(headerBoxes.title.left).toBeCloseTo(headerBoxes.headerLeft, 0);
    expect(headerBoxes.title.right <= headerBoxes.date.left || headerBoxes.date.right <= headerBoxes.title.left || headerBoxes.title.bottom <= headerBoxes.date.top || headerBoxes.date.bottom <= headerBoxes.title.top).toBe(true);
    const hero = page.locator('.hero');
    const dateBottom = await date.evaluate((el) => el.getBoundingClientRect().bottom);
    const heroTop = await hero.evaluate((el) => el.getBoundingClientRect().top);
    expect(dateBottom).toBeLessThanOrEqual(heroTop);

    await page.setViewportSize({ width: 360, height: 780 });
    const mobileWidth = await date.evaluate((el) => el.getBoundingClientRect().width);
    expect(mobileWidth).toBeLessThanOrEqual(360 - 32);
    const mobileDateBottom = await date.evaluate((el) => el.getBoundingClientRect().bottom);
    const mobileHeroTop = await hero.evaluate((el) => el.getBoundingClientRect().top);
    const mobileBoxes = await page.evaluate(() => {
      const bell = document.querySelector('#notif-bell').getBoundingClientRect();
      const date = document.querySelector('#today-label').getBoundingClientRect();
      const title = document.querySelector('#greeting').getBoundingClientRect();
      const header = document.querySelector('.topline').getBoundingClientRect();
      return { bell: { left: bell.left, right: bell.right, top: bell.top, bottom: bell.bottom }, date: { left: date.left, right: date.right, top: date.top, bottom: date.bottom }, title: { left: title.left, right: title.right, top: title.top, bottom: title.bottom }, headerLeft: header.left };
    });
    expect(mobileBoxes.bell.right <= mobileBoxes.date.left || mobileBoxes.date.right <= mobileBoxes.bell.left || mobileBoxes.bell.bottom <= mobileBoxes.date.top || mobileBoxes.date.bottom <= mobileBoxes.bell.top).toBe(true);
    expect(mobileBoxes.date.top).toBeGreaterThanOrEqual(mobileBoxes.bell.bottom);
    expect(Math.abs(mobileBoxes.bell.right - mobileBoxes.date.right)).toBeLessThanOrEqual(1);
    expect(mobileBoxes.title.left).toBeCloseTo(mobileBoxes.headerLeft, 0);
    expect(mobileBoxes.title.right <= mobileBoxes.date.left || mobileBoxes.date.right <= mobileBoxes.title.left || mobileBoxes.title.bottom <= mobileBoxes.date.top || mobileBoxes.date.bottom <= mobileBoxes.title.top).toBe(true);
    expect(mobileDateBottom).toBeLessThanOrEqual(mobileHeroTop);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
