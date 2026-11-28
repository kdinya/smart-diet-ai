import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../../js/catalog.js';

const {
  companionSnapshot,
  catalogAddonMap,
  buildCatalogCompanions,
  isProductInCatalog,
  isCatalogProductInMine,
  buildCatalogProductRow,
  prepareCopiedCatalogProduct
} = catalog;

test('companionSnapshot extracts and sanitizes nutrient properties', () => {
  const snap = companionSnapshot({
    name: '  Кава натуральна  ',
    grams: '150',
    kcal: '2.5',
    protein: '0.2',
    fat: 0,
    carbs: '0.3',
    extra: 'ignored'
  });
  assert.equal(snap.name, '  Кава натуральна  ');
  assert.equal(snap.grams, 150);
  assert.equal(snap.kcal, 2.5);
  assert.equal(snap.protein, 0.2);
  assert.equal(snap.fat, 0);
  assert.equal(snap.carbs, 0.3);
  assert.equal(snap.extra, undefined);
});

test('catalogAddonMap creates snapshot map from catalog companions', () => {
  const catalogProduct = {
    name: 'Кава',
    companions: [
      {
        id: 'addon-1',
        item: { name: 'Молоко', grams: 50, kcal: 30, protein: 1.5, fat: 1.6, carbs: 2.4 }
      },
      {
        id: 'invalid-addon'
      }
    ]
  };
  const map = catalogAddonMap(catalogProduct);
  assert.equal(map.size, 1);
  assert.ok(map.has('addon-1'));
  const snap = map.get('addon-1');
  assert.equal(snap.name, 'Молоко');
  assert.equal(snap.kcal, 30);
});

test('buildCatalogCompanions preserves active status and resolves sources', () => {
  const pool = [
    { id: 'p1', name: 'Цукор', grams: 5, kcal: 20, protein: 0, fat: 0, carbs: 5 }
  ];
  const list = [
    { id: 'p1', grams: 10, on: true },
    { id: 'missing', grams: 50, on: false }
  ];
  const comps = buildCatalogCompanions(list, null, pool);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].id, 'p1');
  assert.equal(comps[0].grams, 10);
  assert.equal(comps[0].on, true);
  assert.equal(comps[0].item.name, 'Цукор');
});

test('isProductInCatalog and isCatalogProductInMine match keys accurately', () => {
  const catalogList = [
    { name: 'Борщ український' },
    { name: 'Салат грецький' }
  ];
  const myProducts = [
    { name: 'борщ український' },
    { name: 'Вівсянка' }
  ];
  assert.equal(isProductInCatalog('  БОРЩ УКРАЇНСЬКИЙ  ', catalogList), true);
  assert.equal(isProductInCatalog('Піца', catalogList), false);

  assert.equal(isCatalogProductInMine({ name: 'Борщ український' }, myProducts), true);
  assert.equal(isCatalogProductInMine({ name: 'Салат грецький' }, myProducts), false);
});

test('buildCatalogProductRow constructs clean row schema for supabase', () => {
  const prod = {
    name: '  Гречка  ',
    grams: 100,
    kcal: 330,
    protein: 12.6,
    fat: 3.3,
    carbs: 62.1,
    verified: true,
    note: '  Органічна  ',
    components: [{ id: 'c1', name: 'Крупа', grams: 100 }]
  };
  const row = buildCatalogProductRow(prod, 'Гречка відбірна');
  assert.equal(row.name, 'Гречка відбірна');
  assert.equal(row.grams, 100);
  assert.equal(row.kcal, 330);
  assert.equal(row.verified, true);
  assert.equal(row.note, 'Органічна');
  assert.equal(row.components.length, 1);
});

test('prepareCopiedCatalogProduct creates isolated product and resolves duplicate addon names', () => {
  const existing = [
    { id: 'ex1', name: 'Молоко', grams: 50, kcal: 30, protein: 1.5, fat: 1.6, carbs: 2.4 }
  ];
  const catalogProduct = {
    id: 'cat-1',
    name: 'Кава з молоком',
    grams: 200,
    kcal: 50,
    protein: 2,
    fat: 2,
    carbs: 6,
    companions: [
      {
        id: 'snap-1',
        grams: 50,
        on: true,
        item: { name: 'Молоко', grams: 50, kcal: 30, protein: 1.5, fat: 1.6, carbs: 2.4 }
      }
    ]
  };
  const { item, addonItems } = prepareCopiedCatalogProduct(catalogProduct, 'Кава з молоком', existing);
  assert.ok(item.id);
  assert.equal(item.name, 'Кава з молоком');
  assert.equal(item.companions.length, 1);
  // Existing milk matched exactly by macros, so no new addon created
  assert.equal(addonItems.length, 0);
  assert.equal(item.companions[0].id, 'ex1');

  // When milk doesn't match macros, a copy is generated
  const differentExisting = [
    { id: 'ex2', name: 'Молоко', grams: 100, kcal: 60, protein: 3, fat: 3.2, carbs: 4.8 }
  ];
  const res2 = prepareCopiedCatalogProduct(catalogProduct, 'Кава з молоком', differentExisting, 'копія');
  assert.equal(res2.addonItems.length, 1);
  assert.equal(res2.addonItems[0].name, 'Молоко (копія)');
});
