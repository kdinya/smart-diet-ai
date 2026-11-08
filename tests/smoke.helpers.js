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
    rlsProfiles: false,
    deniedTables: [],
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

    if (url.pathname === '/rest/v1/rpc/app_user_names') {
      if (!userIdFromRequest(req)) return json(401, { message: 'JWT required' });
      return json(200, backend.tables.profiles.map((row) => ({ display_name: row.display_name })));
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
  if (table === 'user_profiles' && backend.rlsProfiles) {
    return json(403, { code: '42501', message: 'new row violates row-level security policy for table \"user_profiles\"' });
  }
  if (backend.deniedTables.includes(table)) {
    return json(403, { code: '42501', message: `permission denied for table ${table}` });
  }
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
  await page.evaluate(() => localStorage.setItem('smartdiet-sleep-food-reminder', String(Date.now())));
}

async function readStore(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('smartdiet-v1') || '{}'));
}

async function openDietitianChat(page) {
  const mascot = page.locator('#bot-peeker');
  const chatAction = page.locator('#bot-chat-action-fab');
  if (await mascot.isVisible()) {
    await expect(mascot).toHaveClass(/is-arrived/, { timeout: 10000 });
    await mascot.click();
    await expect(chatAction).toBeVisible({ timeout: 10000 });
    await chatAction.click();
    const calcChoice = page.locator('.bot-comic-actions [data-action="open-calc"]');
    await expect(calcChoice).toBeVisible();
    await calcChoice.click();
  } else {
    await page.locator('#chat-fab').click();
  }
  await expect(page.locator('#chat-panel')).toHaveClass(/open/);
}

async function openAskChat(page) {
  const mascot = page.locator('#bot-peeker');
  const chatAction = page.locator('#bot-chat-action-fab');
  if (await mascot.isVisible()) {
    await expect(mascot).toHaveClass(/is-arrived/, { timeout: 10000 });
    await mascot.click();
    await expect(chatAction).toBeVisible({ timeout: 10000 });
    await chatAction.click();
    const askChoice = page.locator('.bot-comic-actions [data-action="open-ask"]');
    await expect(askChoice).toBeVisible();
    await askChoice.click();
  } else {
    await page.evaluate(() => { if (typeof openAsk === 'function') openAsk(); });
  }
  await expect(page.locator('#ask-panel')).toHaveClass(/open/);
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
    currentWeightDate: '2026-10-22',
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

async function shareFirstProductWithMany(page, friends) {
  await openView(page, 'settings');
  for (const friend of friends) await expect(page.locator('#friends-list')).toContainText(friend);
  await openView(page, 'products');
  await page.locator('#products-list [data-toggle-product]').first().click();
  await page.locator('#products-list [data-share-product]').first().click();
  await expect(page.locator('#share-modal')).toHaveClass(/open/);
  for (const friend of friends) await page.locator('#share-body label', { hasText: friend }).locator('input').check();
  await page.click('#share-confirm');
}

const AI_STORE = (order) => ({
  prefs: BASE_PREFS,
  foods: [],
  weights: [],
  ai: { order, keys: { gemini: 'g-key', openai: 'sk-test', anthropic: 'a-key', groq: 'gsk_test', xai: 'xai-test' } },
});

async function selectDiaryDate(page, date) {
  await page.click('#diary-date');
  while (true) {
    const visibleMonth = (await page.locator('#cal-days .cal-day').first().getAttribute('data-cal-date')).slice(0, 7);
    if (visibleMonth === date.slice(0, 7)) break;
    await page.locator(visibleMonth < date.slice(0, 7) ? '#cal-next' : '#cal-prev').click();
  }
  await page.locator(`[data-cal-date="${date}"]`).click();
  await page.click('#cal-done');
}

module.exports = { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openAskChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate };

