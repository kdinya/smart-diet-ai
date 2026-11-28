import test from 'node:test';
import assert from 'node:assert/strict';
import sync from '../../js/sync.js';

const {
  isDataError,
  cloudFoodRow,
  cloudProductRow,
  cloudWeightRow,
  normalizeSyncQueue,
  localSummary,
  hasLocalData,
  enqueueItem,
  dequeueItem,
  queueAllItems,
  forgetFoodItem,
  rememberRejectedItem,
  forgetRejectedItem,
  pruneRejectedItems
} = sync;

test('isDataError identifies data validation error codes', () => {
  assert.equal(isDataError({ code: '22P02' }), true);
  assert.equal(isDataError({ code: '23505' }), true);
  assert.equal(isDataError({ code: '42501' }), true);
  assert.equal(isDataError({ code: '57014' }), false);
  assert.equal(isDataError(null), false);
});

test('cloudFoodRow maps properties and validates structure', () => {
  const food = {
    id: 'f1',
    name: '  Яблуко  ',
    meal: 'lunch',
    grams: 150.456,
    kcal: 78.2,
    protein: 0.4,
    fat: 0.2,
    carbs: 19.1,
    date: '2026-11-28',
    snackId: 'snack-1',
    mealOrder: 2,
    components: [{ id: 'c1', grams: 150 }]
  };
  const row = cloudFoodRow(food, 'user-123');
  assert.equal(row.id, 'f1');
  assert.equal(row.user_id, 'user-123');
  assert.equal(row.name, 'Яблуко');
  assert.equal(row.meal_type, 'lunch');
  assert.equal(row.grams, 150.46);
  assert.equal(row.entry_date, '2026-11-28');
  assert.equal(row.snack_id, 'snack-1');
  assert.equal(row.meal_order, 2);
  assert.equal(row.components.length, 1);
});

test('cloudProductRow maps product and handles companion and note limits', () => {
  const prod = {
    id: 'p1',
    name: '  Сир кисломолочний 5%  ',
    grams: 100,
    kcal: 121,
    protein: 17,
    fat: 5,
    carbs: 2,
    verified: true,
    note: '  Смачний сир  ',
    companions: [{ id: 'comp-1', grams: 20 }]
  };
  const row = cloudProductRow(prod, 'user-123');
  assert.equal(row.id, 'p1');
  assert.equal(row.user_id, 'user-123');
  assert.equal(row.name, 'Сир кисломолочний 5%');
  assert.equal(row.verified, true);
  assert.equal(row.note, 'Смачний сир');
  assert.equal(row.companions.length, 1);
});

test('cloudWeightRow validates range and rounds value', () => {
  assert.equal(cloudWeightRow(null, 'user-1'), null);
  assert.equal(cloudWeightRow({ value: -5 }, 'user-1'), null);
  assert.equal(cloudWeightRow({ value: 1500 }, 'user-1'), null);
  const row = cloudWeightRow({ id: 'w1', value: 72.345, date: '2026-11-28' }, 'user-1');
  assert.equal(row.id, 'w1');
  assert.equal(row.value, 72.35);
  assert.equal(row.entry_date, '2026-11-28');
});

test('normalizeSyncQueue provides safe defaults and converts legacy structures', () => {
  const empty = normalizeSyncQueue(null);
  assert.deepEqual(empty.foods, []);
  assert.deepEqual(empty.weights, []);
  assert.equal(empty.profile, false);

  const raw = {
    foods: ['f1'],
    delFoods: ['f2'],
    delWeights: ['2026-11-27'],
    profile: true
  };
  const norm = normalizeSyncQueue(raw, 'user-abc');
  assert.deepEqual(norm.foods, ['f1']);
  assert.equal(norm.delFoods.length, 1);
  assert.equal(norm.delFoods[0].id, 'f2');
  assert.equal(norm.delFoods[0].u, 'user-abc');
  assert.equal(norm.delWeights[0].d, '2026-11-27');
  assert.equal(norm.delWeights[0].u, 'user-abc');
  assert.equal(norm.profile, true);
});

test('localSummary and hasLocalData count local items and pending queue', () => {
  const queue = {
    foods: ['f1'],
    weights: [],
    delFoods: [],
    delWeights: [],
    products: ['p1'],
    delProducts: [],
    profile: false,
    rejected: []
  };
  const appState = {
    foods: [{ id: 'f1' }, { id: 'f2' }],
    weights: [{ id: 'w1' }],
    products: [{ id: 'p1' }],
    prefs: { goal: 'maintain' }
  };
  const summary = localSummary(queue, appState);
  assert.equal(summary.foods, 2);
  assert.equal(summary.weights, 1);
  assert.equal(summary.products, 1);
  assert.equal(summary.pending, 2);
  assert.equal(hasLocalData(queue, appState), true);
});

test('queue operations: enqueue, dequeue, queueAll, forgetFood, rejection management', () => {
  const queue = {
    foods: [],
    weights: [],
    delFoods: [],
    delWeights: [],
    products: [],
    delProducts: [],
    profile: false,
    rejected: []
  };
  enqueueItem(queue, 'foods', 'food-1');
  assert.deepEqual(queue.foods, ['food-1']);
  enqueueItem(queue, 'foods', 'food-1'); // idempotent
  assert.deepEqual(queue.foods, ['food-1']);
  dequeueItem(queue, 'foods', 'food-1');
  assert.deepEqual(queue.foods, []);

  const stateObj = {
    foods: [{ id: 'f10' }, { id: 'f11' }],
    weights: [{ id: 'w10' }],
    products: [{ id: 'p10' }]
  };
  queueAllItems(queue, stateObj);
  assert.deepEqual(queue.foods, ['f10', 'f11']);
  assert.deepEqual(queue.weights, ['w10']);
  assert.deepEqual(queue.products, ['p10']);

  forgetFoodItem(queue, stateObj, 'f10', 'user-1');
  assert.deepEqual(queue.foods, ['f11']);
  assert.equal(queue.delFoods.length, 1);
  assert.equal(queue.delFoods[0].id, 'f10');
  assert.equal(queue.delFoods[0].u, 'user-1');

  rememberRejectedItem(queue, 'foods', 'f11');
  assert.equal(queue.rejected.length, 1);
  forgetRejectedItem(queue, 'foods', 'f11');
  assert.equal(queue.rejected.length, 0);

  rememberRejectedItem(queue, 'foods', 'missing-food');
  const count = pruneRejectedItems(queue, { foods: [{ id: 'existing' }] });
  assert.equal(count, 0);
  assert.equal(queue.rejected.length, 0);
});
