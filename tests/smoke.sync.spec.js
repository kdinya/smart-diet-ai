const { test, expect, SUPABASE_URL, PASSWORD, USERS, BASE_PREFS, CORS, base64url, userObject, sessionFor, userIdFromRequest, createBackend, mockSupabase, matchesFilters, SOCIAL_TABLES, FRIEND_CODE, areFriends, handleRequestFriend, SHARE_VALUE_KEYS, handleSocial, handleRest, openApp, readStore, openDietitianChat, openView, connectSupabase, signIn, signOut, setupConfirmWatch, autoConfirm, addFood, foodRow, OLD_FOOD, IMPORT_BACKUP, backupFile, EMPTY_STORE, setDisplayName, startUser, startAlice, openAsUser, befriend, addProduct, shareFirstProductWith, shareFirstProductWithMany, AI_STORE, selectDiaryDate } = require('./smoke.helpers');

test.describe('Smoke: food deletion', () => {
  test('deleting a local entry removes it and the deletion survives reload', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });

    await openView(page, 'diary');
    await addFood(page, 'Smoke rice');

    const dialogs = [];
    await autoConfirm(page, true, dialogs);
    await foodRow(page, 'Smoke rice').locator('[data-delete-food]').click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toBe('Delete “Smoke rice” from the diary (lunch)?');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText(await page.evaluate(() => toastT('deleted')));
    await expect(foodRow(page, 'Smoke rice')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Smoke rice');
    expect((await readStore(page)).foods).toHaveLength(0);
    expect(await page.evaluate(() => syncQueue.delFoods)).toHaveLength(0);
  });

  test('deleting a synced entry removes it from the cloud', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await addFood(page, 'Smoke oats');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    await autoConfirm(page, true);
    await foodRow(page, 'Smoke oats').locator('[data-delete-food]').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText(await page.evaluate(() => toastT('deleted')));
    await expect.poll(() => backend.tables.food_entries.length).toBe(0);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Smoke oats');
  });

  test('a deletion during an in-flight food upload stays deleted after reload', async ({ page }) => {
    const backend = createBackend();
    backend.delayFoodWrites = true;
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    await openView(page, 'diary');
    await addFood(page, 'Race condition oats');
    await expect.poll(() => backend.foodWriteStarted).toBe(true);
    await foodRow(page, 'Race condition oats').locator('[data-delete-food]').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/open/);
    await page.locator('#confirm-ok').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText(await page.evaluate(() => toastT('deleted')));
    backend.foodWriteRelease();
    await expect.poll(() => backend.tables.food_entries.length).toBe(0, { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => syncQueue.delFoods.length)).toBe(0, { timeout: 10000 });
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Race condition oats');
  });

  test('every change while signed in reaches the cloud at once', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await addFood(page, 'Instant rice');
    await expect.poll(() => backend.tables.food_entries.map((row) => row.name)).toEqual(['Instant rice']);

    await foodRow(page, 'Instant rice').locator('[data-edit-food]').first().click();
    await page.fill('#food-name', 'Instant brown rice');
    await page.click('#food-save');
    await expect.poll(() => backend.tables.food_entries.map((row) => row.name)).toEqual(['Instant brown rice']);

    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '71.5');
    await page.click('#weight-save');
    await expect.poll(() => backend.tables.weight_entries.map((row) => Number(row.value))).toEqual([71.5]);

    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '71.2');
    await page.click('#weight-save');
    await expect.poll(() => backend.tables.weight_entries.map((row) => Number(row.value))).toEqual([71.2]);
    expect(backend.tables.weight_entries).toHaveLength(1);
  });

  test('entries and weigh-ins still reach the cloud when the profile cannot be saved', async ({ page }) => {
    const backend = createBackend();
    backend.failProfiles = true;
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await page.fill('#pref-kcal', '1800');
    await page.click('#save-prefs');
    await expect.poll(async () => (await readStore(page)).prefs.kcal).toBe(1800);

    await openView(page, 'diary');
    await addFood(page, 'Buckwheat');
    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '70.4');
    await page.click('#weight-save');

    await expect.poll(() => backend.tables.food_entries.map((row) => row.name)).toEqual(['Buckwheat']);
    await expect.poll(() => backend.tables.weight_entries.map((row) => Number(row.value))).toEqual([70.4]);
    await expect.poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('smartdiet-sync-queue') || '{}'))).foods).toEqual([]);
  });

  test('goals saved on one device are loaded on a fresh device after sign-in', async ({ page, browser }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    await page.fill('#pref-kcal', '1800');
    await page.click('#save-prefs');
    await expect.poll(() => backend.tables.user_profiles.map((row) => row.data.kcal)).toEqual([1800]);

    const other = await browser.newContext({ serviceWorkers: 'block' });
    const second = await other.newPage();
    await mockSupabase(second, backend);
    await openApp(second, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await connectSupabase(second);
    await signIn(second, 'alice@example.test');
    await expect.poll(async () => (await readStore(second)).prefs.kcal).toBe(1800);
    expect(backend.tables.user_profiles[0].data.kcal).toBe(1800);
    await other.close();
  });

  test('profile weight date syncs to the cloud and loads on a fresh device', async ({ page, browser }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    const enteredDate = await page.evaluate(() => iso());
    await openView(page, 'settings');
    await page.fill('#pref-name', 'Weight tester');
    await page.fill('#profile-weight', '97');
    await page.locator('#profile-weight').dispatchEvent('change');
    await page.locator('#profile-weight-date').click();
    await page.locator('#cal-today').click();
    await page.locator('#cal-done').click();
    await page.locator('#save-profile').click();
    await expect.poll(() => backend.tables.user_profiles[0]?.data.currentWeightDate).toBe(enteredDate);

    const other = await browser.newContext({ serviceWorkers: 'block' });
    const second = await other.newPage();
    await mockSupabase(second, backend);
    await openApp(second, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await connectSupabase(second);
    await signIn(second, 'alice@example.test');
    await expect.poll(async () => (await readStore(second)).prefs.currentWeightDate).toBe(enteredDate);
    await other.close();
  });

  test('a new device that was touched before sign-in does not overwrite the saved profile', async ({ page, browser }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    await page.fill('#pref-kcal', '1800');
    await page.click('#save-prefs');
    await expect.poll(() => backend.tables.user_profiles.map((row) => row.data.kcal)).toEqual([1800]);

    const other = await browser.newContext({ serviceWorkers: 'block' });
    const second = await other.newPage();
    await mockSupabase(second, backend);
    await openApp(second, { prefs: { ...BASE_PREFS, updatedAt: new Date(Date.now() + 60000).toISOString() }, foods: [], weights: [] });
    await connectSupabase(second);
    await signIn(second, 'alice@example.test');
    await expect.poll(async () => (await readStore(second)).prefs.kcal).toBe(1800);
    expect(backend.tables.user_profiles[0].data.kcal).toBe(1800);
    await other.close();
  });

  test('RLS profile errors are explained and local changes remain queued', async ({ page }) => {
    const backend = createBackend();
    backend.rlsProfiles = true;
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await page.fill('#pref-kcal', '1800');
    await page.click('#save-prefs');
    await expect(page.locator('#sync-status')).toContainText('access rules do not allow it');
    await expect(page.locator('#sync-status')).not.toContainText('row-level security');
    expect((await readStore(page)).prefs.kcal).toBe(1800);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('smartdiet-sync-queue') || '{}').profile)).toBe(true);
  });

  test('a failed cloud delete keeps the entry and reports the error', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await addFood(page, 'Smoke eggs');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    backend.failDeletes = true;
    await autoConfirm(page, true);
    await foodRow(page, 'Smoke eggs').locator('[data-delete-food]').click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Saved on this device. Cloud sync failed:');
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/open/);
    await expect(foodRow(page, 'Smoke eggs')).toHaveCount(1);
    expect(backend.tables.food_entries).toHaveLength(1);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    expect((await readStore(page)).foods.map((food) => food.name)).toContain('Smoke eggs');
    expect(await page.evaluate(() => syncQueue.delFoods[0]?.food?.name)).toBe('Smoke eggs');
  });
});

test.describe('Smoke: account switching', () => {
  test('data from one account is not uploaded to another and is restored on return', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);

    await signIn(page, 'alice@example.test');
    await openView(page, 'diary');
    await addFood(page, 'Alice breakfast', 'breakfast');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    await signOut(page);
    await autoConfirm(page, false);
    await signIn(page, 'bob@example.test');

    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).not.toContainText('Alice breakfast');
    expect((await readStore(page)).foods).toHaveLength(0);
    expect(backend.tables.food_entries.filter((row) => row.user_id === 'user-bob')).toHaveLength(0);

    const setAside = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('smartdiet-foreign-user-alice-'))
        .map((key) => JSON.parse(localStorage.getItem(key)))
    );
    expect(setAside).toHaveLength(1);
    expect(setAside[0].foods.map((food) => food.name)).toEqual(['Alice breakfast']);

    await signOut(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).toContainText('Alice breakfast');
    const aliceFoods = (await readStore(page)).foods.filter((food) => food.name === 'Alice breakfast');
    expect(aliceFoods).toHaveLength(1);
    expect(backend.tables.food_entries.filter((row) => row.user_id === 'user-alice')).toHaveLength(1);
  });
});

test.describe('Smoke: backup import', () => {
  test('confirmed import replaces local data and keeps it after reload', async ({ page }) => {
    const dialogs = [];
    await autoConfirm(page, true, dialogs);

    await openApp(page, { prefs: BASE_PREFS, foods: [OLD_FOOD], weights: [{ id: 'old-weight', value: 90, date: '2026-10-20' }] });
    await openView(page, 'settings');

    await page.setInputFiles('#import-file', backupFile(IMPORT_BACKUP));

    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('Replace the data on this device');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Imported 2 entries and 1 weigh-ins.');

    const imported = await readStore(page);
    expect(imported.foods.map((food) => food.name).sort()).toEqual(['Imported oatmeal', 'Imported soup']);
    expect(imported.weights.map((weight) => [weight.date, weight.value])).toEqual([['2026-10-24', 80.2]]);
    expect(imported.prefs.kcal).toBe(1800);
    expect(imported.prefs.currentWeightDate).toBe('2026-10-22');
    expect(imported.prefs.name).toBe('Imported');
    expect(imported.prefs.mealActivity['2026-10-24|lunch']).toBe(false);
    expect(imported.prefs.snackPositions['2026-10-24|snack-id']).toEqual({after:'breakfast',order:0});

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    const reloaded = await readStore(page);
    expect(reloaded.foods.map((food) => food.name)).not.toContain('Old local entry');
    expect(reloaded.foods).toHaveLength(2);

    await openView(page, 'settings');
    await expect(page.locator('#pref-kcal')).toHaveValue('1800');
  });

  test('backup import keeps same-name products as copies and restores product history', async ({ page }) => {
    await autoConfirm(page, true);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'settings');
    const backup = {
      ...IMPORT_BACKUP,
      products: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Oats', grams: 100, kcal: 90 },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Oats', grams: 100, kcal: 150 },
      ],
      productHistory: [{ id: 'history-1', at: '2026-10-24T10:00:00.000Z', action: 'created', productId: '11111111-1111-4111-8111-111111111111', name: 'Oats' }],
    };
    await page.setInputFiles('#import-file', backupFile(backup));
    await expect.poll(async () => (await readStore(page)).products.map((product) => [product.name, product.kcal]).sort((a, b) => a[1] - b[1])).toEqual([['Oats', 90], ['Oats copy', 150]]);
    const imported = await readStore(page);
    expect(imported.productHistory.some((entry) => entry.action === 'backup_imported')).toBe(true);
    const productLog = imported.productHistory.filter((entry) => entry.action !== 'backup_imported');
    expect(productLog).toHaveLength(2);
    expect(productLog.map((entry) => entry.name).sort()).toEqual(['Oats', 'Oats copy']);
    await page.reload();
    expect((await readStore(page)).products).toHaveLength(2);
    expect((await readStore(page)).productHistory.filter((entry) => entry.action !== 'backup_imported')).toHaveLength(2);
  });

  test('declining the confirmation keeps the current local data', async ({ page }) => {
    const dialogs = [];
    await autoConfirm(page, false, dialogs);

    await openApp(page, { prefs: BASE_PREFS, foods: [OLD_FOOD], weights: [] });
    await openView(page, 'settings');

    await page.setInputFiles('#import-file', backupFile(IMPORT_BACKUP));

    await expect.poll(() => dialogs.length).toBe(1);
    const stored = await readStore(page);
    expect(stored.foods.map((food) => food.name)).toEqual(['Old local entry']);
    expect(stored.prefs.kcal).toBe(2000);
  });

  test('a file that is not a backup is rejected without changing data', async ({ page }) => {
    const dialogs = [];
    await autoConfirm(page, true, dialogs);

    await openApp(page, { prefs: BASE_PREFS, foods: [OLD_FOOD], weights: [] });
    await openView(page, 'settings');

    await page.setInputFiles('#import-file', backupFile({ hello: 'world' }));
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('This file is not a Smart Diet AI backup.');
    expect(dialogs).toHaveLength(0);
    expect((await readStore(page)).foods.map((food) => food.name)).toEqual(['Old local entry']);

    await page.setInputFiles('#import-file', backupFile('{"foods": [ broken'));
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('This file is not a Smart Diet AI backup.');
    expect(dialogs).toHaveLength(0);

    const stored = await readStore(page);
    expect(stored.foods.map((food) => food.name)).toEqual(['Old local entry']);
    expect(stored.prefs.kcal).toBe(2000);
  });
});

test.describe('Smoke: sign-out and data transfer', () => {
  test('sign out hides the button and shows a status', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await signOut(page);
    await expect(page.locator('#auth-out')).toBeHidden();
    await expect(page.locator('#auth-status')).toContainText('Signed out.');
  });

  test('signed-in state shows the account, hides the form, and survives reload', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await expect(page.locator('#auth-form')).toBeVisible();

    await signIn(page, 'alice@example.test');
    await expect(page.locator('#auth-form')).toBeHidden();
    await expect(page.locator('#auth-signed')).toBeVisible();
    await expect(page.locator('#auth-who')).toContainText('alice@example.test');

    await page.reload();
    await openView(page, 'settings');
    await expect(page.locator('#auth-signed')).toBeVisible();
    await expect(page.locator('#auth-form')).toBeHidden();
    await expect(page.locator('#auth-who')).toContainText('alice@example.test');

    await signOut(page);
    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(page.locator('#auth-signed')).toBeHidden();
  });

  test('accepting the transfer moves local entries into the new account', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);

    await signIn(page, 'alice@example.test');
    await openView(page, 'diary');
    await addFood(page, 'Shared lunch', 'lunch');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    await signOut(page);
    await expect(page.locator('#local-owner')).toContainText('alice@example.test');
    const dialogs = [];
    await autoConfirm(page, true, dialogs);
    await signIn(page, 'bob@example.test');

    await expect.poll(() => dialogs.length).toBe(3);
    expect(dialogs[0]).toContain('alice@example.test');
    expect(dialogs[0]).toContain('bob@example.test');
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).toContainText('Shared lunch');
    await expect.poll(() => backend.tables.food_entries.filter((row) => row.user_id === 'user-bob').length).toBe(1);
    await expect(page.locator('#local-owner')).toContainText('bob@example.test');
  });

  test('declining any confirmation uploads nothing and keeps the data separate', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);

    await signIn(page, 'alice@example.test');
    await openView(page, 'diary');
    await addFood(page, 'Private dinner', 'dinner');
    await expect.poll(() => backend.tables.food_entries.length).toBe(1);

    await signOut(page);
    const asked = [];
    await autoConfirm(page, [true, true, false], asked);
    await signIn(page, 'bob@example.test');

    await expect.poll(() => asked.length).toBe(3);
    expect(backend.tables.food_entries.filter((row) => row.user_id === 'user-bob')).toHaveLength(0);
    expect((await readStore(page)).foods).toHaveLength(0);
    const setAside = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('smartdiet-foreign-user-alice-')).length);
    expect(setAside).toBe(1);
  });
});

test.describe('Smoke: friends', () => {
  test('a request sent by code is accepted by the other person and both see each other', async ({ page, browser }) => {
    const backend = createBackend();
    await startAlice(page, backend);
    await expect(page.locator('#my-friend-code')).toHaveText('AAAA2222');

    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await bob.page.fill('#friend-code-input', 'aaaa2222');
    await bob.page.click('#friend-add');
    await expect(bob.page.locator('#notif-stack .toast-msg').last()).toHaveText(await bob.page.evaluate(() => toastT('friendAdded')));
    await expect(bob.page.locator('#sent-requests')).toContainText('Alice');
    expect(backend.tables.friendships).toMatchObject([{ requester: 'user-bob', addressee: 'user-alice', status: 'pending' }]);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'settings');
    const notice = page.locator('#bot-comic');
    await expect(notice).toContainText('Bob wants to add you as a friend.');
    await notice.locator('.bot-comic-actions button').filter({ hasText: 'Accept' }).click();
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText(await page.evaluate(() => toastT('friendAccepted')));
    await expect(page.locator('#friends-list')).toContainText('Bob');
    expect(backend.tables.friendships[0].status).toBe('accepted');
    await bob.context.close();
  });

  test('unknown codes, own code and repeated requests are reported', async ({ page }) => {
    const backend = createBackend();
    await startAlice(page, backend);
    await expect(page.locator('#my-friend-code')).toHaveText('AAAA2222');

    for (const code of ['ZZZZ9999', 'AAAA2222', 'short']) {
      await page.fill('#friend-code-input', code);
      await page.click('#friend-add');
      await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('User not found.');
      await expect(page.locator('#friend-code-input')).toHaveValue('');
      expect(backend.tables.friendships).toHaveLength(0);
    }

    await page.fill('#friend-code-input', 'BBBB3333');
    await page.click('#friend-add');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText(await page.evaluate(() => toastT('friendAdded')));
    await page.fill('#friend-code-input', 'BBBB3333');
    await page.click('#friend-add');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText(await page.evaluate(() => toastT('friendAlready')));
    expect(backend.tables.friendships).toHaveLength(1);
  });

  test('too many lookups are rate limited', async ({ page }) => {
    const backend = createBackend();
    backend.friendAttempts['user-alice'] = { startedAt: Date.now(), count: 10 };
    await startAlice(page, backend);
    await page.fill('#friend-code-input', 'BBBB3333');
    await page.click('#friend-add');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Too many attempts. Try again later.');
    expect(backend.tables.friendships).toHaveLength(0);
  });

  test('a pending request can be declined, and a friend can be removed', async ({ page, browser }) => {
    const backend = createBackend();
    await startAlice(page, backend);
    backend.tables.friendships.push({ id: 'pending-1', requester: 'user-bob', addressee: 'user-alice', status: 'pending', created_at: new Date().toISOString() });
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'settings');
    const notice = page.locator('#bot-comic');
    await expect(notice).toContainText('Bob wants to add you as a friend.');
    await notice.locator('.bot-comic-actions button').filter({ hasText: 'Decline' }).click();
    await expect(page.locator('#friend-requests')).toContainText('No incoming requests.');
    expect(backend.tables.friendships).toHaveLength(0);

    befriend(backend);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'settings');
    await expect(page.locator('#friends-list')).toContainText('Bob');
    await autoConfirm(page, true);
    await page.click('[data-friend-remove]');
    await expect(page.locator('#friends-list')).toContainText('Add a friend before sharing a product.');
    expect(backend.tables.friendships).toHaveLength(0);
  });
});

test.describe('Smoke: product sharing', () => {
  test('without friends a product cannot be sent', async ({ page }) => {
    const backend = createBackend();
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await page.locator('#products-list [data-toggle-product]').first().click();
    await page.locator('#products-list [data-share-product]').first().click();
    await expect(page.locator('#share-body')).toContainText('Add a friend before sharing a product.');
    await expect(page.locator('#share-confirm')).toBeDisabled();
  });

  test('a sent product reaches the inbox and is added to My products on accept', async ({ page, browser }) => {
    const backend = createBackend();
    befriend(backend);
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await shareFirstProductWith(page, 'Bob');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Product sent.');
    expect(backend.tables.product_shares).toMatchObject([{ from_user: 'user-alice', to_user: 'user-bob', name: 'Oats', kcal: 150 }]);

    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await openView(bob.page, 'products');
    await expect(bob.page.locator('#inbox-open')).toContainText('Inbox (1)');
    await bob.page.click('#inbox-open');
    await expect(bob.page.locator('#inbox-body')).toContainText('Alice');
    await expect(bob.page.locator('#inbox-body')).toContainText('Oats');
    await bob.page.click('[data-share-accept]');
    await expect(bob.page.locator('#share-success-modal')).toHaveClass(/open/);
    await expect(bob.page.locator('#share-success-title')).toHaveText('Product added');
    await expect(bob.page.locator('#share-success-message')).toContainText('Added shared product “Oats” to My products.');
    await expect(bob.page.locator('#share-success-ok')).toHaveText('OK');
    await bob.page.click('#share-success-ok');
    await expect(bob.page.locator('#share-success-modal')).not.toHaveClass(/open/);
    await expect.poll(async () => (await readStore(bob.page)).products.map((item) => item.name)).toEqual(['Oats']);
    expect(backend.tables.product_shares).toHaveLength(0);
    await bob.context.close();
  });

  test('a product can be sent to multiple selected friends at once', async ({ page }) => {
    const backend = createBackend();
    befriend(backend);
    backend.tables.profiles.push({ user_id: 'user-carol', friend_code: 'CCCC4444', display_name: 'Carol' });
    backend.tables.friendships.push({ id: 'friendship-carol', requester: 'user-alice', addressee: 'user-carol', status: 'accepted', created_at: new Date().toISOString() });
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await shareFirstProductWithMany(page, ['Bob', 'Carol']);
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Product sent to 2 friends.');
    expect(backend.tables.product_shares).toHaveLength(2);
    expect(backend.tables.product_shares.map(({ to_user, name, kcal }) => ({ to_user, name, kcal }))).toEqual([
      { to_user: 'user-bob', name: 'Oats', kcal: 150 },
      { to_user: 'user-carol', name: 'Oats', kcal: 150 },
    ]);
  });

  test('a checked product keeps its check mark when shared and accepted', async ({ page, browser }) => {
    const backend = createBackend();
    befriend(backend);
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await page.locator('#products-list [data-toggle-product]').first().click();
    await page.locator('#products-list [data-edit-product]').first().click();
    await page.locator('#product-verified').check();
    await page.click('#food-save');
    await shareFirstProductWith(page, 'Bob');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Product sent.');
    expect(backend.tables.product_shares).toMatchObject([{ name: 'Oats', verified: true }]);

    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await openView(bob.page, 'products');
    await bob.page.click('#inbox-open');
    await bob.page.click('[data-share-accept]');
    await expect.poll(async () => (await readStore(bob.page)).products.map((item) => [item.name, item.verified])).toEqual([['Oats', true]]);
    await bob.context.close();
  });

  test('a declined product is removed from the inbox and not saved', async ({ page, browser }) => {
    const backend = createBackend();
    befriend(backend);
    backend.tables.product_shares.push({ id: 'share-1', from_user: 'user-alice', to_user: 'user-bob', name: 'Oats', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25, created_at: new Date().toISOString() });
    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await openView(bob.page, 'products');
    await bob.page.click('#inbox-open');
    await bob.page.click('[data-share-decline]');
    await expect(bob.page.locator('#notif-stack .toast-msg').last()).toHaveText(await bob.page.evaluate(() => toastT('shareRejected')));
    await expect(bob.page.locator('#inbox-body')).toContainText('No new products.');
    expect(backend.tables.product_shares).toHaveLength(0);
    expect((await readStore(bob.page)).products || []).toHaveLength(0);
    await bob.context.close();
  });

  test('the sender can recall a product that has not been answered yet', async ({ page, browser }) => {
    const backend = createBackend();
    befriend(backend);
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await shareFirstProductWith(page, 'Bob');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Product sent.');

    await openView(page, 'settings');
    await expect(page.locator('#sent-shares')).toContainText('Bob');
    await expect(page.locator('#sent-shares')).toContainText('Oats');
    await page.click('[data-share-recall]');
    await expect(page.locator('#notif-stack .toast-msg').last()).toHaveText(await page.evaluate(() => toastT('shareRecalled')));
    await expect(page.locator('#sent-shares')).toContainText('No sent products.');
    expect(backend.tables.product_shares).toHaveLength(0);

    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await openView(bob.page, 'products');
    await expect(bob.page.locator('#inbox-banner')).toBeHidden();
    await bob.context.close();
  });

  test('the twenty-product limit per friend is reported to the sender', async ({ page }) => {
    const backend = createBackend();
    befriend(backend);
    for (let i = 0; i < 20; i += 1) {
      backend.tables.product_shares.push({ id: `queued-${i}`, from_user: 'user-alice', to_user: 'user-bob', name: `Item ${i}`, grams: 100, kcal: 100, protein: 1, fat: 1, carbs: 1, created_at: new Date().toISOString() });
    }
    await startAlice(page, backend);
    await addProduct(page, 'Oats', '150');
    await shareFirstProductWith(page, 'Bob');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Could not send: this friend already has 20 products waiting in the inbox.');
    expect(backend.tables.product_shares).toHaveLength(20);
  });

  test('an incoming product with a matching name is saved as a copy without replacing the existing product', async ({ page, browser }) => {
    const backend = createBackend();
    befriend(backend);
    backend.tables.product_shares.push({ id: 'share-1', from_user: 'user-alice', to_user: 'user-bob', name: 'Oats', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25, created_at: new Date().toISOString() });
    const bob = await openAsUser(browser, backend, 'bob@example.test', 'Bob');
    await addProduct(bob.page, 'Oats', '90');
    await bob.page.click('#inbox-open');
    await bob.page.click('[data-share-accept]');
    await expect.poll(async () => (await readStore(bob.page)).products.map((item) => item.kcal).sort((a, b) => a - b)).toEqual([90, 150]);
    await expect.poll(async () => (await readStore(bob.page)).products.map((item) => item.name).sort()).toEqual(['Oats', 'Oats copy']);
    const history = (await readStore(bob.page)).productHistory.filter((entry) => entry.action === 'created');
    expect(history.map((entry) => entry.name).sort()).toEqual(['Oats', 'Oats copy']);
    expect(backend.tables.product_shares).toHaveLength(0);
    await bob.context.close();
  });
});

test.describe('Smoke: weigh-in deletion in the cloud', () => {
  test('a weigh-in deleted while its upload is still in flight does not come back', async ({ page }) => {
    const backend = createBackend();
    backend.delayWeightWrites = 1500;
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, currentWeight: 97 }, foods: [], weights: [] });
    await connectSupabase(page);
    await autoConfirm(page, true);
    await signIn(page, 'alice@example.test');

    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '96');
    await page.click('#weight-save');
    await openView(page, 'stats');
    await page.locator('#weight-history [data-delete-weight]').first().click();
    await expect(page.locator('#weight-history')).not.toContainText('96');
    await page.waitForTimeout(2500);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'stats');
    await expect(page.locator('#weight-history')).not.toContainText('96');
    expect(backend.tables.weight_entries).toHaveLength(0);
  });

  test('a deleted weigh-in stays deleted after reload and the profile weight is shown again', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, currentWeight: 97 }, foods: [], weights: [] });
    await connectSupabase(page);
    await autoConfirm(page, true);
    await signIn(page, 'alice@example.test');

    await page.evaluate(() => openModal('weight'));
    await page.fill('#weight-value', '96');
    await page.click('#weight-save');
    await expect.poll(() => backend.tables.weight_entries.map((row) => Number(row.value))).toEqual([96]);

    await openView(page, 'stats');
    await autoConfirm(page, true);
    await page.locator('#weight-history [data-delete-weight]').first().click();
    await expect.poll(() => backend.tables.weight_entries.length).toBe(0);
    await expect(page.locator('#weight-history')).not.toContainText('96');

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await expect.poll(() => backend.tables.weight_entries.length).toBe(0);
    await openView(page, 'stats');
    await expect(page.locator('#weight-history')).not.toContainText('96');
    await openView(page, 'home');
    await expect(page.locator('#home-weight')).toHaveText('97.0');
  });

  test('a weigh-in deleted before a relaunch is not restored from the local safety copy', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: { ...BASE_PREFS, currentWeight: 97 }, foods: [], weights: [{ id: 'safety-96', value: 96, date: '2026-10-24' }] });
    await connectSupabase(page);
    await autoConfirm(page, true);
    await signIn(page, 'alice@example.test');
    await expect.poll(() => backend.tables.weight_entries.length).toBe(1);

    await openView(page, 'stats');
    await autoConfirm(page, true);
    await page.locator('#weight-history [data-delete-weight]').first().click();
    await expect.poll(() => backend.tables.weight_entries.length).toBe(0);
    await expect.poll(async () => (await readStore(page)).weights.length).toBe(0);

    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await expect.poll(() => backend.tables.weight_entries.length).toBe(0);
    await openView(page, 'stats');
    await expect(page.locator('#weight-history')).not.toContainText('96');
    expect((await readStore(page)).weights).toHaveLength(0);
  });
});

test.describe('Smoke: data safety under slow uploads', () => {
  test('an edit made while an upload is in flight is sent after it, not lost', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let held = 0;
    await page.route(/\/rest\/v1\/food_entries/, async (route) => {
      if (route.request().method() === 'POST') {
        held += 1;
        await gate;
      }
      await route.fallback();
    });
    await openView(page, 'diary');
    await addFood(page, 'Draft eggs');
    await expect.poll(() => held).toBe(1);
    await page.evaluate(() => {
      const f = state.foods.find((x) => x.name === 'Draft eggs');
      f.name = 'Final eggs';
      persistFood(f);
      save();
    });
    release();
    await expect.poll(() => backend.tables.food_entries.map((r) => r.name)).toContain('Final eggs');
    await expect.poll(() => page.evaluate(() => syncQueue.foods.length)).toBe(0);
  });
});

test.describe('Smoke: dish ingredients sync', () => {
  test('a composite diary entry survives a cloud error, reload and successful retry', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, products: [{ id: 'dish-oatmeal', name: 'Oatmeal bowl', grams: 160, kcal: 280, protein: 12, fat: 7, carbs: 65, components: [{ id: 'oats', name: 'Oats', grams: 60, kcal: 230, protein: 8, fat: 4, carbs: 40 }, { id: 'milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5 }] }], foods: [], weights: [] });
    await connectSupabase(page);
    await autoConfirm(page, true);
    await signIn(page, 'alice@example.test');
    let failed = false;
    const failOnce = async (route) => {
      if (route.request().method() === 'POST' && !failed) {
        failed = true;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary service error' }) });
        return;
      }
      await route.fallback();
    };
    await page.route(/\/rest\/v1\/food_entries/, failOnce);
    await page.evaluate(() => openMealPicker(state.products.find((product) => product.name === 'Oatmeal bowl')));
    await page.click('#pick-add');
    await expect.poll(() => readStore(page).then((store) => store.foods.some((food) => food.name === 'Oatmeal bowl'))).toBe(true);
    await expect.poll(() => page.evaluate(() => syncQueue.foods.length)).toBe(1);
    await expect.poll(() => failed).toBe(true);

    await page.unroute(/\/rest\/v1\/food_entries/, failOnce);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await expect.poll(() => readStore(page).then((store) => store.foods.some((food) => food.name === 'Oatmeal bowl' && food.components?.length === 2))).toBe(true);
    await expect.poll(() => backend.tables.food_entries.map((row) => row.name)).toContain('Oatmeal bowl');
    expect(backend.tables.food_entries.find((row) => row.name === 'Oatmeal bowl').components.map((component) => component.name)).toEqual(['Oats', 'Milk']);
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals')).toContainText('Oatmeal bowl');
    expect((await readStore(page)).foods[0].components.map((component) => component.name)).toEqual(['Oats', 'Milk']);
  });

  test('selected composite ingredients remain selected after cloud sync and on another device', async ({ page, browser }) => {
    const dish = {
      id: 'dish-selection-sync', name: 'Beet salad', grams: 100, kcal: 130, protein: 4, fat: 12, carbs: 6,
      components: [
        { id: 'mayo-sync', name: 'Mayonnaise', grams: 40, kcal: 100, protein: 1, fat: 10, carbs: 2 },
        { id: 'cream-sync', name: 'Sour cream', grams: 60, kcal: 30, protein: 3, fat: 2, carbs: 4 },
      ],
    };
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, products: [dish], foods: [], weights: [] });
    await connectSupabase(page);
    await autoConfirm(page, true);
    await signIn(page, 'alice@example.test');
    await expect.poll(() => backend.tables.products.find((item) => item.id === dish.id)?.components?.length ?? 0).toBe(2);

    await openView(page, 'products');
    const card = page.locator(`.product-item[data-product-id="${dish.id}"]`);
    await card.locator('[data-toggle-product-components]').click();
    await card.locator('[data-product-component-enabled="mayo-sync"]').uncheck();
    await expect.poll(() => backend.tables.products.find((item) => item.id === dish.id)?.components?.map((item) => item.enabled)).toEqual([false, true]);

    const other = await browser.newContext({ serviceWorkers: 'block' });
    const second = await other.newPage();
    await mockSupabase(second, backend);
    await openApp(second, { prefs: BASE_PREFS, products: [], foods: [], weights: [] });
    await connectSupabase(second);
    await signIn(second, 'alice@example.test');
    await expect.poll(async () => (await readStore(second)).products.find((item) => item.id === dish.id)?.components?.map((item) => item.enabled)).toEqual([false, true]);
    await expect.poll(async () => {
      const product = (await readStore(second)).products.find((item) => item.id === dish.id);
      return product && [product.grams, product.kcal, product.protein, product.fat, product.carbs];
    }).toEqual([60, 30, 3, 2, 4]);
    await other.close();
  });

  test('selected product add-ons persist in Supabase and on another device', async ({ page, browser }) => {
    const milkId = 'milk-companion-sync';
    const coffee = { id: 'coffee-companion-sync', name: 'Coffee', grams: 100, kcal: 2, protein: 0.3, fat: 0, carbs: 0, companions: [{ id: milkId, grams: 50 }] };
    const milk = { id: milkId, name: 'Milk', grams: 100, kcal: 64, protein: 3.3, fat: 3.6, carbs: 4.8 };
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, products: [coffee, milk], foods: [], weights: [] });
    await connectSupabase(page);
    await autoConfirm(page, true);
    await signIn(page, 'alice@example.test');
    await expect.poll(() => backend.tables.products.find((item) => item.id === coffee.id)?.companions?.[0]?.on).toBe(true);
    await openView(page, 'products');
    const card = page.locator(`.product-item[data-product-id="${coffee.id}"]`);
    await card.locator('[data-toggle-product-addons]').click();
    await card.locator(`[data-product-companion-enabled="${milkId}"]`).uncheck();
    await expect.poll(() => backend.tables.products.find((item) => item.id === coffee.id)?.companions).toEqual([{ id: milkId, grams: 50, on: false }]);
    const other = await browser.newContext({ serviceWorkers: 'block' });
    const second = await other.newPage();
    await mockSupabase(second, backend);
    await openApp(second, { prefs: BASE_PREFS, products: [], foods: [], weights: [] });
    await connectSupabase(second);
    await signIn(second, 'alice@example.test');
    await expect.poll(async () => (await readStore(second)).products.find((item) => item.id === coffee.id)?.companions).toEqual([{ id: milkId, grams: 50, on: false }]);
    await other.close();
  });
  test('a synced dish entry without saved ingredients gains the device ingredients and uploads them', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const backend = createBackend();
    backend.tables.food_entries.push({
      id: 'food-merge-1', user_id: 'user-alice', name: 'Oatmeal bowl', meal_type: 'breakfast', grams: 160, kcal: 280,
      protein: 12, fat: 7, carbs: 65, entry_date: today, snack_id: null, meal_order: null, created_at: new Date().toISOString()
    });
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');
    await expect.poll(() => page.evaluate(() => state.foods.some((f) => f.id === 'food-merge-1'))).toBe(true);
    expect(await page.evaluate(() => (state.foods.find((f) => f.id === 'food-merge-1').components || []).length)).toBe(0);

    await page.evaluate(async () => {
      const entry = state.foods.find((f) => f.id === 'food-merge-1');
      entry.components = [
        { id: 'c-oats', name: 'Oats', grams: 60, kcal: 230, protein: 8, fat: 4, carbs: 40 },
        { id: 'c-milk', name: 'Milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5 },
      ];
      await pullRemote();
      runSync();
    });
    await expect.poll(() => page.evaluate(() => (state.foods.find((f) => f.id === 'food-merge-1').components || []).length)).toBe(2);
    await expect.poll(() => backend.tables.food_entries.find((row) => row.id === 'food-merge-1')?.components?.length ?? 0, { timeout: 15000 }).toBe(2);
    expect(backend.tables.food_entries.find((row) => row.id === 'food-merge-1').components.map((c) => c.name)).toEqual(['Oats', 'Milk']);
  });
});
