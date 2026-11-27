import test from 'node:test';
import assert from 'node:assert/strict';
import storage from '../../js/storage.js';

// Setup mock localStorage in Node global for testing
const mockStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => mockStorage.has(k) ? mockStorage.get(k) : null,
  setItem: (k, v) => mockStorage.set(String(k), String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
  get length() { return mockStorage.size; }
};
Object.defineProperty(globalThis.localStorage, Symbol.iterator, {
  value: function* () {
    yield* mockStorage.keys();
  }
});

test('storage module: keys and constants invariants', () => {
  assert.equal(storage.STORE_KEY, 'smartdiet-v1', 'Store key must match data contract');
  assert.equal(storage.storeKey, 'smartdiet-v1');
  assert.equal(storage.LAST_BACKUP_KEY, 'smartdiet-last-local-backup');
  assert.equal(storage.SYNC_KEY, 'smartdiet-sync-queue');
  assert.equal(storage.NOTIF_KEY, 'smartdiet-notifications-v1');
  assert.equal(storage.CATALOG_CACHE_KEY, 'smartdiet-catalog-cache');
  assert.equal(storage.ASK_KEY, 'smartdiet-ask-history');
});

test('storage module: loadState returns empty object on missing or invalid data', () => {
  mockStorage.clear();
  assert.deepEqual(storage.loadState('smartdiet-v1'), {});

  mockStorage.set('smartdiet-v1', 'not json');
  const res = storage.loadState('smartdiet-v1');
  assert.deepEqual(res, {});
  // Verifies corrupt state backup
  let hasCorruptBackup = false;
  for (const k of mockStorage.keys()) {
    if (k.startsWith('smartdiet-corrupt-')) hasCorruptBackup = true;
  }
  assert.equal(hasCorruptBackup, true, 'Corrupt state must be backed up to smartdiet-corrupt-*');
});

test('storage module: loadState sanitizes and validates state structure', () => {
  mockStorage.clear();
  const validState = {
    foods: [{ id: '1', name: 'Apple', grams: 100 }],
    weights: [{ id: 'w1', date: '2026-11-20', value: 70 }],
    products: [{ id: 'p1', name: 'Oatmeal', kcal: 350 }],
    prefs: { kcal: 2000, protein: 100, carbs: 242, fat: 70 },
    ai: { keys: { openai: 'test' } }
  };
  mockStorage.set('smartdiet-v1', JSON.stringify(validState));
  const loaded = storage.loadState('smartdiet-v1');
  assert.equal(loaded.foods.length, 1);
  assert.equal(loaded.weights.length, 1);
  assert.equal(loaded.products.length, 1);
  assert.equal(loaded.prefs.kcal, 2000);
});

test('storage module: serializeState strips default Supabase configuration', () => {
  const defaultSb = { url: 'https://default.supabase.co', key: 'default-key' };
  const s1 = { prefs: { lang: 'uk' }, supabase: { ...defaultSb } };
  const out1 = JSON.parse(storage.serializeState(s1, defaultSb));
  assert.equal(out1.supabase, undefined, 'Default Supabase config should be omitted');

  const customSb = { url: 'https://custom.supabase.co', key: 'custom-key' };
  const s2 = { prefs: { lang: 'uk' }, supabase: customSb };
  const out2 = JSON.parse(storage.serializeState(s2, defaultSb));
  assert.deepEqual(out2.supabase, customSb, 'Custom Supabase config must be preserved');
});

test('storage module: cleanProductHistory validates actions and enforces limit', () => {
  const invalid = storage.cleanProductHistory(null);
  assert.deepEqual(invalid, []);

  const history = [
    { at: new Date().toISOString(), action: 'created', name: 'Product A' },
    { at: new Date().toISOString(), action: 'invalid_action', name: 'Product B' },
    { at: 'invalid-date', action: 'updated', name: 'Product C' },
    { at: new Date().toISOString(), action: 'food_added', name: 'Meal' }
  ];
  const cleaned = storage.cleanProductHistory(history);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].name, 'Product A');
  assert.equal(cleaned[1].name, 'Meal');
});

test('storage module: goal plans tracking and history', () => {
  const testState = {
    prefs: {
      kcal: 1800,
      protein: 120,
      carbs: 200,
      fat: 60
    }
  };

  storage.ensureGoalPlans(testState);
  assert.equal(Array.isArray(testState.prefs.goalPlans), true);
  assert.equal(testState.prefs.goalPlans.length, 1);
  assert.equal(testState.prefs.goalPlans[0].from, '1970-01-01');
  assert.equal(testState.prefs.goalPlans[0].kcal, 1800);

  // Sync with same goals does not duplicate
  storage.syncGoalPlans(testState, '2026-11-20');
  assert.equal(testState.prefs.goalPlans.length, 1);

  // Change goals and sync on new date adds a plan
  testState.prefs.kcal = 1900;
  storage.syncGoalPlans(testState, '2026-11-21');
  assert.equal(testState.prefs.goalPlans.length, 2);
  assert.equal(testState.prefs.goalPlans[1].from, '2026-11-21');
  assert.equal(testState.prefs.goalPlans[1].kcal, 1900);

  // goalsOn queries the effective plan
  const planPast = storage.goalsOn('2026-11-20', testState.prefs);
  assert.equal(planPast.kcal, 1800);
  const planPresent = storage.goalsOn('2026-11-22', testState.prefs);
  assert.equal(planPresent.kcal, 1900);
});

test('storage module: notifications loading and saving', () => {
  mockStorage.clear();
  const notifs = [
    { id: 'n1', text: 'Alert 1', at: new Date().toISOString(), unread: true, vis: true },
    { id: 'n2', text: 'Alert 2', at: new Date().toISOString(), unread: false, vis: false }
  ];
  storage.saveNotifications(notifs);
  const loaded = storage.loadNotifications();
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].text, 'Alert 1');
  assert.equal(loaded[0].unread, true);
  assert.equal(loaded[0].vis, false); // vis is initialized to false
});

test('storage module: dietitian chat and meal drafts keys & operations', () => {
  mockStorage.clear();
  assert.equal(storage.dietitianChatKey('user-123'), 'smartdiet-dietitian-chat-v1:user-123');
  assert.equal(storage.dietitianChatKey(null), 'smartdiet-dietitian-chat-v1:local');

  storage.saveDietitianChat([{ id: 'c1', role: 'user', text: 'Hello' }], 'user-123');
  const chat = storage.loadDietitianChat('user-123');
  assert.equal(chat.length, 1);
  assert.equal(chat[0].text, 'Hello');

  assert.equal(storage.mealDraftKey('user-123'), 'smartdiet-meal-drafts-v1:user-123');
  storage.saveMealDrafts([{ id: 'd1', date: '2026-11-25', items: [] }], 'user-123');
  const drafts = storage.mealDrafts('user-123');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, 'd1');
});
