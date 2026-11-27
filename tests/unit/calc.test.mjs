import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const calc = require('../../js/calc-nutrition.js');

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
  assert.equal(calc.calcFmt('protein', 12.34), '12.3');
  assert.equal(calc.calcFmt('fat', 5.0), '5');
  assert.equal(calc.calcFmt('carbs', 30.68), '30.7');
});

test('nutrientState evaluates intake brackets against goal', () => {
  assert.equal(calc.nutrientState(85, 100), 'under');
  assert.equal(calc.nutrientState(90, 100), 'ok');
  assert.equal(calc.nutrientState(100, 100), 'ok');
  assert.equal(calc.nutrientState(110, 100), 'ok');
  assert.equal(calc.nutrientState(115, 100), 'high');
  assert.equal(calc.nutrientState(125, 100), 'high');
  assert.equal(calc.nutrientState(130, 100), 'over');
  assert.equal(calc.nutrientState(50, 0), 'over');
  assert.equal(calc.nutrientState(0, 0), 'ok');
});

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

test('normalizeFoodComponentsForEntry scales components proportionally', () => {
  const components = [
    { id: '1', name: 'Рис', grams: 100, kcal: 130, protein: 2.7, fat: 0.3, carbs: 28.0, enabled: true },
    { id: '2', name: 'Курка', grams: 100, kcal: 165, protein: 31.0, fat: 3.6, carbs: 0.0, enabled: true },
    { id: '3', name: 'Соус', grams: 20, kcal: 50, protein: 0.5, fat: 5.0, carbs: 1.0, enabled: false }
  ];

  // Target total 400g with 2 portions: active raw = 200g, targetGrams = 400g -> scale = 2
  const scaled = calc.normalizeFoodComponentsForEntry(components, 2, 400, false);
  const rice = scaled.find(c => c.id === '1');
  assert.ok(rice);
  assert.equal(rice.portion, 2);
  assert.equal(rice.baseGrams, 200);
  assert.equal(rice.grams, 400); // 200 * 2
  assert.equal(rice.kcal, 520); // 130 * 2 * 2

  const sauce = scaled.find(c => c.id === '3');
  assert.ok(sauce);
  assert.equal(sauce.enabled, false);
  assert.equal(sauce.grams, 40); // 20 * 2 (unscaled by targetGrams because disabled)
});

test('scaleNutrients scales nutrition based on base and target grams', () => {
  const nutrients = { kcal: 200, protein: 10, fat: 5, carbs: 28 };
  const scaled = calc.scaleNutrients(nutrients, 100, 250);
  assert.equal(scaled.grams, 250);
  assert.equal(scaled.kcal, 500);
  assert.equal(scaled.protein, 25);
  assert.equal(scaled.fat, 12.5);
  assert.equal(scaled.carbs, 70);
});

test('scaleComponentGrams scales ingredient proportional to total dish weight', () => {
  assert.equal(calc.scaleComponentGrams(150, 450, 900), 300);
  assert.equal(calc.scaleComponentGrams(100, 450, 225), 50);
  assert.equal(calc.scaleComponentGrams(50, 0, 100), 50);
});

test('planFloor returns proper minimum for sex', () => {
  assert.equal(calc.planFloor({ sex: 'female' }), 1200);
  assert.equal(calc.planFloor({ sex: 'male' }), 1500);
  assert.equal(calc.planFloor({}), 1500);
});

test('calcProteinTarget and calcMacrosFor calculate valid macros', () => {
  const proteinTarget = calc.calcProteinTarget(70, 65);
  assert.ok(proteinTarget > 0);

  const macros = calc.calcMacrosFor(2000, 120, proteinTarget);
  assert.equal(macros.protein, 120);
  assert.equal(macros.fat, 60); // 2000 * 0.27 / 9
  assert.ok(macros.carbs > 0);
  // Total calories check: P*4 + F*9 + C*4 approx equals 2000
  const estimatedKcal = macros.protein * 4 + macros.fat * 9 + macros.carbs * 4;
  assert.ok(Math.abs(estimatedKcal - 2000) <= 15);
});
