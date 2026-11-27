import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Minimal browser/DOM environment for ecobot module evaluation in Node.js
const dummyEl = {
  addEventListener: () => {},
  removeEventListener: () => {},
  setAttribute: () => {},
  getAttribute: () => null,
  classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false },
  style: { setProperty: () => {} },
  dataset: {},
  querySelector: () => null,
  querySelectorAll: () => [],
  replaceChildren: () => {},
  animate: () => ({ finished: Promise.resolve() }),
  getAnimations: () => [],
  getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
  appendChild: () => {}
};

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  performance: { now: () => Date.now() },
  devicePixelRatio: 1,
  innerWidth: 1024,
  innerHeight: 768
};

globalThis.document = {
  ...dummyEl,
  body: dummyEl,
  head: dummyEl,
  getElementById: () => dummyEl,
  querySelector: () => dummyEl,
  querySelectorAll: () => [dummyEl],
  fonts: { ready: Promise.resolve() },
  createElement: () => dummyEl
};

globalThis.$ = () => dummyEl;
globalThis.$$ = () => [dummyEl];
globalThis.t = k => k;
globalThis.esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
globalThis.lang = () => 'en';
globalThis.I = {
  uk: {
    botWelcomeNameIntro: 'Привіт, {name}!',
    botWelcomeAffectionFemalePolite: ['чудово виглядаєш'],
    botWelcomePolite: ['Привіт!']
  },
  en: {
    botWelcomeNameIntro: 'Hey {name}!',
    botWelcomeAffectionNeutralPolite: ['looking great'],
    botWelcomePolite: ['Hello!']
  }
};
globalThis.state = { prefs: { botMode: 'mascot', lang: 'en', name: 'Alex', sex: 'other' } };
globalThis.save = () => {};
globalThis.applyBotPreferences = () => {};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.setInterval = () => {
  const id = { unref: () => {} };
  return id;
};
globalThis.setTimeout = () => {
  const id = { unref: () => {} };
  return id;
};


const require = createRequire(import.meta.url);
const ecobot = require('../../js/ecobot.js');

test('toComicRgba converts hex colors to rgba strings with alpha', () => {
  assert.equal(ecobot.toComicRgba('#28754f', 0.9), 'rgba(40,117,79,0.9)');
  assert.equal(ecobot.toComicRgba('#ffffff', 0.5), 'rgba(255,255,255,0.5)');
  assert.equal(ecobot.toComicRgba('#000000', 1), 'rgba(0,0,0,1)');
});

test('botTimePeriod correctly partitions 24-hour day into periods', () => {
  assert.equal(ecobot.botTimePeriod(new Date(2026, 0, 1, 2)), 'night');
  assert.equal(ecobot.botTimePeriod(new Date(2026, 0, 1, 4)), 'night');
  assert.equal(ecobot.botTimePeriod(new Date(2026, 0, 1, 5)), 'morning');
  assert.equal(ecobot.botTimePeriod(new Date(2026, 0, 1, 8)), 'morning');
  assert.equal(ecobot.botTimePeriod(new Date(2026, 0, 1, 9)), 'day');
  assert.equal(ecobot.botTimePeriod(new Date(2026, 0, 1, 14)), 'day');
  assert.equal(ecobot.botTimePeriod(new Date(2026, 0, 1, 20)), 'day');
  assert.equal(ecobot.botTimePeriod(new Date(2026, 0, 1, 21)), 'evening');
  assert.equal(ecobot.botTimePeriod(new Date(2026, 0, 1, 23)), 'evening');
});

test('botTimeBaseline returns matching baseline posture for each period', () => {
  assert.equal(ecobot.botTimeBaseline('night'), 'sleeping');
  assert.equal(ecobot.botTimeBaseline('day'), 'idle');
  assert.equal(ecobot.botTimeBaseline('morning'), 'sleepy');
  assert.equal(ecobot.botTimeBaseline('evening'), 'sleepy');
});

test('botWearsSleepwear returns sleepwear state matching day cycle', () => {
  assert.equal(ecobot.botWearsSleepwear('night'), true);
  assert.equal(ecobot.botWearsSleepwear('morning'), true);
  assert.equal(ecobot.botWearsSleepwear('evening'), true);
  assert.equal(ecobot.botWearsSleepwear('day'), false);
});

test('botComicCloudPath generates valid SVG path for comic speech bubble', () => {
  const path = ecobot.botComicCloudPath(320, 160, 18, 0.5, false);
  assert.ok(path.startsWith('M'));
  assert.ok(path.endsWith('Z'));
  assert.ok(path.includes('A'));
});

test('renderFaqItem renders structured FAQ button markup', () => {
  const html = ecobot.renderFaqItem('What is calorie deficit?', 'It is burning more than eating.', 0);
  assert.ok(html.includes('data-faq-index="0"'));
  assert.ok(html.includes('What is calorie deficit?'));
  assert.ok(html.includes('It is burning more than eating.'));
});
