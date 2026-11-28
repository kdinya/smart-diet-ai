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


test.describe('Smoke: meals, balance layout and weight picker', () => {
  test('a snack can be added and shows up in the diary and on the overview', async ({ page }) => {
    const backend = createBackend();
    await mockSupabase(page, backend);
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await connectSupabase(page);
    await signIn(page, 'alice@example.test');

    await openView(page, 'diary');
    await expect(page.locator('#diary-meals .meal-card')).toHaveCount(4);
    await addFood(page, 'Apple', 'snack');
    await expect.poll(() => backend.tables.food_entries.map((row) => row.meal_type)).toEqual(['snack']);
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 1' })).toHaveCount(1);

    await openView(page, 'home');
    await expect(page.locator('#home-meals .meal-card')).toHaveCount(4);
    await expect(page.locator('#home-meals')).toContainText('Apple');
    await expect(page.locator('#chat-meal')).toHaveCount(0);
  });

  test('multiple snack events are numbered, grouped, and survive reload', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => { window.__testNow = Date.now(); Date.now = () => window.__testNow; window.__advanceTestClock = ms => { window.__testNow += ms; localStorage.setItem('smartdiet-sleep-food-reminder', String(window.__testNow)); localStorage.setItem('smartdiet-sleep-food-morning', String(window.__testNow)); }; });
    await openView(page, 'diary');
    await addFood(page, 'Apple', 'snack');
    let first = page.locator('#diary-meals [data-meal-key*="|snack|"]').first();
    await first.locator('[data-action="add-food"]').click();
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    for (const [id, value] of [['#food-name','Pear'],['#food-grams','100'],['#food-kcal','50'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','12']]) await page.fill(id,value);
    await page.click('#food-save');
    await page.evaluate(() => window.__advanceTestClock(60 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    for (const [id, value] of [['#food-name','Banana'],['#food-grams','100'],['#food-kcal','90'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','23']]) await page.fill(id,value);
    await page.click('#food-save');
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 1' })).toHaveCount(1);
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 2' })).toHaveCount(1);
    const foods = (await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(foods).toHaveLength(3);
    expect(foods[0].snackId).toBe(foods[1].snackId);
    expect(foods[2].snackId).not.toBe(foods[0].snackId);
    await page.reload();
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 1' })).toHaveCount(1);
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Snack 2' })).toHaveCount(1);
  });

  test('meal activity icons toggle totals while preserving food entries', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); });
    await openApp(page, { prefs: BASE_PREFS, foods: [
      { id:'aaaa1111-1111-4111-8111-111111111111', name:'Today oats', meal:'lunch', grams:100, kcal:300, protein:10, fat:5, carbs:50, date:today, createdAt:1 },
      { id:'bbbb2222-2222-4222-8222-222222222222', name:'Tomorrow oats', meal:'lunch', grams:100, kcal:600, protein:20, fat:10, carbs:100, date:tomorrow, createdAt:2 },
    ], weights:[] });
    await openView(page,'diary');
    await page.evaluate(date=>{let input=document.querySelector('#diary-date');input.value=date;input.dispatchEvent(new Event('change'))},tomorrow);
    const future=page.locator('#diary-meals .meal-card').nth(1);
    await expect(future).toHaveClass(/excluded/);
    await expect(future.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'closed');
    await expect(future.locator('.meal-activity-status')).toHaveCount(0);
    const futureHeader = await future.locator('.meal-top').evaluate(el => {
      const eye = el.querySelector('[data-meal-activity]').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el.querySelector('.meal-title'));
      const title = range.getBoundingClientRect();
      return { eyeRight: eye.right, titleLeft: title.left };
    });
    expect(futureHeader.eyeRight).toBeLessThanOrEqual(futureHeader.titleLeft);
    await expect(future.locator('.meal-list')).toContainText('Tomorrow oats');
    await expect(future.locator('.meal-kcal')).toContainText('600 / 700');
    await future.locator('[data-meal-activity]').click();
    await expect(future).not.toHaveClass(/excluded/);
    await expect(future.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await expect(future.locator('.meal-kcal')).toContainText('600 / 700');
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(true);

    const confirmations=[]; await autoConfirm(page,true,confirmations);
    await openView(page,'diary');
    const current=page.locator('#diary-meals .meal-card').nth(1);
    await expect(current.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await current.locator('[data-meal-activity]').click();
    await expect.poll(()=>confirmations.length).toBe(1);
    await expect(current).toHaveClass(/excluded/);
    await expect(current.locator('.meal-list')).toContainText('Today oats');
    await expect(current.locator('.meal-kcal')).toContainText('300 / 700');
    expect((await readStore(page)).prefs.mealActivity[`${today}|lunch`]).toBe(false);
  });

  test('inactive meal keeps its own stats, anchors snacks, and stays excluded after date rollover', async ({ page }) => {
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en', mealActivity: {
      [`${tomorrow}|breakfast`]: true,
      [`${tomorrow}|lunch`]: false,
      [`${tomorrow}|dinner`]: true,
    } }, foods: [
      { id:'aaaa1111-1111-4111-8111-111111111111', name:'Breakfast oats', meal:'breakfast', grams:100, kcal:100, protein:5, fat:2, carbs:15, date:tomorrow, createdAt:100 },
      { id:'bbbb2222-2222-4222-8222-222222222222', name:'Lunch rice', meal:'lunch', grams:100, kcal:600, protein:12, fat:4, carbs:80, date:tomorrow, createdAt:200 },
      { id:'cccc3333-3333-4333-8333-333333333333', name:'Afternoon apple', meal:'snack', grams:100, kcal:80, protein:0, fat:0, carbs:20, date:tomorrow, createdAt:300, snackId:'afternoon-snack' },
      { id:'dddd4444-4444-4444-8444-444444444444', name:'Dinner fish', meal:'dinner', grams:100, kcal:300, protein:25, fat:12, carbs:5, date:tomorrow, createdAt:400 },
    ], weights:[] });
    await openView(page, 'diary');
    await page.evaluate(date => { const input=document.querySelector('#diary-date'); input.value=date; input.dispatchEvent(new Event('change')); }, tomorrow);
    const titles = () => page.locator('#diary-meals .meal-title').allTextContents();
    expect(await titles()).toEqual(['Breakfast', 'Lunch', 'Snack 1', 'Dinner']);
    let lunch = page.locator('#diary-meals .meal-card').nth(1);
    await expect(lunch).toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-kcal')).toContainText('600 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('400');

    const nextDayTime = await page.evaluate(date => new Date(`${date}T12:00:00`).getTime(), tomorrow);
    await page.addInitScript(time => {
      const NativeDate = Date;
      class FixedDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
      }
      Object.defineProperty(window, 'Date', { value: FixedDate });
    }, nextDayTime);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    lunch = page.locator('#diary-meals .meal-card').nth(1);
    await expect(lunch).toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'closed');
    await expect(lunch.locator('.meal-kcal')).toContainText('600 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('480');
    expect(await titles()).toEqual(['Breakfast', 'Lunch', 'Snack 1', 'Dinner']);

    await lunch.locator('[data-meal-activity]').click();
    await expect(lunch).not.toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('1080');
    expect(await titles()).toEqual(['Breakfast', 'Lunch', 'Snack 1', 'Dinner']);
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(true);
  });

  test('food added for tomorrow remains excluded after that date arrives until activated', async ({ page }) => {
    const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toLocaleDateString('en-CA'); });
    const nextDayTime = await page.evaluate(date => new Date(`${date}T12:00:00`).getTime(), tomorrow);
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights:[] });
    await openView(page, 'diary');
    await page.evaluate(date => { const input=document.querySelector('#diary-date'); input.value=date; input.dispatchEvent(new Event('change')); }, tomorrow);
    await page.locator('#diary-meals .meal-card').nth(1).locator('[data-toggle-meal]').click();
    await addFood(page, 'Tomorrow lunch', 'lunch');
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(false);
    await expect(page.locator('#diary-meals .meal-card').nth(1)).toHaveClass(/excluded/);
    await expect(page.locator('#diary-meals .meal-card').nth(1).locator('.meal-kcal')).toContainText('250 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('0');

    await page.addInitScript(time => {
      const NativeDate = Date;
      class FixedDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [time])); }
        static now() { return time; }
      }
      Object.defineProperty(window, 'Date', { value: FixedDate });
    }, nextDayTime);
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'diary');
    const lunch = page.locator('#diary-meals .meal-card').nth(1);
    await expect(lunch).toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'closed');
    await expect(lunch.locator('.meal-kcal')).toContainText('250 / 700');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('0');
    await lunch.locator('[data-meal-activity]').click();
    await expect(lunch).not.toHaveClass(/excluded/);
    await expect(lunch.locator('.meal-activity-icon')).toHaveAttribute('data-eye', 'open');
    await expect(page.locator('#diary-summary .day-total strong').first()).toHaveText('250');
    expect((await readStore(page)).prefs.mealActivity[`${tomorrow}|lunch`]).toBe(true);
  });

  test('past meal activity is always counted and eye controls appear only for today and tomorrow', async ({ page }) => {
    const dates = await page.evaluate(() => {
      const today = new Date();
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      return { today: today.toLocaleDateString('en-CA'), yesterday: yesterday.toLocaleDateString('en-CA'), dayAfterTomorrow: dayAfterTomorrow.toLocaleDateString('en-CA') };
    });
    await openApp(page, { prefs: { ...BASE_PREFS, mealActivity: { [`${dates.yesterday}|lunch`]: false } }, foods: [
      { id:'51515151-5151-4151-8151-515151515151', name:'Вчорашня каша', meal:'lunch', grams:100, kcal:300, protein:10, fat:5, carbs:50, date:dates.yesterday, createdAt:1 },
      { id:'61616161-6161-4161-8161-616161616161', name:'Пізній запис', meal:'lunch', grams:100, kcal:400, protein:15, fat:8, carbs:60, date:dates.dayAfterTomorrow, createdAt:2 },
    ], weights:[] });
    await openView(page, 'diary');
    const selectDiaryDate = async (date) => {
      await page.click('#diary-date');
      while (true) {
        const visibleMonth = (await page.locator('#cal-days .cal-day').first().getAttribute('data-cal-date')).slice(0, 7);
        if (visibleMonth === date.slice(0, 7)) break;
        await page.locator(visibleMonth < date.slice(0, 7) ? '#cal-next' : '#cal-prev').click();
      }
      await page.locator(`[data-cal-date="${date}"]`).click();
      await page.click('#cal-done');
    };
    await selectDiaryDate(dates.yesterday);
    const yesterdayCard = page.locator('#diary-meals .meal-card').nth(1);
    await expect(yesterdayCard.locator('.meal-title')).toContainText('Lunch');
    await expect(yesterdayCard).not.toHaveClass(/excluded/);
    await expect(yesterdayCard.locator('[data-meal-activity]')).toHaveCount(0);
    await expect(yesterdayCard.locator('.meal-kcal')).toContainText('300 / 700');

    await selectDiaryDate(dates.dayAfterTomorrow);
    const futureCard = page.locator('#diary-meals .meal-card').nth(1);
    await expect(futureCard.locator('[data-meal-activity]')).toHaveCount(0);
    await expect(futureCard).toHaveClass(/excluded/);
    await expect(futureCard.locator('.meal-kcal')).toContainText('400 / 700');
  });

  test('snack arrows move a snack across fixed main meals and persist', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page,{prefs:{...BASE_PREFS,lang:'en'},foods:[
      {id:'cccc1111-1111-4111-8111-111111111111',name:'Breakfast food',meal:'breakfast',grams:100,kcal:200,protein:5,fat:3,carbs:30,date:today,createdAt:100,mealOrder:1},
      {id:'dddd2222-2222-4222-8222-222222222222',name:'Snack food',meal:'snack',grams:100,kcal:100,protein:2,fat:1,carbs:20,date:today,createdAt:200,mealOrder:2,snackId:'snack-a'},
      {id:'eeee3333-3333-4333-8333-333333333333',name:'Lunch food',meal:'lunch',grams:100,kcal:300,protein:10,fat:5,carbs:40,date:today,createdAt:300,mealOrder:3},
      {id:'ffff4444-4444-4444-8444-444444444444',name:'Dinner food',meal:'dinner',grams:100,kcal:400,protein:20,fat:8,carbs:50,date:today,createdAt:400,mealOrder:4},
    ],weights:[]});
    await openView(page,'diary');
    const cards=page.locator('#diary-meals .meal-card');
    await expect(cards).toHaveCount(4);
    let titles=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(titles).toEqual(['Breakfast','Snack 1','Lunch','Dinner']);
    const snack=page.locator('#diary-meals [data-meal-key*="|snack|"]').first();
    await snack.locator('[data-snack-move="1"]').click();
    titles=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(titles).toEqual(['Breakfast','Lunch','Snack 1','Dinner']);
    await snack.locator('[data-snack-move="-1"]').click();
    titles=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(titles).toEqual(['Breakfast','Snack 1','Lunch','Dinner']);
    await page.reload();
    await expect(page.locator('#diary-meals .meal-title')).toHaveText(['Breakfast','Snack 1','Lunch','Dinner']);
  });

  test('main meals stay in breakfast-lunch-dinner order when added out of order', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openView(page, 'diary');
    await addFood(page, 'Dinner food', 'dinner');
    await addFood(page, 'Breakfast food', 'breakfast');
    await addFood(page, 'Lunch food', 'lunch');
    const labels=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(labels.indexOf('Сніданок')).toBeLessThan(labels.indexOf('Обід'));
    expect(labels.indexOf('Обід')).toBeLessThan(labels.indexOf('Вечеря'));
    await page.locator('#diary-meals [data-meal="snack"]').first().click();
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    for (const [id, value] of [['#food-name','Snack food'],['#food-grams','100'],['#food-kcal','90'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','23']]) await page.fill(id,value);
    await page.click('#food-save');
    await expect(page.locator('#diary-meals .meal-title').filter({ hasText: 'Перекус 1' })).toHaveCount(1);
    const ordered=await page.locator('#diary-meals .meal-title').allTextContents();
    expect(ordered.indexOf('Сніданок')).toBeLessThan(ordered.indexOf('Обід'));
    expect(ordered.indexOf('Обід')).toBeLessThan(ordered.indexOf('Вечеря'));
    expect(ordered.indexOf('Вечеря')).toBeLessThan(ordered.indexOf('Перекус 1'));
  });

  test('snacks added less than an hour apart share the same snack event', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => { window.__testNow = Date.now(); Date.now = () => window.__testNow; window.__advanceTestClock = ms => { window.__testNow += ms; localStorage.setItem('smartdiet-sleep-food-reminder', String(window.__testNow)); localStorage.setItem('smartdiet-sleep-food-morning', String(window.__testNow)); }; });
    await openView(page, 'diary');
    await addFood(page, 'Apple', 'snack');
    const firstId=(await readStore(page)).foods.find(f=>f.meal==='snack').snackId;
    await page.evaluate(() => window.__advanceTestClock(59 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    for (const [id, value] of [['#food-name','Pear'],['#food-grams','100'],['#food-kcal','50'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','12']]) await page.fill(id,value);
    await page.click('#food-save');
    let foods=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(foods).toHaveLength(2);
    expect(foods[0].snackId).toBe(firstId);
    expect(foods[1].snackId).toBe(firstId);
    await page.evaluate(() => window.__advanceTestClock(60 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    for (const [id, value] of [['#food-name','Banana'],['#food-grams','100'],['#food-kcal','90'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','23']]) await page.fill(id,value);
    await page.click('#food-save');
    foods=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(foods).toHaveLength(3);
    expect(foods[2].snackId).not.toBe(firstId);
  });

  test('a main meal interrupts the snack hour but an existing snack can still receive food', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await page.evaluate(() => { window.__testNow = Date.now(); Date.now = () => window.__testNow; window.__advanceTestClock = ms => { window.__testNow += ms; localStorage.setItem('smartdiet-sleep-food-reminder', String(window.__testNow)); localStorage.setItem('smartdiet-sleep-food-morning', String(window.__testNow)); }; });
    await openView(page, 'diary');
    await addFood(page, 'Apple', 'snack');
    const firstId=(await readStore(page)).foods.find(f=>f.meal==='snack').snackId;
    await page.evaluate(() => window.__advanceTestClock(15 * 60 * 1000));
    await addFood(page, 'Lunch', 'lunch');
    await page.evaluate(() => window.__advanceTestClock(10 * 60 * 1000));
    await page.locator('#diary-meals [data-new-snack="1"]').click();
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    for (const [id, value] of [['#food-name','Pear'],['#food-grams','100'],['#food-kcal','50'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','12']]) await page.fill(id,value);
    await page.click('#food-save');
    let snacks=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(snacks).toHaveLength(2);
    expect(snacks[0].snackId).toBe(firstId);
    expect(snacks[1].snackId).not.toBe(firstId);
    const firstCard=page.locator(`#diary-meals [data-meal-key*="|snack|${firstId}"]`).first();
    await firstCard.locator('[data-action="add-food"]').click();
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    for (const [id, value] of [['#food-name','Orange'],['#food-grams','100'],['#food-kcal','45'],['#food-protein','1'],['#food-fat','0'],['#food-carbs','11']]) await page.fill(id,value);
    await page.click('#food-save');
    snacks=(await readStore(page)).foods.filter(f=>f.meal==='snack');
    expect(snacks).toHaveLength(3);
    expect(snacks[2].snackId).toBe(firstId);
  });

  test('today balance shows two blocks per row', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const boxes = await page.locator('#view-home .stats .metric').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.querySelector('strong').id, top: Math.round(r.top), left: Math.round(r.left) };
    }));
    expect(boxes.map((b) => b.id)).toEqual(['home-kcal', 'home-protein', 'home-fat', 'home-carbs']);
    expect(boxes[0].top).toBe(boxes[1].top);
    expect(boxes[2].top).toBe(boxes[3].top);
    expect(boxes[2].top).toBeGreaterThan(boxes[0].top);
    expect(boxes[0].left).toBe(boxes[2].left);
  });

  test('diary shows eaten against the daily target, green in range and red well above', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const food = (id, kcal) => ({ id, name: `Item ${id}`, meal: 'lunch', grams: 100, kcal, protein: 10, fat: 70, carbs: 300, date: today, createdAt: Date.now() });
    await openApp(page, {
      prefs: { ...BASE_PREFS, kcal: 2000, protein: 10, fat: 70, carbs: 242 },
      foods: [food('11111111-1111-4111-8111-111111111111', 2000), food('22222222-2222-4222-8222-222222222222', 0)],
      weights: [],
    });
    await openView(page, 'diary');
    const totals = page.locator('#diary-summary .day-total');
    await expect(totals).toHaveCount(4);
    await expect(totals.nth(0)).toContainText('2000/2000');
    await expect(totals.nth(0)).toHaveClass(/ok/);
    await expect(totals.nth(1)).toContainText('20/10');
    await expect(totals.nth(1)).toHaveClass(/over/);
    await expect(totals.nth(2)).toContainText('140/70');
    await expect(totals.nth(2)).toHaveClass(/over/);
    await expect(totals.nth(3)).toContainText('600/242');
    await expect(totals.nth(3)).toHaveClass(/over/);
    const colors = await totals.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
    expect(colors[0]).not.toBe(colors[1]);
  });

  test('diary colors tell apart below, within and above the daily target', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: { ...BASE_PREFS, kcal: 2000, protein: 100, fat: 70, carbs: 242 },
      foods: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Mixed', meal: 'lunch', grams: 100, kcal: 1500, protein: 100, fat: 90, carbs: 300, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await openView(page, 'diary');
    const totals = page.locator('#diary-summary .day-total');
    await expect(totals.nth(0)).toHaveClass(/under/);
    await expect(totals.nth(1)).toHaveClass(/ok/);
    await expect(totals.nth(2)).toHaveClass(/over/);
    await expect(totals.nth(3)).toHaveClass(/high/);
    const colors = await totals.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
    expect(new Set(colors).size).toBe(4);
  });

  test('dietitian has no meal selector and shows meal choice only in add configuration', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openDietitianChat(page);
    await expect(page.locator('#chat-meal')).toHaveCount(0);
    await expect(page.locator('#chat-panel .chat-context select')).toHaveCount(0);
  });

  test('diary info popup explains the colors', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');
    await page.click('#diary-summary [data-day-info]');
    await expect(page.locator('#info-modal')).toHaveClass(/open/);
    await expect(page.locator('#info-body .info-row')).toHaveCount(4);
    await page.click('#info-close');
    await expect(page.locator('#info-modal')).not.toHaveClass(/open/);
  });

  test('AI provider order is saved as soon as it is changed', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'settings');
    for (let i = 0; i < 3; i++) await page.click('.ai-row[data-prov="groq"] [data-ai-move="-1"]');
    await expect.poll(async () => (await readStore(page)).ai.order[0]).toBe('groq');
  });

  test('weight form starts from the latest recorded weight', async ({ page }) => {
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [],
      weights: [
        { id: '44444444-4444-4444-8444-444444444444', value: 82.3, date: '2026-10-01' },
        { id: '55555555-5555-4555-8555-555555555555', value: 80.4, date: '2026-10-20' },
      ],
    });
    await page.evaluate(() => openModal('weight'));
    await expect(page.locator('#weight-value')).toHaveValue('80.4');
  });

  test('dietitian has no separate meal selection control', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const meals = await page.evaluate(() => [8, 12, 15, 16, 21].map((h) => autoMeal(h)));
    expect(meals).toEqual(['breakfast', 'lunch', 'lunch', 'dinner', 'dinner']);
    await openDietitianChat(page);
    await expect(page.locator('#chat-meal')).toHaveCount(0);
  });

  test('dietitian input grows up to five lines and then scrolls', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openDietitianChat(page);
    const input = page.locator('#chat-input');
    const one = (await input.boundingBox()).height;
    await input.fill('1\n2\n3');
    const three = (await input.boundingBox()).height;
    expect(three).toBeGreaterThan(one);
    await input.fill('1\n2\n3\n4\n5\n6\n7\n8');
    const many = (await input.boundingBox()).height;
    expect(many).toBeLessThanOrEqual(133);
    expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(page.locator('#chat-send')).toHaveText('');
  });

  test('overview shows the profile weight until a weight is logged, then the latest one', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, currentWeight: 77 }, foods: [], weights: [] });
    await expect(page.locator('#home-weight')).toHaveText('77.0');
    await page.evaluate(() => {
      state.weights.push({ id: '66666666-6666-4666-8666-666666666666', value: 75.2, date: iso() });
      save();
    });
    await expect(page.locator('#home-weight')).toHaveText('75.2');
  });

  test('a food row expands to show protein, fat and carbs', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: '77777777-7777-4777-8777-777777777777', name: 'Oats', meal: 'breakfast', grams: 200, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await openView(page, 'diary');
    const row = page.locator('#diary-meals .meal-item', { hasText: 'Oats' });
    await expect(row.locator('.meal-detail')).toBeHidden();
    await row.locator('.meal-info').click();
    await expect(row.locator('.meal-detail')).toBeVisible();
    await expect(row.locator('.meal-detail')).toContainText('10');
    await row.locator('.meal-info').click();
    await expect(row.locator('.meal-detail')).toBeHidden();
  });

  test('breakfast, lunch and dinner show eaten against the meal target', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, kcal: 2000, protein: 100, fat: 70, carbs: 242 }, foods: [], weights: [] });
    await openView(page, 'diary');
    const cards = page.locator('#diary-meals .meal-card');
    await expect(cards.nth(0).locator('.meal-kcal')).toContainText('0 / 500');
    await expect(cards.nth(1).locator('.meal-kcal')).toContainText('0 / 700');
    await expect(cards.nth(2).locator('.meal-kcal')).toContainText('0 / 800');
    await expect(cards.nth(3).locator('.meal-kcal')).not.toContainText('/');
  });

  test('a weigh-in can be deleted from the statistics', async ({ page }) => {
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [],
      weights: [
        { id: '88888888-8888-4888-8888-888888888888', value: 82.3, date: '2026-10-01' },
        { id: '99999999-9999-4999-8999-999999999999', value: 80.4, date: '2026-10-20' },
      ],
    });
    await openView(page, 'stats');
    await expect(page.locator('#weight-history .food-row')).toHaveCount(2);
    await autoConfirm(page, true);
    await page.locator('#weight-history [data-delete-weight="2026-10-20"]').click();
    await expect(page.locator('#weight-history .food-row')).toHaveCount(1);
    await expect(page.locator('#weight-history')).not.toContainText('80.4');
  });

  test('meal cards are expanded today, collapsed for other dates, and can be toggled', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    const past = new Date(Date.now() - 3 * 86400000).toLocaleDateString('en-CA');
    const mk = (id, date) => ({ id, name: 'Oats ' + date, meal: 'breakfast', grams: 100, kcal: 300, protein: 10, fat: 5, carbs: 50, date, createdAt: Date.now() });
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [mk('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', today), mk('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', past)],
      weights: [],
    });
    await openView(page, 'diary');
    const first = page.locator('#diary-meals .meal-card').first();
    await expect(first).not.toHaveClass(/collapsed/);
    await expect(first.locator('.meal-item')).toBeVisible();
    await first.locator('.meal-head').click();
    await expect(first).toHaveClass(/collapsed/);
    await expect(first.locator('.meal-item')).toBeHidden();
    await expect(first.locator('.meal-kcal')).toContainText('300');
    await page.evaluate((value) => { const el = document.getElementById('diary-date'); el.value = value; el.dispatchEvent(new Event('change')); }, past);
    await page.locator('#diary-date').dispatchEvent('change');
    await expect(page.locator('#diary-meals .meal-card').first()).toHaveClass(/collapsed/);
    await page.locator('#diary-meals .meal-card').first().locator('.meal-head').click();
    await expect(page.locator('#diary-meals .meal-card').first().locator('.meal-item')).toBeVisible();
  });

  test('delete buttons use a trash icon', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Oats', meal: 'breakfast', grams: 100, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: Date.now() }],
      weights: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', value: 80, date: today }],
    });
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals [data-delete-food] svg')).toHaveCount(1);
    await expect(page.locator('#diary-meals [data-delete-food]')).not.toContainText('✕');
    await openView(page, 'stats');
    await expect(page.locator('#weight-history [data-delete-weight] svg')).toHaveCount(1);
  });

  test('changing personal plan details recalculates the daily calorie recommendation at once', async ({ page }) => {
    await openApp(page, {
      prefs: { ...BASE_PREFS, name: 'Anna', kcal: 1500, sex: 'female', birthDate: '1990-01-01', height: 170, currentWeight: 80, targetWeight: 70, activity: 'low', pace: 20, recommendation: { pace: 20, tdee: 2200 } },
      foods: [],
      weights: [],
    });
    await openView(page, 'settings');
    await expect(page.locator('#pref-kcal')).toHaveValue('1500');
    await page.fill('#profile-weight', '90');
    await page.locator('#profile-weight').press('Tab');
    await expect(page.locator('#pref-kcal')).not.toHaveValue('1500');
    const kcal = await page.locator('#pref-kcal').inputValue();
    await expect(page.locator('#daily-rec-result')).toContainText(kcal);
  });

  test('changing plan details calculates the daily calorie recommendation even without an earlier one', async ({ page }) => {
    await openApp(page, {
      prefs: { ...BASE_PREFS, name: 'Anna', kcal: 2000, sex: 'female', birthDate: '1990-01-01', height: 170, currentWeight: 80, targetWeight: 70, activity: 'low', pace: 20 },
      foods: [],
      weights: [],
    });
    await openView(page, 'settings');
    await page.fill('#profile-weight', '90');
    await page.locator('#profile-weight').press('Tab');
    const kcal = await page.locator('#pref-kcal').inputValue();
    expect(kcal).not.toBe('2000');
    await expect(page.locator('#daily-rec-result')).toContainText(kcal);
  });

  test('low calorie values recalculate macros, but saving stays blocked below the profile minimum', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, sex: 'female' }, foods: [], weights: [] });
    await openView(page, 'settings');
    await page.fill('#pref-kcal', '400');
    await expect(page.locator('#pref-fat')).toHaveValue('12');
    const protein = Number(await page.locator('#pref-protein').inputValue());
    const carbs = Number(await page.locator('#pref-carbs').inputValue());
    expect(Math.abs(4 * protein + 4 * carbs + 9 * 12 - 400)).toBeLessThanOrEqual(5);
    await expect(page.locator('#save-prefs')).toBeDisabled();
    await expect(page.locator('#goal-min-hint')).toContainText('1200');
    await page.fill('#pref-kcal', '1300');
    await expect(page.locator('#save-prefs')).toBeEnabled();
    await page.click('#save-prefs');
    const st = await readStore(page);
    expect(st.prefs.kcal).toBe(1300);
  });

  test('goal buttons explain the recommended and custom targets at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk', sex: 'female' }, foods: [], weights: [] });
    await openView(page, 'settings');
    await expect(page.locator('#save-prefs')).toHaveText('Зберегти власні цілі 🚀');
    await expect(page.locator('#refresh-recommendation')).toHaveText('Перерахувати рекомендовану добову ціль за темпом 🔄');
    await expect(page.locator('[data-i18n="saveGoalsHint"]')).toBeVisible();
    await expect(page.locator('[data-i18n="recalcGoalsHint"]')).toBeVisible();
    const recalcBox = await page.locator('#refresh-recommendation').boundingBox();
    expect(recalcBox.x + recalcBox.width).toBeLessThanOrEqual(360);
  });

  test('editing the weight recalculates calories and macros proportionally', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Oats', meal: 'breakfast', grams: 200, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await openView(page, 'diary');
    await page.locator('#diary-meals [data-edit-food]').first().click();
    await page.fill('#food-grams', '100');
    await expect(page.locator('#food-kcal')).toHaveValue('150');
    await expect(page.locator('#food-protein')).toHaveValue('5');
    await expect(page.locator('#food-fat')).toHaveValue('2.5');
    await expect(page.locator('#food-carbs')).toHaveValue('25');
  });

  test('a diary food can be saved to My products, highlighted, and added back', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Oats', meal: 'breakfast', grams: 200, kcal: 300, protein: 10, fat: 5, carbs: 50, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await openView(page, 'diary');
    const row = page.locator('#diary-meals .meal-item', { hasText: 'Oats' });
    await expect(row).not.toHaveClass(/saved/);
    await row.locator('[data-save-product]').click();
    await expect(page.locator('#diary-meals .meal-item', { hasText: 'Oats' })).toHaveClass(/saved/);
    await openView(page, 'products');
    await expect(page.locator('#products-list')).toContainText('Oats');
    await page.locator('#products-list .product-toggle-main').first().click();
    await page.locator('#products-list [data-add-product]').first().click();
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await expect(page.locator('#pick-dates [data-pick-date="tomorrow"]')).toBeVisible();
    await page.locator('#pick-dates [data-pick-date="today"]').click();
    await page.fill('#pick-grams', '100');
    await page.click('#pick-add');
    await openView(page, 'diary');
    await expect(page.locator('#diary-meals .meal-item', { hasText: 'Oats' })).toHaveCount(2);
    expect((await readStore(page)).foods.map((food) => food.kcal).sort((a, b) => a - b)).toEqual([150, 300]);
  });

  test('a new product can be created and deleted in My products', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'products');
    await page.click('#product-new');
    await page.click('#product-type-simple');
    await page.fill('#food-name', 'Buckwheat');
    await page.fill('#food-kcal', '110');
    await page.click('#food-save');
    await expect(page.locator('#products-list')).toContainText('Buckwheat');
    await page.locator('#products-list .product-toggle-main').first().click();
    const prodDialogs = [];
    await autoConfirm(page, true, prodDialogs);
    await page.locator('#products-list [data-delete-product]').first().click();
    await expect.poll(() => prodDialogs.length).toBe(1);
    expect(prodDialogs[0]).toBe('Delete “Buckwheat” from My products?');
    await expect(page.locator('#products-list')).not.toContainText('Buckwheat');
  });


    test('same-name products are kept as numbered copies and product changes persist in the journal', async ({ page }) => {
    const original = { id: '11111111-1111-4111-8111-111111111111', name: 'Buckwheat', grams: 100, kcal: 110, protein: 4, fat: 1, carbs: 22 };
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products: [original] });
    await openView(page, 'products');
    await page.click('#product-new');
    await page.click('#product-type-simple');
    await page.fill('#food-name', 'Buckwheat');
    await page.fill('#food-grams', '100');
    await page.fill('#food-kcal', '130');
    await page.click('#food-save');

    await expect(page.locator('#products-list .product-name')).toHaveText(['Buckwheat', 'Buckwheat copy']);
    let stored = await readStore(page);
    expect(stored.products).toHaveLength(2);
    expect(stored.products.find((product) => product.id === original.id).kcal).toBe(110);
    expect(stored.productHistory.map((entry) => entry.action)).toEqual(['created']);
    await expect(page.locator('.toast-msg').last()).toContainText('Buckwheat copy');

    await openView(page, 'settings');
    await page.locator('#product-history-open-settings').click();
    await expect(page.locator('#product-history-modal')).toHaveClass(/open/);
    await expect(page.locator('#product-history-list')).toContainText('Created');
    await expect(page.locator('#product-history-list')).toContainText('Buckwheat copy');
    await page.reload();
    await expect(page.locator('#nav:visible, #mobile-nav:visible').first()).toBeVisible();
    await openView(page, 'products');
    await page.locator('#products-list .product-item').nth(1).locator('.product-toggle-main').click();
    await page.locator('#products-list [data-edit-product]').nth(1).click();
    await page.fill('#food-name', 'Buckwheat deluxe');
    await page.click('#food-save');
    stored = await readStore(page);
    expect(stored.productHistory.map((entry) => entry.action)).toEqual(['renamed', 'created']);
    expect(stored.productHistory[0].previousName).toBe('Buckwheat copy');

    await page.locator('#products-list .product-toggle-main').first().click();
    await autoConfirm(page, true);
    await page.locator('#products-list [data-delete-product]').first().click();
    await expect.poll(async () => (await readStore(page)).productHistory[0].action).toBe('deleted');
    await page.reload();
    await openView(page, 'products');
    await openView(page, 'settings');
    await page.locator('#product-history-open-settings').click();
    await expect(page.locator('#product-history-list')).toContainText('Deleted');
    await expect(page.locator('#product-history-list')).toContainText('Buckwheat');
  });

  test('legacy product migration keeps same-name products as localized copies', async ({ page }) => {
    const legacyProducts = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Пангасіус', grams: 100, kcal: 85, protein: 18, fat: 2, carbs: 0 },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Пангасіус', grams: 100, kcal: 90, protein: 19, fat: 2, carbs: 0 },
      { id: '33333333-3333-4333-8333-333333333333', name: 'Пангасіус', grams: 100, kcal: 95, protein: 20, fat: 2, carbs: 0 },
    ];
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk', products: legacyProducts }, foods: [], weights: [] });
    const stored = await readStore(page);
    expect(stored.products.map((product) => product.name).sort()).toEqual(['Пангасіус', 'Пангасіус копія', 'Пангасіус копія 2']);
    expect(stored.products.map((product) => product.id)).toEqual(legacyProducts.map((product) => product.id));
    expect(stored.products.map((product) => product.kcal)).toEqual([85, 90, 95]);
    expect(stored.productHistory.filter((entry) => entry.action === 'created')).toHaveLength(3);
    await page.reload();
    expect((await readStore(page)).products).toHaveLength(3);
    expect((await readStore(page)).productHistory.filter((entry) => entry.action === 'created')).toHaveLength(3);
  });

  test('a failed product write keeps the form open and does not claim the product was saved', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'products');
    await page.click('#product-new');
    await page.click('#product-type-simple');
    await page.fill('#food-name', 'Storage test');
    await page.fill('#food-grams', '100');
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      let failed = false;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'smartdiet-v1' && String(value).includes('Storage test')) { failed = true; throw new DOMException('quota exceeded', 'QuotaExceededError'); }
        return original.call(this, key, value);
      };
    });
    await page.click('#food-save');
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#products-list')).not.toContainText('Storage test');
    await expect(page.locator('.toast-msg').last()).toContainText('Could not save “Storage test”');
    expect((await readStore(page)).products || []).toHaveLength(0);
  });

  test('a failed local diary write keeps the add form open and rolls back the entry', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');
    await page.locator('#diary-meals [data-action="add-food"][data-meal="lunch"]').click();
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
    await page.fill('#food-name', 'Storage test meal');
    await page.fill('#food-grams', '150');
    await page.fill('#food-kcal', '250');
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'smartdiet-v1' && String(value).includes('Storage test meal')) throw new DOMException('quota exceeded', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await page.click('#food-save');
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#diary-meals')).not.toContainText('Storage test meal');
    await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Browser storage is full');
    expect((await readStore(page)).foods || []).toHaveLength(0);
  });

  test('cancelling food deletion preserves the diary entry', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');
    await addFood(page, 'Cancel apple');
    await autoConfirm(page, false);
    await foodRow(page, 'Cancel apple').locator('[data-delete-food]').click();
    await expect(foodRow(page, 'Cancel apple')).toHaveCount(1);
  });

  test('cancelling product deletion preserves the product in My products', async ({ page }) => {
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [],
      weights: [],
      products: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Keep oatmeal', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25 }],
    });
    await openView(page, 'products');
    await page.locator('#products-list .product-toggle-main').first().click();
    await autoConfirm(page, false);
    await page.locator('#products-list [data-delete-product]').first().click();
    await expect(page.locator('#products-list')).toContainText('Keep oatmeal');
  });

  test('saved-product selectors use the My products font size and alphabetical order', async ({ page }) => {
    const products = [
      { id: 'product-z', name: 'Zucchini', grams: 100, kcal: 20, protein: 1, fat: 0, carbs: 4 },
      { id: 'product-b', name: 'Buckwheat', grams: 100, kcal: 110, protein: 4, fat: 1, carbs: 22 },
      { id: 'product-a', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14 },
    ];
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });

    await openView(page, 'products');
    const savedNames = page.locator('#products-list .product-name');
    await expect(savedNames).toHaveText(['Apple', 'Buckwheat', 'Zucchini']);
    await expect(savedNames.first()).toHaveCSS('font-size', '14px');

    await openView(page, 'home');
    await page.locator('#meal-plan-open').click();
    const planNames = page.locator('#meal-plan-products .meal-plan-picker-name');
    await expect(planNames).toHaveText(['Apple', 'Buckwheat', 'Zucchini']);
    await expect(planNames.first()).toHaveCSS('font-size', '14px');
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').first()).toHaveCSS('padding-top', '7px');
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').first()).toHaveCSS('padding-bottom', '7px');
    await page.locator('[data-close-meal-plan]').first().click();

    await page.locator('#view-home .section-head > [data-action="add-food"]').click();
    await page.locator('#pick-product').click();
    const pickerNames = page.locator('#pick-body .pick-item b');
    await expect(pickerNames).toHaveText(['Apple', 'Buckwheat', 'Zucchini']);
    await expect(pickerNames.first()).toHaveCSS('font-size', '14px');
    await expect(page.locator('#pick-body .pick-item').first()).toHaveCSS('padding-top', '8px');
    await expect(page.locator('#pick-body .pick-item').first()).toHaveCSS('padding-bottom', '8px');
    await expect(page.locator('#pick-body .pick-item .muted').first()).toHaveCSS('font-size', '12px');
  });

  test('my products list can be sorted by name, calories, protein, fat, and carbs, defaulting to name', async ({ page }) => {
    const products = [
      { id: 'p-apple', name: 'Apple', grams: 100, kcal: 52, protein: 0.3, fat: 0.2, carbs: 14 },
      { id: 'p-buckwheat', name: 'Buckwheat', grams: 100, kcal: 340, protein: 12, fat: 3, carbs: 70 },
      { id: 'p-cheese', name: 'Cheese', grams: 100, kcal: 350, protein: 25, fat: 28, carbs: 1.5 },
      { id: 'p-avocado', name: 'Avocado', grams: 100, kcal: 160, protein: 2, fat: 15, carbs: 9 },
    ];
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });
    await openView(page, 'products');

    const sortSelect = page.locator('#product-sort');
    await expect(sortSelect).toHaveValue('name');
    const productNames = page.locator('#products-list .product-name');
    await expect(productNames).toHaveText(['Apple', 'Avocado', 'Buckwheat', 'Cheese']);

    await sortSelect.selectOption('kcal');
    await expect(productNames).toHaveText(['Cheese', 'Buckwheat', 'Avocado', 'Apple']);

    await sortSelect.selectOption('protein');
    await expect(productNames).toHaveText(['Cheese', 'Buckwheat', 'Avocado', 'Apple']);

    await sortSelect.selectOption('fat');
    await expect(productNames).toHaveText(['Cheese', 'Avocado', 'Buckwheat', 'Apple']);

    await sortSelect.selectOption('carbs');
    await expect(productNames).toHaveText(['Buckwheat', 'Apple', 'Avocado', 'Cheese']);

    await sortSelect.selectOption('name');
    await expect(productNames).toHaveText(['Apple', 'Avocado', 'Buckwheat', 'Cheese']);
  });

  test('verified products show the same check in each product picker modal', async ({ page }) => {
    const products = [
      { id: 'verified-oats', name: 'Oats', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25, verified: true },
      { id: 'unverified-apple', name: 'Apple', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14, verified: false },
    ];
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });
    const badge = page.locator('.product-verified');

    await openView(page, 'home');
    await page.locator('#meal-plan-open').click();
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').nth(0).locator('.product-verified')).toHaveCount(0);
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').nth(1).locator('.product-verified')).toHaveCount(1);
    await expect(page.locator('#meal-plan-products .meal-plan-picker-item').nth(1).locator('.product-verified')).toHaveAttribute('aria-label', 'Verified product');
    await page.locator('[data-close-meal-plan]').first().click();

    await page.locator('#view-home .section-head > [data-action="add-food"]').click();
    await page.locator('#pick-product').click();
    await expect(page.locator('#pick-body .pick-item').nth(0).locator('.product-verified')).toHaveCount(0);
    await expect(page.locator('#pick-body .pick-item').nth(1).locator('.product-verified')).toHaveCount(1);
    await expect(page.locator('#pick-body .pick-item').nth(1).locator('.product-verified')).toHaveAttribute('aria-label', 'Verified product');
  });

  test('product pickers display protein fat and carbs beside calories', async ({ page }) => {
    const products = [
      { id: 'oats', name: 'Oats', grams: 100, kcal: 150, protein: 5.5, fat: 3.2, carbs: 25.1 },
    ];
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });

    await openView(page, 'home');
    await page.locator('#meal-plan-open').click();
    const planMeta = page.locator('#meal-plan-products .meal-plan-picker-item .meal-plan-picker-meta');
    await expect(planMeta).toBeVisible();
    await expect(planMeta).toContainText('100 g · 150 kcal');
    await expect(planMeta).toContainText('P 5.5 · F 3.2 · C 25.1 g');
    await page.locator('[data-close-meal-plan]').first().click();

    await page.locator('#view-home .section-head > [data-action="add-food"]').click();
    await page.locator('#pick-product').click();
    const pickItemMuted = page.locator('#pick-body .pick-item .muted').first();
    await expect(pickItemMuted).toBeVisible();
    await expect(pickItemMuted).toContainText('100 g · 150 kcal · P 5.5 · F 3.2 · C 25.1 g');
  });

  test('weekly calorie chart renders dashed weight-loss calorie target series and accessible label', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, kcal: 1750 }, foods: [], weights: [] });
    await openView(page, 'stats');

    const chart = page.locator('#calorie-chart');
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute('aria-label', 'Calorie chart');
    await expect(chart.locator('line[stroke-dasharray="7 6"]')).toHaveCount(1);
    await expect(chart.locator('[data-calorie-point]')).toHaveCount(0);
    await expect(page.locator('#calorie-chart-summary')).toContainText('No logged calories');
    await expect(page.locator('[data-i18n="calorieLegendTarget"]')).toBeVisible();
    await expect(page.locator('[data-i18n="calorieLegendIntake"]')).toBeVisible();
  });

  test('food entry modal puts product picker first and hides date for a chosen meal', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    await openView(page, 'diary');

    await page.locator('#diary-meals [data-action="add-food"][data-meal="breakfast"]').click();
    await expect(page.locator('#food-form > #pick-product')).toHaveCount(1);
    await expect(page.locator('#food-date').locator('xpath=..')).toBeHidden();
    await page.locator('#modal-close').click();

    await page.locator('#view-diary .toolbar [data-action="add-food"]').click();
    await expect(page.locator('#food-form > #pick-product')).toHaveCount(1);
    await page.locator('#food-add-manual').click();
    await expect(page.locator('#food-date').locator('xpath=..')).toBeVisible();
  });

  test('reopened dialogs reset scroll without changing product pickers', async ({ page }) => {
    const products = Array.from({ length: 28 }, (_, i) => ({
      id: `scroll-product-${i}`,
      name: `Scroll product ${String(i).padStart(2, '0')}`,
      grams: 100,
      kcal: 120,
      protein: 5,
      fat: 2,
      carbs: 20,
    }));
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [], products });
    await page.setViewportSize({ width: 390, height: 640 });
    await page.evaluate(() => {
      let prototype = HTMLElement.prototype;
      while (prototype && !Object.getOwnPropertyDescriptor(prototype, 'scrollTop')) prototype = Object.getPrototypeOf(prototype);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'scrollTop');
      window.__pickScrollWrites = 0;
      Object.defineProperty(prototype, 'scrollTop', {
        ...descriptor,
        set(value) {
          if (this.closest?.('#pick-modal')) window.__pickScrollWrites += 1;
          return descriptor.set.call(this, value);
        },
      });
    });
    await openView(page, 'diary');

    const addEntry = page.locator('#view-diary .toolbar [data-action="add-food"]');
    const entryModal = page.locator('#modal .modal');
    await addEntry.click();
    await page.locator('#food-add-manual').click();
    await entryModal.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await entryModal.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.locator('#modal-close').click();
    await addEntry.click();
    await expect.poll(() => entryModal.evaluate((el) => el.scrollTop)).toBe(0);

    await page.locator('#pick-product').click();
    await expect(page.locator('#pick-modal .pick-item')).toHaveCount(28);
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    expect(await page.evaluate(() => window.__pickScrollWrites)).toBe(0);
  });

  test('saved products start collapsed and reveal details and actions when toggled', async ({ page }) => {
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [],
      weights: [],
      products: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Oats', grams: 100, kcal: 150, protein: 5, fat: 3, carbs: 25 }],
    });
    await openView(page, 'products');
    const card = page.locator('.product-item');
    await expect(card).toHaveClass(/collapsed/);
    await expect(card.locator('.product-name')).toHaveText('Oats');
    await expect(card.locator('.product-row')).toBeHidden();
    await card.locator('.product-toggle-main').click();
    await expect(card).not.toHaveClass(/collapsed/);
    await expect(card.locator('.product-row')).toBeVisible();
    await expect(card.locator('[data-share-product]')).toBeVisible();
  });

  test('weight is chosen on a scroll wheel on touch devices', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto('/');
    await page.evaluate((data) => localStorage.setItem('smartdiet-v1', JSON.stringify(data)), { prefs: BASE_PREFS, foods: [], weights: [] });
    await page.reload();
    await expect(page.locator('#mobile-nav')).toBeVisible();
    await page.evaluate(() => openModal('weight'));
    await page.locator('#weight-value').click();
    await expect(page.locator('#wheel-back')).toHaveClass(/open/);
    await page.evaluate(() => {
      const [ints, decs] = document.querySelectorAll('#wheel-cols .wheel-col');
      ints.scrollTop = (72 - 30) * 44;
      decs.scrollTop = 5 * 44;
    });
    await page.waitForTimeout(200);
    await page.click('#wheel-done');
    await expect(page.locator('#weight-value')).toHaveValue('72.5');
    await page.click('#weight-save');
    await expect.poll(async () => (await readStore(page)).weights.map((w) => w.value)).toEqual([72.5]);
    await context.close();
  });
});

test.describe('Smoke: today balance', () => {
  test('shows eaten over the daily target with the remainder below in a smaller font', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Rice', meal: 'lunch', grams: 200, kcal: 500, protein: 20, fat: 10, carbs: 80, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await expect(page.locator('#home-kcal')).toHaveText('500');
    await expect(page.locator('#home-kcal-total')).toHaveText('2000');
    await expect(page.locator('#home-kcal-left')).toHaveText('1500');
    await expect(page.locator('#home-protein')).toHaveText('20');
    await expect(page.locator('#home-protein-total')).toHaveText('100');
    await expect(page.locator('#home-protein-left')).toHaveText('80');
    const metric = page.locator('#view-home .stats .metric').first();
    await expect(metric.locator('.left-line')).toContainText('left 1500 kcal');
    const sizes = await metric.evaluate((el) => ({
      main: parseFloat(getComputedStyle(el.querySelector('#home-kcal')).fontSize),
      left: parseFloat(getComputedStyle(el.querySelector('.left-line')).fontSize),
    }));
    expect(sizes.left).toBeLessThan(sizes.main);
    const order = await metric.evaluate((el) => {
      const line = el.querySelector('.left-line').getBoundingClientRect().top;
      return { main: el.querySelector('#home-kcal').getBoundingClientRect().top, line };
    });
    expect(order.line).toBeGreaterThan(order.main);
  });

  test('an overage is shown as over, and the text follows the language', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: { ...BASE_PREFS, lang: 'uk' },
      foods: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Cake', meal: 'snack', grams: 300, kcal: 2400, protein: 10, fat: 90, carbs: 300, date: today, createdAt: Date.now() }],
      weights: [],
    });
    await expect(page.locator('#home-kcal')).toHaveText('2400');
    await expect(page.locator('#home-kcal-total')).toHaveText('2000');
    await expect(page.locator('#home-kcal-left')).toHaveText('400');
    const kcalLine = page.locator('#view-home .stats .metric').first().locator('.left-line');
    await expect(kcalLine).toContainText('400 ккал');
    await expect(kcalLine).toContainText('перебір');
    await expect(kcalLine).toHaveClass(/over/);
  });
});

test.describe('Smoke: calendar', () => {
  test('calendar uses the app style and marks days with saved entries', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, {
      prefs: BASE_PREFS,
      foods: [{ id: '77777777-7777-4777-8777-777777777777', name: 'Calendar pear', meal: 'lunch', grams: 100, kcal: 60, protein: 1, fat: 0, carbs: 15, date: today, createdAt: 1 }],
      weights: [],
    });
    await openView(page, 'diary');
    await page.click('#diary-date');
    await expect(page.locator('#cal-modal')).toHaveClass(/open/);
    await expect(page.locator(`[data-cal-date="${today}"]`)).toHaveClass(/has-entries/);
    await page.locator('#cal-done').click();
    await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);
  });
});

test.describe('Smoke: legacy snack ordering', () => {
  test('old and current snack records share one chronological order when mealOrder is absent or null', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await openApp(page, { prefs: BASE_PREFS, foods: [
      { id: 'old-snack-food', name: 'Old snack', meal: 'snack', grams: 100, kcal: 20, protein: 1, fat: 0, carbs: 3, date: today, createdAt: 1000, mealOrder: null },
      { id: 'new-snack-food', name: 'New snack', meal: 'snack', grams: 100, kcal: 20, protein: 1, fat: 0, carbs: 3, date: today, createdAt: 2000, mealOrder: 9999999999999, snackId: 'new-snack' },
      { id: 'breakfast-anchor', name: 'Breakfast', meal: 'breakfast', grams: 100, kcal: 100, protein: 5, fat: 2, carbs: 10, date: today, createdAt: 500 },
    ], weights: [] });
    const names = await page.evaluate((date) => mealTimeline(date).filter(x => x.type === 'snack').map(x => x.event.foods[0].name), today);
    expect(names).toEqual(['Old snack', 'New snack']);
  });
});

test.describe('Smoke: current date card', () => {
  test('shows weekday on the first row and date with only the day bold on the second row', async ({ page }) => {
    await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
    const date = page.locator('#today-label');
    const expected = await page.evaluate(() => Object.fromEntries(new Intl.DateTimeFormat(lang() === 'uk' ? 'uk-UA' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(new Date()).map((part) => [part.type, part.value])));
    const expectedDateMonth = await page.evaluate(() => new Intl.DateTimeFormat(lang() === 'uk' ? 'uk-UA' : 'en-US', { day: 'numeric', month: 'long' }).format(new Date()));
    await expect(date.locator('.date-weekday')).toHaveText(expected.weekday);
    await expect(date.locator('.date-day-month')).toHaveText(expectedDateMonth);
    await expect(date.locator('.date-day')).toHaveText(expected.day);
    await expect(date.locator('.date-month')).toHaveText(expected.month);
    const layout = await date.evaluate((el) => {
      const weekday = el.querySelector('.date-weekday');
      const dayMonth = el.querySelector('.date-day-month');
      const day = el.querySelector('.date-day');
      const month = el.querySelector('.date-month');
      return {
        weekdayAlign: getComputedStyle(weekday).textAlign,
        dayMonthJustify: getComputedStyle(dayMonth).justifyContent,
        dayFontSize: parseFloat(getComputedStyle(day).fontSize),
        dayFontWeight: parseInt(getComputedStyle(day).fontWeight, 10),
        monthFontSize: parseFloat(getComputedStyle(month).fontSize),
        monthFontWeight: parseInt(getComputedStyle(month).fontWeight, 10),
        weekdayFontSize: parseFloat(getComputedStyle(weekday).fontSize),
        weekdayFontWeight: parseInt(getComputedStyle(weekday).fontWeight, 10),
      };
    });
    expect(layout.weekdayAlign).toBe('right');
    expect(layout.dayMonthJustify).toBe('flex-end');
    expect(layout.dayFontSize).toBeCloseTo(15.4, 1);
    expect(layout.dayFontWeight).toBeGreaterThanOrEqual(700);
    expect(layout.monthFontSize).toBeCloseTo(12.9, 1);
    expect(layout.monthFontWeight).toBeLessThan(700);
    expect(layout.weekdayFontSize).toBeCloseTo(12.9, 1);
    expect(layout.weekdayFontWeight).toBeLessThan(700);

    const bell = page.locator('#notif-bell');
    const headerBoxes = await page.evaluate(() => {
      const bell = document.querySelector('#notif-bell').getBoundingClientRect();
      const date = document.querySelector('#today-label').getBoundingClientRect();
      const title = document.querySelector('#greeting').getBoundingClientRect();
      const header = document.querySelector('.topline').getBoundingClientRect();
      return { bell: { left: bell.left, right: bell.right, top: bell.top, bottom: bell.bottom }, date: { left: date.left, right: date.right, top: date.top, bottom: date.bottom }, title: { left: title.left, right: title.right, top: title.top, bottom: title.bottom }, headerLeft: header.left };
    });
    expect(headerBoxes.bell.right <= headerBoxes.date.left || headerBoxes.date.right <= headerBoxes.bell.left || headerBoxes.bell.bottom <= headerBoxes.date.top || headerBoxes.date.bottom <= headerBoxes.bell.top).toBe(true);
    expect(headerBoxes.date.top).toBeGreaterThanOrEqual(headerBoxes.bell.bottom);
    expect(Math.abs(headerBoxes.bell.right - headerBoxes.date.right)).toBeLessThanOrEqual(1);
    expect(headerBoxes.title.left).toBeCloseTo(headerBoxes.headerLeft, 0);
    expect(headerBoxes.title.right <= headerBoxes.date.left || headerBoxes.date.right <= headerBoxes.title.left || headerBoxes.title.bottom <= headerBoxes.date.top || headerBoxes.date.bottom <= headerBoxes.title.top).toBe(true);
    const hero = page.locator('.hero');
    const dateBottom = await date.evaluate((el) => el.getBoundingClientRect().bottom);
    const heroTop = await hero.evaluate((el) => el.getBoundingClientRect().top);
    expect(dateBottom).toBeLessThanOrEqual(heroTop);

    await page.setViewportSize({ width: 360, height: 780 });
    const mobileWidth = await date.evaluate((el) => el.getBoundingClientRect().width);
    expect(mobileWidth).toBeLessThanOrEqual(360 - 32);
    const mobileDateBottom = await date.evaluate((el) => el.getBoundingClientRect().bottom);
    await expect(page.locator('.mobile-page-intro')).toBeVisible();
    await expect(hero).toBeHidden();
    const mobileBoxes = await page.evaluate(() => {
      const bell = document.querySelector('#notif-bell').getBoundingClientRect();
      const date = document.querySelector('#today-label').getBoundingClientRect();
      const weight = document.querySelector('#weight-badge').getBoundingClientRect();
      const title = document.querySelector('#greeting').getBoundingClientRect();
      const intro = document.querySelector('.mobile-page-intro').getBoundingClientRect();
      const tagline = document.querySelector('.mobile-page-tagline').getBoundingClientRect();
      const description = document.querySelector('.mobile-page-desc');
      const descBox = description.getBoundingClientRect();
      const header = document.querySelector('.topline').getBoundingClientRect();
      return { bell: { left: bell.left, right: bell.right, top: bell.top, bottom: bell.bottom }, date: { left: date.left, right: date.right, top: date.top, bottom: date.bottom }, weight: { left: weight.left, right: weight.right, top: weight.top, bottom: weight.bottom }, title: { left: title.left, right: title.right, top: title.top, bottom: title.bottom }, intro: { left: intro.left, right: intro.right, top: intro.top, bottom: intro.bottom }, tagline: { left: tagline.left, right: tagline.right }, desc: { right: descBox.right, scrollWidth: description.scrollWidth, clientWidth: description.clientWidth }, headerLeft: header.left, headerBottom: header.bottom };
    });
    expect(mobileBoxes.bell.right <= mobileBoxes.date.left || mobileBoxes.date.right <= mobileBoxes.bell.left || mobileBoxes.bell.bottom <= mobileBoxes.date.top || mobileBoxes.date.bottom <= mobileBoxes.bell.top).toBe(true);
    expect(mobileBoxes.date.top).toBeGreaterThanOrEqual(mobileBoxes.bell.bottom);
    expect(Math.abs(mobileBoxes.bell.right - mobileBoxes.date.right)).toBeLessThanOrEqual(1);
    expect(mobileBoxes.title.left).toBeCloseTo(mobileBoxes.headerLeft, 0);
    expect(mobileBoxes.title.right <= mobileBoxes.date.left || mobileBoxes.date.right <= mobileBoxes.title.left || mobileBoxes.title.bottom <= mobileBoxes.date.top || mobileBoxes.date.bottom <= mobileBoxes.title.top).toBe(true);
    expect(mobileBoxes.intro.top).toBeGreaterThanOrEqual(mobileBoxes.title.bottom);
    expect(mobileBoxes.intro.right).toBeLessThanOrEqual(mobileBoxes.date.left);
    expect(mobileBoxes.intro.right).toBeLessThanOrEqual(mobileBoxes.weight.left);
    expect(mobileBoxes.tagline.right).toBeLessThanOrEqual(mobileBoxes.date.left);
    expect(mobileBoxes.desc.right).toBeLessThanOrEqual(mobileBoxes.date.left);
    expect(mobileBoxes.desc.scrollWidth).toBeLessThanOrEqual(mobileBoxes.desc.clientWidth + 1);
    expect(mobileBoxes.headerBottom).toBeGreaterThan(mobileDateBottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});

test('save buttons keep the product and diary labels after a re-render', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
  await page.evaluate(() => openProductModal({ id: 'p-label', name: 'Oats', grams: 100, kcal: 370, protein: 13, fat: 7, carbs: 60 }));
  await page.evaluate(() => render());
  await expect(page.locator('#food-save')).toHaveText(await page.evaluate(() => t('saveProduct')));
  await page.evaluate(() => openModal('food', 'breakfast', { id: 'f-label', name: 'Egg', grams: 50, kcal: 70, protein: 6, fat: 5, carbs: 0, meal: 'breakfast', date: iso() }));
  await page.evaluate(() => render());
  await expect(page.locator('#food-save')).toHaveText(await page.evaluate(() => t('saveChanges')));
});

test('calendar opens above the weight-entry dialog', async ({ page }) => {
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
  await page.locator('[data-action="add-weight"]').click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await page.locator('#weight-date-input').click();
  await expect(page.locator('#cal-modal')).toHaveClass(/open/);
  const zIndexes = await page.evaluate(() => ({ calendar: Number(getComputedStyle(document.querySelector('#cal-modal')).zIndex), entry: Number(getComputedStyle(document.querySelector('#modal')).zIndex) }));
  expect(zIndexes.calendar).toBeGreaterThan(zIndexes.entry);
});

test('calendar highlights meals in diary and only weigh-ins in weight entry', async ({ page }) => {
  const foodDate = '2026-10-25';
  const weightDate = '2026-10-28';
  await page.clock.install({ time: new Date('2026-10-29T12:00:00') });
  await openApp(page, {
    prefs: BASE_PREFS,
    foods: [{ id: 'f-cal-1', name: 'Apple', meal: 'breakfast', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14, date: foodDate, createdAt: 1 }],
    weights: [{ id: 'w-cal-1', value: 72.4, date: weightDate, createdAt: 1 }],
  });

  // 1. Check diary calendar: foodDate is marked, weightDate is NOT marked
  await openView(page, 'diary');
  await page.locator('#diary-date').click();
  await expect(page.locator('#cal-modal')).toHaveClass(/open/);
  await expect(page.locator('#cal-title')).toHaveText('October 2026');
  await expect(page.locator(`[data-cal-date="${foodDate}"]`)).toHaveClass(/has-entries/);
  await expect(page.locator(`[data-cal-date="${weightDate}"]`)).not.toHaveClass(/has-entries/);
  await page.locator('#cal-cancel').click();
  await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);

  // 2. Check weight entry calendar: weightDate is marked, foodDate is NOT marked
  await openView(page, 'home');
  await page.locator('[data-action="add-weight"]').click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await page.locator('#weight-date-input').click();
  await expect(page.locator('#cal-modal')).toHaveClass(/open/);
  await expect(page.locator('#cal-title')).toHaveText('October 2026');
  await expect(page.locator(`[data-cal-date="${weightDate}"]`)).toHaveClass(/has-entries/);
  await expect(page.locator(`[data-cal-date="${foodDate}"]`)).not.toHaveClass(/has-entries/);
  await page.locator('#cal-cancel').click();
  await expect(page.locator('#cal-modal')).not.toHaveClass(/open/);
});

test('diary next-day arrow stays disabled on today when tomorrow has no entries', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00') });
  await openApp(page, { prefs: BASE_PREFS, foods: [], weights: [] });
  await openView(page, 'diary');
  await expect(page.locator('#diary-date')).toHaveValue('2026-10-29');
  await expect(page.locator('#diary-next')).toBeDisabled();
});

test('diary next-day arrow is enabled when tomorrow has entries and disabled again after moving there', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00') });
  await openApp(page, {
    prefs: BASE_PREFS,
    foods: [{ id: 'f-next-1', name: 'Apple', meal: 'breakfast', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14, date: '2026-10-30', createdAt: 1 }],
    weights: [],
  });
  await openView(page, 'diary');
  await expect(page.locator('#diary-date')).toHaveValue('2026-10-29');
  await expect(page.locator('#diary-next')).toBeEnabled();
  await page.locator('#diary-next').click();
  await expect(page.locator('#diary-date')).toHaveValue('2026-10-30');
  await expect(page.locator('#diary-next')).toBeDisabled();
});

test('snack title stays on one line before the expand arrow and analyze button', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.clock.install({ time: new Date('2026-11-05T12:00:00') });
  const today = '2026-11-05';
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk' },
    weights: [],
    foods: [
      { id: 'snack-title-1', name: 'Яблуко', meal: 'snack', grams: 100, kcal: 52, protein: 0, fat: 0, carbs: 14, date: today, createdAt: 1, snackId: 'snack-a' },
      { id: 'snack-title-2', name: 'Банан', meal: 'snack', grams: 100, kcal: 89, protein: 1, fat: 0, carbs: 23, date: today, createdAt: 2, snackId: 'snack-b' },
    ],
  });
  await openView(page, 'diary');
  const title = page.locator('#view-diary .meal-top .meal-head .meal-title', { hasText: 'Перекус 2' }).first();
  await expect(title).toBeVisible();
  expect(await title.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
  const lines = await title.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
  });
  expect(lines).toBe(1);
});

test('adding food defaults to today even when a past diary date was viewed, and announces meal and date', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk' },
    foods: [],
    weights: [],
  });

  // 1. Switch to Diary and select yesterday
  await openView(page, 'diary');
  await selectDiaryDate(page, '2026-11-01');
  await expect(page.locator('#diary-date')).toHaveValue('2026-11-01');

  // 2. Switch back to Home (today) and add food to Snack
  await openView(page, 'home');
  await page.locator('#home-meals [data-toggle-meal]').filter({ hasText: 'Перекус' }).click();
  await page.locator('#home-meals [data-action="add-food"][data-meal="snack"]').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await expect(page.locator('#food-date')).toHaveValue('2026-11-02');
  if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();

  // 3. Fill and save food
  await page.fill('#food-name', 'Яблуко');
  await page.fill('#food-grams', '150');
  await page.fill('#food-kcal', '75');
  await page.locator('#food-save').click();

  // 4. Toast must indicate the meal and today's date
  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Перекус');
  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Сьогодні');

  // 5. Food must be saved under today's date (2026-11-02), not yesterday
  const foods = await page.evaluate(() => state.foods);
  expect(foods).toHaveLength(1);
  expect(foods[0].date).toBe('2026-11-02');
  expect(foods[0].meal).toBe('snack');
});

test('adding food directly from diary retains historical date and announces meal and date in toast', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-02T12:00:00') });
  await openApp(page, {
    prefs: { ...BASE_PREFS, lang: 'uk' },
    foods: [],
    weights: [],
  });

  await openView(page, 'diary');
  await selectDiaryDate(page, '2026-10-25');

  await page.locator('#diary-meals [data-toggle-meal]').filter({ hasText: 'Обід' }).click();
  await page.locator('#diary-meals [data-action="add-food"][data-meal="lunch"]').first().click();
  await expect(page.locator('#modal')).toHaveClass(/open/);
  await expect(page.locator('#food-date')).toHaveValue('2026-10-25');
  if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();

  await page.fill('#food-name', 'Гречка');
  await page.fill('#food-grams', '200');
  await page.fill('#food-kcal', '220');
  await page.locator('#food-save').click();

  await expect(page.locator('#notif-stack .toast-msg').last()).toContainText('Обід');
  const foods = await page.evaluate(() => state.foods);
  expect(foods).toHaveLength(1);
  expect(foods[0].date).toBe('2026-10-25');
  expect(foods[0].meal).toBe('lunch');
});

test.describe('Smoke: food added notice', () => {
  test('the notice names the product, the meal and the date, and the bell keeps the same text', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openView(page, 'diary');
    await addFood(page, 'Огірок', 'lunch');
    const card = page.locator('#notif-stack').getByText('Огірок');
    await expect(card).toContainText('Обід');
    await expect(card).toContainText('Сьогодні');
    await expect.poll(() => page.evaluate(() => notifications[0]?.text || '')).toContain('Огірок');
  });
});

test.describe('Smoke: food entry choice modal', () => {
  test('shows choose from products and manual entry buttons in both Ukrainian and English', async ({ page }) => {
    const products = [
      { id: 'p-apple', name: 'Яблуко', grams: 100, kcal: 52, protein: 0.3, fat: 0.2, carbs: 14 }
    ];
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [], products });

    // Open Add Entry from diary
    await openView(page, 'diary');
    await page.locator('#view-diary .toolbar [data-action="add-food"]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);

    const pickBtn = page.locator('#pick-product');
    const manualBtn = page.locator('#food-add-manual');
    const fields = page.locator('#food-fields');
    const backBtn = page.locator('#food-back-choices');

    // Initial state: choice cards visible, fields hidden, back hidden
    await expect(pickBtn).toBeVisible();
    await expect(manualBtn).toBeVisible();
    await expect(fields).toBeHidden();
    await expect(backBtn).toBeHidden();

    // Ukrainian texts
    await expect(pickBtn).toContainText('Вибрати з моїх продуктів');
    await expect(manualBtn).toContainText('Додати вручну');

    // Check 360px viewport responsiveness
    await page.setViewportSize({ width: 360, height: 640 });
    const modalBox = await page.locator('#modal .modal').boundingBox();
    const pickBox = await pickBtn.boundingBox();
    const manualBox = await manualBtn.boundingBox();
    expect(pickBox.width).toBeLessThanOrEqual(modalBox.width);
    expect(manualBox.width).toBeLessThanOrEqual(modalBox.width);

    // Switch to English and verify labels
    await page.locator('#modal-close').click();
    await openView(page, 'settings');
    await page.selectOption('#pref-lang', 'en');
    await page.locator('#save-lang').click();

    await openView(page, 'diary');
    await page.locator('#view-diary .toolbar [data-action="add-food"]').click();
    await expect(pickBtn).toContainText('Choose from my products');
    await expect(manualBtn).toContainText('Add manually');
  });

  test('choose from products opens product picker, populates form, and allows back navigation', async ({ page }) => {
    const products = [
      { id: 'p-buckwheat', name: 'Гречка відварена', grams: 150, kcal: 180, protein: 6, fat: 2, carbs: 36 }
    ];
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [], products });

    await openView(page, 'diary');
    await page.locator('#diary-meals [data-action="add-food"][data-meal="lunch"]').click();
    await expect(page.locator('#modal')).toHaveClass(/open/);

    // Click pick from products
    await page.locator('#pick-product').click();
    await expect(page.locator('#pick-modal')).toHaveClass(/open/);
    await page.locator('#pick-body [data-pick-product="p-buckwheat"]').click();

    // Now food-fields should be visible and filled
    await expect(page.locator('#food-fields')).toBeVisible();
    await expect(page.locator('#pick-product')).toBeHidden();
    await expect(page.locator('#food-add-manual')).toBeHidden();
    await expect(page.locator('#food-back-choices')).toBeVisible();
    await expect(page.locator('#food-name')).toHaveValue('Гречка відварена');
    await expect(page.locator('#product-calc-search')).toBeHidden();
    await expect(page.locator('#product-import-clipboard')).toBeHidden();

    // Click back to choices
    await page.locator('#food-back-choices').click();
    await expect(page.locator('#food-fields')).toBeHidden();
    await expect(page.locator('#pick-product')).toBeVisible();
    await expect(page.locator('#food-add-manual')).toBeVisible();
    await expect(page.locator('#food-back-choices')).toBeHidden();
  });

  test('manual entry opens form without calorie search or clipboard, and shows option to save to products', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [], products: [] });

    await openView(page, 'diary');
    await page.locator('#diary-meals [data-action="add-food"][data-meal="lunch"]').click();
    await page.locator('#food-add-manual').click();

    await expect(page.locator('#food-fields')).toBeVisible();
    await expect(page.locator('#product-calc-search')).toBeHidden();
    await expect(page.locator('#product-import-clipboard')).toBeHidden();

    // Type a new product name and check "Also save to My products" option
    await page.fill('#food-name', 'Омлет із зеленню');
    await page.dispatchEvent('#food-name', 'input');

    const saveProdLabel = page.locator('#food-save-product-label');
    await expect(saveProdLabel).toBeVisible();
    await expect(saveProdLabel).toContainText('Також зберегти в Мої продукти');
    await expect(page.locator('#product-calc-search')).toBeHidden();
    await expect(page.locator('#product-import-clipboard')).toBeHidden();

    const modal = await page.locator('#modal .modal').boundingBox();
    expect(modal.width).toBeLessThanOrEqual(360);

    await page.locator('#food-save-product').check();
    await page.fill('#food-grams', '180');
    await page.fill('#food-kcal', '240');
    await page.fill('#food-protein', '14');
    await page.fill('#food-fat', '18');
    await page.fill('#food-carbs', '3');

    await page.click('#food-save');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);

    // Verify it is saved in diary
    await expect(page.locator('#diary-meals')).toContainText('Омлет із зеленню');

    // Verify it was also saved to My Products
    await openView(page, 'products');
    await expect(page.locator('#products-list')).toContainText('Омлет із зеленню');
  });

  test("shows Today shortcut button only when viewing another date in diary", async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: "uk" }, foods: [], weights: [] });
    await openView(page, "diary");

    const todayBtn = page.locator("#diary-today");
    // On today, button must be hidden
    await expect(todayBtn).toHaveClass(/hidden/);

    // Navigate to another day via calendar
    await selectDiaryDate(page, "2026-11-01");
    await expect(todayBtn).not.toHaveClass(/hidden/);
    await expect(todayBtn).toBeVisible();
    await expect(todayBtn).toHaveText("Сьогодні");

    // Click Today shortcut button
    await todayBtn.click();
    await expect(todayBtn).toHaveClass(/hidden/);
  });

  test("shows single-portion explanation note before ingredients and add-ons in meal picker and food edit", async ({ page }) => {
    const COMPOSITE = {
      id: "prod-comp-1",
      name: "Буряк з часником",
      grams: 150,
      kcal: 180,
      protein: 4,
      fat: 10,
      carbs: 18,
      components: [
        { id: "comp-1", name: "Буряк варений", grams: 120, kcal: 54, protein: 2, fat: 0.2, carbs: 12, enabled: true },
        { id: "comp-2", name: "Часник", grams: 10, kcal: 15, protein: 0.6, fat: 0.1, carbs: 3, enabled: true },
        { id: "comp-3", name: "Майонез", grams: 20, kcal: 136, protein: 0.2, fat: 15, carbs: 0.6, enabled: true }
      ]
    };
    await openApp(page, { prefs: { ...BASE_PREFS, lang: "uk" }, foods: [], weights: [], products: [COMPOSITE] });

    // 1. In meal picker when selecting a composite dish
    await page.evaluate((comp) => {
      openMealPicker(state.products.find((p) => p.id === comp.id), "lunch");
    }, COMPOSITE);

    await expect(page.locator("#pick-modal")).toHaveClass(/open/);
    await expect(page.locator("#pick-components-field")).toBeVisible();
    const pickNote = page.locator("#pick-components-field .companion-portion-note");
    await expect(pickNote).toBeVisible();
    await expect(pickNote).toContainText("всю страву");

    // Add to lunch
    await page.click("#pick-add");
    await expect(page.locator("#pick-modal")).not.toHaveClass(/open/);
    await openView(page, "diary");
    await expect(page.locator("#diary-meals")).toContainText("Буряк з часником");

    // 2. In edit modal for the logged composite dish
    await page.locator("#diary-meals [data-edit-food]").first().click();
    await expect(page.locator("#modal")).toHaveClass(/open/);
    await expect(page.locator("#food-components-field")).toBeVisible();
    const editNote = page.locator("#food-components-field .companion-portion-note");
    await expect(editNote).toBeVisible();
    await expect(editNote).toContainText("всю страву");
  });
});

test.describe('Smoke: meal buttons in the food dialog', () => {
  async function openManualFoodDialog(page, meal) {
    await openView(page, 'diary');
    await page.locator(`#diary-meals [data-action="add-food"][data-meal="${meal}"]`).click();
    if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
  }

  async function fillAndSave(page, name) {
    for (const [id, value] of [['#food-name', name], ['#food-grams', '100'], ['#food-kcal', '50'], ['#food-protein', '1'], ['#food-fat', '0'], ['#food-carbs', '12']]) await page.fill(id, value);
    await page.click('#food-save');
    await expect(page.locator('#diary-meals')).toContainText(name);
  }

  test('the meal is chosen with buttons, not a dropdown, and starts on the meal whose plus was tapped', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await openManualFoodDialog(page, 'lunch');
    await expect(page.locator('#food-form select, #food-form .dd:has(#food-meal)').filter({ has: page.locator('#food-meal') })).toHaveCount(0);
    await expect(page.locator('#food-meal-buttons [data-food-meal]')).toHaveText(['Breakfast', 'Lunch', 'Dinner', 'Snack']);
    await expect(page.locator('#food-meal-buttons [aria-pressed="true"]')).toHaveText('Lunch');
    await page.locator('#food-meal-buttons [data-food-meal="dinner"]').click();
    await expect(page.locator('#food-meal-buttons [aria-pressed="true"]')).toHaveText('Dinner');
    await expect(page.locator('#food-meal-buttons [aria-pressed="true"]')).toHaveCount(1);
    await fillAndSave(page, 'Soup');
    expect((await readStore(page)).foods.map((f) => [f.name, f.meal])).toEqual([['Soup', 'dinner']]);
  });

  test('every meal can be picked and is saved to that meal', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
      await openView(page, 'diary');
      await page.locator('#view-diary .toolbar [data-action="add-food"]').click();
      if (await page.locator('#food-add-manual').isVisible()) await page.locator('#food-add-manual').click();
      await page.locator(`#food-meal-buttons [data-food-meal="${meal}"]`).click();
      await fillAndSave(page, `Item ${meal}`);
    }
    expect((await readStore(page)).foods.map((f) => [f.name, f.meal])).toEqual([
      ['Item breakfast', 'breakfast'],
      ['Item lunch', 'lunch'],
      ['Item dinner', 'dinner'],
      ['Item snack', 'snack'],
    ]);
  });

  test('editing an entry shows its meal on the buttons and allows moving it', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'en' }, foods: [], weights: [] });
    await openView(page, 'diary');
    await addFood(page, 'Rice', 'lunch');
    await page.locator('#diary-meals [data-edit-food]').first().click();
    await expect(page.locator('#food-meal-buttons [aria-pressed="true"]')).toHaveText('Lunch');
    await page.locator('#food-meal-buttons [data-food-meal="dinner"]').click();
    await page.click('#food-save');
    await expect.poll(async () => (await readStore(page)).foods.map((f) => f.meal)).toEqual(['dinner']);
  });

  test('buttons follow the interface language', async ({ page }) => {
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openManualFoodDialog(page, 'breakfast');
    await expect(page.locator('#food-meal-buttons [data-food-meal]')).toHaveText(['Сніданок', 'Обід', 'Вечеря', 'Перекус']);
    await expect(page.locator('#food-meal-buttons [aria-pressed="true"]')).toHaveText('Сніданок');
  });

  test('buttons fit the dialog at 360px without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openApp(page, { prefs: { ...BASE_PREFS, lang: 'uk' }, foods: [], weights: [] });
    await openManualFoodDialog(page, 'dinner');
    const fit = await page.evaluate(() => {
      const modal = document.querySelector('#modal .modal').getBoundingClientRect();
      const boxes = [...document.querySelectorAll('#food-meal-buttons [data-food-meal]')].map((b) => b.getBoundingClientRect());
      return {
        count: boxes.length,
        inside: boxes.every((r) => r.left >= modal.left - 1 && r.right <= modal.right + 1),
        tall: boxes.every((r) => r.height >= 36),
        pageScroll: document.documentElement.scrollWidth,
      };
    });
    expect(fit.count).toBe(4);
    expect(fit.inside).toBe(true);
    expect(fit.tall).toBe(true);
    expect(fit.pageScroll).toBeLessThanOrEqual(360);
  });
});
