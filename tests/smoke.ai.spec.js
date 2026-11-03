const { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate } = require('./smoke.helpers');

test.describe('Smoke: meal plan', () => {
  test("tomorrow plan ignores today's fully used calorie budget and saves for tomorrow", async ({ page }) => {
    const products = [
      { id: 'meal-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'meal-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'meal-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
    ];
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      ...AI_STORE(['gemini']),
      prefs: { ...BASE_PREFS, kcal: 2000 },
      products,
      foods: [{ id: 'today-full', name: 'Already eaten', date: today, meal: 'lunch', grams: 500, kcal: 2000, protein: 80, fat: 60, carbs: 220 }],
    });
    let requestBody;
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          items: [{ id: 'meal-oats', grams: 100, meal: 'breakfast' }],
        }) }] } }] }),
      });
    });
    await page.locator('#meal-plan-open').click();
    await page.locator('#meal-plan-dates [data-meal-plan-date="tomorrow"]').click();
    await page.locator('#meal-plan-products [data-plan-product]').first().check();
    await page.locator('#meal-plan-products [data-plan-product]').nth(1).check();
    await page.locator('#meal-plan-products [data-plan-product]').nth(2).check();
    await page.locator('#meal-plan-run').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Plan saved as a draft');
    expect(requestBody.contents[0].parts[0].text).toContain('tomorrow');
    expect(requestBody.contents[0].parts[0].text).toContain('Already logged for this day: 0 kcal');
    const drafts = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('smartdiet-meal-drafts-v1:'))
      .flatMap(([, value]) => JSON.parse(value)));
    const tomorrow = await page.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA');
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].date).toBe(tomorrow);
  });

  test('tomorrow plan counts a planned meal even when its eye is off', async ({ page }) => {
    const products = [
      { id: 'meal-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'meal-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'meal-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
    ];
    const tomorrow = await page.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA');
    });
    await openApp(page, {
      ...AI_STORE(['gemini']),
      prefs: { ...BASE_PREFS, kcal: 2000 },
      products,
      foods: [{ id: 'tomorrow-planned-lunch', name: 'Planned lunch', date: tomorrow, meal: 'lunch', grams: 500, kcal: 900, protein: 40, fat: 20, carbs: 100, createdAt: 2 }],
    });
    let requestBody;
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          items: [{ id: 'meal-oats', grams: 100, meal: 'breakfast' }],
        }) }] } }] }),
      });
    });
    await page.locator('#meal-plan-open').click();
    await page.locator('#meal-plan-dates [data-meal-plan-date="tomorrow"]').click();
    await page.locator('#meal-plan-products [data-plan-product]').first().check();
    await page.locator('#meal-plan-products [data-plan-product]').nth(1).check();
    await page.locator('#meal-plan-products [data-plan-product]').nth(2).check();
    await page.locator('#meal-plan-run').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Plan saved as a draft');
    const promptText = requestBody.contents[0].parts[0].text;
    expect(promptText).toContain('Already logged for this day: 900 kcal');
    expect(promptText).toContain('Plan ONLY these meals: Breakfast, Dinner');
    const drafts = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('smartdiet-meal-drafts-v1:'))
      .flatMap(([, value]) => JSON.parse(value)));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].date).toBe(tomorrow);
  });

  test('draft lock keeps a draft after its day, and the bin deletes it even when locked', async ({ page }) => {
    const dayOffset = (days) => page.evaluate((n) => {
      const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA');
    }, days);
    const today = await dayOffset(0);
    const yesterday = await dayOffset(-1);
    const draft = (id, date, locked) => ({
      id, date, items: [{ name: id, meal: 'lunch', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25 }],
      ...(locked === undefined ? {} : { locked }),
    });
    const draftKey = 'smartdiet-meal-drafts-v1:local';
    await page.goto('/');
    await page.evaluate((data) => localStorage.setItem('smartdiet-v1', JSON.stringify(data)), { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [draftKey, [
      draft('old-open', yesterday), draft('old-locked', yesterday, true), draft('today-open', today),
    ]]);
    await page.reload();
    const storedIds = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).map((d) => d.id), draftKey);
    expect(await storedIds()).toEqual(['old-locked', 'today-open']);
    await expect(page.locator('#meal-drafts-open')).toBeVisible();
    await page.locator('#meal-drafts-open').click();
    await expect(page.locator('#meal-drafts-modal')).toHaveClass(/open/);
    await expect(page.locator('[data-plan-lock="old-locked"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-plan-lock="today-open"]').click();
    await expect(page.locator('[data-plan-lock="today-open"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-plan-delete="old-locked"]').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.locator('#confirm-ok').click();
    await expect(page.locator('[data-plan-delete="old-locked"]')).toHaveCount(0);
    expect(await storedIds()).toEqual(['today-open']);
    await page.reload();
    expect(await storedIds()).toEqual(['today-open']);
  });

  test('meal-plan validation toast stays above the open modal', async ({ page }) => {
    const products = [
      { id: 'meal-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'meal-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'meal-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
    ];
    await openApp(page, { ...AI_STORE(['gemini']), products });
    await page.locator('#meal-plan-open').click();
    await page.locator('#meal-plan-run').click();
    const toast = page.locator('#notif-stack .toast-msg').last();
    await expect(toast).toBeVisible();
    const layers = await page.evaluate(() => ({
      toast: Number(getComputedStyle(document.querySelector('#notif-stack')).zIndex),
      modal: Number(getComputedStyle(document.querySelector('#meal-plan-modal')).zIndex),
    }));
    expect(layers.toast).toBeGreaterThan(layers.modal);
    await expect(page.locator('#meal-plan-modal')).toHaveClass(/open/);
  });

  test('keeps actions visible and saves an AI-generated plan', async ({ page }) => {
    const products = [
      { id: 'meal-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'meal-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'meal-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
      { id: 'meal-apple', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14 },
    ];
    await openApp(page, { ...AI_STORE(['gemini']), products });
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          items: [{ id: 'meal-oats', grams: 150, meal: 'breakfast' }],
        }) }] } }],
      }),
    }));

    await page.locator('#meal-plan-open').click();
    const modal = page.locator('#meal-plan-modal .meal-plan-modal');
    const list = page.locator('#meal-plan-products');
    const run = page.locator('#meal-plan-run');
    await list.evaluate((el) => { el.style.height = '90px'; el.style.flex = '0 0 90px'; });
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(run).toBeInViewport();
    await expect(page.locator('#meal-plan-modal')).toHaveClass(/open/);

    const checks = page.locator('#meal-plan-products [data-plan-product]');
    for (let i = 0; i < 3; i += 1) await checks.nth(i).check();
    await run.click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Plan saved as a draft');
    const drafts = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('smartdiet-meal-drafts-v1:'))
      .flatMap(([, value]) => JSON.parse(value)));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toEqual([{ id: 'meal-oats', name: 'Oats', meal: 'breakfast', grams: 150, kcal: 525, protein: 18, fat: 9, carbs: 90 }]);
    await expect(modal).toBeVisible();
    await expect(page.locator('#meal-plan-title')).toHaveText('Draft created');
    await expect(page.locator('#meal-plan-result-body')).toContainText('Oats');
  });

  test('AI plan builds full meals, retries single-item answers, and shows progress while working', async ({ page }) => {
    const products = [
      { id: 'full-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'full-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'full-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
      { id: 'full-apple', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14 },
    ];
    const answers = [
      { items: [{ id: 'full-oats', grams: 60, meal: 'breakfast' }, { id: 'full-chicken', grams: 120, meal: 'lunch' }] },
      { items: [
        { id: 'full-oats', grams: 60, meal: 'breakfast' }, { id: 'full-apple', grams: 100, meal: 'breakfast' },
        { id: 'full-chicken', grams: 120, meal: 'lunch' }, { id: 'full-rice', grams: 120, meal: 'lunch' },
        { id: 'full-chicken', grams: 100, meal: 'dinner' }, { id: 'full-rice', grams: 100, meal: 'dinner' },
      ] },
    ];
    await openApp(page, { ...AI_STORE(['gemini']), products });
    let calls = 0;
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      const answer = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
      });
    });

    await page.locator('#meal-plan-open').click();
    const checks = page.locator('#meal-plan-products [data-plan-product]');
    for (let i = 0; i < 4; i += 1) await checks.nth(i).check();
    await page.locator('#meal-plan-run').click();
    await expect(page.locator('#meal-plan-building')).toBeVisible();
    await expect(page.locator('#meal-plan-result')).toBeVisible();
    await expect(page.locator('#meal-plan-result-body h4')).toHaveCount(3);
    expect(calls).toBe(2);
    await expect(page.locator('#meal-plan-result-body')).toContainText('Apple');
    await expect(page.locator('#meal-plan-result-body')).toContainText('Rice');
    const drafts = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('smartdiet-meal-drafts-v1:'))
      .flatMap(([, value]) => JSON.parse(value)));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items.map((x) => x.meal)).toEqual(['breakfast', 'breakfast', 'lunch', 'lunch', 'dinner', 'dinner']);
  });
  test('tomorrow plan is scaled to every daily limit, not only calories', async ({ page }) => {
    const products = [
      { id: 'fit-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'fit-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'fit-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
      { id: 'fit-apple', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14 },
    ];
    const answer = { items: [
      { id: 'fit-chicken', grams: 500, meal: 'breakfast' }, { id: 'fit-oats', grams: 100, meal: 'breakfast' },
      { id: 'fit-rice', grams: 300, meal: 'lunch' }, { id: 'fit-apple', grams: 200, meal: 'lunch' },
      { id: 'fit-chicken', grams: 300, meal: 'dinner' }, { id: 'fit-rice', grams: 200, meal: 'dinner' },
    ] };
    await openApp(page, { ...AI_STORE(['gemini']), products });
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
    }));

    await page.locator('#meal-plan-open').click();
    await page.locator('[data-meal-plan-date="tomorrow"]').click();
    const checks = page.locator('#meal-plan-products [data-plan-product]');
    for (let i = 0; i < 4; i += 1) await checks.nth(i).check();
    await page.locator('#meal-plan-run').click();
    await expect(page.locator('#meal-plan-result')).toBeVisible();
    const drafts = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('smartdiet-meal-drafts-v1:'))
      .flatMap(([, value]) => JSON.parse(value)));
    expect(drafts).toHaveLength(1);
    const sum = (k) => drafts[0].items.reduce((s, it) => s + it[k], 0);
    expect(sum('protein')).toBeLessThanOrEqual(100);
    expect(sum('kcal')).toBeLessThanOrEqual(2000);
    expect(sum('carbs')).toBeLessThanOrEqual(242);
    expect(sum('fat')).toBeLessThanOrEqual(70);
    expect(new Set(drafts[0].items.map((x) => x.meal))).toEqual(new Set(['breakfast', 'lunch', 'dinner']));
    expect(drafts[0].items.every((x) => x.grams >= 5)).toBe(true);
  });
  test('today plan skips meals already logged and plans only the missing ones', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const products = [
      { id: 'today-chicken', name: 'Chicken', grams: 100, kcal: 165, protein: 31, fat: 4, carbs: 0 },
      { id: 'today-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60 },
      { id: 'today-rice', name: 'Rice', grams: 100, kcal: 130, protein: 3, fat: 0, carbs: 28 },
      { id: 'today-apple', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14 },
    ];
    const answer = { items: [
      { id: 'today-chicken', grams: 200, meal: 'lunch' }, { id: 'today-rice', grams: 150, meal: 'lunch' },
      { id: 'today-oats', grams: 80, meal: 'dinner' }, { id: 'today-apple', grams: 150, meal: 'dinner' },
    ] };
    await openApp(page, { ...AI_STORE(['gemini']), products, foods: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Eggs', meal: 'breakfast', grams: 100, kcal: 300, protein: 20, fat: 20, carbs: 2, date: today, createdAt: Date.now() }], weights: [] });
    let prompt = '';
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      prompt = route.request().postData() || '';
      await route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
      });
    });
    await page.locator('#meal-plan-open').click();
    const checks = page.locator('#meal-plan-products [data-plan-product]');
    for (let i = 0; i < 4; i += 1) await checks.nth(i).check();
    await page.locator('#meal-plan-run').click();
    await expect(page.locator('#meal-plan-result')).toBeVisible();
    expect(prompt).toContain('Lunch, Dinner');
    const drafts = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('smartdiet-meal-drafts-v1:'))
      .flatMap(([, value]) => JSON.parse(value)));
    expect(drafts).toHaveLength(1);
    expect(new Set(drafts[0].items.map((x) => x.meal))).toEqual(new Set(['lunch', 'dinner']));
  });
});

test.describe('Smoke: AI provider fallback', () => {
  test('add to diary uses the meal picked after the answer', async ({ page }) => {
    await openApp(page, AI_STORE(['gemini']));
    await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          items: [{ name: 'Chicken', grams: 150, kcal: 248, protein: 46, fat: 5, carbs: 0 }],
          total: { kcal: 248, protein: 46, fat: 5, carbs: 0 },
          note: 'ok',
        }) }] } }],
      }),
    }));
    await openDietitianChat(page);
    await page.locator('#chat-input').fill('chicken');
    await page.locator('#chat-send').click();
    const addButton = page.locator('#chatbox .chat-product-plus');
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(page.locator('#ask-product-action-modal')).toHaveClass(/open/);
    await page.locator('#ask-product-action-diary').click();
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await page.locator('#pick-meals [data-pick-meal="lunch"]').click();
    await page.locator('#pick-dates [data-pick-date="tomorrow"]').click();
    await page.locator('#pick-add').click();
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); });
    await expect.poll(async () => (await readStore(page)).foods.map((f) => [f.meal, f.date])).toEqual([['lunch', tomorrow]]);
  });

  test('Auto never falls back to OpenAI, Anthropic or xAI', async ({ page }) => {
    await openApp(page, AI_STORE(['openai']));
    await expect(page.evaluate(() => callAi('hello', false))).rejects.toThrow(/Gemini/);
  });

  test('a failing provider is skipped and the next one answers', async ({ page }) => {
    await openApp(page, AI_STORE(['openai', 'groq']));
    await page.evaluate(() => { state.ai.models.openai = 'gpt-6-luna'; });
    const calls = [];
    await page.route('https://api.openai.com/**', (route) => {
      calls.push('openai');
      return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { message: 'upstream failure' } }) });
    });
    await page.route('https://api.groq.com/**', (route) => {
      calls.push('groq');
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'answer from groq' } }] }) });
    });
    const out = await page.evaluate(() => callAi('hello', false));
    expect(out).toBe('answer from groq');
    expect(calls).toEqual(['openai', 'groq']);
    expect(await page.evaluate(() => lastAi.name)).toBe('Groq');
  });

  test('providers that all hang give up within the shared time budget', async ({ page }) => {
    await openApp(page, AI_STORE(['gemini', 'openai', 'anthropic', 'groq', 'xai']));
    await page.evaluate(() => { state.ai.models.openai = 'gpt-6-luna'; state.ai.models.anthropic = 'claude-haiku-5-5'; state.ai.models.xai = 'grok-4.3'; });
    const calls = [];
    for (const [name, pattern] of [
      ['gemini', 'https://generativelanguage.googleapis.com/**'],
      ['openai', 'https://api.openai.com/**'],
      ['anthropic', 'https://api.anthropic.com/**'],
      ['groq', 'https://api.groq.com/**'],
      ['xai', 'https://api.x.ai/**'],
    ]) {
      await page.route(pattern, () => { calls.push(name); });
    }
    await page.clock.install();
    const result = page.evaluate(() => callAi('hello', false).then((value) => ({ value }), (error) => ({ error: error.message })));
    let settled = false;
    result.then(() => { settled = true; });
    for (let i = 0; i < 80 && !settled; i += 1) {
      await page.clock.runFor(1000);
      await page.waitForTimeout(25);
    }
    expect(settled).toBe(true);
    const { error } = await result;
    expect(error).toContain('Google Gemini');
    expect(error).toContain('OpenAI');
    expect(error).toContain('Anthropic Claude');
    expect(error).not.toContain('Groq');
    expect(error).not.toContain('xAI Grok');
    expect(calls).toEqual(['gemini', 'openai', 'anthropic']);
  });
});

test.describe('Smoke: meal analysis, dietitian questions, calendar and intro', () => {
  test('calendar keeps the chosen day until Done, and Cancel discards it', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');
    const before = await page.locator('#diary-date').inputValue();
    await page.click('#diary-date');
    const first = await page.locator('.cal-day:not(.today)').first().getAttribute('data-cal-date');
    await page.locator(`[data-cal-date="${first}"]`).click();
    await expect(page.locator('#cal-modal')).toHaveClass(/open/);
    await expect(page.locator('#diary-date')).toHaveValue(before);
    await page.click('#cal-done');
    await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#diary-date')).toHaveValue(first);

    await page.click('#diary-date');
    const second = await page.locator(`.cal-day:not(.today):not([data-cal-date="${first}"])`).first().getAttribute('data-cal-date');
    await page.locator(`[data-cal-date="${second}"]`).click();
    await page.click('#cal-cancel');
    await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#diary-date')).toHaveValue(first);
  });

  test('overview expands only the meal where food was added last, and survives reload', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Oats', meal: 'breakfast', grams: 80, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: 1000 },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Soup', meal: 'lunch', grams: 300, kcal: 200, protein: 8, fat: 6, carbs: 25, date: today, createdAt: 2000 },
      ],
      weights: [],
    });
    const card = (meal) => page.locator(`#home-meals .meal-card[data-meal-key="home|${today}|${meal}"]`);
    await expect(card('lunch')).not.toHaveClass(/collapsed/);
    await expect(card('breakfast')).toHaveClass(/collapsed/);

    await page.evaluate((date) => {
      state.foods = state.foods.filter((f) => !(f.meal === 'lunch' && f.date === date));
      save();
    }, today);
    await expect(card('breakfast')).not.toHaveClass(/collapsed/);
    await expect(card('lunch')).toHaveClass(/collapsed/);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await expect(card('breakfast')).not.toHaveClass(/collapsed/);
    await expect(card('lunch')).toHaveClass(/collapsed/);
  });

  test('meal and whole-day analysis send only today’s entries and show the answer', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    await page.clock.setFixedTime(noon);
    await openApp(page, {
      ...AI_STORE(['groq']),
      foods: [
        { id: '33333333-3333-4333-8333-333333333333', name: 'Rice bowl', meal: 'lunch', grams: 250, kcal: 420, protein: 12, fat: 8, carbs: 70, date: today, createdAt: 3000 },
        { id: '44444444-4444-4444-8444-444444444444', name: 'Old tea', meal: 'lunch', grams: 200, kcal: 5, protein: 0, fat: 0, carbs: 1, date: '2020-01-01', createdAt: 1 },
      ],
    });
    let body = '';
    await page.route('https://api.groq.com/**', (route) => {
      body = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Balanced lunch. Add vegetables.' } }] }) });
    });

    await page.click('#view-home [data-analyze="lunch"]');
    await expect(page.locator('#analysis-modal')).toHaveClass(/open/);
    await expect(page.locator('#bot-peeker')).toHaveAttribute('data-spine-mood', 'success');
    await expect(page.locator('#analysis-body')).toContainText('Balanced lunch. Add vegetables.');
    expect(body).toContain('Rice bowl');
    expect(body).not.toContain('Old tea');
    await page.click('#analysis-close');
    await expect(page.locator('#analysis-modal')).not.toHaveClass(/open/);

    await page.click('#view-home [data-analyze="dinner"]');
    await expect(page.locator('#analysis-body')).toContainText('Nothing is logged here yet');
    await page.click('#analysis-close');

    await page.click('#view-home [data-analyze="day"]');
    await expect(page.locator('#analysis-title')).toContainText('Analysis: Whole day');
    await expect(page.locator('#analysis-body')).toContainText('Balanced lunch. Add vegetables.');
    expect(body).toContain('Rice bowl');
    expect(body).toContain('Current time: 12:00');
    expect(body).toContain('Not logged, but later meals are already recorded: breakfast. These were most likely skipped.');
    expect(body).toContain('Still ahead today: dinner');
    await page.keyboard.press('Escape');
    await expect(page.locator('#analysis-modal')).not.toHaveClass(/open/);
  });

  test('diary analysis buttons sit on each meal and the day, and analyze the selected date', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      ...AI_STORE(['groq']),
      foods: [
        { id: '55555555-5555-4555-8555-555555555555', name: 'Rice bowl', meal: 'lunch', grams: 250, kcal: 420, protein: 12, fat: 8, carbs: 70, date: today, createdAt: 3000 },
        { id: '66666666-6666-4666-8666-666666666666', name: 'Old tea', meal: 'lunch', grams: 200, kcal: 5, protein: 0, fat: 0, carbs: 1, date: '2020-01-01', createdAt: 1 },
      ],
    });
    let body = '';
    await page.route('https://api.groq.com/**', (route) => {
      body = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Light lunch. Add protein.' } }] }) });
    });

    await openView(page, 'diary');
    await page.evaluate(() => { $('#diary-date').value = '2020-01-01'; render(); });
    await expect(page.locator('#diary-meals .meal-card[data-meal-key^="diary|2020-01-01|lunch"] .meal-head [data-analyze]')).toHaveCount(0);
    await page.click('#diary-meals [data-analyze="lunch"]');
    await expect(page.locator('#analysis-body')).toContainText('Light lunch. Add protein.');
    expect(body).toContain('Old tea');
    expect(body).not.toContain('Rice bowl');
    await page.keyboard.press('Escape');
    await expect(page.locator('#analysis-modal')).not.toHaveClass(/open/);

    await page.click('#diary-summary [data-analyze="day"]');
    await expect(page.locator('#analysis-title')).toContainText('Analysis: Whole day');
    expect(body).toContain('Old tea');
    expect(body).not.toContain('Rice bowl');
  });

  test('whole-day analysis treats a skipped breakfast as skipped when lunch and dinner are logged', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const evening = new Date();
    evening.setHours(20, 0, 0, 0);
    await page.clock.setFixedTime(evening);
    await openApp(page, {
      ...AI_STORE(['groq']),
      foods: [
        { id: '77777777-7777-4777-8777-777777777777', name: 'Soup', meal: 'lunch', grams: 300, kcal: 200, protein: 8, fat: 6, carbs: 25, date: today, createdAt: 2000 },
        { id: '88888888-8888-4888-8888-888888888888', name: 'Fish', meal: 'dinner', grams: 200, kcal: 350, protein: 30, fat: 14, carbs: 5, date: today, createdAt: 4000 },
      ],
    });
    let body = '';
    await page.route('https://api.groq.com/**', (route) => {
      body = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Add breakfast tomorrow.' } }] }) });
    });
    await page.click('#view-home [data-analyze="day"]');
    await expect(page.locator('#analysis-body')).toContainText('Add breakfast tomorrow.');
    expect(body).toContain('Not logged, but later meals are already recorded: breakfast.');
    expect(body).not.toContain('Still ahead today');
    expect(body).toContain('do not suggest making up for it with fasting');
  });

  test('Ask the Dietitian sends no diary or profile data and keeps its history', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      ...AI_STORE(['groq']),
      prefs: { ...BASE_PREFS, name: 'Denys', birthDate: '1990-01-01' },
      foods: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Secret pear', meal: 'snack', grams: 100, kcal: 60, protein: 1, fat: 0, carbs: 15, date: today, createdAt: 4000 }],
    });
    let body = '';
    await page.route('https://api.groq.com/**', (route) => {
      body = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Aim for protein at every meal.' } }] }) });
    });

    await page.click('[data-action="open-ask"]');
    await expect(page.locator('#ask-panel')).toHaveClass(/open/);
    await expect(page.locator('#chat-panel')).not.toHaveClass(/open/);
    await page.fill('#ask-input', 'How much protein do I need?');
    await page.click('#ask-send');
    await expect(page.locator('#ask-box')).toContainText('Aim for protein at every meal.');
    expect(body).toContain('How much protein do I need?');
    expect(body).not.toContain('Secret pear');
    expect(body).not.toContain('1990-01-01');
    expect(body).not.toContain('Denys');

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await page.click('[data-action="open-ask"]');
    await expect(page.locator('#ask-box')).toContainText('How much protein do I need?');
    await expect(page.locator('#ask-box')).toContainText('Aim for protein at every meal.');

    await page.click('#ask-clear');
    await page.locator('#confirm-ok').click();
    await expect(page.locator('#ask-box .bubble:not(#ask-welcome)')).toHaveCount(0);
  });

  test('the system launch screen uses the intro colour, so no light flash shows first', async ({ page }) => {
    const manifest = await (await page.request.get('/manifest.json')).json();
    expect(manifest.background_color).toBe('#042415');
    expect(manifest.theme_color).toBe('#0d4b2a');
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0d4b2a');
  });

  test('the launch intro shows the app mark and then leaves the screen', async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#intro .intro-word')).toHaveText('Smart Diet AI');
    await expect(page.locator('#intro')).toHaveCount(0, { timeout: 6000 });
  });
});

test.describe('Smoke: dietitian launcher', () => {
  test('English launcher label is concise too', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await expect(page.locator('.chat-fab-label')).toHaveText('AI Dietitian');
    await openView(page, 'settings');
    await page.locator('#pref-tone').selectOption('playful');
    await page.locator('#save-tone').click();
    await expect(page.locator('.chat-fab-label')).toHaveText('AI Dietitian');
  });

  test('assistant appearance sliders, localized label and overlays behave correctly', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
  await page.clock.install();
  const fab = page.locator('#bot-chat-action-fab');
  const legacyFab = page.locator('#chat-fab');
  const mascot = page.locator('#bot-peeker');
  await expect(mascot.locator('canvas.bot-spine-canvas')).toHaveCount(1);
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await expect(mascot).toHaveAttribute('data-spine-animations', 'idle,blink,wave,thinking,celebrate');
  await expect(mascot).toHaveAttribute('data-spine-motion-layer', 'breathing,gaze,head,face,leaves,arms');
  await expect.poll(() => mascot.locator('canvas.bot-spine-canvas').evaluate(canvas => { const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let visible = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visible++; return visible; })).toBeGreaterThan(0);
  await expect(mascot.locator('.eco-stage, img[src*="eco-bot/"]')).toHaveCount(0);
  await expect(mascot).toHaveCSS('z-index', '250');
  await expect(page.locator('.chat-fab-label')).toHaveText('ШІ - дієтолог');
  await expect(fab.locator('svg')).toHaveCount(1);
  await expect(fab).toHaveAttribute('aria-label', 'Відкрити чат ШІ-дієтолога');
  await openView(page, 'settings');
  await expect(page.locator('#pref-bot-size')).toHaveAttribute('min', '30');
  await expect(page.locator('#pref-bot-size')).toHaveAttribute('max', '100');
  await expect(page.locator('#pref-bot-size')).toHaveValue('60');
  await expect(page.locator('#pref-bot-enabled')).toHaveAttribute('role', 'switch');
  await expect(page.locator('#pref-bot-enabled')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#pref-bot-side')).toHaveValue('right');
  await expect(page.locator('#pref-bot-offset-v')).toHaveAttribute('min', '0');
  await expect(page.locator('#pref-bot-offset-v')).toHaveAttribute('max', '100');
  await expect(page.locator('#pref-bot-offset-v')).toHaveValue('10');
  await expect(page.locator('#bot-appearance-card [data-bot-position]')).toHaveCount(0);
  await expect(page.locator('#pref-bot-offset-v')).toHaveCSS('flex-grow', '1');
  await expect(page.locator('#pref-bot-offset-v')).toHaveCSS('min-width', '0px');
  await expect(page.locator('#pref-bot-size')).toHaveCSS('touch-action', 'pan-y');
  await expect(page.locator('#pref-bot-offset-h')).toHaveAttribute('min', '-1.5');
  await expect(page.locator('#pref-bot-offset-h')).toHaveAttribute('max', '1.5');
  await expect(page.locator('#pref-bot-offset-h')).toHaveAttribute('step', '0.05');
  await expect(page.locator('#pref-bot-offset-h')).toHaveValue('0.4');
  await expect(page.locator('#bot-offset-h-value')).toHaveText('0.4rem');
  await expect(page.locator('#pref-bot-side').locator('xpath=..')).toHaveClass(/dd/);
  await expect(page.locator('#pref-bot-frequency').locator('xpath=..')).toHaveClass(/dd/);
  await page.evaluate(() => {
    const slider = document.querySelector('#pref-bot-size');
    const rect = slider.getBoundingClientRect();
    const x = rect.left + rect.width * 0.35;
    const y = rect.top + rect.height / 2;
    window.trackTapValues = Object.fromEntries(['#pref-bot-size', '#pref-bot-offset-v', '#pref-bot-offset-h'].map((selector, index) => {
      const range = document.querySelector(selector);
      const initial = range.value;
      const box = range.getBoundingClientRect();
      const pointerId = 20 + index;
      range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', clientX: box.left + box.width * 0.4, clientY: box.top + 8 }));
      range.value = range.min;
      range.dispatchEvent(new Event('input', { bubbles: true }));
      const afterTrackInput = range.value;
      range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId, pointerType: 'touch' }));
      return [selector, { initial, afterTrackInput, afterPointerUp: range.value }];
    }));
    slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 6, pointerType: 'touch', clientX: x, clientY: y }));
    window.tapTouchValue = slider.value;
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 6, pointerType: 'touch', clientX: x, clientY: y }));
    slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y }));
    slider.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x + 2, clientY: y + 32 }));
    window.verticalTouchValue = slider.value;
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x + 2, clientY: y + 32 }));
    slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch', clientX: x, clientY: y }));
    slider.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch', clientX: x + rect.width * 0.2, clientY: y + 2 }));
    window.horizontalTouchValue = slider.value;
    window.expectedHorizontalTouchValue = String(30 + Math.round(Math.max(0, Math.min(1, (x + rect.width * 0.2 - rect.left - 9) / Math.max(1, rect.width - 18))) * 70));
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8, pointerType: 'touch', clientX: x + rect.width * 0.2, clientY: y + 2 }));
  });
  expect(await page.evaluate(() => window.tapTouchValue)).toBe('60');
  expect(await page.evaluate(() => window.trackTapValues)).toEqual({
    '#pref-bot-size': { initial: '60', afterTrackInput: '60', afterPointerUp: '60' },
    '#pref-bot-offset-v': { initial: '10', afterTrackInput: '10', afterPointerUp: '10' },
    '#pref-bot-offset-h': { initial: '0.4', afterTrackInput: '0.4', afterPointerUp: '0.4' },
  });
  expect(await page.evaluate(() => window.verticalTouchValue)).toBe('60');
  expect(await page.evaluate(() => window.horizontalTouchValue)).toBe(await page.evaluate(() => window.expectedHorizontalTouchValue));
  const orderedCards = await page.locator('#view-settings .card').evaluateAll(cards => cards.map(card => ({ id: card.id, hasPersonality: Boolean(card.querySelector('#pref-tone')) })));
  const personalityIndex = orderedCards.findIndex(card => card.hasPersonality);
  const appearanceIndex = orderedCards.findIndex(card => card.id === 'bot-appearance-card');
  const friendsIndex = orderedCards.findIndex(card => card.id === 'friends-card');
  expect(appearanceIndex).toBeGreaterThan(personalityIndex);
  expect(appearanceIndex).toBeLessThan(friendsIndex);
  await page.locator('#pref-bot-size').fill('30');
  await page.locator('#pref-bot-side').selectOption('left');
  await page.locator('#pref-bot-offset-v').fill('0');
  const bottomPlacement = await mascot.evaluate(el => ({ top: parseFloat(el.style.top), available: innerHeight - el.offsetHeight - (parseFloat(getComputedStyle(el).getPropertyValue('--bot-safe-bottom')) || 0) }));
  expect(Math.abs(bottomPlacement.top - bottomPlacement.available)).toBeLessThanOrEqual(1);
  await expect(mascot).toHaveCSS('left', '6.4px');
  await page.locator('#pref-bot-offset-h').fill('-1.5');
  await expect(mascot).toHaveCSS('--bot-offset-h', '-1.5rem');
  await expect(mascot).toHaveCSS('left', '-24px');
  await page.locator('#pref-bot-offset-h').fill('1.5');
  await expect(mascot).toHaveCSS('--bot-offset-h', '1.5rem');
  await expect(mascot).toHaveCSS('left', '24px');
  await expect(mascot).toHaveClass(/bot-side-left/);
  await page.locator('#pref-bot-size').fill('100');
  await expect(mascot).toHaveCSS('--bot-offset-h', '1.5rem');
  await page.locator('#pref-bot-offset-v').fill('100');
  await expect(mascot).toHaveCSS('top', '0px');
  await page.locator('#pref-bot-size').fill('30');
  await expect(mascot).toHaveCSS('--bot-offset-h', '1.5rem');
  await page.locator('#pref-bot-frequency').selectOption('15000');
  await page.locator('#save-bot-settings').click();
  await page.locator('#pref-bot-enabled').click();
  await expect(page.locator('#pref-bot-enabled')).toHaveAttribute('aria-checked', 'false');
  await expect(mascot).toBeHidden();
  await expect(legacyFab).toHaveClass(/is-expanded/);
  await expect(page.locator('.chat-fab-label')).toHaveCSS('opacity', '1');
  await expect(page.locator('.chat-fab-label')).toHaveText('ШІ - дієтолог');
  await expect(legacyFab).toHaveCSS('right', '24px');
  await expect(legacyFab).toHaveCSS('width', '210px');
  await expect(legacyFab).toHaveCSS('bottom', /px$/);
  await expect(legacyFab.locator('.chat-fab-label')).toHaveText('ШІ - дієтолог');
  await page.locator('#pref-bot-enabled').click();
  await expect(page.locator('#pref-bot-enabled')).toHaveAttribute('aria-checked', 'true');
  await expect(mascot).toBeVisible();
  expect((await readStore(page)).prefs).toMatchObject({ botSize: '0.3', botSide: 'left', botOffsetV: '100%', botOffsetH: '1.5rem', botFrequency: 15000 });
  await expect(mascot).toHaveCSS('--bot-scale', '0.3');
  await expect(fab).toBeHidden();
  await expect(legacyFab).toBeHidden();
  await page.clock.runFor(6000);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await mascot.click();
  await expect(fab).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/bot-actions-open/);
  await expect(legacyFab).toBeHidden();
  await expect(page.locator('#bot-settings-fab')).toBeVisible();
  await expect(page.locator('#bot-settings-fab svg circle')).toHaveCount(1);
  await expect(page.locator('#bot-settings-fab svg path')).toHaveCount(2);
  await expect(fab).toHaveCSS('animation-name', 'bot-action-unfurl');
  await expect(page.locator('#bot-settings-fab')).toHaveCSS('animation-name', 'bot-action-unfurl');
  await expect(fab).toHaveCSS('animation-duration', '0.9s');
  await expect(fab).toHaveCSS('animation-delay', '0s');
  await expect(page.locator('#bot-settings-fab')).toHaveCSS('animation-delay', '0s');
  await expect(fab).toHaveCSS('opacity', '1');
  await expect(page.locator('#bot-settings-fab')).toHaveCSS('opacity', '1');
  const assistantLayers = await page.evaluate(() => {
    const getZ = element => Number.parseInt(getComputedStyle(element).zIndex, 10);
    const actions = ['#bot-chat-action-fab', '#bot-settings-fab'].map(selector => getZ(document.querySelector(selector)));
    const legacyFab = document.querySelector('#chat-fab');
    legacyFab.classList.add('fab-popped');
    const poppedChat = getZ(legacyFab);
    legacyFab.classList.remove('fab-popped');
    const mascot = getZ(document.querySelector('#bot-peeker'));
    const overlays = [
      document.querySelector('.mobilebar'),
      ...document.querySelectorAll('.modal-back'),
    ].map(getZ).filter(Number.isFinite);
    const dialogs = ['#chat-panel', '#ask-panel'].map(selector => getZ(document.querySelector(selector)));
    return { actions, poppedChat, mascot, overlays, dialogs };
  });
  expect(assistantLayers.actions).toEqual([249, 249]);
  expect(assistantLayers.actions.every(layer => layer < assistantLayers.mascot)).toBeTruthy();
  expect(assistantLayers.poppedChat).toBe(39);
  for (const dialogLayer of assistantLayers.dialogs) expect(dialogLayer).toBeGreaterThan(assistantLayers.mascot);
  for (const overlayLayer of assistantLayers.overlays) {
    for (const actionLayer of assistantLayers.actions) expect(actionLayer).toBeGreaterThan(overlayLayer);
    expect(assistantLayers.poppedChat).toBeLessThan(overlayLayer);
  }
  for (const [action, iconSize] of [[fab, '39px'], [page.locator('#bot-settings-fab'), '43.5px']]) {
    const icon = action.locator('svg');
    await expect(icon).toHaveCSS('animation-name', 'bot-action-icon-spin');
    await expect(icon).toHaveCSS('animation-duration', '0.45s');
    await expect(icon).toHaveCSS('animation-timing-function', 'linear');
    await expect(icon).toHaveCSS('animation-iteration-count', '1');
    await expect(icon).toHaveCSS('width', iconSize);
  }
  const spinKeyframes = await page.evaluate(() => {
    const rules = [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules]; } catch { return []; } });
    const spin = rules.find(rule => rule.type === CSSRule.KEYFRAMES_RULE && rule.name === 'bot-action-icon-spin');
    const move = rules.find(rule => rule.type === CSSRule.KEYFRAMES_RULE && rule.name === 'bot-action-unfurl');
    return { from: spin?.cssRules[0]?.style.transform, to: spin?.cssRules[spin.cssRules.length - 1]?.style.transform, buttonMovesWithoutRotation: move ? [...move.cssRules].every(rule => !rule.style.transform.includes('rotate')) : false };
  });
  expect(spinKeyframes).toEqual({ from: 'rotate(0deg)', to: 'rotate(360deg)', buttonMovesWithoutRotation: true });
  await expect(fab).toHaveCSS('--bot-menu-from-x', /px$/);
  await expect(page.locator('#bot-settings-fab')).toHaveCSS('--bot-menu-from-y', /px$/);
  await page.clock.runFor(350);
  const settingsClearOfMascot = await page.evaluate(() => { const bot = document.querySelector('#bot-peeker').getBoundingClientRect(); const button = document.querySelector('#bot-settings-fab').getBoundingClientRect(); return button.bottom <= bot.top || button.top >= bot.bottom || button.right <= bot.left || button.left >= bot.right; });
  expect(settingsClearOfMascot).toBeTruthy();
  const aligned = await page.evaluate(() => { const bot = document.querySelector('#bot-peeker').getBoundingClientRect(); const fab = document.querySelector('#bot-chat-action-fab'); return { botCenter: bot.top + bot.height / 2, buttonCenter: parseFloat(fab.style.top) + fab.offsetHeight / 2, side: getComputedStyle(fab).left }; });
  expect(Math.abs(aligned.botCenter - aligned.buttonCenter)).toBeLessThanOrEqual(1);
  expect(parseFloat(aligned.side)).toBeGreaterThan(0);
  const activeSpins = await page.evaluate(() => ['#bot-chat-action-fab', '#bot-settings-fab'].map(selector => {
    const icon = document.querySelector(`${selector} svg`);
    const spin = icon.getAnimations().find(animation => animation.animationName === 'bot-action-icon-spin');
    return { playState: spin?.playState, currentTime: spin?.currentTime, transform: getComputedStyle(icon).transform };
  }));
  expect(activeSpins).toHaveLength(2);
  for (const spin of activeSpins) {
    expect(['running', 'finished']).toContain(spin.playState);
    expect(spin.currentTime).toBeGreaterThan(0);
  }
  await page.clock.runFor(1949);
  await expect(fab).toBeVisible();
  await page.clock.runFor(1);
  await expect(fab).toHaveCSS('opacity', '1');
  await expect(page.locator('#bot-settings-fab')).toHaveCSS('opacity', '1');
  const closingLayers = await page.evaluate(() => {
    const mascot = Number.parseInt(getComputedStyle(document.querySelector('#bot-peeker')).zIndex, 10);
    const actions = ['#bot-chat-action-fab', '#bot-settings-fab'].map(selector => Number.parseInt(getComputedStyle(document.querySelector(selector)).zIndex, 10));
    return { mascot, actions };
  });
  expect(closingLayers.actions).toEqual([249, 249]);
  expect(closingLayers.actions.every(layer => layer < closingLayers.mascot)).toBeTruthy();
  await page.clock.runFor(3200);
  await expect(fab).toBeHidden();
  await mascot.click();
  await expect(fab).toBeVisible();
  await page.locator('#bot-settings-fab').click();
  await expect(page.locator('#bot-appearance-card')).toBeInViewport();
  await page.clock.runFor(760);
  await expect(fab).toBeHidden();
  await mascot.click();
  await page.locator('#view-settings h2').first().click();
  await page.clock.runFor(760);
  await expect(fab).toBeHidden();
  await mascot.click();
  await fab.click();
  await expect(page.locator('#chat-panel')).toHaveClass(/open/);
  await expect(mascot).toHaveClass(/bot-overlay-hidden/);
  await page.locator('#chat-close').click();
  await page.clock.runFor(1100);
  await expect(mascot).not.toHaveClass(/bot-overlay-hidden/);
  await openView(page, 'settings');
  await page.locator('#pref-tone').selectOption('playful');
  await page.locator('#save-tone').click();
  await expect(page.locator('.chat-fab-label')).toHaveText('ШІ-дієтолог');
  expect((await readStore(page)).prefs).toMatchObject({ aiTone: 'playful', botSize: '0.3', botSide: 'left', botOffsetV: '100%', botOffsetH: '1.5rem' });
});

test('single Spine assistant uses the new rig and keeps legacy appearance settings', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk', botSize: '0.72', botSide: 'left', botOffsetV: '37%', botOffsetH: '1.25rem', botFrequency: 15000, botMirrorEnabled: true }, foods: [], weights: [] });
  const mascot = page.locator('#bot-peeker');
  await expect(mascot).toBeVisible();
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await expect(mascot).toHaveAttribute('data-spine-animations', 'idle,blink,wave,thinking,celebrate');
  await expect(mascot).toHaveClass(/bot-side-left/);
  await expect(mascot).toHaveCSS('--bot-scale', '0.72');
  await expect(mascot).toHaveCSS('--bot-offset-h', '1.25rem');
  await expect(page.locator('#pref-bot-mirror-enabled')).toHaveCount(0);
  await expect(page.locator('#bot-peeker-mirror')).toHaveCount(0);
  await openView(page, 'settings');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'curious');
  await expect(page.locator('#pref-bot-size')).toHaveValue('72');
  await expect(page.locator('#pref-bot-side')).toHaveValue('left');
  await expect(page.locator('#pref-bot-offset-v')).toHaveValue('37');
  await expect(page.locator('#pref-bot-offset-h')).toHaveValue('1.25');
  await expect(page.locator('#pref-bot-frequency')).toHaveValue('15000');
  await page.evaluate(() => window.nutritionBot.celebration());
  await expect(mascot).toHaveAttribute('data-spine-action', 'celebrate');
  await expect(mascot).toHaveAttribute('data-spine-sequence', 'celebrate,wave');
  await page.evaluate(() => window.nutritionBot.idle());
  const blinkCount = Number(await mascot.getAttribute('data-spine-blink-count') || 0);
  await page.clock.runFor(6500);
  await expect.poll(async () => Number(await mascot.getAttribute('data-spine-blink-count') || 0)).toBeGreaterThan(blinkCount);
  await page.evaluate(() => window.nutritionBot.wave());
  await expect(mascot).toHaveAttribute('data-spine-action', 'wave');
  await page.evaluate(() => window.nutritionBot.idle());
  await expect(mascot).toHaveAttribute('data-spine-mood', 'idle');
  await expect.poll(() => page.evaluate(() => typeof window.nutritionBot.talking)).toBe('undefined');
  await page.evaluate(() => window.nutritionBot.sad());
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sad');
  await page.evaluate(() => window.nutritionBot.sleepy());
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await page.evaluate(() => window.nutritionBot.idle());
  const autoCount = Number(await mascot.getAttribute('data-spine-auto-motion-count') || 0);
  await page.evaluate(() => configureBotAnimations(1000));
  await page.clock.runFor(1000);
  await expect.poll(async () => Number(await mascot.getAttribute('data-spine-auto-motion-count') || 0)).toBeGreaterThan(autoCount);
  await page.evaluate(() => configureBotAnimations(15000));
  await page.evaluate(() => window.nutritionBot.idle());
  const scratchCount = Number(await mascot.getAttribute('data-spine-scratch-count') || 0);
  const botBounds = await mascot.boundingBox();
  const scratchX = botBounds.x + botBounds.width / 2;
  const scratchY = botBounds.y + botBounds.height / 2;
  await page.mouse.move(scratchX, scratchY);
  await page.mouse.down();
  for (const offset of [22, -22, 22, -22, 22]) await page.mouse.move(scratchX + offset, scratchY, { steps: 2 });
  await page.mouse.up();
  await expect.poll(async () => Number(await mascot.getAttribute('data-spine-scratch-count') || 0)).toBe(scratchCount + 1);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'scratch');
  await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
  await page.evaluate(async () => { await addFood({ name: 'Bot reaction meal', meal: 'lunch', grams: 100, kcal: 100, protein: 5, fat: 2, carbs: 10, date: iso() }); });
  await expect(mascot).toHaveAttribute('data-spine-mood', 'success');
  await page.evaluate(async () => { const date = '2026-01-01'; state.weights.push({ id: 'bot-reaction-weight', value: 80, date }); save(); await deleteWeight(date); });
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sad');
  await page.evaluate(() => window.nutritionBot.idle());
  await mascot.click();
  await expect(page.locator('#bot-chat-action-fab')).toBeVisible();
  await page.locator('#bot-chat-action-fab').click();
  await expect(page.locator('#chat-panel')).toHaveClass(/open/);
  await expect(mascot).toHaveClass(/bot-overlay-hidden/);
  await page.locator('#chat-close').click();
  await page.clock.runFor(1100);
  await expect(mascot).not.toHaveClass(/bot-overlay-hidden/);
  await page.reload();
  await expect(page.locator('#bot-peeker')).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await openView(page, 'settings');
  await expect(page.locator('#pref-bot-size')).toHaveValue('72');
  await expect(page.locator('#pref-bot-side')).toHaveValue('left');
  await expect(page.locator('#pref-bot-offset-v')).toHaveValue('37');
  await expect(page.locator('#pref-bot-offset-h')).toHaveValue('1.25');
  await expect(page.locator('#pref-bot-frequency')).toHaveValue('15000');
});

test('disabled assistant restores the original one-click dietitian launcher', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'button' }, foods: [], weights: [] });
    const fab = page.locator('#chat-fab');
    await expect(page.locator('#pref-bot-enabled')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#bot-peeker')).toBeHidden();
    await expect(fab).toHaveCSS('right', '24px');
    await expect(fab).toHaveCSS('bottom', '24px');
    await fab.click();
    await expect(page.locator('#chat-panel')).toHaveClass(/open/);
    await expect(fab).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#chat-close').click();
    await expect(page.locator('#chat-panel')).not.toHaveClass(/open/);
  });
});

test.describe('Smoke: AI character', () => {
  test('the playful character changes app texts and the choice survives reload', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await expect(page.locator('#chat-welcome')).not.toContainText('croissant');
    await openView(page, 'settings');
    await expect(page.locator('#pref-tone')).toHaveValue('polite');
    await page.selectOption('#pref-tone', 'playful');
    await page.click('#save-tone');
    await expect(page.locator('#chat-welcome')).toContainText('just one more croissant');
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'settings');
    await expect(page.locator('#pref-tone')).toHaveValue('playful');
    expect((await readStore(page)).prefs.aiTone).toBe('playful');
  });
});

test.describe('Smoke: dialog close, AI models and storage cleanup', () => {
  test('deleting one app message asks for confirmation first', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
  await page.evaluate(() => toast('Confirm delete test'));
  await page.evaluate(() => openNotifications());
  await expect(page.locator('#notif-list .notif-item')).toHaveCount(1);
  await page.locator('#notif-list [data-notif-delete]').click();
  await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
  await expect(page.locator('#confirm-message')).toHaveText('Delete this message?');
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#notif-list .notif-item')).toHaveCount(1);
  await page.locator('#notif-list [data-notif-delete]').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#notif-list .notif-item')).toHaveCount(0);
});

test('all close buttons share one style', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const info = await page.$$eval('button', bs => bs.filter(b => /✕|×/.test(b.textContent) && !b.closest('.install-banner')).map(b => ({ cls: b.className, id: b.id })));
    expect(info.length).toBeGreaterThanOrEqual(9);
    for (const b of info) expect(b.cls).toContain('modal-x');
    const sizes = await page.$$eval('button.modal-x', bs => bs.map(b => { const s = getComputedStyle(b); return [s.width, s.height, s.backgroundColor, s.borderRadius, s.fontSize].join('|'); }));
    expect(new Set(sizes).size).toBe(1);
  });

  test('model dropdown, custom id validation, warning and test button', async ({ page }) => {
    await page.route('https://api.groq.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) }));
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'settings');
    await expect(page.locator('[data-ai-warn="gemini"]')).toBeVisible();
    await expect(page.locator('[data-ai-warn="groq"]')).toBeHidden();
    await page.locator('.ai-row[data-prov="gemini"] .dd-btn').click();
    await page.locator('.ai-row[data-prov="gemini"] .dd-opt[data-value="custom"]').click();
    await expect(page.locator('[data-ai-custom="gemini"]')).toBeVisible();
    await page.fill('[data-ai-custom="gemini"]', 'bad id!');
    await page.click('#save-ai');
    await expect(page.locator('#toast, .toast').first()).toContainText(/Model ID|ID моделі/);
    await page.fill('[data-ai-custom="gemini"]', 'gemini-my-model');
    await page.click('#save-ai');
    await page.reload();
    await openView(page, 'settings');
    const st = await readStore(page);
    expect(st.ai.models.gemini).toBe('gemini-my-model');
    await expect(page.locator('[data-ai-custom="gemini"]')).toHaveValue('gemini-my-model');
    // test button without key
    await page.click('[data-ai-test="groq"]');
    await expect(page.locator('[data-ai-result="groq"]')).toContainText('Add the API key first');
    // test button with a key, auto model
    await page.fill('[data-ai-key="groq"]', 'gsk_test_key_123');
    await page.click('[data-ai-test="groq"]');
    await expect(page.locator('[data-ai-result="groq"]')).toContainText('Works: openai/gpt-oss-120b');
  });

  test('storage full: old synced entries are offered for removal and removed only after OK', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const r = await page.evaluate(() => {
      const oldDate = '2024-01-05', newDate = iso();
      state.foods = [
        { id: '11111111-1111-4111-8111-111111111111', name: 'old a', meal: 'lunch', grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, date: oldDate },
        { id: '22222222-2222-4222-8222-222222222222', name: 'old pending', meal: 'lunch', grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, date: oldDate },
        { id: '33333333-3333-4333-8333-333333333333', name: 'new', meal: 'lunch', grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, date: newDate },
        { id: '44444444-4444-4444-8444-444444444444', name: 'old unconfirmed', meal: 'lunch', grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, date: oldDate },
      ];
      sb = {}; user = { id: 'tester' };
      state.synced = { uid: 'tester', email: '', foods: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'], weights: [], products: [] };
      syncQueue.foods = ['22222222-2222-4222-8222-222222222222'];
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === storeKey && !window.__allowWrite) throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
      return staleSyncedFoods().map(f => f.name);
    });
    expect(r).toEqual(['old a']);
    await page.evaluate(() => { writeLocal(storeKey, '{}'); });
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.evaluate(() => { window.__allowWrite = true; });
    await page.click('#confirm-ok');
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/open/);
    const names = await page.evaluate(() => state.foods.map(f => f.name));
    expect(names.sort()).toEqual(['new', 'old pending', 'old unconfirmed'].sort());
  });
});

test.describe('Smoke: Gemini default and styled settings pickers', () => {
  test('Auto uses the fast Gemini model first and settings selects use the app dropdown', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    expect(await page.evaluate(() => AI_MODELS.gemini.auto)).toEqual(['gemini-3.5-flash-lite']);
    await openView(page, 'settings');
    for (const id of ['#pref-lang', '#profile-sex', '#profile-activity', '#profile-pace']) {
      await expect(page.locator(id)).toHaveClass(/dd-native/);
    }
    const pace = page.locator('#profile-pace');
    const values = await pace.evaluate(s => [...s.options].map(o => o.value));
    await pace.locator('xpath=..').locator('.dd-btn').click();
    await page.locator('#profile-pace').locator('xpath=..').locator('.dd-opt').nth(1).click();
    await expect(pace).toHaveValue(values[1]);
    await page.locator('#pref-lang').locator('xpath=..').locator('.dd-btn').click();
    await page.locator('#pref-lang').locator('xpath=..').locator('.dd-opt[data-value="uk"]').click();
    await page.click('#save-lang');
    expect((await readStore(page)).prefs.lang).toBe('uk');
  });
});

test.describe('Smoke: dietitian answer display and spacing', () => {
  test('response length can be chosen in Settings and the dietitian panel', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'en' } });
    await openView(page, 'settings');
    const select = page.locator('#pref-verbosity');
    await select.locator('xpath=..').locator('.dd-btn').click();
    await select.locator('xpath=..').locator('.dd-opt[data-value="brief"]').click();
    await page.locator('#save-tone').click();
    await expect.poll(async () => (await readStore(page)).prefs.aiVerbosity).toBe('brief');
    expect(await page.evaluate(() => askPrompt([], 'How much protein?'))).toContain('very briefly');
    await select.locator('xpath=..').locator('.dd-btn').click();
    await select.locator('xpath=..').locator('.dd-opt[data-value="detailed"]').click();
    await page.locator('#save-tone').click();
    expect(await page.evaluate(() => askPrompt([], 'How much protein?'))).toContain('in detail');
  });
  test('saved JSON comparison replies render as readable text instead of raw JSON', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'en' } });
    const json = '```json\n{"comparison":[{"name":"Coffee with honey","calories_kcal":21,"carbs_g":5.7,"sugar_g":5.7,"notes":"A light natural sweetener."},{"name":"Coffee with sugar","calories_kcal":16,"carbs_g":4,"sugar_g":4,"notes":"A quick sweet option."}],"summary":"Honey has about 5 kcal more."}\n```';
    await page.evaluate((value) => localStorage.setItem('smartdiet-ask-v1', JSON.stringify([{ role: 'ai', text: value }])), json);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await page.click('[data-action="open-ask"]');
    const bubble = page.locator('#ask-box .bubble.ai').last();
    await expect(bubble).toContainText('Coffee with honey');
    await expect(bubble).toContainText('21 kcal');
    await expect(bubble).toContainText('Honey has about 5 kcal more.');
    await expect(bubble).not.toContainText('```json');
    await expect(bubble).not.toContainText('"comparison"');
  });
  test('Ask the Dietitian renders recommended foods as rows with plus actions and a destination dialog', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'uk' } });
    const json = JSON.stringify({ items: [
      { name: 'Вівсянка', grams: 50, kcal: 190, protein: 7, fat: 3, carbs: 32 },
      { name: 'Йогурт', grams: 120, kcal: 90, protein: 8, fat: 2, carbs: 10 },
    ], summary: 'Орієнтовні порції для перекусу.' });
    await page.route('https://api.groq.com/**', (route) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: json } }] }) }));
    await page.click('[data-action="open-ask"]');
    await page.fill('#ask-input', 'Що можна додати до перекусу?');
    await page.click('#ask-send');

    const rows = page.locator('#ask-box .ask-product-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Вівсянка');
    await expect(rows.nth(1)).toContainText('Йогурт');
    await expect(rows.nth(0).locator('.ask-product-plus')).toHaveText('+');
    await expect(rows.nth(0).locator('.ask-product-plus')).toHaveAttribute('aria-label', 'Вибрати, куди додати Вівсянка');

    await rows.nth(0).locator('.ask-product-plus').click();
    await expect(page.locator('#ask-product-action-modal')).toHaveClass(/open/);
    await expect(page.locator('#ask-product-action-name')).toHaveText('Вівсянка');
    await page.locator('#ask-product-action-save').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#food-name')).toHaveValue('Вівсянка');
    await page.locator('#food-save').click();
    await expect.poll(async () => (await readStore(page)).products.map((x) => x.name)).toContain('Вівсянка');

    await rows.nth(1).locator('.ask-product-plus').click();
    await expect(page.locator('#ask-product-action-modal')).toHaveClass(/open/);
    await page.locator('#ask-product-action-diary').click();
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await page.locator('#pick-meals [data-pick-meal="breakfast"]').click();
    await page.locator('#pick-add').click();
    await expect.poll(async () => (await readStore(page)).foods.map((x) => x.name)).toContain('Йогурт');
  });

  test('floating dietitian chat displays each recommended product on its own row', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'uk' } });
    const json = JSON.stringify({ items: [
      { name: 'Вівсянка', grams: 50, kcal: 190, protein: 7, fat: 3, carbs: 32 },
      { name: 'Йогурт', grams: 120, kcal: 90, protein: 8, fat: 2, carbs: 10 },
    ], total: { kcal: 280, protein: 15, fat: 5, carbs: 42 }, note: '' });
    await page.route('https://api.groq.com/**', (route) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: json } }] }) }));
    await openDietitianChat(page);
    await page.locator('#chat-input').fill('перекус');
    await page.locator('#chat-send').click();

    const rows = page.locator('#chatbox .chat-product-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Вівсянка');
    await expect(rows.nth(1)).toContainText('Йогурт');
    await expect(rows.nth(0).locator('.chat-product-title')).toHaveText('Вівсянка:');
    await expect(rows.nth(0).locator('.chat-product-details')).toContainText('50');
    const titleStyles = await rows.nth(0).locator('.chat-product-title').evaluate(el => {
      const style = getComputedStyle(el);
      return { fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight) };
    });
    const detailSize = await rows.nth(0).locator('.chat-product-details').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(titleStyles.fontWeight).toBeGreaterThanOrEqual(600);
    expect(detailSize).toBeLessThan(titleStyles.fontSize);
    const productRowStyle = await rows.nth(0).evaluate(el => {
      const style = getComputedStyle(el);
      return { borderColor: style.borderTopColor, borderStyle: style.borderTopStyle, borderRadius: style.borderTopLeftRadius };
    });
    expect(productRowStyle.borderColor).toBe('rgb(126, 184, 134)');
    expect(productRowStyle.borderStyle).toBe('solid');
    expect(productRowStyle.borderRadius).toBe('10px');
    const rowTops = await rows.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(rowTops[1]).toBeGreaterThan(rowTops[0]);
    await rows.nth(0).locator('.chat-product-plus').click();
    await expect(page.locator('#ask-product-action-modal')).toHaveClass(/open/);
    await expect(page.locator('#ask-product-action-name')).toHaveText('Вівсянка');
    const summary = page.locator('#chatbox .bubble.ai').last().locator('.chat-product-total');
    await expect(summary.locator('.ai-info-btn')).toHaveCount(1);
    const infoSize = await summary.locator('.ai-info-btn').evaluate(el => {
      const style = getComputedStyle(el);
      return { width: parseFloat(style.width), height: parseFloat(style.height) };
    });
    expect(infoSize.width).toBeLessThanOrEqual(20);
    expect(infoSize.height).toBeLessThanOrEqual(20);
    const bubbleChildren = await page.locator('#chatbox .bubble.ai').last().locator('> *').evaluateAll(nodes => nodes.map(n => n.className));
    expect(bubbleChildren.slice(-2)).toEqual(['chat-product-total', 'ai-meta hidden']);
    const listGap = await page.locator('#chatbox .chat-product-list').evaluate(el => parseFloat(getComputedStyle(el).rowGap));
    expect(listGap).toBeGreaterThanOrEqual(8);
    const messageGap = await page.locator('#chatbox').evaluate(el => parseFloat(getComputedStyle(el).rowGap));
    expect(messageGap).toBeGreaterThanOrEqual(12);
  });

  test('floating dietitian chat history survives close and reload, clears with confirmation, and remains account-scoped', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'uk' } });
    const reply = JSON.stringify({ items: [{ name: 'Вівсянка', grams: 50, kcal: 190, protein: 7, fat: 3, carbs: 32 }], total: { kcal: 190, protein: 7, fat: 3, carbs: 32 }, note: 'Орієнтовна порція.' });
    await page.route('https://api.groq.com/**', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: reply } }] }) }));
    await openDietitianChat(page);
    await page.locator('#chat-input').fill('вівсянка');
    await page.locator('#chat-send').click();
    await expect(page.locator('#chatbox .chat-product-row')).toHaveCount(1);
    await page.locator('#chat-close').click();
    await openDietitianChat(page);
    await expect(page.locator('#chatbox .chat-product-row')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openDietitianChat(page);
    await expect(page.locator('#chatbox .chat-product-row')).toHaveCount(1);
    const savedKey = await page.evaluate(() => Object.keys(localStorage).find(key => key === 'smartdiet-dietitian-chat-v1:local'));
    expect(savedKey).toBe('smartdiet-dietitian-chat-v1:local');
    const accountKeys = await page.evaluate(() => {
      user = { id: 'dietitian-test-user' };
      switchDietitianChat();
      const accountWasInitiallyEmpty = dietitianChat.length === 0;
      appendDietitianChat({ id: 'account-only-message', role: 'user', text: 'private account chat' });
      user = null;
      switchDietitianChat();
      const guestHasAccountMessage = dietitianChat.some(message => message.text === 'private account chat');
      const guestHistoryLength = dietitianChat.length;
      user = { id: 'dietitian-test-user' };
      switchDietitianChat();
      const accountRestored = dietitianChat.some(message => message.text === 'private account chat');
      user = null;
      switchDietitianChat();
      return { accountWasInitiallyEmpty, guestHasAccountMessage, guestHistoryLength, accountRestored };
    });
    expect(accountKeys.accountWasInitiallyEmpty).toBe(true);
    expect(accountKeys.guestHasAccountMessage).toBe(false);
    expect(accountKeys.guestHistoryLength).toBeGreaterThan(0);
    expect(accountKeys.accountRestored).toBe(true);
    await page.locator('#chat-clear').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.locator('#confirm-cancel').click();
    await expect(page.locator('#chatbox .chat-product-row')).toHaveCount(1);
    await page.locator('#chat-clear').click();
    await page.locator('#confirm-ok').click();
    await expect(page.locator('#chatbox .bubble:not(#chat-welcome)')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('smartdiet-dietitian-chat-v1:local') || '[]'))).toEqual([]);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openDietitianChat(page);
    await expect(page.locator('#chatbox .bubble:not(#chat-welcome)')).toHaveCount(0);
  });

  test('meal cards stack eye and title, then calories, then macros without horizontal overflow', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'en' }, foods: [
      { id: 'meal-layout-test', name: 'Oats', meal: 'breakfast', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60, date: today, createdAt: 1 },
    ] });
    await page.setViewportSize({ width: 360, height: 800 });
    await openView(page, 'diary');
    const card = page.locator('#diary-meals .meal-card').first();
    const positions = await card.evaluate(el => {
      const top = el.querySelector('.meal-top');
      const eye = top.querySelector('.meal-activity-icon').getBoundingClientRect();
      const titleRange = document.createRange();
      titleRange.selectNodeContents(top.querySelector('.meal-title'));
      const title = titleRange.getBoundingClientRect();
      const calories = top.querySelector('.meal-kcal').getBoundingClientRect();
      const macros = top.querySelector('.meal-macros').getBoundingClientRect();
      return { eye: { top: eye.top, left: eye.left, right: eye.right, bottom: eye.bottom }, title: { top: title.top, left: title.left, bottom: title.bottom }, calories: { top: calories.top, left: calories.left }, macros: { top: macros.top, left: macros.left }, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    });
    expect(positions.eye.top).toBeLessThan(positions.title.bottom);
    expect(positions.eye.bottom).toBeGreaterThan(positions.title.top);
    expect(positions.calories.top).toBeGreaterThan(positions.title.top);
    expect(positions.macros.top).toBeGreaterThan(positions.calories.top);
    expect(positions.macros.left).toBeCloseTo(positions.calories.left, 0);
    expect(positions.scrollWidth).toBeLessThanOrEqual(positions.innerWidth);
  });

  test('meal header keeps eye left, title close beside it, and snack arrows below analysis', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [
      { id: 'layout-breakfast', name: 'Oats', meal: 'breakfast', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60, date: today, createdAt: 1 },
      { id: 'layout-snack', name: 'Apple', meal: 'snack', snackId: 'layout-snack-event', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14, date: today, createdAt: 2 },
    ] });
    await page.setViewportSize({ width: 390, height: 844 });
    await openView(page, 'diary');
    const card = page.locator('#diary-meals .meal-card').filter({ has: page.locator('.meal-title', { hasText: 'Snack' }) }).first();
    const layout = await card.evaluate(el => {
      const rect = selector => { const r=el.querySelector(selector).getBoundingClientRect(); return {top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:r.width}; };
      const range=document.createRange();range.selectNodeContents(el.querySelector('.meal-title'));const text=range.getBoundingClientRect();const calorieRange=document.createRange();calorieRange.selectNodeContents(el.querySelector('.meal-kcal'));const calorieText=calorieRange.getBoundingClientRect();return { eye:rect('.meal-activity'), title:rect('.meal-title'), titleText:{left:text.left,right:text.right}, titleAlign:getComputedStyle(el.querySelector('.meal-title')).textAlign, chevronLeft:getComputedStyle(el.querySelector('.meal-analyze'),'::after').left, analyze:rect('.meal-analyze'), arrows:rect('.snack-moves'), calories:rect('.meal-kcal'), calorieText:{left:calorieText.left,right:calorieText.right,top:calorieText.top,bottom:calorieText.bottom}, macros:rect('.meal-macros'), top:rect('.meal-top'), innerWidth:window.innerWidth, scrollWidth:document.documentElement.scrollWidth };
    });
    expect(layout.titleText.left).toBeGreaterThanOrEqual(layout.eye.right);
    expect(layout.titleText.left-layout.eye.right).toBeLessThanOrEqual(8);
    expect(layout.titleText.right).toBeLessThan(layout.analyze.left);
    expect(layout.titleAlign).toBe('left');
    expect(layout.chevronLeft).toBe('-22px');
    expect(layout.title.top).toBeLessThanOrEqual(layout.analyze.top+3);
    expect(layout.calories.top).toBeGreaterThanOrEqual(layout.title.bottom);
    expect(layout.calories.top-layout.title.bottom).toBeLessThanOrEqual(8);
    expect(layout.calorieText.right).toBeLessThan(layout.arrows.left);
    expect(Math.abs(layout.calorieText.top-layout.arrows.top)).toBeLessThanOrEqual(8);
    expect(layout.arrows.top).toBeGreaterThanOrEqual(layout.analyze.bottom);
    expect(layout.arrows.right).toBeCloseTo(layout.top.right,0);
    expect(layout.macros.top).toBeGreaterThan(layout.calories.top);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
  });

  test('a prepared dish stays one nutrition item and mobile content clears the launcher', async ({ page }) => {
    await openApp(page, { ...AI_STORE(['groq']), prefs: { ...BASE_PREFS, lang: 'uk' } });
    let sent = '';
    await page.route('https://api.groq.com/**', async (route) => {
      sent = route.request().postData() || '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ name: 'Млинці на молоці', grams: 180, kcal: 360, protein: 12, fat: 10, carbs: 55 }], total: { kcal: 360, protein: 12, fat: 10, carbs: 55 }, note: 'Орієнтовна оцінка готової страви.' }) } }] }) });
    });
    await openDietitianChat(page);
    await page.locator('#chat-input').fill('млинці на молоці');
    await page.locator('#chat-send').click();
    await expect.poll(() => sent).toContain('рахуй це як ОДНУ готову страву');
    await expect(page.locator('#chatbox')).toContainText('Млинці на молоці');
    await expect(page.locator('#chatbox')).not.toContainText('окреме молоко');
    await page.setViewportSize({ width: 390, height: 844 });
    const padding = await page.locator('.main').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(padding).toBeGreaterThanOrEqual(123);
  });
});
