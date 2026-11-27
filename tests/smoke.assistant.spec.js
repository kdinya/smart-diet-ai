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


test.describe('Smoke: sleeping assistant wake prompt', () => {
  const sleepyStore = () => ({ prefs: { ...BASE_PREFS, botMode: 'mascot', lang: 'uk' }, products: [], foods: [], weights: [] });
  const silenceStartupWelcome = (page) => page.evaluate(() => {
    clearTimeout(botWelcomeTimer);
    botWelcomeTimer = null;
    botWelcomeScheduled = false;
    botWelcomeShown = true;
    hideBotComic(true);
    applyBotTimeBaseline();
  });

  test('startup welcome changes sleeping assistant to dozing and sleeps one second after dismissal', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-03T02:00:00') });
    await openApp(page, sleepyStore());
    const mascot = page.locator('#bot-peeker');
    const bubble = page.locator('#bot-comic');
    await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
    await expect(mascot).not.toHaveClass(/is-arrived/);
    await page.clock.fastForward(1500);
    await expect(mascot).toHaveClass(/is-arrived/);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
    await page.clock.fastForward(700);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await page.clock.fastForward(500);
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(bubble.locator('.bot-comic-actions')).toBeHidden();
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');

    await page.mouse.click(4, 4);
    await expect(bubble).not.toHaveClass(/is-visible/);
    await page.clock.fastForward(1000);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
  });

  test('tapping a sleeping assistant asks first and the no choice returns it to sleep', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-03T02:00:00') });
    await openApp(page, sleepyStore());
    await silenceStartupWelcome(page);
    const mascot = page.locator('#bot-peeker');
    const bubble = page.locator('#bot-comic');
    await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');

    await mascot.click();
    await page.clock.fastForward(20);
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(bubble.locator('.bot-comic-text')).toHaveText('Я сплю 😴 Точно розбудити мене?');
    await expect(bubble.locator('.bot-comic-actions button')).toHaveText(['Так, розбудити', 'Ні, спи далі']);
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await page.evaluate(() => toggleBotPoppedFab());
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
    await expect(bubble.locator('.bot-comic-actions button')).toHaveCount(2);

    await bubble.locator('.bot-comic-actions button', { hasText: 'Ні, спи далі' }).click();
    await expect(bubble).not.toHaveClass(/is-visible/);
    await page.clock.fastForward(1000);
    await expect.poll(() => page.evaluate(() => botMotion), { timeout: 3000 }).toBe('sleeping');
  });

  test('yes reveals the quick actions and the assistant sleeps again after opening settings', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-03T02:00:00') });
    await openApp(page, sleepyStore());
    await silenceStartupWelcome(page);
    const mascot = page.locator('#bot-peeker');
    const bubble = page.locator('#bot-comic');
    await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
    await mascot.click();
    await page.clock.fastForward(20);
    await expect(bubble.locator('.bot-comic-actions button')).toHaveCount(2);
    await bubble.locator('.bot-comic-actions button', { hasText: 'Так, розбудити' }).click();
    await page.clock.fastForward(360);
    await page.clock.fastForward(20);
    await expect(page.locator('body')).toHaveClass(/bot-actions-open/, { timeout: 3000 });
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await expect(page.locator('#bot-chat-action-fab')).toBeVisible();
    await expect(page.locator('#bot-settings-fab')).toBeVisible();

    await page.locator('#bot-settings-fab').click();
    await expect(page.locator('#bot-appearance-card')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
    await page.clock.fastForward(1000);
    await expect.poll(() => page.evaluate(() => botMotion), { timeout: 3000 }).toBe('sleeping');
  });

  test('unrelated actions cannot animate the assistant awake at night', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-03T02:00:00') });
    await openApp(page, sleepyStore());
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
    await page.evaluate(() => {
      window.nutritionBot.wave();
      window.nutritionBot.thinking();
      window.nutritionBot.success();
      window.nutritionBot.celebration();
    });
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
  });
});

test.describe('Smoke: sleepy assistant food reminder', () => {
  const store = () => ({ prefs: { ...BASE_PREFS, botMode: 'mascot', lang: 'uk' }, products: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Apple', grams: 100, kcal: 52, protein: 0.3, fat: 0.2, carbs: 14 }], foods: [], weights: [] });

  test('meal add shows a reminder while asleep and returns the assistant to sleep when closed', async ({ page }) => {
    await openApp(page, store());
    await clearSleepFoodReminderCooldown(page);
    await page.evaluate(() => setBotServiceState({ period: 'night', pajamas: true }));
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
    const meal = page.locator('#home-meals .meal-card').first();
    await meal.locator('.meal-head').click();
    await meal.locator('[data-action="add-food"]').click();
    await page.clock.fastForward(20);
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
    await expect(page.locator('#bot-comic .bot-comic-text')).toHaveText('О, нічний перекус! Я вже в піжамі, але для запису смаколика знайду хвилинку 🍎😴');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await page.locator('#bot-comic .bot-comic-actions button').click();
    await page.clock.fastForward(1000);
    await expect.poll(() => page.evaluate(() => botMotion), { timeout: 2000 }).toBe('sleeping');
  });

  test('product plus shows a reminder while asleep and does not open the meal picker', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-06T02:00:00') });
    await openApp(page, store());
    await clearSleepFoodReminderCooldown(page);
    await openView(page, 'products');
    await page.evaluate(() => setBotServiceState({ period: 'night', pajamas: true }));
    const product = page.locator('#products-list .product-item[data-product-id="11111111-1111-4111-8111-111111111111"]');
    if (await product.evaluate((element) => element.classList.contains('collapsed'))) await product.locator('.product-toggle-main').click();
    await product.locator('[data-add-product]').click();
    await page.clock.fastForward(20);
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
    await expect(page.locator('#pick-modal')).not.toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await page.locator('#bot-comic .bot-comic-actions button').click();
    await page.clock.fastForward(1000);
    await expect.poll(() => page.evaluate(() => botMotion), { timeout: 2000 }).toBe('sleeping');
    await clearSleepFoodReminderCooldown(page);
    await page.evaluate(() => setBotServiceState({ period: 'morning', pajamas: true }));
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    if (await product.evaluate((element) => element.classList.contains('collapsed'))) await product.locator('.product-toggle-main').click();
    await product.locator('[data-add-product]').click();
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
    await expect(page.locator('#bot-comic .bot-comic-text')).toHaveText('Доброго ранку! Я ще сонний, але сніданок — це дуже важлива справа 🍳😴');
  });

  test('AI-recommended food shows the sleep reminder before opening the meal picker', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-06T02:00:00') });
    await openApp(page, store());
    await clearSleepFoodReminderCooldown(page);
    await page.evaluate(() => {
      clearTimeout(botWelcomeTimer);
      botWelcomeTimer = null;
      botWelcomeScheduled = false;
      botWelcomeShown = true;
      hideBotComic(true);
      applyBotTimeBaseline();
    });
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
    await page.evaluate(() => { openAsk(); askBubble(JSON.stringify({ items: [{ name: 'Oats', grams: 50, kcal: 190, protein: 7, fat: 3, carbs: 32 }] }), 'ai'); });
    await page.locator('#ask-box .ask-product-plus').click();
    await page.locator('#ask-product-action-diary').click();
    await page.clock.fastForward(20);
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
    await expect(page.locator('#bot-comic .bot-comic-text')).toHaveText('О, нічний перекус! Я вже в піжамі, але для запису смаколика знайду хвилинку 🍎😴');
    await expect(page.locator('#pick-modal')).not.toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
  });

  test('disabled assistant never intercepts food entry even while asleep', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'button', lang: 'uk' }, products: [], foods: [], weights: [] });
    await clearSleepFoodReminderCooldown(page);
    await page.evaluate(() => setBotServiceState({ period: 'night', pajamas: true }));
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
    const meal = page.locator('#home-meals .meal-card').first();
    await meal.locator('.meal-head').click();
    await meal.locator('[data-action="add-food"]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);
    expect(await page.evaluate(() => botComicActionResolve)).toBeNull();
  });

  test('sleeping and sleepy reminders share a 10-minute cooldown, then show again', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-06T02:00:00') });
    await openApp(page, store());
    await clearSleepFoodReminderCooldown(page);
    await page.evaluate(() => setBotServiceState({ period: 'night', pajamas: true }));
    const meal = page.locator('#home-meals .meal-card').first();
    await meal.locator('.meal-head').click();
    const add = meal.locator('[data-action="add-food"]');

    await add.click();
    const bubble = page.locator('#bot-comic');
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(bubble.locator('.bot-comic-text')).toHaveText('О, нічний перекус! Я вже в піжамі, але для запису смаколика знайду хвилинку 🍎😴');
    await bubble.locator('.bot-comic-actions button').click();
    await page.clock.fastForward(1000);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');

    await add.click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(bubble).not.toHaveClass(/is-visible/);
    await page.locator('#modal-close').click();

    await page.clock.fastForward(10 * 60 * 1000 + 1);
    await add.click();
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
  });

  test('a sleepy assistant allows morning food and gives a gentle reminder in the evening', async ({ page }) => {
    await openApp(page, store());
    await clearSleepFoodReminderCooldown(page);
    await page.evaluate(() => setBotServiceState({ period: 'morning', pajamas: true }));
    const meal = page.locator('#home-meals .meal-card').first();
    await meal.locator('.meal-head').click();
    const add = meal.locator('[data-action="add-food"]');
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await add.click();
    const bubble = page.locator('#bot-comic');
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(bubble.locator('.bot-comic-text')).toHaveText('Доброго ранку! Я ще сонний, але сніданок — це дуже важлива справа 🍳😴');
    await page.locator('#modal-close').click();
    await page.evaluate(() => hideBotComic(true));

    await clearSleepFoodReminderCooldown(page);
    await page.evaluate(() => setBotServiceState({ period: 'evening', pajamas: true }));
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleepy');
    await add.click();
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(bubble.locator('.bot-comic-text')).toHaveText('О, нічний перекус! Я вже в піжамі, але для запису смаколика знайду хвилинку 🍎😴');
    await bubble.locator('.bot-comic-actions button').click();
    await expect(bubble).not.toHaveClass(/is-visible/);

    await clearSleepFoodReminderCooldown(page);
    await page.evaluate(() => setBotServiceState({ period: 'day', pajamas: false }));
    await add.click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(bubble).not.toHaveClass(/is-visible/);
    await expect.poll(() => page.evaluate(() => botMotion)).not.toBe('sleeping');
  });

  test('sleepy reminder respects its cooldown and then allows meal entry', async ({ page }) => {
    await openApp(page, store());
    await page.evaluate(() => setBotServiceState({ period: 'morning', pajamas: true }));
    const meal = page.locator('#home-meals .meal-card').first();
    await meal.locator('.meal-head').click();
    await page.evaluate(() => localStorage.setItem('smartdiet-sleep-food-morning', String(Date.now())));
    await meal.locator('[data-action="add-food"]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);
    await page.locator('#modal-close').click();
  });
});

test('assistant drops to the bottom while a window is open and returns when it closes', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot' }, foods: [], weights: [] });
  await openView(page, 'home');
  const peeker = page.locator('#bot-peeker');
  await expect(peeker).toHaveClass(/is-arrived/);
  const restY = (await peeker.boundingBox()).y;
  const viewport = page.viewportSize();

  await page.locator('[data-action="add-weight"]').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await expect.poll(async () => {
    const box = await peeker.boundingBox();
    return box ? Math.round(box.y + box.height) : 0;
  }, { timeout: 3000 }).toBeGreaterThanOrEqual(viewport.height - 4);

  await page.evaluate(() => {
    document.querySelectorAll('.modal-back.open').forEach(modal => modal.classList.remove('open'));
    updateScrollLock();
  });
  await expect.poll(async () => Math.round((await peeker.boundingBox()).y), { timeout: 3000 }).toBeLessThanOrEqual(Math.round(restY) + 1);
});

test('lower position slider sets how far the assistant drops while a window is open', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot' }, foods: [], weights: [] });
  await openView(page, 'settings');
  const lowerSlider = page.locator('#pref-bot-lower-offset');
  await expect(lowerSlider).toHaveAttribute('min', '-10');
  await expect(lowerSlider).toHaveAttribute('max', '0');
  await lowerSlider.fill('0');
  await page.locator('#save-bot-settings').click();
  await openView(page, 'home');
  const peeker = page.locator('#bot-peeker');
  await expect(peeker).toHaveClass(/is-arrived/);
  const viewport = page.viewportSize();

  await page.locator('[data-action="add-weight"]').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  const height = await peeker.evaluate(el => el.offsetHeight);
  const expectedY = viewport.height - height;
  await expect.poll(async () => Math.round((await peeker.boundingBox()).y), { timeout: 3000 }).toBeGreaterThanOrEqual(Math.round(expectedY) - 3);
  await expect.poll(async () => Math.round((await peeker.boundingBox()).y), { timeout: 3000 }).toBeLessThanOrEqual(Math.round(expectedY) + 3);

  await page.locator('#modal .modal-close').click();
  await expect(page.locator('#modal')).not.toHaveClass(/open/);
  await openView(page, 'settings');
  await lowerSlider.fill('-10');
  await page.locator('#save-bot-settings').click();
  await openView(page, 'home');
  await page.locator('[data-action="add-weight"]').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  const expectedNegativeY = Math.round((viewport.height - height) * 1.1);
  await expect.poll(async () => Math.round((await peeker.boundingBox()).y), { timeout: 3000 }).toBeGreaterThanOrEqual(expectedNegativeY - 3);
});

test('an accidental touch on the lower-position slider does not move the assistant', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot', botOffsetV: '40%' }, foods: [], weights: [] });
  await openView(page, 'settings');
  const peeker = page.locator('#bot-peeker');
  const slider = page.locator('#pref-bot-lower-offset');
  const originalY = (await peeker.boundingBox()).y;
  const originalValue = await slider.inputValue();

  for (const endEvent of ['pointerup', 'pointercancel']) {
    await slider.evaluate((el, finishEvent) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }));
      el.value = '-10';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (finishEvent === 'pointercancel') {
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 24 }));
      }
      el.dispatchEvent(new PointerEvent(finishEvent, { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 24 }));
    }, endEvent);
    await expect(slider).toHaveValue(originalValue);
    await expect.poll(async () => Math.round((await peeker.boundingBox()).y)).toBe(Math.round(originalY));
  }
});

test('lower-position slider previews while dragged and returns to the saved position on release', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot', botOffsetV: '40%' }, foods: [], weights: [] });
  await openView(page, 'settings');
  const peeker = page.locator('#bot-peeker');
  const slider = page.locator('#pref-bot-lower-offset');
  const originalY = (await peeker.boundingBox()).y;
  const originalSaved = (await readStore(page)).prefs.botLowerOffset || 0;
  await slider.evaluate(el => { el.value = '-10'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(async () => (await peeker.boundingBox()).y).toBeGreaterThan(originalY + 20);
  expect((await readStore(page)).prefs.botLowerOffset || 0).toBe(originalSaved);
  await slider.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
  await expect.poll(async () => Math.round((await peeker.boundingBox()).y)).toBe(Math.round(originalY));
});

test('menstrual-cycle support is female-only and its bubble waits for an explicit acknowledgement', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-05T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, sex: 'female', botMode: 'mascot' }, foods: [], weights: [] });
  await page.locator('[data-action="add-weight"]').first().click();
  const cycle = page.locator('#weight-cycle-field');
  await expect(cycle).toBeVisible();
  await page.locator('#weight-cycle').check();
  const bubble = page.locator('#bot-comic');
  await expect(bubble).toContainText('fluid retention and bloating');
  await expect(bubble.locator('.bot-comic-actions button')).toHaveText('Got it — continue');
  await page.clock.fastForward(60000);
  await expect(bubble).toHaveClass(/is-visible/);
  await bubble.locator('.bot-comic-actions button').click();
  await expect(bubble).not.toHaveClass(/is-visible/);
  await expect(page.locator('#modal')).toHaveClass(/open/);

  await page.locator('#modal-close').click();
  await page.evaluate(() => { state.prefs = { ...state.prefs, sex: 'male' }; save(); });
  await page.locator('[data-action="add-weight"]').first().click();
  await expect(page.locator('#weight-cycle-field')).toBeHidden();
  await expect(page.locator('#weight-cycle')).not.toBeChecked();
});

test('robot settings button closes an open window before opening settings', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot' }, foods: [], weights: [] });
  await openView(page, 'home');
  await expect(page.locator('#bot-peeker')).toHaveClass(/is-arrived/);
  await page.locator('[data-action="add-weight"]').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await page.locator('#bot-settings-fab').dispatchEvent('click');
  await expect(page.locator('#modal')).not.toHaveClass(/open/);
  await expect(page.locator('#bot-appearance-card')).toBeVisible();
});

test('assistant message dimming defaults to 30 and follows the saved setting', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot' }, foods: [], weights: [] });
  const dimColor = () => page.evaluate(() => getComputedStyle(document.getElementById('bot-comic-dim')).backgroundColor);
  await expect.poll(dimColor).toBe('rgba(21, 82, 56, 0.3)');
  await openView(page, 'settings');
  await page.locator('#pref-bot-dim').fill('60');
  await page.locator('#save-bot-settings').click();
  await expect.poll(dimColor).toBe('rgba(21, 82, 56, 0.6)');
});

test('all assistant appearance sliders ignore touch and vertical scroll but respond to intentional horizontal drags', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot' }, foods: [], weights: [] });
  await openView(page, 'settings');
  const ids = ['pref-bot-size', 'pref-bot-offset-v', 'pref-bot-lower-offset', 'pref-bot-dim', 'pref-bot-offset-h'];
  for (const id of ids) {
    const slider = page.locator(`#${id}`);
    const start = await slider.inputValue();
    await slider.evaluate(el => {
      const rect = el.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const emit = (type, clientX, clientY) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 91, pointerType: 'touch', clientX, clientY }));
      emit('pointerdown', x, y); emit('pointermove', x + 2, y + 30); emit('pointerup', x + 2, y + 30);
    });
    await expect(slider).toHaveValue(start);
    await slider.evaluate(el => {
      const rect = el.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const emit = (type, clientX, clientY) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 92, pointerType: 'touch', clientX, clientY }));
      emit('pointerdown', x, y); emit('pointermove', x - 70, y + 1); emit('pointerup', x - 70, y + 1);
    });
    await expect.poll(() => slider.inputValue()).not.toBe(start);
  }
});

test('text-only assistant bubbles dismiss on any touch while action bubbles stay open', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot' }, foods: [], weights: [] });
  await page.evaluate(() => { botWelcomeShown = true; botComicTouched = true; });
  const bubble = page.locator('#bot-comic');
  await page.evaluate(() => window.nutritionBot.say('Dismiss me'));
  await expect(bubble).toHaveClass(/is-visible/);
  await bubble.locator('.bot-comic-text').dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(bubble).not.toHaveClass(/is-visible/);

  await page.evaluate(() => {
    const underlay = document.createElement('button');
    underlay.id = 'bot-comic-underlay-test';
    underlay.textContent = 'Background action';
    underlay.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:1';
    underlay.dataset.clicks = '0';
    underlay.addEventListener('click', () => underlay.dataset.clicks = String(Number(underlay.dataset.clicks) + 1));
    document.body.appendChild(underlay);
    window.nutritionBot.ask('Needs a choice', [{ label: 'Continue', value: 'continue' }]);
  });
  await expect(bubble).toHaveAttribute('data-requires-action', 'true');
  await expect(bubble).toHaveClass(/is-visible/);
  const dim = page.locator('#bot-comic-dim');
  await expect(dim).toHaveClass(/is-action-blocking/);
  await expect(dim).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator('#bot-peeker')).toHaveCSS('pointer-events', 'none');
  const underlayBox = await page.locator('#bot-comic-underlay-test').boundingBox();
  await page.mouse.click(underlayBox.x + underlayBox.width / 2, underlayBox.y + underlayBox.height / 2);
  await expect(page.locator('#bot-comic-underlay-test')).toHaveAttribute('data-clicks', '0');
  await bubble.locator('.bot-comic-text').dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(bubble).toHaveClass(/is-visible/);
  await bubble.locator('.bot-comic-actions button').click();
  await expect(bubble).not.toHaveClass(/is-visible/);
  await expect(dim).not.toHaveClass(/is-action-blocking/);
  await expect(page.locator('#bot-peeker')).toHaveCSS('pointer-events', 'auto');

  await page.evaluate(() => { window.__assistantChoice = null; window.nutritionBot.say('Dismissible choice', { dismissible: true, actions: [{ label: 'Continue', value: 'continue', onSelect: value => { window.__assistantChoice = value; } }] }); });
  await expect(bubble).toHaveClass(/is-visible/);
  await bubble.locator('.bot-comic-actions button').dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(bubble).toHaveClass(/is-visible/);
  await bubble.locator('.bot-comic-actions button').click();
  await expect.poll(() => page.evaluate(() => window.__assistantChoice)).toBe('continue');
  await expect(bubble).not.toHaveClass(/is-visible/);
});

test('assistant comic clouds stay hidden whenever the assistant is disabled', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'button', lang: 'en' }, foods: [], weights: [] });
  const bubble = page.locator('#bot-comic');
  await page.clock.install({ time: new Date('2026-11-05T12:00:00') });
  await page.clock.fastForward(5000);
  await expect(bubble).not.toHaveClass(/is-visible/);
  await page.evaluate(() => {
    window.nutritionBot.say('Regular message');
    window.nutritionBot.say('Forced reminder', { force: true, actions: [{ label: 'Close', value: 'close' }] });
    botComicPreview = true;
    renderBotComic();
  });
  await expect(bubble).not.toHaveClass(/is-visible/);
  await page.evaluate(() => { botComicPreview = false; inboxRows = [{ id: 'disabled-share', name: 'Apple' }]; announceNewShares(); });
  expect(await page.evaluate(() => shareNoticeBatch)).toBeNull();

  await openView(page, 'settings');
  const toggle = page.locator('#pref-bot-enabled');
  await page.evaluate(() => { state.prefs.botMode = 'mascot'; document.querySelector('#pref-bot-enabled').setAttribute('aria-checked', 'true'); applyBotPreferences(); });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => { botWelcomeShown = false; scheduleBotWelcome(3000); window.nutritionBot.say('Visible while enabled'); });
  await expect(bubble).toHaveClass(/is-visible/);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(bubble).not.toHaveClass(/is-visible/);
  expect(await page.evaluate(() => botWelcomeTimer)).toBeNull();
  await page.clock.fastForward(3000);
  await expect(bubble).not.toHaveClass(/is-visible/);
  await page.evaluate(() => window.nutritionBot.say('Must stay hidden', { force: true }));
  await expect(bubble).not.toHaveClass(/is-visible/);
});

test.describe('Smoke: assistant buttons hide on interaction', () => {
  test('the assistant action buttons close on a tap, a drag or a scroll', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    const mascot = page.locator('#bot-peeker');
    await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
    const openButtons = async () => {
      await mascot.click();
      await expect(page.locator('body')).toHaveClass(/bot-actions-open/);
    };
    await openButtons();
    await page.locator('main h1').first().click();
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
    await openButtons();
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(300, 200, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
    await openButtons();
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 200);
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
  });
});

test('swiping the assistant flings it past the opposite edge and keeps the new side after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot', botSide: 'right' }, foods: [], weights: [] });
  const bot = page.locator('#bot-peeker');
  await expect(bot).toHaveClass(/is-arrived/);
  await expect(bot).not.toHaveClass(/bot-side-left/);
  await waitForTransformTransition(bot);
  const box = await bot.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx - i * 40, cy);
  await expect.poll(() => bot.evaluate((el) => el.style.transform)).not.toBe('');
  await page.mouse.up();
  await expect(bot).toHaveClass(/bot-side-left/, { timeout: 5000 });
  await expect.poll(async () => (await readStore(page)).prefs.botSide).toBe('left');
  await page.reload();
  await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
  await expect(page.locator('#bot-peeker')).toHaveClass(/bot-side-left/);
  await expect(page.locator('#bot-peeker')).toHaveClass(/is-arrived/);
  expect((await readStore(page)).prefs.botSide).toBe('left');
  await waitForTransformTransition(bot);

  const box2 = await page.locator('#bot-peeker').boundingBox();
  const lx = box2.x + box2.width / 2;
  const ly = box2.y + box2.height / 2;
  await page.mouse.move(lx, ly);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(lx + i * 40, ly);
  await page.mouse.up();
  await expect(page.locator('#bot-peeker')).not.toHaveClass(/bot-side-left/, { timeout: 5000 });
  await expect.poll(async () => (await readStore(page)).prefs.botSide).toBe('right');
});

test('a small drag snaps the assistant back and keeps its side on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot', botSide: 'right' }, foods: [], weights: [] });
  const bot = page.locator('#bot-peeker');
  await expect(bot).toHaveClass(/is-arrived/);
  await waitForTransformTransition(bot);
  const box = await bot.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 20, cy);
  await expect.poll(() => bot.evaluate((el) => el.style.transform)).not.toBe('');
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => document.getElementById('bot-peeker').style.transform)).toBe('');
  await expect(bot).not.toHaveClass(/bot-side-left/);
  expect((await readStore(page)).prefs.botSide).toBe('right');
});

test('assistant celebrates nutrition goals and shows its target-overage and sleep reactions', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk', currentWeight: 90, targetWeight: 80 },
    foods: [],
    weights: [],
  });
  const mascot = page.locator('#bot-peeker');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });

  await page.evaluate(async () => addFood({
    name: 'Тестова страва', meal: 'lunch', grams: 200, kcal: 1800,
    protein: 80, fat: 20, carbs: 200, date: iso(),
  }));
  await expect(page.locator('#confetti-canvas')).toHaveCount(1);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'celebration');

  await page.evaluate(async () => addFood({
    name: 'Ще одна тестова страва', meal: 'dinner', grams: 100, kcal: 300,
    protein: 10, fat: 10, carbs: 30, date: iso(),
  }));
  await expect(mascot).toHaveAttribute('data-spine-mood', 'oops');

  await page.clock.fastForward(3000);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'idle');
  await expect(page.locator('#bot-zzz')).not.toHaveClass(/is-sleeping/);
  await page.mouse.move(200, 200);
  await expect.poll(() => page.evaluate(() => window.botGaze?.t)).toBeGreaterThan(0);
});

test('assistant welcome pools stay localized and greet at night in dozing mode', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T02:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
  const pools = await page.evaluate(() => ({
    ukMessages: I.uk.botWelcomePolite,
    enPolite: I.en.botWelcomePolite,
  }));
  expect(pools.ukMessages).toHaveLength(15);
  expect(pools.enPolite).toHaveLength(8);
  const topical = /Україн|ЗСУ|Росій|захисник|стрій|бореться|темряв/iu;
  expect(pools.ukMessages.slice(0, 10).filter(text => topical.test(text))).toHaveLength(5);
  expect(pools.ukMessages.slice(10).filter(text => topical.test(text))).toHaveLength(0);
  expect(pools.enPolite.join(' ')).not.toMatch(/ЗСУ|Україн|Ukraine|Russia|Putin/i);
  const mascot = page.locator('#bot-peeker');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await page.clock.fastForward(4500);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
});

test('assistant welcomes use profile names and match Ukrainian gender', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk', name: 'Олена', sex: 'female' }, foods: [], weights: [] });
  const result = await page.evaluate(() => {
    const source = '💙 Привіт! Україна прекрасна, а ти вже зробив/-ла крок до турботи про себе.';
    const female = personalizeBotWelcome(source, true);
    state.prefs.sex = 'male';
    const male = personalizeBotWelcome(source, true);
    state.prefs.sex = 'other';
    const neutral = personalizeBotWelcome(source, true);
    state.prefs.lang = 'en';
    const english = personalizeBotWelcome('🌿 Hi! Ready for a fresh start?', true);
    return { female, male, neutral, english };
  });
  expect(result.female).toContain('Олена');
  expect(result.female).toContain('зробила крок');
  expect(result.female).toContain('моя квіточко');
  expect(result.male).toContain('зробив крок');
  expect(result.male).toContain('мій котику');
  expect(result.neutral).toContain('зробив/-ла крок');
  expect(result.english).toContain('👋 Hi, Олена!');
  const parity = await page.evaluate(() => Object.keys(I.en).sort().join('|') === Object.keys(I.uk).sort().join('|'));
  expect(parity).toBe(true);
  expect(await page.evaluate(() => I.uk.botWelcomeUniversalPolite)).toHaveLength(1);
});

test('Ukrainian assistant startup welcome uses one of the 15 approved messages and stays until touched', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk', name: 'Олена' }, foods: [], weights: [] });
  await page.clock.fastForward(1499);
  const bubble = page.locator('#bot-comic');
  await expect(bubble).not.toHaveClass(/is-visible/);
  await page.clock.fastForward(501);
  await expect(bubble).toHaveClass(/is-visible/, { timeout: 5000 });
  const welcome = await page.evaluate(() => ({
    text: document.querySelector('#bot-comic .bot-comic-text').textContent,
    allowed: I.uk.botWelcomePolite,
  }));
  expect(welcome.allowed).toHaveLength(15);
  expect(welcome.allowed).toContain(welcome.text);
  await page.clock.fastForward(15000);
  await expect(bubble).toHaveClass(/is-visible/);
  await page.locator('body').dispatchEvent('pointerdown');
  await expect(bubble).not.toHaveClass(/is-visible/);
});

test('assistant follows local night, morning, day, and evening routines', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T02:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  await page.evaluate(() => {
    clearTimeout(botWelcomeTimer);
    botWelcomeTimer = null;
    botWelcomeScheduled = false;
    botWelcomeShown = true;
    applyBotTimeBaseline();
  });
  const mascot = page.locator('#bot-peeker');
  const zzz = page.locator('#bot-zzz');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await expect(mascot).toHaveAttribute('data-time-period', 'night');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleeping');
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  const pajamaSlots = () => page.evaluate(() => {
    botSpineRig.skeleton.setToSetupPose();
    applyBotSleepwearSlots(botSpineRig);
    return Object.fromEntries(['pj_cap', 'pj_shirt', 'pj_upper_arm_l', 'pj_forearm_l'].map(name => [name, botSpineRig.skeleton.findSlot(name).attachment?.name ?? null]));
  });
  await expect.poll(pajamaSlots).toEqual({ pj_cap: 'pj_cap', pj_shirt: 'pj_shirt', pj_upper_arm_l: 'pj_upper_arm_l', pj_forearm_l: 'pj_forearm_l' });
  expect(await page.evaluate(() => ({
    pj_cap: botSpineRig.skeleton.findSlot('pj_cap').bone.data.name,
    pj_shirt: botSpineRig.skeleton.findSlot('pj_shirt').bone.data.name,
    pj_upper_arm_l: botSpineRig.skeleton.findSlot('pj_upper_arm_l').bone.data.name,
    pj_forearm_l: botSpineRig.skeleton.findSlot('pj_forearm_l').bone.data.name,
  }))).toEqual({ pj_cap: 'head', pj_shirt: 'torso', pj_upper_arm_l: 'upper_arm_l', pj_forearm_l: 'forearm_l' });
  const isArmMirroredBehindBack = () => page.evaluate(() => {
    let order = botSpineRig.skeleton.drawOrder.map(s => s.data.name);
    let torsoIndex = order.indexOf('torso');
    let armSlots = ['upper_arm_l', 'pj_upper_arm_l', 'forearm_l', 'pj_forearm_l', 'hand_l'];
    let bone = botSpineRig.bones.upper_arm_l;
    let elbow = botSpineRig.bones.forearm_l;
    let wrist = botSpineRig.bones.hand_l;
    return torsoIndex >= 0 && armSlots.every(name => order.indexOf(name) >= 0 && order.indexOf(name) < torsoIndex) && bone.scaleY === -1 && Math.abs(bone.rotation - 70) < 5 && elbow.worldX < bone.worldX && wrist.worldX <= elbow.worldX + 20;
  });
  await expect.poll(isArmMirroredBehindBack).toBe(true);

  await mascot.click();
  await page.clock.fastForward(20);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await expect(zzz).not.toHaveClass(/is-sleeping/);
  await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
  await page.locator('#bot-comic .bot-comic-actions button').nth(1).click();
  await page.clock.fastForward(1000);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleeping');
  await expect(zzz).toHaveClass(/is-sleeping/);

  const setTime = async (date) => {
    await page.clock.setSystemTime(new Date(date));
    await page.evaluate(() => syncBotTimePeriod());
  };
  await setTime('2026-11-03T04:59:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'night');
  await setTime('2026-11-03T05:00:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'morning');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect.poll(isArmMirroredBehindBack).toBe(true);
  await expect(zzz).not.toHaveClass(/is-sleeping/);
  await setTime('2026-11-03T08:59:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'morning');
  await setTime('2026-11-03T09:00:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'idle');
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
  await expect(zzz).not.toHaveClass(/is-sleeping/);
  await expect.poll(pajamaSlots).toEqual({ pj_cap: null, pj_shirt: null, pj_upper_arm_l: null, pj_forearm_l: null });
  const isArmInFront = () => page.evaluate(() => {
    let order = botSpineRig.skeleton.drawOrder.map(s => s.data.name);
    let bone = botSpineRig.bones.upper_arm_l;
    return order.indexOf('upper_arm_l') > order.indexOf('torso') && bone.scaleY === 1 && Math.abs(bone.rotation) < 5;
  });
  await expect.poll(isArmInFront).toBe(true);
  await setTime('2026-11-03T20:59:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await setTime('2026-11-03T21:00:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'evening');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect(zzz).not.toHaveClass(/is-sleeping/);
  await setTime('2026-11-03T23:59:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'evening');
  await setTime('2026-11-04T00:00:00');
  await expect(mascot).toHaveAttribute('data-time-period', 'night');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleeping');
  await expect(zzz).toHaveClass(/is-sleeping/);
});

test('assistant waits fully off-screen until its entrance on load', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot', botSide: 'right' }, foods: [], weights: [] });
  const canvas = page.locator('#bot-peeker .bot-spine-canvas');
  await page.evaluate(() => document.getElementById('bot-peeker').classList.remove('is-arrived'));
  const right = await canvas.boundingBox();
  expect(right.x).toBeGreaterThanOrEqual(390);
  await page.evaluate(() => document.getElementById('bot-peeker').classList.add('bot-side-left'));
  const left = await canvas.boundingBox();
  expect(left.x + left.width).toBeLessThanOrEqual(0);
});

test('assistant stays sleepy instead of cheerful while wearing pajamas', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T21:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const mascot = page.locator('#bot-peeker');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await expect(mascot).toHaveAttribute('data-time-period', 'evening');
  await page.evaluate(() => nutritionBot.celebration());
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await page.evaluate(() => nutritionBot.wave());
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await page.clock.setSystemTime(new Date('2026-11-03T12:00:00'));
  await page.evaluate(() => syncBotTimePeriod());
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await page.evaluate(() => nutritionBot.celebration());
  await expect(mascot).toHaveAttribute('data-spine-mood', 'celebration');
});

test('hidden service menu forces assistant states until it is closed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const mascot = page.locator('#bot-peeker');
  const modal = page.locator('#bot-service-modal');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  const mouthScale = () => page.evaluate(() => botSpineRig.skeleton.findBone('mouth').scaleY);
  const eyeScale = () => page.evaluate(() => botSpineRig.skeleton.findBone('eye_l').scaleY);
  const isArmBehind = () => page.evaluate(() => {
    let order = botSpineRig.skeleton.drawOrder.map(s => s.data.name);
    let torsoIndex = order.indexOf('torso');
    let armSlots = ['upper_arm_l', 'pj_upper_arm_l', 'forearm_l', 'pj_forearm_l', 'hand_l'];
    let bone = botSpineRig.bones.upper_arm_l;
    let elbow = botSpineRig.bones.forearm_l;
    let wrist = botSpineRig.bones.hand_l;
    return torsoIndex >= 0 && armSlots.every(name => order.indexOf(name) >= 0 && order.indexOf(name) < torsoIndex) && bone.scaleY === -1 && Math.abs(bone.rotation - 70) < 5 && elbow.worldX < bone.worldX && wrist.worldX <= elbow.worldX + 20;
  });
  const dayMouth = await mouthScale();
  const dayEye = await eyeScale();
  await openView(page, 'settings');
  const title = page.locator('#bot-appearance-title');
  for (let i = 0; i < 4; i++) await title.click();
  await expect(modal).not.toHaveClass(/open/);
  await title.click();
  await expect(modal).toHaveClass(/open/);
  await modal.getByRole('button', { name: 'Asleep' }).click();
  await modal.getByRole('button', { name: 'Take off pajamas' }).click();
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect(mascot).toHaveAttribute('data-time-period', 'night');
  await expect.poll(isArmBehind).toBe(true);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleeping');
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect(page.locator('#bot-zzz')).toHaveClass(/is-sleeping/);
  await expect.poll(mouthScale).toBeLessThan(dayMouth * 0.9);
  await modal.getByRole('button', { name: 'Sleepy' }).click();
  await modal.getByRole('button', { name: 'Take off pajamas' }).click();
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect(mascot).toHaveAttribute('data-spine-mood', 'sleepy');
  await expect.poll(eyeScale).toBeLessThan(dayEye * 0.8);
  await expect.poll(isArmBehind).toBe(true);
  await expect(page.locator('#bot-zzz')).not.toHaveClass(/is-sleeping/);
  await modal.getByRole('button', { name: 'Awake' }).click();
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
  await modal.getByRole('button', { name: 'Put on pajamas' }).click();
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await expect.poll(isArmBehind).toBe(true);
  await modal.getByRole('button', { name: 'Take off pajamas' }).click();
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
  const isArmNormal = () => page.evaluate(() => {
    let order = botSpineRig.skeleton.drawOrder.map(s => s.data.name);
    let bone = botSpineRig.bones.upper_arm_l;
    return order.indexOf('upper_arm_l') > order.indexOf('torso') && bone.scaleY === 1 && Math.abs(bone.rotation) < 5;
  });
  await expect.poll(isArmNormal).toBe(true);
  await modal.locator('#bot-service-close').click();
  await expect(modal).not.toHaveClass(/open/);
  await expect(mascot).toHaveAttribute('data-time-period', 'day');
  await expect(mascot).toHaveAttribute('data-spine-mood', 'idle');
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
});

test('comic assistant cloud artwork mirrors without mirroring text', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const result = await page.evaluate(() => {
    const bubble = document.querySelector('#bot-comic');
    const text = bubble.querySelector('.bot-comic-text');
    text.textContent = 'Readable on both sides';
    bubble.dataset.placement = 'top';
    bubble.dataset.side = 'right';
    fitBotComicCloud(bubble, 18, .75, 12);
    const path = bubble.querySelector('.bot-comic-shape path');
    const rightPath = path.getAttribute('d');
    const rightText = { value: text.textContent, transform: getComputedStyle(text).transform, parent: text.parentElement.className };
    bubble.dataset.side = 'left';
    fitBotComicCloud(bubble, 18, .25, 12);
    return { rightPath, leftPath: path.getAttribute('d'), pathTransform: path.getAttribute('transform'), artworkTransform: bubble.querySelector('.bot-comic-art').style.transform, text: { value: text.textContent, transform: getComputedStyle(text).transform, parent: text.parentElement.className }, dots: bubble.querySelectorAll('.bot-comic-thought-dot').length };
  });
  expect(result.leftPath).toBe(result.rightPath);
  expect(result.pathTransform).toBeNull();
  expect(result.artworkTransform).toBe('scaleX(-1)');
  expect(result.text.value).toBe('Readable on both sides');
  expect(result.text.parent).toBe('bot-comic');
  expect(result.text.transform).not.toMatch(/matrix\(-1/);
  expect(result.dots).toBe(3);
});

test('comic assistant cloud keeps a usable text area for very long messages on narrow screens', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const bubble = page.locator('#bot-comic');
  const longMessage = 'unbroken-message-'.repeat(45);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 780 });
    const layout = await page.evaluate(message => {
      const bubble = document.querySelector('#bot-comic');
      bubble.dataset.side = 'right';
      bubble.dataset.placement = 'top';
      bubble.querySelector('.bot-comic-text').textContent = message;
      positionBotComic();
      const bounds = bubble.getBoundingClientRect();
      const text = bubble.querySelector('.bot-comic-text');
      const textBounds = text.getBoundingClientRect();
      return { fit: bubble.dataset.fit, width: bounds.width, height: bounds.height, textWidth: textBounds.width, padding: getComputedStyle(bubble).padding };
    }, longMessage);
    expect(layout.width).toBeLessThanOrEqual(width - 47);
    expect(layout.height).toBeLessThanOrEqual(732);
    expect(layout.textWidth).toBeGreaterThan(120);
    expect(layout.padding).toMatch(/^22px 26px 40px$/);
    expect(layout.fit).toBe('ok');
    await expect(bubble.locator('.bot-comic-text')).toHaveText(longMessage);
  }
});

test('comic assistant cloud cleanly encloses multi-line messages with actions without overflowing', async ({ page }) => {
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
  await page.evaluate(() => { botComicTouched = true; });
  const bubble = page.locator('#bot-comic');
  const result = await page.evaluate(async () => {
    const bubble = document.querySelector('#bot-comic');
    const msg = I.uk.weightCycleSupport;
    window.nutritionBot.ask(msg, [{ label: I.uk.weightCycleContinue, value: 'continue' }]);
    positionBotComic();
    const bBox = bubble.getBoundingClientRect();
    const tBox = bubble.querySelector('.bot-comic-text').getBoundingClientRect();
    const aBox = bubble.querySelector('.bot-comic-actions').getBoundingClientRect();
    return {
      fit: bubble.dataset.fit,
      requiresAction: bubble.dataset.requiresAction,
      bubbleWidth: bBox.width,
      textWidth: tBox.width,
      actionsWidth: aBox.width
    };
  });
  expect(result.fit).toBe('ok');
  expect(result.requiresAction).toBe('true');
  expect(result.bubbleWidth).toBeGreaterThan(160);
  await expect(bubble.locator('.bot-comic-actions button')).toHaveText(await page.evaluate(() => I.uk.weightCycleContinue));
  await bubble.locator('.bot-comic-actions button').click();
  await expect(bubble).not.toHaveClass(/is-visible/);
});

test('comic assistant message fits, stays until touch, and preview settings are temporary', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  await page.clock.fastForward(1499);
  const bubble = page.locator('#bot-comic');
  await expect(bubble).not.toHaveClass(/is-visible/);
  await page.clock.fastForward(501);
  await expect(bubble).toHaveClass(/is-visible/, { timeout: 5000 });
  const welcome = await page.evaluate(() => ({ text: document.querySelector('#bot-comic .bot-comic-text').textContent, allowed: I.en.botWelcomePolite }));
  expect(welcome.allowed).toHaveLength(8);
  expect(welcome.allowed.some(message => welcome.text.startsWith(message))).toBe(true);
  const uaWelcome = await page.evaluate(() => I.uk.botWelcomePolite);
  expect(uaWelcome).toHaveLength(15);
  const topical = /Україн|ЗСУ|Росій|захисник|стрій|бореться|темряв/iu;
  expect(uaWelcome.slice(0, 10).filter(text => topical.test(text))).toHaveLength(5);
  expect(uaWelcome.slice(10).filter(text => topical.test(text))).toHaveLength(0);
  const fit = await bubble.evaluate(el => {
    const box = el.getBoundingClientRect();
    const path = el.querySelector('.bot-comic-shape path');
    const text = el.querySelector('.bot-comic-text');
    const textMatrix = new DOMMatrixReadOnly(getComputedStyle(text).transform);
    const angle = Math.atan2(textMatrix.b, textMatrix.a);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let textInside = true;
    for (let a = -1; a <= 1; a += .5) {
      for (let b = -1; b <= 1; b += .5) {
        if (Math.abs(a) < 1 && Math.abs(b) < 1) continue;
        const x = a * text.offsetWidth * .24;
        const y = b * text.offsetHeight * .22;
        if (!path.isPointInFill(new DOMPoint(text.offsetLeft + text.offsetWidth / 2 + x * cos - y * sin, text.offsetTop + text.offsetHeight / 2 + x * sin + y * cos))) textInside = false;
      }
    }
    return { withinViewport: box.left >= 0 && box.right <= innerWidth, withinHeight: box.top >= 0 && box.bottom <= innerHeight, textFits: text.scrollWidth <= text.clientWidth + 1, textAngle: angle * 180 / Math.PI, fontSize: getComputedStyle(el).fontSize, side: el.dataset.side, placement: el.dataset.placement, alpha: getComputedStyle(path).fill, cloud: Boolean(path.getAttribute('d')), textInside, hasCloseCross: Boolean(el.querySelector('.bot-comic-close')), sparkCount: el.querySelectorAll('.bot-comic-spark').length, outline: getComputedStyle(path).stroke, thoughtDots: el.querySelectorAll('.bot-comic-thought-dot').length, artworkTransform: el.querySelector('.bot-comic-art').style.transform, bubbleBackground: getComputedStyle(el).backgroundColor, shapeShadow: getComputedStyle(el.querySelector('.bot-comic-shape')).filter };
  });
  expect(fit.withinViewport).toBe(true);
  expect(fit.withinHeight).toBe(true);
  expect(fit.textFits).toBe(true);
  expect(fit.textAngle).toBe(0);
  expect(await bubble.evaluate(el => getComputedStyle(el).maxWidth)).toBe('340px');
  expect(fit.fontSize).toBe('17px');
  expect(fit.alpha).toMatch(/rgba/);
  expect(fit.cloud).toBe(true);
  const outlineArcCount = await bubble.locator('.bot-comic-shape path').getAttribute('d').then(d => (d.match(/A/g) || []).length);
  expect(outlineArcCount).toBeGreaterThanOrEqual(7);
  expect(fit.textInside).toBe(true);
  expect(fit.hasCloseCross).toBe(false);
  expect(fit.sparkCount).toBe(4);
  expect(fit.outline).toBe('rgb(40, 117, 79)');
  expect(fit.side).toBe('right');
  expect(fit.thoughtDots).toBe(3);
  expect(fit.artworkTransform).toBe('');
  expect(fit.bubbleBackground).toBe('rgba(0, 0, 0, 0)');
  expect(fit.shapeShadow).toBe('none');
  await page.evaluate(() => window.nutritionBot.say('Hi!'));
  const shortMessageWidth = await bubble.evaluate(el => el.getBoundingClientRect().width);
  await page.evaluate(() => window.nutritionBot.say('A longer assistant note should use more horizontal space and avoid looking like a narrow column.'));
  const longMessageWidth = await bubble.evaluate(el => el.getBoundingClientRect().width);
  expect(longMessageWidth).toBeGreaterThan(shortMessageWidth + 10);
  expect(longMessageWidth).toBeLessThanOrEqual(364);
  await page.setViewportSize({ width: 390, height: 844 });
  await bubble.evaluate(() => positionBotComic());
  const mobile = await bubble.evaluate(el => { const r=el.getBoundingClientRect(); return { centered: Math.abs(r.left+r.width/2-innerWidth/2)<2, left:r.left,width:r.width,screen:innerWidth }; });
  expect(mobile.centered).toBe(true);
  await page.evaluate(() => { document.querySelector('#bot-comic .bot-comic-text').textContent = 'A short note ✨'; positionBotComic(); });
  await page.locator('#bot-peeker').evaluate(el => { el.classList.add('bot-side-left'); el.style.left='8px'; el.style.right='auto'; positionBotComic(); });
  const leftSide = await bubble.getAttribute('data-side');
  await expect(bubble).toHaveAttribute('data-fit', 'ok');
  expect(leftSide).toBe('left');
  expect(await bubble.locator('.bot-comic-art').evaluate(el => el.style.transform)).toBe('scaleX(-1)');
  const leftOutlineArcCount = await bubble.locator('.bot-comic-shape path').getAttribute('d').then(d => (d.match(/A/g) || []).length);
  expect(leftOutlineArcCount).toBeGreaterThanOrEqual(7);
  await expect(bubble.locator('.bot-comic-shape path')).toHaveAttribute('d', /A/);
  await expect(bubble).toHaveAttribute('data-side', 'left');
  await expect(bubble.locator('.bot-comic-text')).toHaveCSS('--comic-text-angle', '0deg');
  expect(await bubble.locator('.bot-comic-shape').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBe(1);
  const leftBounds = await bubble.evaluate(el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; });
  expect(leftBounds.left).toBeGreaterThanOrEqual(0);
  expect(leftBounds.right).toBeLessThanOrEqual(390);
  expect(leftBounds.top).toBeGreaterThanOrEqual(0);
  expect(leftBounds.bottom).toBeLessThanOrEqual(844);
  await page.evaluate(() => window.nutritionBot.say('This is a much longer assistant message to verify that the entire comic cloud remains within the visible screen area. '.repeat(8), { duration: 60 }));
  await expect.poll(() => bubble.evaluate(el => { const r=el.getBoundingClientRect(); return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight; })).toBe(true);
  await page.evaluate(() => { document.querySelector('#bot-comic .bot-comic-text').textContent = 'A short note ✨'; positionBotComic(); });
  await page.locator('#bot-peeker').evaluate(el => { el.classList.remove('bot-side-left'); el.style.left=''; el.style.right=''; positionBotComic(); });
  const rightSide = await bubble.getAttribute('data-side');
  
  await expect(bubble).toHaveAttribute('data-fit', 'ok');
  expect(rightSide).toBe('right');
  expect(await bubble.locator('.bot-comic-art').evaluate(el => el.style.transform)).toBe('');
  const rightBounds = await bubble.evaluate(el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; });
  expect(rightBounds.left).toBeGreaterThanOrEqual(0);
  expect(rightBounds.right).toBeLessThanOrEqual(390);
  expect(rightBounds.top).toBeGreaterThanOrEqual(0);
  expect(rightBounds.bottom).toBeLessThanOrEqual(844);
  await expect(bubble).toHaveAttribute('data-side', 'right');
  await expect(bubble.locator('.bot-comic-text')).toHaveCSS('--comic-text-angle', '0deg');
  expect(await bubble.locator('.bot-comic-thought-dot').count()).toBe(3);
  await expect(bubble.locator('.bot-comic-shape path')).toHaveAttribute('d', /A/);
  await page.evaluate(() => window.nutritionBot.say('Timer test', { duration: 1 }));
  await page.clock.fastForward(1400);
  await expect(bubble).not.toHaveClass(/is-visible/);
  await page.locator('body').dispatchEvent('pointerdown');
  await expect(bubble).not.toHaveClass(/is-visible/);

  await openView(page, 'settings');
  const title = page.locator('#bot-appearance-title');
  for (let i = 0; i < 5; i++) await title.click();
  const modal = page.locator('#bot-service-modal');
  await expect(modal).toHaveClass(/open/);
  await page.setViewportSize({ width: 390, height: 844 });
  await modal.locator('#bot-comic-preview-toggle').click();
  const preview = page.locator('#bot-comic');
  await expect(preview).toHaveClass(/bot-comic-preview/);
  expect(await preview.evaluate(el => el.parentElement === document.body)).toBe(true);
  const previewGeometry = await page.evaluate(() => { const a=document.querySelector('#bot-comic').getBoundingClientRect(), b=document.querySelector('#bot-peeker').getBoundingClientRect(); return {fixed:getComputedStyle(document.querySelector('#bot-comic')).position,zIndex:+getComputedStyle(document.querySelector('#bot-comic')).zIndex,left:a.left,right:a.right,top:a.top,bottom:a.bottom,nearRobot:Math.abs((a.left+a.right)/2-(b.left+b.right)/2)<200}; });
  expect(previewGeometry.fixed).toBe('fixed');
  expect(previewGeometry.zIndex).toBeGreaterThan(100);
  expect(previewGeometry.left).toBeGreaterThanOrEqual(0);
  expect(previewGeometry.right).toBeLessThanOrEqual(390);
  expect(previewGeometry.top).toBeGreaterThanOrEqual(0);
  expect(previewGeometry.bottom).toBeLessThanOrEqual(844);
  expect(previewGeometry.nearRobot).toBe(true);
  await page.locator('body').dispatchEvent('pointerdown');
  await expect(preview).toHaveClass(/is-visible/);
  await modal.locator('#bot-comic-text').fill('A tiny preview ✨');
  await expect(preview).toHaveText('A tiny preview ✨');
  await modal.locator('#bot-comic-font').evaluate(el => { el.value = '22'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('font-size', '22px');
  await modal.locator('#bot-comic-padding').evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('padding', '22px 26px 40px');
  await modal.locator('#bot-comic-duration').evaluate(el => { el.value = '8'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(modal.locator('#bot-comic-duration-value')).toHaveText('8 s');
  await modal.locator('#bot-comic-alpha').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(preview.locator('.bot-comic-shape path')).toHaveCSS('fill', 'rgba(255, 255, 255, 0.5)');
  await modal.locator('#bot-comic-width').evaluate(el => { el.value = '200'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('max-width', '200px');
  await modal.locator('#bot-comic-radius').evaluate(el => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('--comic-radius', '30px');
  await modal.locator('#bot-comic-border').evaluate(el => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('--comic-border', '4px');
  await modal.locator('#bot-comic-outline').evaluate(el => { el.value = '#28754f'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('--comic-outline', '#28754f');
  await modal.locator('#bot-comic-bg').evaluate(el => { el.value = '#ffeecc'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview.locator('.bot-comic-shape path')).toHaveCSS('fill', 'rgba(255, 238, 204, 0.5)');
  await modal.locator('#bot-comic-color').evaluate(el => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(preview).toHaveCSS('--comic-color', '#123456');
  await modal.locator('#bot-comic-weight').selectOption('600');
  await expect(preview).toHaveCSS('font-weight', '600');
  await modal.locator('#bot-comic-placement').selectOption('bottom');
  await expect(preview).toHaveAttribute('data-placement', 'bottom');
  await modal.locator('#bot-comic-gap').evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await modal.locator('#bot-comic-offset-x').evaluate(el => { el.value = '12'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await modal.locator('#bot-comic-offset-y').evaluate(el => { el.value = '12'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const adjustedBubble = await preview.evaluate(el => { const r=el.getBoundingClientRect(); return {left:r.left,top:r.top}; });
  expect(adjustedBubble.left).toBeGreaterThan(0);
  expect(adjustedBubble.top).toBeGreaterThan(0);
  await modal.locator('#bot-comic-motion').selectOption('float');
  await expect(preview).toHaveAttribute('data-motion', 'float');
  await modal.locator('#bot-comic-dismiss').selectOption('shrink');
  await expect(preview).toHaveAttribute('data-dismiss', 'shrink');
  await modal.locator('#bot-comic-dismiss-test').click();
  await expect(preview).toHaveClass(/is-visible/, { timeout: 2000 });
  await expect(preview.locator('.bot-comic-text')).toHaveCSS('--comic-text-angle', '0deg');
  await expect(preview.locator('.bot-comic-thought-dot')).toHaveCount(3);
  await modal.locator('#bot-service-close').click();
  await expect(modal).not.toHaveClass(/open/);
  await expect(preview).not.toHaveClass(/is-visible/);
  expect(await page.evaluate(() => localStorage.getItem('smartdiet-v1'))).not.toContain('A tiny preview');
  for (let i = 0; i < 5; i++) await title.click();
  await modal.locator('#bot-comic-preview-toggle').click();
  await expect(preview).toHaveText('Hi! 🌿 I’m ready to help you today ✨');
  await expect(preview).toHaveCSS('font-size', '17px');
  await expect(preview).toHaveCSS('--comic-alpha', '0.95');
  await expect(preview).toHaveCSS('--comic-radius', '30px');
  await expect(modal.locator('#bot-comic-padding')).toHaveValue('20');
  await expect(preview).toHaveCSS('padding', '22px 26px 40px');
  await expect(modal.locator('#bot-comic-offset-y')).toHaveValue('35');
  await expect(modal.locator('#bot-comic-placement')).toHaveValue('auto');
  await modal.locator('#bot-service-close').click();
  await page.evaluate(() => window.nutritionBot.say('Saved! 🎉', { duration: 2 }));
  await expect(bubble).toHaveText('Saved! 🎉');
  await page.clock.fastForward(2100);
  await expect(bubble).not.toHaveClass(/is-visible/);
});

test('assistant action message stays until a choice is pressed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  await page.clock.fastForward(4500);
  const bubble = page.locator('#bot-comic');
  await expect(bubble).toHaveClass(/is-visible/);
  await page.evaluate(() => { window.__assistantChoice = window.nutritionBot.ask('Save this choice?', [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }]); });
  await expect(bubble).toContainText('Save this choice?');
  await expect(bubble.locator('.bot-comic-actions button')).toHaveCount(2);
  await page.clock.fastForward(30_000);
  await page.locator('body').dispatchEvent('pointerdown');
  await expect(bubble).toHaveClass(/is-visible/);
  await bubble.locator('.bot-comic-actions button').first().click();
  await expect(bubble).not.toHaveClass(/is-visible/);
  await expect.poll(() => page.evaluate(() => window.__assistantChoice)).toBe('yes');
});

test('putting on and taking off pajamas plays a sparkle transition', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-03T12:00:00') });
  await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
  const mascot = page.locator('#bot-peeker');
  const modal = page.locator('#bot-service-modal');
  await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
  await page.clock.fastForward(3500);
  await openView(page, 'settings');
  const title = page.locator('#bot-appearance-title');
  for (let i = 0; i < 5; i++) await title.click();
  await expect(modal).toHaveClass(/open/);
  await modal.getByRole('button', { name: 'Put on pajamas' }).click();
  await expect(mascot).toHaveClass(/bot-wears-sleepwear/);
  await page.clock.fastForward(200);
  expect(await page.evaluate(() => botSpineRig.pajamaFx?.dir)).toBe('on');
  expect(await page.evaluate(() => botSpineRig.pajamaFx.particles.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => botSpineRig.skeleton.findSlot('pj_cap').color.a)).toBeLessThan(1);
  await page.clock.fastForward(3000);
  expect(await page.evaluate(() => botSpineRig.pajamaFx)).toBeNull();
  expect(await page.evaluate(() => botSpineRig.skeleton.findSlot('pj_cap').color.a)).toBe(1);
  await modal.getByRole('button', { name: 'Take off pajamas' }).click();
  await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
  await page.clock.fastForward(200);
  expect(await page.evaluate(() => botSpineRig.pajamaFx?.dir)).toBe('off');
  expect(await page.evaluate(() => botSpineRig.skeleton.findSlot('pj_cap').attachment?.name ?? null)).toBe('pj_cap');
  await page.clock.fastForward(3000);
  expect(await page.evaluate(() => botSpineRig.pajamaFx)).toBeNull();
  expect(await page.evaluate(() => botSpineRig.skeleton.findSlot('pj_cap').attachment?.name ?? null)).toBeNull();
});

test.describe('Smoke: assistant chat launcher choices', () => {
  test('home hero does not contain Ask Dietitian CTA and assistant chat button opens speech cloud with general and calorie options', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await page.evaluate(() => {
      if (typeof setBotServiceState === 'function') setBotServiceState({ period: 'day', pajamas: false });
      clearTimeout(window.botWelcomeTimer);
      window.botWelcomeTimer = null;
      window.botWelcomeShown = true;
      if (typeof hideBotComic === 'function') hideBotComic(true);
    });
    await expect(page.locator('#view-home .card.hero [data-action="open-ask"]')).toHaveCount(0);

    const mascot = page.locator('#bot-peeker');
    await expect(mascot).toBeVisible();
    await expect(mascot).toHaveClass(/is-arrived/, { timeout: 10000 });
    await mascot.click();

    const chatAction = page.locator('#bot-chat-action-fab');
    await expect(chatAction).toBeVisible();
    await chatAction.click();

    const bubble = page.locator('#bot-comic');
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveClass(/is-visible/);

    const askBtn = page.locator('.bot-comic-actions [data-action="open-ask"]');
    const calcBtn = page.locator('.bot-comic-actions [data-action="open-calc"]');
    await expect(askBtn).toHaveText('Поспілкуватися');
    await expect(calcBtn).toHaveText('Розрахувати калорії');

    await askBtn.click();
    await expect(bubble).not.toHaveClass(/is-visible/);
    await expect(page.locator('#ask-panel')).toHaveClass(/open/);
    await expect(page.locator('#chat-panel')).not.toHaveClass(/open/);
    await page.locator('#ask-close').click();
    await expect(page.locator('#ask-panel')).not.toHaveClass(/open/);
    await expect(mascot).not.toHaveClass(/bot-overlay-hidden/);
    await waitForTransformTransition(mascot);

    await mascot.click();
    await expect(chatAction).toBeVisible();
    await chatAction.click();
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(calcBtn).toBeVisible();
    await calcBtn.click();
    await expect(page.locator('#chat-panel')).toHaveClass(/open/);
    await expect(page.locator('#ask-panel')).not.toHaveClass(/open/);
    await page.locator('#chat-close').click();
    await expect(page.locator('#chat-panel')).not.toHaveClass(/open/);
  });
});

test.describe('Smoke: assistant quiet mode', () => {
  const quietStore = (extra = {}) => ({
    prefs: { ...BASE_PREFS, botMode: 'mascot', botQuiet: true, lang: 'uk', ...extra },
    products: [],
    foods: [],
    weights: [],
  });
  const silenceStartup = (page) => page.evaluate(() => {
    clearTimeout(botWelcomeTimer);
    botWelcomeTimer = null;
    hideBotComic(true);
    localStorage.removeItem('smartdiet-bot-meal-greeting');
  });
  const reopen = (page) => page.evaluate(() => {
    hideBotComic(true);
    botComicTouched = false;
    botWelcomeShown = false;
    botWelcomeScheduled = false;
    scheduleBotWelcome(0);
  });

  test('the settings switch saves the quiet mode and shows it after a reload', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, botMode: 'mascot', lang: 'en' }, foods: [], weights: [] });
    await openView(page, 'settings');
    const sw = page.locator('#pref-bot-quiet');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await page.locator('#save-bot-settings').click();
    await expect.poll(async () => (await readStore(page)).prefs.botQuiet).toBe(true);
    await page.reload();
    await openView(page, 'settings');
    await expect(page.locator('#pref-bot-quiet')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#pref-bot-quiet').click();
    await page.locator('#save-bot-settings').click();
    await expect.poll(async () => (await readStore(page)).prefs.botQuiet).toBe(false);
  });

  test('the welcome shows once per meal time and again only when the next meal time starts', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-24T13:00:00') });
    await openApp(page, quietStore());
    await silenceStartup(page);
    await reopen(page);
    await page.clock.fastForward(3000);
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);

    for (const time of ['2026-11-24T14:00:00', '2026-11-24T15:59:00']) {
      await page.clock.setSystemTime(new Date(time));
      await reopen(page);
      await page.clock.fastForward(3000);
      await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);
    }

    await page.clock.setSystemTime(new Date('2026-11-24T17:00:00'));
    await reopen(page);
    await page.clock.fastForward(3000);
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);

    await page.clock.setSystemTime(new Date('2026-11-24T19:00:00'));
    await reopen(page);
    await page.clock.fastForward(3000);
    await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);

    await page.clock.setSystemTime(new Date('2026-11-25T08:00:00'));
    await reopen(page);
    await page.clock.fastForward(3000);
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
  });

  test('during the night period the assistant does not greet and breakfast starts at 05:00', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-24T02:00:00') });
    await openApp(page, quietStore());
    await silenceStartup(page);
    await reopen(page);
    await page.clock.fastForward(3000);
    await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');

    await page.clock.setSystemTime(new Date('2026-11-24T05:00:00'));
    await reopen(page);
    await page.clock.fastForward(3000);
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
    await page.clock.setSystemTime(new Date('2026-11-24T08:00:00'));
    await reopen(page);
    await page.clock.fastForward(3000);
    await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);
  });

  test('adding food while the assistant sleeps shows no reminder and opens the form', async ({ page }) => {
    await openApp(page, { ...quietStore(), products: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Apple', grams: 100, kcal: 52, protein: 0.3, fat: 0.2, carbs: 14 }] });
    await page.evaluate(() => {
      localStorage.removeItem('smartdiet-sleep-food-reminder');
      clearTimeout(botWelcomeTimer);
      botWelcomeTimer = null;
      botWelcomeShown = true;
      hideBotComic(true);
      setBotServiceState({ period: 'night', pajamas: true });
    });
    await expect.poll(() => page.evaluate(() => botMotion)).toBe('sleeping');
    const meal = page.locator('#home-meals .meal-card').first();
    await meal.locator('.meal-head').click();
    await meal.locator('[data-action="add-food"]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);
  });

  test('plain tips are hidden but dialogs that need an answer still appear', async ({ page }) => {
    await openApp(page, quietStore());
    await silenceStartup(page);
    await page.evaluate(() => { botWelcomeShown = true; });
    await page.evaluate(() => window.nutritionBot.say('Just a tip'));
    await expect(page.locator('#bot-comic')).not.toHaveClass(/is-visible/);
    await page.evaluate(() => { window.nutritionBot.ask('Need your answer', [{ label: 'Yes', value: 'yes' }]); });
    await expect(page.locator('#bot-comic')).toHaveClass(/is-visible/);
    await expect(page.locator('#bot-comic .bot-comic-text')).toHaveText('Need your answer');
  });
});
