import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const calc = require('../../js/calc-nutrition.js');

// --- 1. Basic formatting & parsing ---

test('normalizeNutritionNumber handles formats, whitespace, and boundary conditions', () => {
  assert.equal(calc.normalizeNutritionNumber('12,5'), '12.5');
  assert.equal(calc.normalizeNutritionNumber(' 12.50 '), '12.5');
  assert.equal(calc.normalizeNutritionNumber('1 250,5'), '1250.5');
  assert.equal(calc.normalizeNutritionNumber('1.250,5'), '1250.5');
  assert.equal(calc.normalizeNutritionNumber('12.346'), '12.35');
  assert.equal(calc.normalizeNutritionNumber('0'), '0');
  assert.equal(calc.normalizeNutritionNumber(''), '0');
  assert.equal(calc.normalizeNutritionNumber('abc'), '');
  assert.equal(calc.normalizeNutritionNumber('-10'), '');
  assert.equal(calc.normalizeNutritionNumber('10000'), '10000');
  assert.equal(calc.normalizeNutritionNumber('15000'), '');
});

test('parseImportedNutrition extracts values from Ukrainian and English text', () => {
  const uaText = `
    Харчова цінність на 100 г:
    Калорійність: 250 ккал
    Білки: 12,5 г
    Жири: 5,0 г
    Вуглеводи: 35,2 г
    Добова норма: 15% daily
  `;
  const uaRes = calc.parseImportedNutrition(uaText);
  assert.equal(uaRes.kcal, '250');
  assert.equal(uaRes.protein, '12.5');
  assert.equal(uaRes.fat, '5');
  assert.equal(uaRes.carbs, '35.2');

  const enText = `
    Nutrition Facts per 100g:
    Energy 180 kcal
    Protein 15.2 g
    Total Fat 4.5 g
    Total Carbohydrate 20.0 g
    % Daily Value: 10%
  `;
  const enRes = calc.parseImportedNutrition(enText);
  assert.equal(enRes.kcal, '180');
  assert.equal(enRes.protein, '15.2');
  assert.equal(enRes.fat, '4.5');
  assert.equal(enRes.carbs, '20');
});

test('calcFmt formats kcal as whole number and macros with 1 decimal', () => {
  assert.equal(calc.calcFmt('kcal', 254.7), '255');
  assert.equal(calc.calcFmt('kcal', 100.1), '100');
  assert.equal(calc.calcFmt('kcal', 0), '0');
  assert.equal(calc.calcFmt('protein', 12.34), '12.3');
  assert.equal(calc.calcFmt('protein', 0), '0');
  assert.equal(calc.calcFmt('fat', 5.0), '5');
  assert.equal(calc.calcFmt('carbs', 30.68), '30.7');
  assert.equal(calc.calcFmt('grams', 150.25), '150.3');
});

test('nutrientState evaluates intake brackets against goal at exact boundaries', () => {
  assert.equal(calc.nutrientState(89.9, 100), 'under');
  assert.equal(calc.nutrientState(90, 100), 'ok');
  assert.equal(calc.nutrientState(100, 100), 'ok');
  assert.equal(calc.nutrientState(110, 100), 'ok');
  assert.equal(calc.nutrientState(110.1, 100), 'high');
  assert.equal(calc.nutrientState(125, 100), 'high');
  assert.equal(calc.nutrientState(125.1, 100), 'over');
  assert.equal(calc.nutrientState(130, 100), 'over');
  assert.equal(calc.nutrientState(50, 0), 'over');
  assert.equal(calc.nutrientState(0, 0), 'ok');
});

// --- 2. Composite dishes (Складні страви) ---

test('compositeTotals sums enabled components and excludes disabled ones', () => {
  const components = [
    { id: '1', name: 'Буряк', grams: 150, kcal: 65, protein: 2.5, fat: 0.2, carbs: 14.0, enabled: true },
    { id: '2', name: 'Свинина', grams: 100, kcal: 160, protein: 18.0, fat: 9.5, carbs: 0.0, enabled: true },
    { id: '3', name: 'Сметана', grams: 30, kcal: 48, protein: 0.8, fat: 4.5, carbs: 1.1, enabled: false }
  ];

  const totals = calc.compositeTotals(components);
  assert.equal(totals.grams, 250);
  assert.equal(totals.kcal, 225);
  assert.equal(totals.protein, 20.5);
  assert.equal(totals.fat, 9.7);
  assert.equal(totals.carbs, 14.0);
});

test('compositeTotals handles all components disabled, empty array or null input without NaN', () => {
  const allDisabled = [
    { id: '1', name: 'Рис', grams: 100, kcal: 130, protein: 2.7, fat: 0.3, carbs: 28.0, enabled: false },
    { id: '2', name: 'Курка', grams: 100, kcal: 165, protein: 31.0, fat: 3.6, carbs: 0.0, enabled: false }
  ];
  assert.deepEqual(calc.compositeTotals(allDisabled), { grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 });
  assert.deepEqual(calc.compositeTotals([]), { grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 });
  assert.deepEqual(calc.compositeTotals(null), { grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 });
  assert.deepEqual(calc.compositeTotals(undefined), { grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 });
});

test('compositeTotals preserves floating-point precision on fractional grams and micro-nutrients', () => {
  const components = [
    { id: '1', name: 'Сіль/Спеції', grams: 0.5, kcal: 0, protein: 0.1, fat: 0.0, carbs: 0.1, enabled: true },
    { id: '2', name: 'Олія оливкова', grams: 12.3, kcal: 108.7, protein: 0.0, fat: 12.3, carbs: 0.0, enabled: true },
    { id: '3', name: 'Лимонний сік', grams: 7.7, kcal: 2.2, protein: 0.1, fat: 0.0, carbs: 0.5, enabled: true }
  ];

  const totals = calc.compositeTotals(components);
  assert.equal(totals.grams, 20.5); // 0.5 + 12.3 + 7.7
  assert.equal(totals.kcal, 111); // Math.round(110.9)
  assert.equal(totals.protein, 0.2); // 0.1 + 0.0 + 0.1
  assert.equal(totals.fat, 12.3);
  assert.equal(totals.carbs, 0.6);
});

test('compositeTotals handles zero calories, water, and missing or string nutrient fields safely', () => {
  const components = [
    { id: '1', name: 'Вода', grams: '250', kcal: '0', protein: '0', fat: '0', carbs: '0', enabled: true },
    { id: '2', name: 'Чайний лист', grams: 3, kcal: 1, enabled: true } // missing protein/fat/carbs
  ];
  const totals = calc.compositeTotals(components);
  assert.equal(totals.grams, 253);
  assert.equal(totals.kcal, 1);
  assert.equal(totals.protein, 0);
  assert.equal(totals.fat, 0);
  assert.equal(totals.carbs, 0);
});

test('scaleNutrients scales nutrition with boundary cases', () => {
  const nutrients = { kcal: 200, protein: 10, fat: 5, carbs: 28 };
  // Normal scale
  const scaled = calc.scaleNutrients(nutrients, 100, 250);
  assert.equal(scaled.grams, 250);
  assert.equal(scaled.kcal, 500);
  assert.equal(scaled.protein, 25);
  assert.equal(scaled.fat, 12.5);
  assert.equal(scaled.carbs, 70);

  // Target 0 grams: all nutrients become 0
  const zeroTarget = calc.scaleNutrients(nutrients, 100, 0);
  assert.deepEqual(zeroTarget, { grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 });

  // Base 0 or negative: defaults to 100g base
  const zeroBase = calc.scaleNutrients(nutrients, 0, 50);
  assert.equal(zeroBase.grams, 50);
  assert.equal(zeroBase.kcal, 100);

  // Null/undefined nutrients
  const emptyNutrients = calc.scaleNutrients(null, 100, 150);
  assert.deepEqual(emptyNutrients, { grams: 150, kcal: 0, protein: 0, fat: 0, carbs: 0 });
});

test('scaleComponentGrams scales ingredient proportional to total dish weight with guards', () => {
  assert.equal(calc.scaleComponentGrams(150, 450, 900), 300);
  assert.equal(calc.scaleComponentGrams(100, 450, 225), 50);
  assert.equal(calc.scaleComponentGrams(33.3, 100, 200), 66.6);

  // Guard against non-positive totals (returns currentGrams unchanged)
  assert.equal(calc.scaleComponentGrams(50, 0, 100), 50);
  assert.equal(calc.scaleComponentGrams(50, 100, 0), 50);
  assert.equal(calc.scaleComponentGrams(50, -100, 200), 50);
});

// --- 3. Addons / Companions (Додатки до страв) ---

test('calcCompanionTotals computes base product with active and inactive companions', () => {
  const baseProduct = { name: 'Кава', grams: 150, kcal: 3, protein: 0.2, fat: 0, carbs: 0.4 };
  const companions = [
    {
      item: { name: 'Молоко 2.5%', grams: 100, kcal: 52, protein: 2.8, fat: 2.5, carbs: 4.7 },
      grams: 50,
      on: true
    },
    {
      item: { name: 'Цукор', grams: 100, kcal: 398, protein: 0, fat: 0, carbs: 99.8 },
      grams: 10,
      on: false // turned off
    }
  ];

  const totals = calc.calcCompanionTotals(baseProduct, companions);
  assert.equal(totals.grams, 200); // 150 + 50
  assert.equal(totals.kcal, 29); // 3 + 26
  assert.equal(totals.protein, 1.6); // 0.2 + 1.4
  assert.equal(totals.fat, 1.3); // 0 + 1.25 -> 1.3
  assert.equal(totals.carbs, 2.8); // 0.4 + 2.35 -> 2.8
});

test('calcCompanionTotals handles companion with default base grams and empty companions list', () => {
  const baseProduct = { name: 'Сирники', grams: 200, kcal: 360, protein: 28, fat: 16, carbs: 26 };
  // Empty companions
  assert.deepEqual(calc.calcCompanionTotals(baseProduct, []), {
    grams: 200,
    kcal: 360,
    protein: 28,
    fat: 16,
    carbs: 26
  });

  // Companion with grams: 0 uses item base grams
  const companionsWithZeroG = [
    {
      item: { name: 'Мед', grams: 20, kcal: 64, protein: 0.1, fat: 0, carbs: 16.5 },
      grams: 0, // falls back to base 20g
      on: true
    }
  ];
  const withHoney = calc.calcCompanionTotals(baseProduct, companionsWithZeroG);
  assert.equal(withHoney.grams, 220); // 200 + 20
  assert.equal(withHoney.kcal, 424); // 360 + 64
});

test('normalizeFoodComponentsForEntry preserves isBase flag for dishes with companions', () => {
  const components = [
    { id: '__base__', name: 'Кава', grams: 150, kcal: 3, protein: 0.2, fat: 0, carbs: 0.4, enabled: true, isBase: true },
    { id: 'milk', name: 'Молоко', grams: 50, kcal: 26, protein: 1.4, fat: 1.3, carbs: 2.4, enabled: true }
  ];

  // 1 portion, total 200g
  const result = calc.normalizeFoodComponentsForEntry(components, 1, 200, false);
  const base = result.find(c => c.id === '__base__');
  assert.ok(base);
  assert.equal(base.isBase, true);
  assert.equal(base.grams, 150);
  assert.equal(base.portion, 1);

  const addon = result.find(c => c.id === 'milk');
  assert.ok(addon);
  assert.equal(addon.grams, 50);
  assert.equal(addon.isBase, undefined);
});

test('normalizeFoodComponentsForEntry scales base when addon is disabled', () => {
  const components = [
    { id: '__base__', name: 'Кава', grams: 150, kcal: 3, protein: 0.2, fat: 0, carbs: 0.4, enabled: true, isBase: true },
    { id: 'milk', name: 'Молоко', grams: 50, kcal: 26, protein: 1.4, fat: 1.3, carbs: 2.4, enabled: false }
  ];

  // User orders black coffee (addon disabled): target is 150g
  const result = calc.normalizeFoodComponentsForEntry(components, 1, 150, false);
  const base = result.find(c => c.id === '__base__');
  assert.equal(base.grams, 150);
  assert.equal(base.enabled, true);

  const addon = result.find(c => c.id === 'milk');
  assert.equal(addon.grams, 50);
  assert.equal(addon.enabled, false);

  // compositeTotals on this output only counts the active coffee
  const totals = calc.compositeTotals(result);
  assert.equal(totals.grams, 150);
  assert.equal(totals.kcal, 3);
});

// --- 4. Portions & Fractional Portions (Дробові та нестандартні порції) ---

test('normalizeFoodComponentsForEntry scales components proportionally for fractional portions (0.5)', () => {
  const components = [
    { id: '1', name: 'Рис', grams: 100, kcal: 130, protein: 2.7, fat: 0.3, carbs: 28.0, enabled: true },
    { id: '2', name: 'Курка', grams: 100, kcal: 165, protein: 31.0, fat: 3.6, carbs: 0.0, enabled: true }
  ];

  // Half portion (0.5), target total for 1 portion is 200g
  const scaled = calc.normalizeFoodComponentsForEntry(components, 0.5, 200, false);
  const rice = scaled.find(c => c.id === '1');
  const chicken = scaled.find(c => c.id === '2');

  assert.equal(rice.portion, 0.5);
  assert.equal(rice.baseGrams, 100);
  assert.equal(rice.grams, 50); // 100 * 0.5
  assert.equal(rice.kcal, 65); // 130 * 0.5

  assert.equal(chicken.portion, 0.5);
  assert.equal(chicken.baseGrams, 100);
  assert.equal(chicken.grams, 50); // 100 * 0.5
  assert.equal(chicken.protein, 15.5); // 31.0 * 0.5
  assert.equal(chicken.fat, 1.8); // 3.6 * 0.5

  const totals = calc.compositeTotals(scaled);
  assert.equal(totals.grams, 100);
  assert.equal(totals.kcal, 148); // Math.round(65 + 82.5)
});

test('normalizeFoodComponentsForEntry handles quarter (0.25) and one-third (0.33) portions', () => {
  const components = [
    { id: '1', name: 'Вівсянка', grams: 120, kcal: 140, protein: 4.8, fat: 2.8, carbs: 24.0, enabled: true }
  ];

  // Quarter portion (0.25)
  const quarter = calc.normalizeFoodComponentsForEntry(components, 0.25, 120, false);
  assert.equal(quarter[0].grams, 30);
  assert.equal(quarter[0].kcal, 35);
  assert.equal(quarter[0].protein, 1.2);
  assert.equal(quarter[0].fat, 0.7);
  assert.equal(quarter[0].carbs, 6.0);

  // One-third portion (0.33)
  const third = calc.normalizeFoodComponentsForEntry(components, 0.33, 120, false);
  assert.equal(third[0].grams, 39.6);
  assert.equal(third[0].kcal, 46.2);
  assert.equal(third[0].protein, 1.6);
});

test('normalizeFoodComponentsForEntry falls back to 1 portion when portion is 0 or negative', () => {
  const components = [
    { id: '1', name: 'Яблуко', grams: 150, kcal: 78, protein: 0.6, fat: 0.3, carbs: 20.7, enabled: true }
  ];

  const zeroPortion = calc.normalizeFoodComponentsForEntry(components, 0, 150, false);
  assert.equal(zeroPortion[0].portion, 1);
  assert.equal(zeroPortion[0].grams, 150);

  const negPortion = calc.normalizeFoodComponentsForEntry(components, -2, 150, false);
  assert.equal(negPortion[0].portion, 1);
  assert.equal(negPortion[0].grams, 150);
});

test('normalizeFoodComponentsForEntry handles absolute mode correctly', () => {
  // When absolute: true, the input grams already represent the total across portions
  const components = [
    { id: '1', name: 'Суп', grams: 500, kcal: 300, protein: 15, fat: 10, carbs: 35, enabled: true }
  ];

  // 2 portions, already 500g total: base per portion is 250g
  const result = calc.normalizeFoodComponentsForEntry(components, 2, 250, true);
  assert.equal(result[0].portion, 2);
  assert.equal(result[0].baseGrams, 250);
  assert.equal(result[0].grams, 500);
  assert.equal(result[0].kcal, 300);
});

test('normalizeFoodComponentsForEntry handles all components disabled without division by zero', () => {
  const components = [
    { id: '1', name: 'A', grams: 100, kcal: 100, protein: 10, fat: 5, carbs: 10, enabled: false }
  ];
  const result = calc.normalizeFoodComponentsForEntry(components, 1, 100, false);
  assert.equal(result[0].grams, 100);
  assert.equal(result[0].enabled, false);
  assert.ok(Number.isFinite(result[0].grams));
  assert.ok(Number.isFinite(result[0].kcal));
});

// --- 5. Goal calculations (Цільові плани та макроси) ---

test('planFloor returns proper minimum for sex', () => {
  assert.equal(calc.planFloor({ sex: 'female' }), 1200);
  assert.equal(calc.planFloor({ sex: 'male' }), 1500);
  assert.equal(calc.planFloor({}), 1500);
  assert.equal(calc.planFloor(null), 1500);
});

test('calcProteinTarget handles deficit, maintenance, surplus and zero weight', () => {
  // Deficit: target 65kg < weight 70kg -> ref is min(70, 65 * 1.15) = 70
  const deficit = calc.calcProteinTarget(70, 65);
  assert.equal(deficit, 126); // 1.8 * 70

  // Big deficit: target 50kg < weight 90kg -> ref = min(90, 50 * 1.15) = 57.5 -> 1.8 * 57.5 = 103.5
  const bigDeficit = calc.calcProteinTarget(90, 50);
  assert.ok(Math.abs(bigDeficit - 103.5) < 0.001);

  // Surplus / Maintenance: target 80kg >= weight 75kg -> ref = 75 -> 1.8 * 75 = 135
  const surplus = calc.calcProteinTarget(75, 80);
  assert.equal(surplus, 135);

  // Zero or negative weight
  assert.equal(calc.calcProteinTarget(0, 70), 0);
  assert.equal(calc.calcProteinTarget(-10, 70), 0);
});

test('calcMacrosFor distributes calories correctly across low, normal and high intakes', () => {
  // Normal 2000 kcal
  const macros = calc.calcMacrosFor(2000, 120, 120);
  assert.equal(macros.protein, 120);
  assert.equal(macros.fat, 60); // 2000 * 0.27 / 9
  assert.equal(macros.carbs, 245); // (2000 - 480 - 540) / 4 = 980 / 4 = 245

  // Custom protein clamped to max 40% of calories
  // At 1000 kcal, max protein is 1000 * 0.4 / 4 = 100g. If custom is 150g -> clamped to 100g.
  const clamped = calc.calcMacrosFor(1000, 150, 80);
  assert.equal(clamped.protein, 100);
  assert.equal(clamped.fat, 30); // 1000 * 0.27 / 9
  assert.equal(clamped.carbs, 83); // (1000 - 400 - 270) / 4 = 330 / 4 = 82.5 -> 83

  // Low deficit 800 kcal: non-negative carbs guaranteed
  const low = calc.calcMacrosFor(800, 70, 70);
  assert.ok(low.protein > 0);
  assert.ok(low.fat > 0);
  assert.ok(low.carbs >= 0);
});


test("compositeDishBaseGrams returns product grams or sum of components", () => {
  assert.equal(calc.compositeDishBaseGrams({ grams: 250 }), 250);
  assert.equal(calc.compositeDishBaseGrams({ components: [{ grams: 60 }, { grams: 40 }] }), 100);
  assert.equal(calc.compositeDishBaseGrams({}), 100);
});

test("calcCompositeNutrients distributes portion grams and nutrients based on active ingredient ratio", () => {
  const comps = [
    { id: "beet", name: "Beet", grams: 60, kcal: 26, protein: 1, fat: 0.1, carbs: 5.8, enabled: true },
    { id: "mayo", name: "Mayonnaise", grams: 20, kcal: 136, protein: 0.2, fat: 15, carbs: 0.5, enabled: true },
    { id: "sauce", name: "Sauce", grams: 20, kcal: 20, protein: 0.5, fat: 1, carbs: 2, enabled: true },
  ];

  // 100g portion with all 3: 60%, 20%, 20%
  const res100 = calc.calcCompositeNutrients(comps, 100);
  assert.equal(res100.grams, 100);
  assert.equal(res100.kcal, 182);

  // 200g portion with all 3: exactly double
  const res200 = calc.calcCompositeNutrients(comps, 200);
  assert.equal(res200.grams, 200);
  assert.equal(res200.kcal, 364);

  // When only Beet is enabled: occupies 100% of portion
  comps[1].enabled = false;
  comps[2].enabled = false;
  const resOnlyBeet100 = calc.calcCompositeNutrients(comps, 100);
  assert.equal(resOnlyBeet100.grams, 100);
  // 60g beet = 26 kcal -> 100g = 26 * 100 / 60 = 43.33 -> 43 kcal
  assert.equal(resOnlyBeet100.kcal, 43);

  const resOnlyBeet200 = calc.calcCompositeNutrients(comps, 200);
  assert.equal(resOnlyBeet200.grams, 200);
  // 200g = 26 * 200 / 60 = 86.67 -> 87 kcal
  assert.equal(resOnlyBeet200.kcal, 87);
});

test("scaleCompositeComponents returns scaled component entries for saving", () => {
  const comps = [
    { id: "beet", name: "Beet", grams: 60, kcal: 26, protein: 1, fat: 0.1, carbs: 5.8, enabled: true },
    { id: "mayo", name: "Mayonnaise", grams: 20, kcal: 136, protein: 0.2, fat: 15, carbs: 0.5, enabled: false },
  ];
  const scaled = calc.scaleCompositeComponents(comps, 200);
  assert.equal(scaled[0].grams, 200);
  assert.equal(scaled[0].bowlGrams, 60);
  assert.equal(Math.round(scaled[0].kcal), 87);
  assert.equal(scaled[1].grams, 0);
  assert.equal(scaled[1].bowlGrams, 20);
});
