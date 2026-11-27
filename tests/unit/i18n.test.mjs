import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const i18nPath = path.join(repoRoot, 'js/i18n.js');

test('i18n dictionary structure and parity', () => {
  const code = fs.readFileSync(i18nPath, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const I = sandbox.I || sandbox.window.I;
  assert.ok(I, 'I dictionary must be defined');
  assert.ok(I.en, 'I.en must be defined');
  assert.ok(I.uk, 'I.uk must be defined');

  const enKeys = Object.keys(I.en).sort();
  const ukKeys = Object.keys(I.uk).sort();

  assert.equal(
    enKeys.length,
    ukKeys.length,
    `Key count mismatch: en has ${enKeys.length}, uk has ${ukKeys.length}`
  );

  const missingInUk = enKeys.filter(k => !(k in I.uk));
  const missingInEn = ukKeys.filter(k => !(k in I.en));

  assert.deepEqual(missingInUk, [], `Keys missing in uk: ${missingInUk.join(', ')}`);
  assert.deepEqual(missingInEn, [], `Keys missing in en: ${missingInEn.join(', ')}`);

  // Ensure no values are empty strings or null/undefined
  for (const lang of ['en', 'uk']) {
    for (const [key, value] of Object.entries(I[lang])) {
      assert.notEqual(value, null, `${lang}.${key} is null`);
      assert.notEqual(value, undefined, `${lang}.${key} is undefined`);
      if (typeof value === 'string') {
        assert.ok(value.trim().length > 0, `${lang}.${key} is empty string`);
      } else if (Array.isArray(value)) {
        assert.ok(value.length > 0, `${lang}.${key} array is empty`);
      }
    }
  }

  // Ensure FAQ categories match between languages
  assert.equal(
    I.en.faqCategories.length,
    I.uk.faqCategories.length,
    'faqCategories length mismatch'
  );
  const enCatIds = I.en.faqCategories.map(c => c.id);
  const ukCatIds = I.uk.faqCategories.map(c => c.id);
  assert.deepEqual(enCatIds, ukCatIds, 'faqCategories id mismatch between en and uk');

  // Ensure FAQ items count matches
  assert.equal(
    I.en.faqItems.length,
    I.uk.faqItems.length,
    'faqItems length mismatch'
  );

  console.log(`✓ i18n verified successfully: ${enKeys.length} keys in perfect bilingual parity.`);
});
