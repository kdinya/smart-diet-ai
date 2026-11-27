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


test.describe('Smoke: app user count', () => {
  test('Friends shows the number of app users and lists their nicknames on tap', async ({ page }) => {
    const backend = createBackend();
    backend.tables.profiles.push({ user_id: 'user-empty', friend_code: 'EEEE5555', display_name: '  ' });
    await startAlice(page, backend);
    await openView(page, 'settings');
    await expect(page.locator('#app-users')).toBeVisible();
    await expect(page.locator('#app-users-count')).toHaveText('2');
    await expect(page.locator('#app-users-list')).toBeHidden();
    await page.locator('#app-users-toggle').click();
    await expect(page.locator('#app-users-list')).toContainText('Alice');
    await expect(page.locator('#app-users-list')).toContainText('Bob');
    await expect(page.locator('#app-users-list')).not.toContainText('AAAA2222');
    await page.locator('#app-users-toggle').click();
    await expect(page.locator('#app-users-list')).toBeHidden();
  });

  test('signed-in users record an app open at launch and when returning to the foreground', async ({ page }) => {
    const backend = createBackend();
    await startAlice(page, backend);
    await expect.poll(() => backend.activityEvents.length).toBeGreaterThan(0);
    const initialEvents = backend.activityEvents.length;
    expect(backend.activityEvents[0].user_id).toBe(USERS['alice@example.test']);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => backend.activityEvents.length).toBe(initialEvents + 1);
    expect(backend.activityEvents.at(-1).user_id).toBe(USERS['alice@example.test']);
  });

  test('admins see a localized last app-open time beside every named app user', async ({ page }) => {
    const backend = createBackend();
    const bobOpenedAt = '2026-10-03T08:05:00.000Z';
    backend.tables.profiles[0].last_sign_in_at = '2026-01-02T08:05:00.000Z';
    backend.tables.profiles[1].last_sign_in_at = '2026-01-03T08:05:00.000Z';
    backend.tables.app_open_activity.push({ user_id: 'user-bob', last_opened_at: bobOpenedAt });
    backend.tables.profiles.push(
      { user_id: 'user-charlie', friend_code: 'CCCC4444', display_name: '' },
      { user_id: 'user-empty', friend_code: 'EEEE5555', display_name: '  ' },
    );
    backend.tables.user_profiles.push({ user_id: 'user-charlie', data: { name: 'Charlie' } });
    backend.tables.app_admins.push({ user_id: USERS['alice@example.test'] });
    await startAlice(page, backend);
    await expect.poll(() => backend.activityEvents.length).toBeGreaterThan(0);
    const aliceOpenedAt = backend.tables.app_open_activity.find((row) => row.user_id === USERS['alice@example.test']).last_opened_at;
    await openView(page, 'settings');
    await expect(page.locator('#app-users-count')).toHaveText('3');
    await page.locator('#app-users-toggle').click();

    const englishDates = await page.evaluate(([alice, bob]) => [
      new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(new Date(alice)),
      new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(bob)),
    ], [aliceOpenedAt, bobOpenedAt]);
    const rows = page.locator('#app-users-list .app-user-name');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Alice' })).toContainText(`(${englishDates[0]})`);
    await expect(rows.filter({ hasText: 'Bob' })).toContainText(`(${englishDates[1]})`);
    const bobSignInDate = await page.evaluate(() => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-01-03T08:05:00.000Z')));
    await expect(rows.filter({ hasText: 'Bob' })).not.toContainText(`(${bobSignInDate})`);
    await expect(rows.filter({ hasText: 'Charlie' })).toContainText('(No app opens yet.)');

    await page.selectOption('#pref-lang', 'uk');
    await page.locator('#save-lang').click();
    await page.locator('#app-users-toggle').click();
    await page.locator('#app-users-toggle').click();
    const ukrainianDates = await page.evaluate(([alice, bob]) => [alice, bob].map((value) => {
      const date = new Date(value);
      const now = new Date();
      const today = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
      return new Intl.DateTimeFormat('uk-UA', today ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }), [aliceOpenedAt, bobOpenedAt]);
    await expect(rows.filter({ hasText: 'Alice' })).toContainText(`(${ukrainianDates[0]})`);
    await expect(rows.filter({ hasText: 'Bob' })).toContainText(`(${ukrainianDates[1]})`);
    await expect(rows.filter({ hasText: 'Charlie' })).toContainText('(Застосунок ще не відкривали.)');
  });

  test('Friends opens a popup with the nicknames when there are more than five app users', async ({ page }) => {
    const backend = createBackend();
    for (const name of ['Carol', 'Dave', 'Erin', 'Frank']) backend.tables.profiles.push({ user_id: `u-${name}`, display_name: name, friend_code: `C${name.toUpperCase()}1` });
    await startAlice(page, backend);
    await openView(page, 'settings');
    await expect(page.locator('#app-users-count')).toHaveText('6');
    await page.locator('#app-users-toggle').click();
    await expect(page.locator('#app-users-modal')).toHaveClass(/open/);
    await expect(page.locator('#app-users-modal-list')).toContainText('Dave');
    await expect(page.locator('#app-users-list')).toBeHidden();
    await page.locator('#app-users-modal-close').click();
    await expect(page.locator('#app-users-modal')).not.toHaveClass(/open/);
  });

  test('the dietitian dialog sits above the assistant and closes other windows when it opens', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    const mascot = page.locator('#bot-peeker');
    await expect(mascot).toHaveAttribute('data-spine-ready', 'true', { timeout: 10000 });
    await mascot.click();
    await expect(page.locator('body')).toHaveClass(/bot-actions-open/);
    await page.evaluate(() => document.getElementById('confirm-modal').classList.add('open'));
    await page.evaluate(() => openAsk());
    await expect(page.locator('#ask-panel')).toHaveClass(/open/);
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/open/);
    await expect(page.locator('body')).not.toHaveClass(/bot-actions-open/);
    await expect(page.locator('#ask-panel')).toHaveCSS('z-index', '300');
  });
});

test.describe('Smoke: first-visit greeting and shared product notice', () => {
  test('assistant remains cheerful and active during daytime hours without pajama transitions', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-03T11:45:00') });
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
    await expect(mascot).toHaveAttribute('data-time-period', 'day');
    await expect(mascot).toHaveAttribute('data-spine-mood', 'idle');
    await expect(mascot).not.toHaveClass(/bot-wears-sleepwear/);
    await expect(zzz).not.toHaveClass(/is-sleeping/);

    for (let i = 0; i < 12; i++) {
      const motion = await page.evaluate(() => nextRandomBotMotion());
      expect(['wave', 'thinking', 'celebration', 'wink', 'nod', 'surprise']).toContain(motion);
      expect(motion).not.toBe('sleepy');
      expect(motion).not.toBe('sad');
      await page.evaluate((m) => setBotMotion(m, 80), motion);
      expect(await mascot.getAttribute('data-time-period')).toBe('day');
      expect(await mascot.evaluate((el) => el.classList.contains('bot-wears-sleepwear'))).toBe(false);
    }
  });

  test('greets a first-time visitor in Ukrainian and English on the setup screen', async ({ page }) => {
    await openApp(page, { prefs: { lang: 'uk' }, foods: [], weights: [] });
    await expect(page.locator('#onboarding-modal')).toHaveClass(/open/);
    await expect(page.locator('#onboarding-choice')).toBeVisible();
    await expect(page.locator('#onboard-intro-hello')).toHaveText('Привіт! · Hello!');
    await expect(page.locator('#onboard-intro-uk')).toContainText('Smart Diet AI допомагає');
    await expect(page.locator('#onboard-intro-en')).toContainText('Smart Diet AI helps you');
  });

  test('announces only the first shared product, keeps it open until a button is pressed, and waits for open dialogs', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    const bubble = page.locator('#bot-comic');
    await page.evaluate(() => {
      localStorage.setItem('smartdiet-share-count-v1', '0');
      friendNames.set('friend-share-1', 'Олена');
      inboxRows = [{ id: 'share-1', from_user: 'friend-share-1', name: 'Яблуко', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14, verified: false, created_at: '2026-11-05T10:00:00.000Z' }];
      announceNewShares();
    });
    await expect(bubble).not.toHaveClass(/is-visible/);
    await page.locator('#greeting').click();
    await expect(bubble).not.toHaveClass(/is-visible/);
    await page.waitForTimeout(1100);
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(bubble.locator('.bot-comic-text')).toHaveText('Олена надсилає тобі продукт «Яблуко».');
    await expect(bubble.locator('.bot-comic-actions button')).toHaveText(['Переглянути', 'Закрити']);
    await expect(page.locator('#bot-comic-dim')).toHaveClass(/is-visible/);
    await bubble.locator('.bot-comic-actions button', { hasText: 'Закрити' }).click();
    await expect(bubble).not.toHaveClass(/is-visible/);

    await page.evaluate(() => {
      inboxRows = [...inboxRows, { ...inboxRows[0], id: 'share-2', name: 'Банан' }];
      announceNewShares();
    });
    await expect(bubble).not.toHaveClass(/is-visible/);
    await expect(page.locator('#bot-comic-dim')).not.toHaveClass(/is-visible/);

    await page.evaluate(() => {
      inboxRows = [];
      announceNewShares();
      inboxRows = [
        { id: 'share-3', from_user: 'friend-share-1', name: 'Груша', grams: 100, kcal: 57, protein: 0, fat: 0, carbs: 15, verified: false, created_at: '2026-11-05T11:00:00.000Z' },
        { id: 'share-4', from_user: 'friend-share-1', name: 'Слива', grams: 100, kcal: 46, protein: 0, fat: 0, carbs: 11, verified: false, created_at: '2026-11-05T11:01:00.000Z' },
      ];
      document.querySelector('#inbox-modal').classList.add('open');
      announceNewShares();
    });
    await expect(bubble).not.toHaveClass(/is-visible/);
    await page.evaluate(() => document.querySelector('#inbox-modal').classList.remove('open'));
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(bubble.locator('.bot-comic-text')).toHaveText('Тобі прийшли нові продукти від друзів: 2.');
    await page.evaluate(() => { user = { id: 'me-share' }; renderInbox(); });
    await bubble.locator('.bot-comic-actions button', { hasText: 'Переглянути' }).click();
    await expect(page.locator('#inbox-modal')).toHaveClass(/open/);
    await expect(page.locator('#inbox-body')).toContainText('Груша');
    await page.locator('#inbox-modal [data-close-inbox]').first().click();
    await expect(bubble).not.toHaveClass(/is-visible/);
  });
});

test.describe('Smoke: friend invite links', () => {
  const inviteToken = '0123456789abcdef012345';

  test('an invite link is stored once and removed from the address bar', async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto(`/?friend-invite=${inviteToken}`);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('smartdiet-friend-invite'))).toBe(inviteToken);
    expect(await page.evaluate(() => location.search)).toBe('');
  });

  test('an incoming friend request appears in the assistant bubble with accept and decline', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => {
      clearTimeout(botWelcomeTimer);
      botWelcomeTimer = null;
      botWelcomeScheduled = false;
      botWelcomeShown = true;
      botComicTouched = true;
      user = { id: 'me-friend' };
      appHasInteracted = true;
      friendNames.set('friend-req-1', 'Olena');
      friendRows = [{ id: 'req-1', requester: 'friend-req-1', addressee: 'me-friend', status: 'pending', created_at: '2026-11-06T10:00:00.000Z' }];
      window.__friendDecisions = [];
      respondFriend = async (id, accept) => { window.__friendDecisions.push([id, accept]); };
      announceFriendRequests();
    });
    const bubble = page.locator('#bot-comic');
    await expect(bubble).toHaveClass(/is-visible/);
    await expect(bubble.locator('.bot-comic-text')).toHaveText('Olena wants to add you as a friend.');
    await expect(bubble.locator('.bot-comic-actions button')).toHaveCount(2);
    await bubble.locator('.bot-comic-actions button').first().click();
    expect(await page.evaluate(() => window.__friendDecisions)).toEqual([['req-1', true]]);
  });

  test('inviting a friend copies a link to the invite when sharing is unavailable', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    const base = await page.evaluate(() => location.origin + location.pathname);
    await page.evaluate((token) => {
      user = { id: 'me-invite' };
      window.__copied = '';
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied = text; } }, configurable: true });
      sb = { rpc: async (name) => ({ data: name === 'create_friend_invite' ? token : null, error: null }) };
    }, inviteToken);
    await page.evaluate(() => inviteFriend());
    await expect.poll(() => page.evaluate(() => window.__copied)).toBe(`${base}?friend-invite=${inviteToken}`);
  });

  test('a stored invite is accepted once after sign-in and then forgotten', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate((token) => {
      localStorage.setItem('smartdiet-friend-invite', token);
      user = { id: 'me-link' };
      window.__inviteCalls = [];
      sb = { rpc: async (name, args) => { window.__inviteCalls.push([name, args]); return { data: 'ok', error: null }; } };
    }, inviteToken);
    await page.evaluate(() => acceptPendingFriendInvite());
    expect(await page.evaluate(() => window.__inviteCalls)).toEqual([['accept_friend_invite', { invite_token: inviteToken }]]);
    expect(await page.evaluate(() => localStorage.getItem('smartdiet-friend-invite'))).toBeNull();
  });
});

test.describe('Smoke: friend invite failures', () => {
  test('a failed invite keeps the Friends block visible', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => {
      user = { id: 'me-missing-fn' };
      sb = { rpc: async () => ({ data: null, error: { message: 'Could not find the function public.create_friend_invite', code: 'PGRST202' } }) };
      renderFriends();
    });
    await page.evaluate(() => inviteFriend());
    await expect(page.locator('#friends-signed')).not.toHaveClass(/hidden/);
  });
});
