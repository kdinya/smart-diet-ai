const { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate } = require('./smoke.helpers');

async function waitForTransformTransition(locator) {
  await expect.poll(() => locator.evaluate((element) => {
    const transition = element.getAnimations().find((animation) => animation.transitionProperty === 'transform');
    return !transition || transition.playState === 'finished';
  })).toBe(true);
}

async function clearSleepFoodReminderCooldown(page) {
  await page.evaluate(() => {
    localStorage.removeItem('smartdiet-sleep-food-reminder');
    localStorage.removeItem('smartdiet-sleep-food-morning');
    if (typeof sleepFoodReminderAt !== 'undefined') sleepFoodReminderAt = 0;
    if (typeof sleepFoodMorningAt !== 'undefined') sleepFoodMorningAt = 0;
  });
}


test.describe('Smoke: goals', () => {
  test('saves daily goals, keeps them after reload, and rejects invalid numbers', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });

    await openView(page, 'settings');
    await page.fill('#pref-kcal', '1800');
    await page.fill('#pref-protein', '120');
    await page.fill('#pref-fat', '60');
    await page.fill('#pref-carbs', '195');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Goals saved.');

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'settings');
    await expect(page.locator('#pref-kcal')).toHaveValue('1800');
    await expect(page.locator('#pref-protein')).toHaveValue('120');
    await expect(page.locator('#pref-carbs')).toHaveValue('195');
    await expect(page.locator('#pref-fat')).toHaveValue('60');

    await openView(page, 'home');
    await expect(page.locator('#home-kcal-left')).toHaveText('1800');

    await openView(page, 'settings');
    await page.fill('#pref-kcal', '-500');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Values must be numbers from 0 to 10000.');

    await page.fill('#pref-kcal', '0');
    await page.click('#save-prefs');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Values must be numbers from 0 to 10000.');

    const stored = await readStore(page);
    expect(stored.prefs.kcal).toBe(1800);
    expect(stored.prefs.protein).toBe(120);
  });
});

test('profile weight uses its entered date for the exact weekly rate and survives unrelated edits', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, name: 'Weight tester', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [{ id: 'w-after-profile', value: 95.5, date: '2026-11-01' }],
  });
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#view-stats')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => progressInfo().lastWeekRate)).toBeCloseTo(-1.3125, 8);
  await expect(page.locator('#weight-history')).toContainText('10/25/2026');
  await page.evaluate(() => openWeightHistory());
  const profileHistoryRow = page.locator('#weight-history-modal-list .food-row').filter({ hasText: '97.0 kg' });
  await expect(profileHistoryRow).toContainText('From your profile');
  await expect(profileHistoryRow).toContainText('10/25/2026');
  await page.locator('#weight-history-done').click();

  await page.evaluate(() => showView('settings'));
  await expect(page.locator('#view-settings')).toHaveClass(/active/);
  await expect(page.locator('#profile-weight-date')).toHaveValue('2026-10-25');
  await page.fill('#pref-name', 'Weight tester updated');
  await page.locator('#save-profile').click();
  await expect.poll(async () => (await readStore(page)).prefs.currentWeightDate).toBe('2026-10-25');
  await page.reload();
  await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
  expect((await readStore(page)).prefs.currentWeightDate).toBe('2026-10-25');
});

test('progress shows recent weekly and average daily change, while keeping the forecast trend internal', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [
      { id: 'w-oct-26', value: 96.5, date: '2026-10-26' },
      { id: 'w-oct-30', value: 96, date: '2026-10-30' },
      { id: 'w-oct-31', value: 95.6, date: '2026-10-31' },
      { id: 'w-nov-02', value: 95.5, date: '2026-11-02' },
    ],
  });
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#view-stats')).toHaveClass(/active/);
  await expect(page.locator('#progress-stats .metric')).toHaveCount(6);
  await expect(page.locator('#progress-stats .metric').nth(0)).toContainText('згладжене середнє за останні 7 днів');
  await expect(page.locator('#progress-stats .metric').nth(1).locator('strong')).toHaveText('-0.188');
  await expect(page.locator('#progress-stats .metric').nth(1)).toContainText('Середня втрата ваги за день');
  await expect(page.locator('#progress-stats .metric').nth(3).locator('strong')).toHaveText('-1.31');
  await expect(page.locator('#progress-stats .metric').nth(3)).toContainText('Середнє за тиждень');
  await expect(page.locator('#progress-stats')).not.toContainText('Довгостроковий тренд для прогнозу');
  await expect.poll(() => page.evaluate(() => progressInfo().rate)).toBeCloseTo(-1.2630434783, 6);
  await expect(page.locator('#progress-stats .metric').nth(4).locator('strong')).not.toHaveText('—');
});

test('weight progress shows a plus sign when weight increases', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [{ id: 'w-gain', value: 98, date: '2026-11-02' }],
  });
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#progress-stats .metric').nth(1).locator('strong')).toHaveText('+0.125');
  await expect(page.locator('#progress-stats .metric').filter({ hasText: 'Загальна втрата від ваги в профілі' }).locator('strong')).toHaveText('+1.0');
});

test('weekly rate averages the change since the profile weight from screenshot weigh-ins', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [
      { id: 'w-oct-26', value: 96.5, date: '2026-10-26' },
      { id: 'w-oct-30', value: 96, date: '2026-10-30' },
      { id: 'w-oct-31', value: 95.6, date: '2026-10-31' },
      { id: 'w-nov-02', value: 95.5, date: '2026-11-02' },
    ],
  });
  await page.evaluate(() => showView('stats'));
  await expect.poll(() => page.evaluate(() => progressInfo().lastWeekRate)).toBeCloseTo(-1.3125, 8);
  await expect.poll(() => page.evaluate(() => progressInfo().rate)).toBeCloseTo(-1.2630434783, 6);
  await expect(page.locator('#progress-stats .metric').nth(1).locator('strong')).toHaveText('-0.188');
  await expect(page.locator('#progress-stats .metric').nth(3).locator('strong')).toHaveText('-1.31');
  await expect.poll(() => page.evaluate(() => progressInfo().averageDailyLoss)).toBeCloseTo(0.1875, 8);
  await expect(page.locator('#progress-stats')).toContainText('Загальна втрата від ваги в профілі');
  await expect(page.locator('#progress-stats .metric').filter({ hasText: 'Загальна втрата від ваги в профілі' }).locator('strong')).toHaveText('-1.5');
  await expect.poll(() => page.evaluate(() => progressInfo().totalLost)).toBeCloseTo(1.5, 8);
});

test('weekly rate under one week uses the days elapsed since the profile weight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-27T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [{ id: 'w-oct-27', value: 96, date: '2026-10-27' }],
  });
  await page.evaluate(() => showView('stats'));
  await expect.poll(() => page.evaluate(() => progressInfo().lastWeekRate)).toBeCloseTo(-3.5, 8);
  await expect(page.locator('#progress-stats .metric').nth(3).locator('strong')).toHaveText('-3.50');
});

test('weekly rate shows zero instead of an empty value when nothing was weighed in after the profile weight', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 80 },
    foods: [],
    weights: [],
  });
  await page.evaluate(() => showView('stats'));
  await expect.poll(() => page.evaluate(() => progressInfo().lastWeekRate)).toBeCloseTo(0, 8);
  await expect(page.locator('#progress-stats .metric').nth(3).locator('strong')).toHaveText('0.00');
});

test('total weight change metric shows elapsed days since profile weight date in third row', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', tone: 'fun', currentWeight: 90, currentWeightDate: '2026-10-31', targetWeight: 80 },
    foods: [],
    weights: [{ id: 'w-1', value: 89, date: '2026-11-02' }],
  });
  await page.evaluate(() => showView('stats'));
  const totalMetric = page.locator('#progress-stats .metric').filter({ has: page.locator('button[data-metric-info="totalLost"]') });
  await expect(totalMetric.locator('strong')).toHaveText('-1.0');
  await expect(totalMetric.locator('.metric-sub')).toHaveText('за 2 дні від початку');

  await page.evaluate(() => {
    state.prefs.currentWeightDate = '2026-11-01';
    state.prefs.tone = 'standard';
    renderProgress();
  });
  const totalMetricStd = page.locator('#progress-stats .metric').filter({ hasText: 'Загальна втрата від ваги в профілі' });
  await expect(totalMetricStd.locator('.metric-sub')).toHaveText('за 1 день від початку');

  await page.evaluate(() => {
    state.prefs.currentWeightDate = '2026-11-02';
    renderProgress();
  });
  await expect(totalMetricStd.locator('.metric-sub')).toHaveText('за 0 днів від початку');

  await page.evaluate(() => {
    state.prefs.lang = 'en';
    state.prefs.currentWeightDate = '2026-10-28';
    renderProgress();
  });
  const totalMetricEn = page.locator('#progress-stats .metric').filter({ hasText: 'Total weight loss since profile weight' });
  await expect(totalMetricEn.locator('.metric-sub')).toHaveText('in 5 days from start');

  await page.evaluate(() => {
    state.prefs.currentWeightDate = '2026-11-01';
    renderProgress();
  });
  await expect(totalMetricEn.locator('.metric-sub')).toHaveText('in 1 day from start');

  await page.evaluate(() => {
    state.prefs.lang = 'uk';
    state.prefs.currentWeightDate = '2026-10-25';
    state.weights = [{ id: 'w-1', value: 88, date: '2026-10-28' }];
    renderProgress();
  });
  await expect(totalMetric.locator('.metric-sub')).toHaveText('за 8 днів від початку');

  await page.evaluate(() => {
    state.weights = [];
    renderProgress();
  });
  await expect(page.locator('#progress-stats .metric-sub')).toHaveCount(0);
});

test('profile weight date can be backfilled from the calendar and a new weight defaults to today', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, name: 'Weight tester', currentWeight: 97 }, foods: [], weights: [] });
  await openView(page, 'settings');
  await page.locator('#profile-weight-date').click();
  await expect(page.locator('#cal-title')).toHaveText('November 2026');
  await page.locator('#cal-prev').click();
  await page.locator('[data-cal-date="2026-10-25"]').click();
  await page.locator('#cal-done').click();
  await page.locator('#save-profile').click();
  await expect.poll(async () => (await readStore(page)).prefs.currentWeightDate).toBe('2026-10-25');

  await page.fill('#profile-weight', '95.5');
  await page.locator('#profile-weight').dispatchEvent('change');
  await expect(page.locator('#profile-weight-date')).toHaveValue('2026-11-02');
  await page.locator('#save-profile').click();
  await expect.poll(async () => (await readStore(page)).prefs.currentWeight).toBe(95.5);
  expect((await readStore(page)).prefs.currentWeightDate).toBe('2026-11-02');
});

test('new profiles assign the profile weight date automatically without a date input', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, setupComplete: false, setupDismissed: false, currentWeight: null, currentWeightDate: null }, foods: [], weights: [] });
  await page.locator('#onboarding-choice-guest').click();
  await expect(page.locator('#onboard-weight-date-field')).toBeHidden();
  await page.evaluate(() => {
    const nameEl = document.querySelector('#onboard-name');
    if (nameEl) { nameEl.value = 'Guest User'; nameEl.dispatchEvent(new Event('input', { bubbles: true })); }
    const el = document.querySelector('#onboard-weight'); el.value = '70'; el.dispatchEvent(new Event('input', { bubbles: true }));
    const birth = document.querySelector('#onboard-birth'); birth.value = '1990-01-01'; birth.dispatchEvent(new Event('change', { bubbles: true }));
    const height = document.querySelector('#onboard-height'); height.value = '170'; height.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#onboarding-save').click();
  await expect.poll(async () => (await readStore(page)).prefs.currentWeightDate).toBe('2026-11-02');
  await page.evaluate(() => showView('settings'));
  await expect(page.locator('#view-settings')).toHaveClass(/active/);
  await expect(page.locator('#profile-weight-date-field')).toBeHidden();
});

test('legacy profiles without a saved weight date keep the manual backfill field', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, name: 'Legacy profile', currentWeight: 97, currentWeightDate: null }, foods: [], weights: [] });
  await openView(page, 'settings');
  await expect(page.locator('#profile-weight-date-field')).toBeVisible();
  await page.locator('#profile-weight-date').click();
  await expect(page.locator('#cal-title')).toBeVisible();
});

test('weight and kg stay on one line in mobile weight history', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openApp(page, {
    prefs: { ...BASE_PREFS, currentWeight: 97, currentWeightDate: '2026-10-25' },
    foods: [],
    weights: [{ id: 'w-mobile', value: 95.5, date: '2026-11-02' }],
  });
  const value = page.locator('#weight-history .weight-value').first();
  await expect(value).toContainText('kg');
  await expect.poll(() => value.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
  const dimensions = await value.evaluate(el => ({
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight) || (parseFloat(getComputedStyle(el).fontSize || '14') * 1.2),
  }));
  expect(dimensions.height).toBeLessThanOrEqual(dimensions.lineHeight + 1);
});

test('home weight card uses the newest date across profile and diary records', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, currentWeight: 95.5, currentWeightDate: '2026-11-02' },
    foods: [],
    weights: [{ id: 'w-older', value: 97, date: '2026-11-01' }],
  });
  await expect(page.locator('#home-weight')).toHaveText('95.5');
  await expect(page.locator('#weight-date')).toContainText('11/2/2026');
  await expect(page.locator('#weight-history .food-row').first()).toContainText('95.5');
});

test('profile weight change makes every earlier weigh-in inactive without deleting records', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, name: 'Weight baseline tester', lang: 'en', currentWeight: 97, currentWeightDate: '2026-10-25', targetWeight: 70 },
    foods: [],
    weights: [
      { id: 'w-old-high', value: 101, date: '2026-10-10' },
      { id: 'w-old-lower', value: 94, date: '2026-10-20' },
      { id: 'w-pre-baseline-high', value: 98, date: '2026-10-30' },
      { id: 'w-current', value: 95.5, date: '2026-11-03' },
    ],
  });
  await openView(page, 'settings');
  await page.fill('#profile-weight', '95.5');
  await page.locator('#profile-weight').dispatchEvent('change');
  await expect(page.locator('#profile-weight-date')).toHaveValue('2026-11-03');
  await page.locator('#save-profile').click();
  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('saved');
  await openView(page, 'stats');
  const result = await page.evaluate(() => ({
    all: allWeightObservations().map(x => [x.d, x.v]),
    active: weightObservations().map(x => [x.d, x.v]),
    inactive: weightHistoryRows().filter(x => x.inactive).map(x => [x.date, x.value]),
    savedWeightCount: state.weights.length,
  }));
  expect(result.all).toHaveLength(4);
  expect(result.active).toEqual([['2026-11-03', 95.5]]);
  expect(result.inactive).toEqual([['2026-10-30', 98], ['2026-10-20', 94], ['2026-10-10', 101]]);
  expect(result.savedWeightCount).toBe(4);
  await expect(page.locator('#weight-chart .weight-point-inactive')).toHaveCount(3);
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00'));
  await page.evaluate(() => { state.weights.push({ id: 'w-new-after-baseline', value: 96, date: '2026-11-04' }); save(); render(); });
  expect(await page.evaluate(() => weightObservations().map(x => [x.d, x.v]))).toEqual([['2026-11-03', 95.5], ['2026-11-04', 96]]);
});

test('future profile weight dates cannot appear as recorded observations', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, name: 'Future date tester', currentWeight: 95.5, currentWeightDate: '2026-11-03' },
    foods: [],
    weights: [{ id: 'w-today', value: 97, date: '2026-11-02' }, { id: 'w-future', value: 94, date: '2026-11-04' }],
  });
  expect(await page.evaluate(() => weightObservations())).toEqual([{ d: '2026-11-02', v: 97, source: 'weigh-in' }]);
  expect(await page.evaluate(() => weightHistoryRows().map(({ date, value }) => ({ date, value })))).toEqual([{ date: '2026-11-02', value: 97 }, { date: '', value: 95.5 }]);
  await expect(page.locator('#home-weight')).toHaveText('97.0');
  await openView(page, 'settings');
  await page.locator('#profile-weight-date').click();
  await expect(page.locator('[data-cal-date="2026-11-03"]')).toBeDisabled();
  await expect(page.locator('[data-cal-date="2026-11-02"]')).toBeEnabled();
  await page.locator('#cal-cancel').click();
  await page.locator('#save-profile').click();
  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('cannot be in the future');
});

test('diary weigh-in takes precedence over a profile weight on the same date', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, currentWeight: 97, currentWeightDate: '2026-11-01' },
    foods: [],
    weights: [{ id: 'w-same-day', value: 95.5, date: '2026-11-01' }],
  });
  expect(await page.evaluate(() => weightObservations())).toEqual([{ d: '2026-11-01', v: 95.5, source: 'weigh-in' }]);
  expect(await page.evaluate(() => progressInfo().rate)).toBeNull();
});

test('weight rate and forecast start on day seven, use all weigh-ins, and refresh daily', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-31T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, targetWeight: 70 },
    foods: [],
    weights: [
      { id: 'w-day-1', value: 80, date: '2026-10-25' },
      { id: 'w-day-3', value: 79.6, date: '2026-10-28' },
      { id: 'w-day-6', value: 79.2, date: '2026-10-31' },
      { id: 'w-day-7', value: 79.1, date: '2026-11-01' },
    ],
  });
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#view-stats')).toHaveClass(/active/);
  const recentRate = page.locator('#progress-stats .metric').nth(3).locator('strong');
  await expect.poll(() => page.evaluate(() => progressInfo().rate)).toBeNull();
  await expect(page.locator('#progress-stats .metric').nth(4).locator('strong')).toHaveText('—');
  await expect(recentRate).toHaveText('—');
  await expect(page.locator('#progress-notes')).toContainText('at least 7 days');

  await page.clock.setFixedTime(new Date('2026-11-01T12:01:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => page.evaluate(() => progressInfo().rate)).not.toBeNull();
  await expect(page.locator('#progress-notes')).not.toContainText('at least 7 days');
  const forecast = page.locator('#progress-stats .metric').nth(4).locator('strong');
  await expect(forecast).not.toHaveText('—');
  const firstForecast = await forecast.textContent();

  await page.clock.setFixedTime(new Date('2026-11-02T12:02:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(forecast).not.toHaveText(firstForecast);

  await page.evaluate(() => {
    state.weights.push({ id: 'w-older-than-28-days', value: 100, date: '2026-09-01' });
    save();
  });
  const allHistoryRate = await page.evaluate(() => progressInfo().rate);
  const recentWeekRate = await page.evaluate(() => progressInfo().lastWeekRate);
  const expectedAllHistoryRate = await page.evaluate(() => {
    const points = weightObservations().map((item) => ({ n: dayNum(item.d), v: item.v }));
    return slopePerDay(points) * 7;
  });
  const recentWindowRate = await page.evaluate(() => {
    const today = dayNum(iso());
    const points = weightObservations().filter((item) => dayNum(item.d) > today - 28).map((item) => ({ n: dayNum(item.d), v: item.v }));
    return slopePerDay(points) * 7;
  });
  expect(allHistoryRate).toBeCloseTo(expectedAllHistoryRate, 8);
  expect(recentWeekRate).toBeNull();
  expect(allHistoryRate).not.toBeCloseTo(recentWindowRate, 2);
  expect((await readStore(page)).weights).toHaveLength(5);
});

test('latest weight card keeps only the adjacent shortcut to weight trend', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [{ id: 'w-1', value: 74.5, date: '2026-10-30' }] });
  await expect(page.locator('.weight-card')).toBeVisible();
  await expect(page.locator('.weight-trend-btn')).toHaveCount(0);
  await expect(page.locator('.weight-chart-action')).toBeVisible();

  await page.locator('.weight-chart-action').click();
  await expect(page.locator('#view-stats')).toHaveClass(/active/);
  await expect(page.locator('#card-weight-trend')).toBeVisible();
});

test('full weight history opens in a scrollable dialog and retains delete controls', async ({ page }) => {
  const weights = Array.from({ length: 5 }, (_, i) => ({ id: `w-${i}`, value: 74 + i / 10, date: `2026-10-${String(30 - i).padStart(2, '0')}` }));
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights });
  await openView(page, 'stats');
  await expect(page.locator('#weight-history .food-row')).toHaveCount(3);
  await page.locator('#weight-history-more-wrap [data-action="open-weight-history"]').click();
  await expect(page.locator('#weight-history-modal')).toHaveClass(/open/);
  await expect(page.locator('#weight-history-modal-list .food-row')).toHaveCount(5);
  await expect(page.locator('#weight-history-modal-list [data-delete-weight]')).toHaveCount(5);
  await page.locator('#weight-history-done').click();
  await expect(page.locator('#weight-history-modal')).not.toHaveClass(/open/);
});

test.describe('Smoke: calorie deficit fills goals and keeps pace', () => {
  const profileWithTarget = {
    ...BASE_PREFS,
    name: 'Pace tester',
    birthDate: '1995-05-10',
    sex: 'female',
    height: 165,
    currentWeight: 70,
    currentWeightDate: new Date().toLocaleDateString('en-CA'),
    targetWeight: 60,
    activity: 'low',
    pace: 20,
  };

  test('choosing a deficit fills goals, and the pace survives moving to another block', async ({ page }) => {
    await openApp(page, { prefs: profileWithTarget, foods: [], weights: [] });
    await openView(page, 'settings');
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-btn').click();
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-opt').nth(3).click();
    await expect(page.locator('#pref-kcal')).not.toHaveValue('2000');
    const kcalAfterPick = await page.locator('#pref-kcal').inputValue();
    await page.locator('#pref-lang').locator('xpath=..').locator('.dd-btn').click();
    await expect.poll(async () => (await readStore(page)).prefs.pace).toBe(25);
    await expect(page.locator('#profile-pace')).toHaveValue('25');
    const stored = await readStore(page);
    expect(stored.prefs.kcal).toBe(Number(kcalAfterPick));
    expect(stored.prefs.pace).toBe(25);
  });

  test('maintenance keeps the desired weight through reload and uses it when weight loss is selected again', async ({ page }) => {
    await openApp(page, { prefs: profileWithTarget, foods: [], weights: [] });
    await openView(page, 'settings');
    const choosePace = async (index) => {
      await page.locator('#profile-pace').locator('xpath=..').locator('.dd-btn').click();
      await page.locator('#profile-pace').locator('xpath=..').locator('.dd-opt').nth(index).click();
    };

    await choosePace(0);
    await expect.poll(async () => (await readStore(page)).prefs.pace).toBe(0);
    expect((await readStore(page)).prefs.targetWeight).toBe(60);
    const maintenanceKcal = Number(await page.locator('#pref-kcal').inputValue());
    await page.reload();
    await openView(page, 'settings');
    await expect(page.locator('#profile-target-field')).toHaveClass(/hidden/);
    await expect(page.locator('#profile-target')).toHaveValue('60');

    await choosePace(2);
    await expect.poll(async () => (await readStore(page)).prefs.pace).toBe(20);
    const restored = (await readStore(page)).prefs;
    expect(restored.targetWeight).toBe(60);
    expect(restored.kcal).toBeLessThan(maintenanceKcal);
    await expect(page.locator('#profile-target')).toHaveValue('60');
  });

  test('a deficit without a target weight explains what is missing and leaves goals unchanged', async ({ page }) => {
    await openApp(page, { prefs: { ...profileWithTarget, targetWeight: null }, foods: [], weights: [] });
    await openView(page, 'settings');
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-btn').click();
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-opt').nth(3).click();
    await expect(page.locator('#profile-pace-preview')).toContainText('target weight');
    await expect(page.locator('#pref-kcal')).toHaveValue('2000');
  });
});

test('adult recommendations use the newest dated weigh-in, preferring the newest same-day creation time', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T12:00:00') });
  const prefs = { ...BASE_PREFS, lang: 'en', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [
    { id: 'weight-1', date: '2026-11-20', value: 92, createdAt: 100 },
    { id: 'weight-2', date: '2026-11-23', value: 94, createdAt: 200 },
    { id: 'weight-3', date: '2026-11-23', value: 88, createdAt: 300 },
  ] });
  await expect(page.locator('#daily-rec-weight')).toHaveText('Recommendation uses your latest weigh-in: 88.0 kg (entered 23.11).');
  const expected = await page.evaluate(() => formulaRecommendation({ ...state.prefs, currentWeight: 88 }));
  await expect(page.locator('#daily-rec-result')).toContainText(`${expected.kcal} kcal`);
  expect(await page.evaluate(() => currentWeightInfo().value)).toBe(88);
});

test('profile weight is used when no active weigh-in exists', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T12:00:00') });
  const prefs = { ...BASE_PREFS, lang: 'en', age: 35, sex: 'male', height: 180, currentWeight: 95, currentWeightDate: '2026-11-23', targetWeight: 80, activity: 'low', pace: 20 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await expect(page.locator('#daily-rec-weight')).toHaveText('Recommendation uses profile weight: 95.0 kg.');
  const expected = await page.evaluate(() => formulaRecommendation({ ...state.prefs, currentWeight: 95 }));
  await expect(page.locator('#daily-rec-result')).toContainText(`${expected.kcal} kcal`);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('smartdiet-v1'));
    data.weights = [{ id: 'old-baseline', date: '2026-11-20', value: 88 }];
    data.prefs.currentWeightDate = '2026-11-23';
    data.prefs.currentWeight = 95;
    localStorage.setItem('smartdiet-v1', JSON.stringify(data));
  });
  await page.reload();
  await expect(page.locator('#daily-rec-weight')).toHaveText('Recommendation uses profile weight: 95.0 kg.');
});

for (const [weighIn, shouldReach] of [[70.3, true], [70.4, false], [69, true]]) {
  test(`a target of 70 kg ${shouldReach ? 'accepts' : 'does not accept'} a new weigh-in of ${weighIn} kg`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-24T12:00:00') });
    const prefs = { ...BASE_PREFS, age: 35, sex: 'male', height: 180, currentWeight: 70.8, currentWeightDate: '2026-10-01', targetWeight: 70, activity: 'low', pace: 20, kcal: 1500, protein: 100, carbs: 150, fat: 50 };
    await openApp(page, { prefs, foods: [], weights: [{ date: '2026-11-20', value: 70.8, createdAt: 10 }] });
    await page.locator('[data-action="add-weight"]').first().click();
    await page.fill('#weight-value', String(weighIn));
    await page.locator('#weight-save').click();
    if (shouldReach) {
      await expect(page.locator('#weight-goal-title')).toHaveText('Goal reached');
      await page.locator('#weight-goal-cancel').click();
      const saved = await readStore(page);
      expect(saved.prefs.pace).toBe(20);
      expect(saved.prefs.goalReachedFor).toBe('70.0');
    } else {
      await expect(page.locator('#weight-goal-modal')).not.toHaveClass(/open/);
      expect((await readStore(page)).prefs.goalReachedFor).toBeUndefined();
    }
  });
}

test('a pediatric profile does not receive the adult goal-transition dialog', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T12:00:00') });
  const prefs = { ...BASE_PREFS, age: 15, sex: 'male', height: 170, currentWeight: 70.8, currentWeightDate: '2026-10-01', targetWeight: 70, activity: 'low', pace: 20, pediatricTargetKcal: 2100 };
  await openApp(page, { prefs, foods: [], weights: [{ date: '2026-11-20', value: 70.8, createdAt: 10 }] });
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '69');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).not.toHaveClass(/open/);
  expect((await readStore(page)).prefs.pace).toBe(20);
});

test('a new lower weigh-in automatically refreshes formula-owned goals but leaves manual goals intact', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T12:00:00') });
  const prefs = { ...BASE_PREFS, age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  const initial = await page.evaluate(() => {
    const recommendation = formulaRecommendation({ ...state.prefs, currentWeight: 100 });
    state.prefs = { ...state.prefs, ...recommendation, recommendation };
    save();
    return recommendation.kcal;
  });
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  const automatic = await readStore(page);
  const expected = await page.evaluate(() => formulaRecommendation({ ...state.prefs, currentWeight: 90 }));
  expect(automatic.prefs.kcal).not.toBe(initial);
  expect(automatic.prefs.kcal).toBe(expected.kcal);
  expect(automatic.prefs.recommendation.kcal).toBe(expected.kcal);
  await openView(page, 'settings');
  await expect(page.locator('#daily-rec-result')).toContainText(`${expected.kcal} kcal`);
  await expect(page.locator('#daily-rec-weight')).toContainText('90.0 kg (entered 24.11)');

  await page.fill('#pref-protein', '130');
  await page.fill('#pref-fat', '60');
  await page.fill('#pref-carbs', '135');
  await page.locator('#save-prefs').click();
  const manuallySaved = await readStore(page);
  await openView(page, 'home');
  await page.clock.fastForward(86_400_000);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '89');
  await page.locator('#weight-save').click();
  const afterManual = await readStore(page);
  expect(afterManual.prefs.kcal).toBe(manuallySaved.prefs.kcal);
  expect(afterManual.prefs.protein).toBe(manuallySaved.prefs.protein);
  expect(afterManual.prefs.kcal).toBe(1600);
});

test('deleting the newest active weigh-in restores the prior formula-based recommendation', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T12:00:00') });
  const prefs = { ...BASE_PREFS, age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20 };
  await openApp(page, { prefs, foods: [], weights: [
    { id: '88888888-8888-4888-8888-888888888888', date: '2026-11-22', value: 85, createdAt: 1 },
    { id: '99999999-9999-4999-8999-999999999999', date: '2026-11-23', value: 90, createdAt: 2 },
  ] });
  const latestRecommendation = await page.evaluate(() => {
    const recommendation = formulaRecommendation({ ...state.prefs, currentWeight: 90 });
    state.prefs = { ...state.prefs, ...recommendation, recommendation, goalPlans: [
      { from: '2026-11-20', kcal: 1800, protein: 120, carbs: 180, fat: 60 },
    ] };
    save();
    return recommendation.kcal;
  });
  await openView(page, 'stats');
  await autoConfirm(page, true);
  await page.locator('#weight-history [data-delete-weight="2026-11-23"]').click();
  const restored = await readStore(page);
  const previousRecommendation = await page.evaluate(() => formulaRecommendation({ ...state.prefs, currentWeight: 85 }));
  expect(restored.prefs.kcal).not.toBe(latestRecommendation);
  expect(restored.prefs.kcal).toBe(previousRecommendation.kcal);
  expect(await page.evaluate(() => currentWeightInfo().value)).toBe(85);
  expect(restored.prefs.goalPlans.find(plan => plan.from === '2026-11-20')).toEqual({ from: '2026-11-20', kcal: 1800, protein: 120, carbs: 180, fat: 60 });
});

test('reaching a target offers a one-time, optional transition to maintenance', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.clock.install({ time: new Date('2026-11-24T12:00:00') });
  const prefs = { ...BASE_PREFS, lang: 'en', age: 35, sex: 'male', height: 180, currentWeight: 86, currentWeightDate: '2026-10-01', targetWeight: 85, activity: 'low', pace: 20, kcal: 1500, protein: 100, carbs: 150, fat: 50 };
  await openApp(page, { prefs, foods: [], weights: [{ date: '2026-11-20', value: 86, createdAt: 10 }] });
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '85.2');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-title')).toHaveText('Goal reached');
  await expect(page.locator('#weight-goal-message')).toContainText('at or below your 85.0 kg target');
  await expect(page.locator('#weight-goal-message')).toContainText('0.8 kg below your earliest saved weigh-in');
  await expect(page.locator('#weight-goal-apply')).toHaveText('Switch to maintenance');
  const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, modal: document.querySelector('#weight-goal-modal .modal').getBoundingClientRect().width }));
  expect(layout.width).toBeLessThanOrEqual(360);
  expect(layout.modal).toBeLessThanOrEqual(360);
  await page.locator('#weight-goal-apply').click();
  const saved = await readStore(page);
  expect(saved.prefs.pace).toBe(0);
  expect(saved.prefs.maintenanceGoalsCustom).toBe(false);
  expect(saved.prefs.targetWeight).toBe(85);
  expect(saved.prefs.goalReachedFor).toBe('85.0');

  await page.clock.fastForward(86_400_000);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '84.8');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).not.toHaveClass(/open/);
  const afterAcceptedMaintenance = await readStore(page);
  const trackedRecommendation = await page.evaluate(() => formulaRecommendation({ ...state.prefs, currentWeight: 84.8 }));
  expect(afterAcceptedMaintenance.prefs.kcal).toBe(trackedRecommendation.kcal);
  expect(afterAcceptedMaintenance.prefs.maintenanceGoalsCustom).toBe(false);
  await page.clock.fastForward(86_400_000);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '85.1');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).not.toHaveClass(/open/);
});

test('rising maintenance trend offers a modest, confirmed calorie adjustment', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T12:00:00') });
  const prefs = { ...BASE_PREFS, lang: 'en', age: 35, sex: 'male', height: 180, currentWeight: 80, currentWeightDate: '2026-10-25', targetWeight: 80, activity: 'low', pace: 0, kcal: 2200, protein: 120, carbs: 250, fat: 75 };
  await openApp(page, { prefs, foods: [], weights: [
    { date: '2026-10-31', value: 80.1, createdAt: 1 },
    { date: '2026-11-07', value: 80.3, createdAt: 2 },
    { date: '2026-11-14', value: 80.6, createdAt: 3 },
    { date: '2026-11-21', value: 80.8, createdAt: 4 },
  ] });
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '81.0');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-title')).toHaveText('Review your maintenance target');
  await expect(page.locator('#weight-goal-message')).toContainText('upward trend');
  const suggested = Number(await page.locator('#weight-goal-kcal').inputValue());
  const before = await readStore(page);
  expect(suggested).toBeLessThan(before.prefs.kcal);
  expect((await readStore(page)).prefs.kcal).toBe(before.prefs.kcal);
  await page.fill('#weight-goal-kcal', '1000');
  await expect(page.locator('#weight-goal-min-hint')).toBeVisible();
  await expect(page.locator('#weight-goal-apply')).toBeDisabled();
  const customCalories = Math.max(1501, suggested - 50);
  await page.fill('#weight-goal-kcal', String(customCalories));
  await expect(page.locator('#weight-goal-apply')).toBeEnabled();
  await page.locator('#weight-goal-apply').click();
  const adjusted = await readStore(page);
  expect(adjusted.prefs.kcal).toBe(customCalories);
  expect(adjusted.prefs.pace).toBe(0);
  expect(adjusted.prefs.maintenanceGoalsCustom).toBe(true);
  expect(adjusted.prefs.maintenanceTrendReviewDate).toBe('2026-11-24');
});

test('a lower weigh-in offers the recalculated target and can be declined without changing the profile', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).toHaveClass(/open/);
  await expect(page.locator('#weight-goal-message')).toContainText('1781 kcal/day');
  await page.locator('#weight-goal-cancel').click();
  await page.evaluate(() => showView('stats'));
  const note = page.locator('#progress-notes .progress-target-note');
  await expect(note).toContainText('90.0 kg');
  await expect(note).toContainText('1781 kcal');
  await expect(note).toContainText('protein');
  await expect(note).toContainText('fat');
  await expect(note).toContainText('carbs');
  const saved = await readStore(page);
  expect(saved.prefs.kcal).toBe(2236);
  expect(saved.prefs.currentWeight).toBe(100);
  expect(saved.prefs.currentWeightDate).toBe('2026-10-01');
  expect(saved.weights.map(item => item.value)).toContain(90);
});

test('weigh-in goal dialog edits calories and shows calculated macros only after confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).toHaveClass(/open/);
  await expect(page.locator('#weight-goal-message')).toContainText('1781 kcal/day');
  await expect(page.locator('#weight-goal-protein')).toHaveText('162');
  await expect(page.locator('#weight-goal-fat')).toHaveText('53');
  await expect(page.locator('#weight-goal-carbs')).toHaveText('164');
  await expect(page.locator('input#weight-goal-protein, input#weight-goal-fat, input#weight-goal-carbs')).toHaveCount(0);
  const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, macros: document.querySelector('.weight-goal-macros').getBoundingClientRect().width, modal: document.querySelector('#weight-goal-modal .modal').getBoundingClientRect().width }));
  expect(layout.width).toBeLessThanOrEqual(360);
  expect(layout.macros).toBeLessThanOrEqual(layout.modal - 28);
  const before = await readStore(page);
  expect(before.prefs.kcal).toBe(2236);
  expect(before.prefs.protein).toBe(160);
  await page.locator('#weight-goal-apply').click();
  const after = await readStore(page);
  expect(after.prefs.kcal).toBe(1781);
  expect(after.prefs.protein).toBe(162);
  expect(after.prefs.fat).toBe(53);
  expect(after.prefs.carbs).toBe(164);
  expect(after.prefs.currentWeight).toBe(100);
  await page.evaluate(() => showView('settings'));
  await expect(page.locator('#pref-kcal')).toHaveValue('1781');
  await expect(page.locator('#pref-protein')).toHaveValue('162');
  await expect(page.locator('#pref-fat')).toHaveValue('53');
  await expect(page.locator('#pref-carbs')).toHaveValue('164');
  await expect(page.locator('#profile-pace')).toHaveValue('custom_90.0');
  const customOpt = page.locator('#profile-pace option[value="custom_90.0"]');
  await expect(customOpt).toHaveCount(1);
  expect(await customOpt.textContent()).toContain('90.0');

  // Change pace to 10%
  await page.locator('#profile-pace').locator('xpath=..').locator('.dd-btn').click();
  await page.locator('#profile-pace').locator('xpath=..').locator('.dd-opt[data-value="10"]').click();
  await expect(page.locator('#profile-pace')).toHaveValue('10');
  // Custom option remains in dropdown
  await expect(page.locator('#profile-pace option[value="custom_90.0"]')).toHaveCount(1);

  // Return to custom pace
  await page.locator('#profile-pace').locator('xpath=..').locator('.dd-btn').click();
  await page.locator('#profile-pace').locator('xpath=..').locator('.dd-opt[data-value="custom_90.0"]').click();
  await expect(page.locator('#profile-pace')).toHaveValue('custom_90.0');
  await expect(page.locator('#pref-kcal')).toHaveValue('1781');
  await expect(page.locator('#pref-protein')).toHaveValue('162');
  await expect(page.locator('#pref-fat')).toHaveValue('53');
  await expect(page.locator('#pref-carbs')).toHaveValue('164');
});

test('the weight goal dialog recalculates macros from a custom calorie target and keeps weight history', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).toHaveClass(/open/);
  await page.fill('#weight-goal-kcal', '1900');
  await expect(page.locator('#weight-goal-protein')).toHaveText('162');
  await expect(page.locator('#weight-goal-fat')).toHaveText('57');
  await expect(page.locator('#weight-goal-carbs')).toHaveText('185');
  await page.locator('#weight-goal-apply').click();
  const saved = await readStore(page);
  expect(saved.prefs.kcal).toBe(1900);
  expect(saved.prefs.protein).toBe(162);
  expect(saved.prefs.carbs).toBe(185);
  expect(saved.prefs.fat).toBe(57);
  expect(saved.prefs.currentWeight).toBe(100);
  expect(saved.prefs.currentWeightDate).toBe('2026-10-01');
  expect(saved.weights.map(item => item.value)).toContain(90);
});

test('the weight goal dialog is localized in Ukrainian and can be dismissed without changing goals', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, lang: 'uk', botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-title')).toHaveText('Перевір денні цілі');
  await expect(page.locator('#weight-goal-message')).toContainText('щонайменше на 10 ккал');
  await expect(page.locator('#weight-goal-cancel')).toHaveText('Залишити поточні');
  await page.locator('#weight-goal-cancel').click();
  const saved = await readStore(page);
  expect(saved.prefs.kcal).toBe(2236);
  expect(saved.weights.map(item => item.value)).toContain(90);
});

test('a recommendation less than 10 kcal below the saved goal does not open the goal dialog', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 1790, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).not.toHaveClass(/open/);
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#progress-notes .progress-target-note')).toContainText('1781 kcal');
  expect((await readStore(page)).prefs.kcal).toBe(1790);
});

test('a recommendation exactly 10 kcal below the saved goal opens the goal dialog', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 1791, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).toHaveClass(/open/);
  await expect(page.locator('#weight-goal-message')).toContainText('at least 10 kcal below');
  await page.locator('#weight-goal-cancel').click();
  expect((await readStore(page)).prefs.kcal).toBe(1791);
});

test('a lower weigh-in shows same-pace calories and macros in progress without changing saved goals', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-12T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 45, sex: 'male', height: 185, currentWeight: 97, currentWeightDate: '2026-10-28', targetWeight: 85, activity: 'low', pace: 25, kcal: 1721, protein: 172, carbs: 141, fat: 52 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '93');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).toHaveClass(/open/);
  await page.locator('#weight-goal-cancel').click();
  await page.evaluate(() => showView('stats'));
  const note = page.locator('#progress-notes .progress-target-note');
  await expect(note).toContainText('93.0 kg');
  await expect(note).toContainText('1680 kcal');
  await expect(note).toContainText('protein 167 g');
  await expect(note).toContainText('fat 50 g');
  await expect(note).toContainText('carbs 141 g');
  await expect(note).toContainText('saved goals are unchanged');
  const saved = await readStore(page);
  expect(saved.prefs.kcal).toBe(1721);
  expect(saved.prefs.protein).toBe(172);
  expect(saved.prefs.carbs).toBe(141);
  expect(saved.prefs.fat).toBe(52);
  expect(saved.prefs.currentWeight).toBe(97);
  expect(saved.weights.map(item => item.value)).toContain(93);
});

test('a lower weigh-in shows recalculated macros in Ukrainian under progress without changing saved goals', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-12T12:00:00') });
  const prefs = { ...BASE_PREFS, lang: 'uk', botMode: 'mascot', age: 45, sex: 'male', height: 185, currentWeight: 97, currentWeightDate: '2026-10-28', targetWeight: 85, activity: 'low', pace: 25, kcal: 1721, protein: 172, carbs: 141, fat: 52 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '93');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).toHaveClass(/open/);
  await page.locator('#weight-goal-cancel').click();
  await page.evaluate(() => showView('stats'));
  const note = page.locator('#progress-notes .progress-target-note');
  await expect(note).toContainText('93.0 кг');
  await expect(note).toContainText('1680 ккал');
  await expect(note).toContainText('білки 167 г');
  await expect(note).toContainText('жири 50 г');
  await expect(note).toContainText('вуглеводи 141 г');
  await expect(note).toContainText('збережені цілі не змінено');
  const saved = await readStore(page);
  expect(saved.prefs.kcal).toBe(1721);
  expect(saved.prefs.protein).toBe(172);
  expect(saved.prefs.carbs).toBe(141);
  expect(saved.prefs.fat).toBe(52);
  expect(saved.prefs.currentWeight).toBe(97);
});

test('progress recommendation recalculates after each lower weigh-in and survives reload without applying', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '90');
  await page.locator('#weight-save').click();
  await page.locator('#weight-goal-cancel').click();
  await page.reload();
  await page.clock.fastForward(2200);
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#progress-notes .progress-target-note')).toContainText('90.0 kg');
  await expect(page.locator('#bot-comic')).not.toContainText('latest recorded weight');
  const first = (await readStore(page)).prefs;
  expect(first.kcal).toBe(2236);
  expect(first.currentWeight).toBe(100);

  await page.clock.fastForward(2 * 86400 * 1000);
  await page.evaluate(() => showView('home'));
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '88');
  await page.locator('#weight-save').click();
  await page.locator('#weight-goal-cancel').click();
  await expect(page.locator('#progress-notes .progress-target-note')).toContainText('88.0 kg');
  expect((await readStore(page)).prefs.kcal).toBe(2236);

  await page.reload();
  await page.clock.fastForward(2200);
  await page.evaluate(() => { state.prefs = { ...state.prefs, kcal: 1925 }; save(); });
  await page.evaluate(() => showView('home'));
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '99.9');
  await page.locator('#weight-save').click();
  await page.evaluate(() => showView('stats'));
  await expect(page.locator('#progress-notes .progress-target-note')).toContainText('99.9 kg');
  await expect(page.locator('#progress-notes .progress-target-note')).toContainText('1876 kcal');
  await expect(page.locator('#bot-comic')).not.toContainText('latest recorded weight');
  const afterReload = await readStore(page);
  expect(afterReload.prefs.kcal).toBe(1925);
  expect(afterReload.prefs.currentWeight).toBe(100);
  expect(afterReload.weights.map(item => item.value)).toContain(99.9);
});

test('logging weight closer to the goal celebrates progress', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, currentWeight: 90, currentWeightDate: '2026-10-01', targetWeight: 80 },
    foods: [],
    weights: [],
  });
  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '89');
  await page.locator('#weight-save').click();
  await expect(page.locator('#confetti-canvas')).toHaveCount(1);
  await expect(page.locator('#bot-peeker')).toHaveAttribute('data-spine-mood', 'celebration');
  expect(await page.evaluate(() => state.weights.map((item) => item.value))).toContain(89);
});

test.describe('Smoke: weight badge and achievements', () => {
  test('the current weight shows under the date and opens the achievements window', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [{ date: '2026-01-01', value: 80 }, { date: '2026-01-20', value: 78.5 }] });
    await expect(page.locator('#weight-badge-value')).toHaveText('78.5');
    await expect(page.locator('#weight-badge-diff')).toHaveText('(-1.5)');
    await expect(page.locator('#weight-badge .weight-badge-unit')).toHaveText('kg');
    await expect(page.locator('#weight-badge .weight-badge-label')).toHaveText('My weight');

    const geometry = await page.evaluate(() => {
      const date = document.querySelector('#today-label').getBoundingClientRect();
      const badge = document.querySelector('#weight-badge').getBoundingClientRect();
      const badgeStyle = getComputedStyle(document.querySelector('#weight-badge'));
      return {
        dateWidth: date.width,
        badgeWidth: badge.width,
        dateRight: date.right,
        badgeRight: badge.right,
        badgeTop: badge.top,
        dateBottom: date.bottom,
        badgeBorderRadius: badgeStyle.borderRadius,
        badgeBorderStyle: badgeStyle.borderTopStyle,
      };
    });
    expect(Math.abs(geometry.dateWidth - geometry.badgeWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.dateRight - geometry.badgeRight)).toBeLessThanOrEqual(1);
    expect(geometry.badgeTop).toBeGreaterThanOrEqual(geometry.dateBottom);
    expect(geometry.badgeBorderStyle).toBe('solid');
    expect(geometry.badgeBorderRadius).toBe('14px');

    // When weight label is wider, both cards expand to equal width
    await page.evaluate(() => {
      document.querySelector('.weight-badge-label').textContent = 'Very long custom weight label';
    });
    const widerGeometry = await page.evaluate(() => {
      const date = document.querySelector('#today-label').getBoundingClientRect();
      const badge = document.querySelector('#weight-badge').getBoundingClientRect();
      return { dateWidth: date.width, badgeWidth: badge.width, dateRight: date.right, badgeRight: badge.right };
    });
    expect(Math.abs(widerGeometry.dateWidth - widerGeometry.badgeWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(widerGeometry.dateRight - widerGeometry.badgeRight)).toBeLessThanOrEqual(1);
    expect(widerGeometry.dateWidth).toBeGreaterThan(geometry.dateWidth);

    await page.locator('#weight-badge').click();
    await expect(page.locator('#achievements-modal')).toHaveClass(/open/);
    await expect(page.locator('#achievements-list .achievement-item.is-unlocked')).toHaveCount(2);
    await expect(page.locator('#achievements-list .achievement-item.is-unlocked').nth(1)).toContainText('First kilogram');
    await page.locator('#achievements-close').click();
    await expect(page.locator('#achievements-modal')).not.toHaveClass(/open/);
  });

  test('the weight badge shows cumulative weight loss or gain in the first line', async ({ page }) => {
    // When weight is gained
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [{ date: '2026-01-01', value: 70 }, { date: '2026-01-20', value: 71.5 }] });
    await expect(page.locator('#weight-badge-value')).toHaveText('71.5');
    await expect(page.locator('#weight-badge-diff')).toHaveText('(+1.5)');
    await expect(page.locator('#weight-badge .weight-badge-unit')).toHaveText('kg');

    // When single weight observation exists
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [{ date: '2026-01-01', value: 75 }] });
    await expect(page.locator('#weight-badge-value')).toHaveText('75');
    await expect(page.locator('#weight-badge-diff')).toHaveText('(-0)');
  });

});

test.describe('Smoke: floating current weight', () => {
  test('the weight badge floats after the date scrolls away and returns at the page top', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [{ date: '2026-11-05', value: 72.4 }] });
    const badge = page.locator('#weight-badge');
    await expect(badge).not.toHaveClass(/is-floating/);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(badge).toHaveClass(/is-floating/);
    await expect.poll(() => badge.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
    const floating = await badge.evaluate(el => ({ position: getComputedStyle(el).position, z: Number(getComputedStyle(el).zIndex), top: el.getBoundingClientRect().top }));
    expect(floating.position).toBe('fixed');
    expect(floating.z).toBeGreaterThan(50);
    expect(floating.top).toBeLessThan(50);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(badge).not.toHaveClass(/is-floating/);
    const restored = await badge.evaluate(el => getComputedStyle(el).position);
    expect(restored).not.toBe('fixed');
  });
});

test.describe('Smoke: previous weight on home', () => {
  test('the home weight shows the previous weight in brackets', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en', currentWeight: 80, currentWeightDate: '2026-01-01' }, foods: [], weights: [{ date: '2026-01-20', value: 78.5 }] });
    await expect(page.locator('#home-weight')).toHaveText('78.5');
    await expect(page.locator('#home-weight-prev')).toHaveText('(was 80.0 kg)');
  });
});

test('weight chart keeps labels and markers proportional on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'en' },
    foods: [],
    weights: [
      { id: 'w-a', value: 81.2, date: '2026-10-05' },
      { id: 'w-b', value: 79.8, date: '2026-10-20' },
      { id: 'w-c', value: 78.4, date: '2026-11-03' },
    ],
  });
  await page.evaluate(() => document.querySelector('#intro')?.remove());
  await openView(page, 'stats');
  const chart = page.locator('#weight-chart');
  await expect(chart.locator('[data-weight-point]')).toHaveCount(3);
  await expect(chart).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  const measurements = await chart.evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    const point = svg.querySelector('.weight-point-active circle:not(.weight-point-hitarea)').getBoundingClientRect();
    return { ratio: svg.viewBox.baseVal.width / svg.viewBox.baseVal.height, renderedRatio: rect.width / rect.height, pointDifference: Math.abs(point.width - point.height), width: rect.width };
  });
  expect(Math.abs(measurements.ratio - measurements.renderedRatio)).toBeLessThan(0.03);
  expect(measurements.pointDifference).toBeLessThan(1);
  expect(measurements.width).toBeLessThan(400);
});

test('weight chart range controls filter dates and points reveal accessible details', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'en' },
    foods: [],
    weights: [
      { id: 'w-old', value: 81, date: '2026-08-01' },
      { id: 'w-recent-old', value: 79.5, date: '2026-10-20' },
      { id: 'w-current', value: 78, date: '2026-11-03' },
    ],
  });
  await page.evaluate(() => document.querySelector('#intro')?.remove());
  await openView(page, 'stats');
  await expect(page.locator('#weight-chart [data-weight-point]')).toHaveCount(2);
  await expect(page.locator('#weight-chart-summary')).toContainText('-1.5 kg');
  await page.locator('[data-weight-range="all"]').click();
  await expect(page.locator('[data-weight-range="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#weight-chart [data-weight-point]')).toHaveCount(3);
  const oldest = page.locator('#weight-chart [data-weight-point]').first();
  await expect(oldest).toHaveAttribute('aria-label', /Aug 1, 2026: 81/);
  await oldest.click();
  await expect(page.locator('#weight-chart-tooltip')).toBeVisible();
  await expect(page.locator('#weight-chart-tooltip')).toContainText('81.0 kg');
  await page.locator('[data-weight-range="1m"]').click();
  await page.mouse.move(0, 0);
  await expect(page.locator('#weight-chart-tooltip')).toBeHidden();
  await expect(page.locator('#weight-chart [data-weight-point]')).toHaveCount(2);
});

test.describe('Smoke: weight-loss questions', () => {
  test('the questions button opens a dialog where opening one answer closes the previous one', async ({ page }) => {
    await page.clock.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, products: [], foods: [], weights: [] });
    await page.evaluate(() => document.querySelector('#intro')?.remove());
    await expect(page.locator('#bot-peeker')).toBeVisible();
    await expect(page.locator('#bot-peeker')).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
    await page.evaluate(() => toggleBotPoppedFab(true));
    await expect(page.locator('#bot-faq-action-fab')).toBeVisible();
    const onCircle = await page.evaluate(() => {
      const m = document.getElementById('bot-peeker').getBoundingClientRect();
      const cx = m.left + m.width / 2, cy = m.top + m.height / 2;
      const dist = (id) => { const el = document.getElementById(id); return Math.hypot(parseFloat(el.style.left) + el.offsetWidth / 2 - cx, parseFloat(el.style.top) + el.offsetHeight / 2 - cy); };
      return { faq: dist('bot-faq-action-fab'), average: (dist('bot-chat-action-fab') + dist('bot-settings-fab')) / 2 };
    });
    expect(Math.abs(onCircle.faq - onCircle.average)).toBeLessThan(2);
    await page.locator('#bot-faq-action-fab').dispatchEvent('click');
    await expect(page.locator('#faq-modal')).toHaveClass(/open/);
    await expect(page.locator('#faq-list .faq-category')).toHaveCount(7);
    await expect(page.locator('#faq-list .faq-category-title').first()).toContainText('What to do to lose weight');
    await expect(page.locator('#faq-list .faq-category[data-category="app"] .faq-category-title')).toContainText('Using the Smart Diet AI app');
    await expect(page.locator('#faq-list .faq-item')).toHaveCount(87);
    await expect(page.locator('#faq-list .faq-answer').nth(0)).toHaveAttribute('aria-hidden', 'true');
    await page.locator('#faq-list .faq-question').nth(0).click();
    await expect(page.locator('#faq-list .faq-answer').nth(0)).toBeVisible();
    await expect(page.locator('#faq-list .faq-answer').nth(0)).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#faq-list .faq-question').nth(1).click();
    await expect(page.locator('#faq-list .faq-answer').nth(0)).toBeHidden();
    await expect(page.locator('#faq-list .faq-answer').nth(0)).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#faq-list .faq-answer').nth(1)).toBeVisible();
    await expect(page.locator('#faq-list .faq-answer').nth(1)).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#faq-list .faq-item').nth(60).scrollIntoViewIfNeeded();
    await expect(page.locator('#faq-close')).toBeInViewport();
    await page.locator('#faq-close').click();
    await expect(page.locator('#faq-modal')).not.toHaveClass(/open/);
  });
});

test('Settings goal inputs automatically recalculate the remaining fields upon manual edits', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
  await openView(page, 'settings');
  await page.setViewportSize({ width: 360, height: 780 });

  // 1. Changing calories recalculates protein, fat, and carbs
  await page.fill('#pref-kcal', '1600');
  const p1 = Number(await page.locator('#pref-protein').inputValue());
  const f1 = Number(await page.locator('#pref-fat').inputValue());
  const c1 = Number(await page.locator('#pref-carbs').inputValue());
  expect(p1).toBeGreaterThan(0);
  expect(f1).toBeGreaterThan(0);
  expect(c1).toBeGreaterThan(0);
  const sum1 = p1 * 4 + c1 * 4 + f1 * 9;
  expect(Math.abs(sum1 - 1600)).toBeLessThanOrEqual(5);

  // 2. Changing protein adjusts carbs to maintain calories
  await page.fill('#pref-protein', String(p1 + 20));
  const c2 = Number(await page.locator('#pref-carbs').inputValue());
  expect(c2).toBeLessThan(c1);
  const sum2 = (p1 + 20) * 4 + c2 * 4 + f1 * 9;
  expect(Math.abs(sum2 - 1600)).toBeLessThanOrEqual(5);

  // 3. Changing carbs updates calories
  await page.fill('#pref-carbs', '180');
  const k3 = Number(await page.locator('#pref-kcal').inputValue());
  const expectedKcal = (p1 + 20) * 4 + 180 * 4 + f1 * 9;
  expect(k3).toBe(expectedKcal);

  // 4. Save and verify reload persistence
  await page.click('#save-prefs');
  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Goals saved.');
  await page.reload();
  await openView(page, 'settings');
  await expect(page.locator('#pref-kcal')).toHaveValue(String(expectedKcal));
  await expect(page.locator('#pref-protein')).toHaveValue(String(p1 + 20));
  await expect(page.locator('#pref-carbs')).toHaveValue('180');
});

test('accepted weigh-in recommendation persists custom pace in Settings and updates on language toggle', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);

  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '92');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).toHaveClass(/open/);
  await page.locator('#weight-goal-apply').click();

  await openView(page, 'settings');
  const customPaceOpt = page.locator('#profile-pace option[value="custom_92.0"]');
  await expect(customPaceOpt).toHaveCount(1);
  expect(await customPaceOpt.textContent()).toContain('Custom (92.0 kg)');
  await expect(page.locator('#profile-pace')).toHaveValue('custom_92.0');

  // Switch to Ukrainian and verify custom pace label translated
  await page.selectOption('#pref-lang', 'uk');
  await page.locator('#save-lang').click();
  expect(await customPaceOpt.textContent()).toContain('Користувацький (92.0 кг)');

  // Responsive check
  const bounds = await page.locator('#profile-pace').locator('xpath=..').boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(360);
});

test('weigh-in goal review blocks saving below the profile minimum and explains why at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  const prefs = { ...BASE_PREFS, botMode: 'mascot', age: 35, sex: 'male', height: 180, currentWeight: 100, currentWeightDate: '2026-10-01', targetWeight: 80, activity: 'low', pace: 20, kcal: 2236, protein: 160, carbs: 200, fat: 70 };
  await openApp(page, { prefs, foods: [], weights: [] });
  await page.clock.fastForward(2200);

  await page.locator('[data-action="add-weight"]').first().click();
  await page.fill('#weight-value', '92');
  await page.locator('#weight-save').click();
  await expect(page.locator('#weight-goal-modal')).toHaveClass(/open/);

  await page.fill('#weight-goal-kcal', '1200');
  await expect(page.locator('#weight-goal-apply')).toBeDisabled();
  await expect(page.locator('#weight-goal-min-hint')).toContainText('1500');
  await expect(page.locator('#weight-goal-min-hint')).toBeVisible();

  await page.fill('#weight-goal-kcal', '1600');
  await expect(page.locator('#weight-goal-apply')).toBeEnabled();
  await expect(page.locator('#weight-goal-min-hint')).toBeHidden();
  const box = await page.locator('#weight-goal-modal .modal').boundingBox();
  expect(box.width).toBeLessThanOrEqual(360);

  await page.locator('#weight-goal-apply').click();
  await expect(page.locator('#weight-goal-modal')).not.toHaveClass(/open/);
  expect((await readStore(page)).prefs.kcal).toBe(1600);
});
