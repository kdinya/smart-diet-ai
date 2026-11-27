import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ai = require('../../js/ai-service.js');

test('AI configuration contains expected providers and models', () => {
  assert.deepEqual(ai.AI_IDS, ['gemini', 'openai', 'anthropic', 'groq', 'xai']);
  assert.deepEqual(ai.AI_AUTO_PROVIDERS, ['gemini', 'groq']);
  assert.ok(ai.AI_MODELS.gemini.auto.includes('gemini-3.5-flash-lite'));
  assert.ok(ai.AI_MODELS.groq.auto.includes('openai/gpt-oss-120b'));
  assert.ok(ai.AI_MODELS.openai.auto.includes('gpt-6-luna'));
  assert.ok(ai.AI_MODELS.anthropic.auto.includes('claude-haiku-5-5'));
  assert.ok(ai.AI_MODELS.xai.auto.includes('grok-4.3'));
});

test('aiTimeLeft calculates remaining time or throws on timeout', () => {
  const now = Date.now();
  assert.equal(ai.aiTimeLeft(Date.now() + 10000, 5000), 5000);
  const left = ai.aiTimeLeft(Date.now() + 3000, 5000);
  assert.ok(left >= 2950 && left <= 3000);
  assert.throws(() => ai.aiTimeLeft(now + 200, 5000), /slowly|повільно/i);
});

test('parseNutrition parses valid JSON and scales/clamps values', () => {
  const jsonStr = JSON.stringify({
    items: [
      { name: 'Вівсянка', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { name: 'Молоко', grams: 200, kcal: 120, protein: 6, fat: 5, carbs: 9 }
    ],
    note: 'Гарний збалансований сніданок'
  });
  const res = ai.parseNutrition(jsonStr, { lang: 'uk' });
  assert.equal(res.items.length, 2);
  assert.equal(res.total.kcal, 470);
  assert.equal(res.total.protein, 18);
  assert.equal(res.total.fat, 11);
  assert.equal(res.total.carbs, 69);
  assert.equal(res.note, 'Гарний збалансований сніданок');
});

test('parseNutrition handles markdown code blocks and consolidates duplicate names', () => {
  const fenced = '```json\n{"items":[{"name":"Хліб","grams":50,"kcal":120,"protein":4,"fat":1,"carbs":24},{"name":"хліб","grams":50,"kcal":120,"protein":4,"fat":1,"carbs":24}]}\n```';
  const res = ai.parseNutrition(fenced, { lang: 'uk' });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].grams, 100);
  assert.equal(res.items[0].kcal, 240);
});

test('parseNutrition throws on missing, non-numeric or negative nutrition fields', () => {
  assert.throws(() => ai.parseNutrition(JSON.stringify({ items: [{ name: 'Rice', grams: 150, protein: 3, fat: 0, carbs: 40 }] })), /incomplete|неповний/i);
  assert.throws(() => ai.parseNutrition(JSON.stringify({ items: [{ name: 'Rice', grams: 150, kcal: -100, protein: 3, fat: 0, carbs: 40 }] })), /incomplete|неповний/i);
  assert.throws(() => ai.parseNutrition(JSON.stringify({ items: [{ name: 'Rice', grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 }] })), /incomplete|неповний/i);
});

test('nutritionPrompt builds correct prompt for uk and en', () => {
  const budget = {
    targetMeal: 450,
    total: 1800,
    consumed: 500,
    used: { protein: 30, fat: 20, carbs: 60 },
    target: { protein: 100, fat: 60, carbs: 200 }
  };
  const ukPrompt = ai.nutritionPrompt('Вівсяна каша з ягодами', 'breakfast', budget, ['Кава з молоком (150 ккал)'], 'uk', k => k);
  assert.ok(ukPrompt.includes('Вівсяна каша з ягодами'));
  assert.ok(ukPrompt.includes('Кава з молоком (150 ккал)'));
  assert.ok(ukPrompt.includes('450 ккал'));

  const enPrompt = ai.nutritionPrompt('Oatmeal with berries', 'breakfast', budget, [], 'en', k => k);
  assert.ok(enPrompt.includes('Oatmeal with berries'));
  assert.ok(enPrompt.includes('450 kcal'));
});

test('mealPlanPrompt constructs plan prompt with given foods and remaining budget', () => {
  const foods = [{ id: 'p1', name: 'Куряче філе', grams: 100, kcal: 110, protein: 23, fat: 1, carbs: 0 }];
  const budget = { used: { kcal: 500, protein: 30, fat: 20, carbs: 50 } };
  const remaining = { kcal: 1300, protein: 70, fat: 40, carbs: 150 };
  const prompt = ai.mealPlanPrompt(foods, budget, remaining, '', ['lunch', 'dinner'], {
    lang: 'uk',
    t: k => k,
    mealPlanDate: '2026-11-20',
    todayIso: '2026-11-20'
  });
  assert.ok(prompt.includes('Куряче філе'));
  assert.ok(prompt.includes('lunch'));
  assert.ok(prompt.includes('dinner'));
  assert.ok(prompt.includes('решту сьогодні'));
});

test('parseMealPlanItems parses valid meal plan items and validates allowed products', () => {
  const allowed = new Map([
    ['p1', { id: 'p1', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 }]
  ]);
  const raw = '```json\n{"items":[{"id":"p1","grams":50,"meal":"breakfast"}]}\n```';
  const items = ai.parseMealPlanItems(raw, allowed, { t: k => k });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'p1');
  assert.equal(items[0].grams, 50);
  assert.equal(items[0].kcal, 175);
});

test('askPrompt formats verbosity correctly', () => {
  const briefPrompt = ai.askPrompt([], 'How to lose weight safely?', { lang: 'en', verbosity: 'brief' });
  assert.ok(briefPrompt.includes('Answer very briefly'));

  const detailedPrompt = ai.askPrompt([], 'How to lose weight safely?', { lang: 'en', verbosity: 'detailed' });
  assert.ok(detailedPrompt.includes('Answer in detail'));

  const ukPrompt = ai.askPrompt([], 'Як безпечно схуднути?', { lang: 'uk', verbosity: 'balanced' });
  assert.ok(ukPrompt.includes('Відповідай збалансовано'));
});

test('parseAskProductReply and formatDietitianReply handle JSON and text gracefully', () => {
  const jsonReply = JSON.stringify({
    items: [
      { name: 'Oatmeal', grams: 60, kcal: 220, protein: 8, fat: 4, carbs: 38 }
    ],
    summary: 'A wholesome breakfast choice.'
  });
  const parsed = ai.parseAskProductReply(jsonReply);
  assert.ok(parsed);
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].name, 'Oatmeal');
  assert.equal(parsed.products[0].grams, 60);

  const formatted = ai.formatDietitianReply(JSON.stringify({
    summary: 'Eat more protein.',
    items: [{ name: 'Eggs', grams: 100, kcal: 140, notes: 'boiled' }]
  }), { lang: 'en' });
  assert.ok(formatted.includes('Eggs'));
  assert.ok(formatted.includes('Eat more protein.'));
});

test('dailyRecommendationPrompt outputs localized prompt', () => {
  const p = { age: 30, sex: 'female', height: 165, calculationWeight: 65, targetWeight: 60, activity: 'moderate' };
  const c = { tdee: 1900, kcal: 1520, pace: 0.38 };
  const rec = { protein: 95 };
  const uk = ai.dailyRecommendationPrompt(p, c, rec, false, 'uk');
  assert.ok(uk.includes('1520 ккал/день'));
  assert.ok(uk.includes('1900 ккал/день'));

  const en = ai.dailyRecommendationPrompt(p, c, rec, false, 'en');
  assert.ok(en.includes('1520 kcal/day'));
  assert.ok(en.includes('1900 kcal/day'));
});
