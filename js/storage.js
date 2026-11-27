// Smart Diet AI - Local Storage & Data Contract Persistence Module
// Manages application state loading, corruption recovery, write-through serialization,
// product activity history, goal plans history, notifications, catalog cache, drafts and chats.

(function(root) {
  'use strict';

  const STORE_KEY = 'smartdiet-v1';
  const storeKey = STORE_KEY;
  const LAST_BACKUP_KEY = 'smartdiet-last-local-backup';
  const SYNC_KEY = 'smartdiet-sync-queue';
  const NOTIF_KEY = 'smartdiet-notifications-v1';
  const NOTIF_LIMIT = 50;
  const NOTIF_VISIBLE_MS = 10000;
  const NOTIF_MAX_VISIBLE = 4;
  const CATALOG_CACHE_KEY = 'smartdiet-catalog-cache';
  const ASK_KEY = 'smartdiet-ask-history';
  const ASK_MAX = 50;
  const DIETITIAN_CHAT_LIMIT = 40;
  const DIETITIAN_CHAT_MAX_TEXT = 1200;

  let storageWarned = false;
  let stateRecovered = false;

  function loadState(key = storeKey) {
    let raw = null;
    try {
      raw = localStorage.getItem(key);
    } catch (e) {
      return {};
    }
    if (!raw) return {};
    try {
      let s = JSON.parse(raw);
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw Error('bad state');
      let list = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [],
          obj = v => v && typeof v === 'object' && !Array.isArray(v);
      s.foods = list(s.foods);
      s.weights = list(s.weights);
      s.products = list(s.products);
      if (!obj(s.prefs)) delete s.prefs;
      if (!obj(s.ai) || (s.ai.keys !== undefined && !obj(s.ai.keys))) delete s.ai;
      if (!obj(s.synced)) delete s.synced;
      return s;
    } catch (e) {
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith('smartdiet-corrupt-'))
          .sort()
          .slice(0, -1)
          .forEach(k => localStorage.removeItem(k));
        localStorage.setItem('smartdiet-corrupt-' + Date.now(), raw);
      } catch (_) {}
      stateRecovered = true;
      return {};
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, value);
      storageWarned = false;
      return true;
    } catch (e) {
      try {
        localStorage.removeItem(LAST_BACKUP_KEY);
        localStorage.setItem(key, value);
        storageWarned = false;
        return true;
      } catch (_) {}
      if (!storageWarned) {
        storageWarned = true;
        try {
          if (typeof root.toast === 'function' && typeof root.t === 'function') root.toast(root.t('storageFull'));
        } catch (_) {}
      }
      try {
        if (typeof root.offerStorageCleanup === 'function') root.offerStorageCleanup();
      } catch (_) {}
      return false;
    }
  }

  function serializeState(targetState = (typeof root.state !== 'undefined' ? root.state : {}), defaultSupabase) {
    let s = targetState;
    const defUrl = (defaultSupabase && defaultSupabase.url) || (typeof root.SUPABASE_URL !== 'undefined' ? root.SUPABASE_URL : '');
    const defKey = (defaultSupabase && defaultSupabase.key) || (typeof root.SUPABASE_ANON_KEY !== 'undefined' ? root.SUPABASE_ANON_KEY : '');
    if (s && s.supabase && s.supabase.url === defUrl && s.supabase.key === defKey) {
      s = { ...targetState };
      delete s.supabase;
    }
    return JSON.stringify(s);
  }

  function isProductLogAction(a) {
    return ['created', 'updated', 'renamed', 'deleted'].includes(a);
  }

  function isLogAction(a) {
    return isProductLogAction(a) || [
      'food_added', 'food_updated', 'food_deleted',
      'weight_added', 'weight_deleted', 'goals_saved',
      'profile_saved', 'share_sent', 'share_accepted',
      'share_declined', 'backup_exported', 'backup_imported'
    ].includes(a);
  }

  function journalVerbKey(a) {
    return isProductLogAction(a)
      ? 'productHistory' + a[0].toUpperCase() + a.slice(1)
      : 'journal' + a.split('_').map(p => p[0].toUpperCase() + p.slice(1)).join('');
  }

  function cleanProductHistory(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(x =>
      x && typeof x === 'object' &&
      isLogAction(x.action) &&
      typeof x.name === 'string' &&
      (x.name.trim() || !isProductLogAction(x.action)) &&
      typeof x.at === 'string' &&
      Number.isFinite(Date.parse(x.at))
    ).slice(0, 1000).map(x => ({
      id: typeof x.id === 'string' && x.id ? x.id : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'hist-' + Math.random().toString(36).slice(2)),
      at: x.at,
      action: x.action,
      productId: typeof x.productId === 'string' ? x.productId : '',
      name: String(x.name).trim().slice(0, 120),
      ...(typeof x.previousName === 'string' && x.previousName ? { previousName: x.previousName.slice(0, 120) } : {}),
      ...(typeof x.details === 'string' && x.details.trim() ? { details: x.details.trim().slice(0, 240) } : {})
    }));
  }

  function goalValuesOf(p) {
    return ['kcal', 'protein', 'carbs', 'fat'].reduce((o, k) => (o[k] = +(p && p[k]) || 0, o), {});
  }

  function ensureGoalPlans(targetState = (typeof root.state !== 'undefined' ? root.state : null)) {
    let p = targetState ? (targetState.prefs || {}) : {};
    if (!(+p.kcal > 0) || (Array.isArray(p.goalPlans) && p.goalPlans.length)) return;
    p.goalPlans = [{ from: '1970-01-01', ...goalValuesOf(p) }];
  }

  function syncGoalPlans(targetState = (typeof root.state !== 'undefined' ? root.state : null), today = (typeof root.iso === 'function' ? root.iso() : new Date().toISOString().slice(0, 10))) {
    let p = targetState ? targetState.prefs : null;
    if (!p || !(+p.kcal > 0)) return;
    ensureGoalPlans(targetState);
    let plans = p.goalPlans,
        cur = goalValuesOf(p),
        last = plans[plans.length - 1];
    if (['kcal', 'protein', 'carbs', 'fat'].every(k => last[k] === cur[k])) return;
    if (last.from === today) plans[plans.length - 1] = { from: today, ...cur };
    else plans.push({ from: today, ...cur });
    if (plans.length > 60) plans.splice(0, plans.length - 60);
  }

  function goalsOn(date, p = (typeof root.state !== 'undefined' && root.state ? root.state.prefs : {})) {
    let plans = Array.isArray(p && p.goalPlans) ? p.goalPlans : [],
        pick = null;
    for (let x of plans) if (x.from <= date) pick = x;
    return pick || plans[0] || null;
  }

  function loadNotifications(key = NOTIF_KEY, limit = NOTIF_LIMIT) {
    try {
      let list = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(list)) return [];
      return list.filter(x => x && typeof x.id === 'string' && typeof x.text === 'string')
        .slice(0, limit)
        .map(x => ({
          id: x.id,
          text: x.text,
          at: typeof x.at === 'string' ? x.at : new Date().toISOString(),
          unread: !!(x.unread || x.vis),
          vis: false
        }));
    } catch (e) {
      return [];
    }
  }

  function saveNotifications(list, key = NOTIF_KEY, limit = NOTIF_LIMIT) {
    try {
      localStorage.setItem(key, JSON.stringify((list || []).slice(0, limit).map(({ id, text, at, unread, vis }) => ({ id, text, at, unread, vis }))));
    } catch (e) {}
  }

  function loadCachedCatalog(key = CATALOG_CACHE_KEY) {
    try {
      let raw = localStorage.getItem(key);
      if (raw) {
        let parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (_) {}
    return [];
  }

  function saveCachedCatalog(list, key = CATALOG_CACHE_KEY) {
    try {
      if (Array.isArray(list)) localStorage.setItem(key, JSON.stringify(list));
    } catch (_) {}
  }

  function dietitianChatKey(userId = (typeof root.user !== 'undefined' && root.user ? root.user.id : null)) {
    return 'smartdiet-dietitian-chat-v1:' + String(userId || 'local');
  }

  function loadDietitianChat(userId = (typeof root.user !== 'undefined' && root.user ? root.user.id : null), limit = DIETITIAN_CHAT_LIMIT, maxText = DIETITIAN_CHAT_MAX_TEXT, cleanResultFn = (typeof root.cleanDietitianResult === 'function' ? root.cleanDietitianResult : null)) {
    try {
      let list = JSON.parse(localStorage.getItem(dietitianChatKey(userId)) || '[]');
      if (!Array.isArray(list)) return [];
      return list.slice(-limit).map(m => {
        if (!m || typeof m !== 'object') return null;
        let id = typeof m.id === 'string' ? m.id : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'chat-' + Math.random().toString(36).slice(2));
        if (m.role === 'user' && typeof m.text === 'string') return { id, role: 'user', text: m.text.slice(0, maxText) };
        if (m.role === 'ai' && m.type === 'result') {
          let result = cleanResultFn ? cleanResultFn(m.result) : m.result;
          return result ? { id, role: 'ai', type: 'result', result } : null;
        }
        if (m.role === 'ai' && typeof m.text === 'string') return { id, role: 'ai', text: m.text.slice(0, maxText) };
        return null;
      }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function saveDietitianChat(chat = (typeof root.dietitianChat !== 'undefined' ? root.dietitianChat : []), userId = (typeof root.user !== 'undefined' && root.user ? root.user.id : null), limit = DIETITIAN_CHAT_LIMIT) {
    try {
      localStorage.setItem(dietitianChatKey(userId), JSON.stringify((chat || []).slice(-limit)));
    } catch (e) {}
  }

  function mealDraftKey(userId = (typeof root.user !== 'undefined' && root.user ? root.user.id : null)) {
    return 'smartdiet-meal-drafts-v1:' + String(userId || 'local');
  }

  function mealDraftPrefKey(userId = (typeof root.user !== 'undefined' && root.user ? root.user.id : null)) {
    return 'smartdiet-meal-drafts-keep-v1:' + String(userId || 'local');
  }

  function mealDrafts(userId = (typeof root.user !== 'undefined' && root.user ? root.user.id : null)) {
    try {
      let a = JSON.parse(localStorage.getItem(mealDraftKey(userId)) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  }

  function saveMealDrafts(a, userId = (typeof root.user !== 'undefined' && root.user ? root.user.id : null)) {
    localStorage.setItem(mealDraftKey(userId), JSON.stringify(a));
  }

  function migrateKeepMealDrafts(userId = (typeof root.user !== 'undefined' && root.user ? root.user.id : null)) {
    try {
      if (localStorage.getItem(mealDraftPrefKey(userId)) !== '1') return;
      saveMealDrafts(mealDrafts(userId).map(d => d && typeof d === 'object' ? { ...d, locked: true } : d), userId);
      localStorage.removeItem(mealDraftPrefKey(userId));
    } catch (e) {}
  }

  function cleanMealDrafts(userId = (typeof root.user !== 'undefined' && root.user ? root.user.id : null), today = (typeof root.iso === 'function' ? root.iso() : new Date().toISOString().slice(0, 10))) {
    migrateKeepMealDrafts(userId);
    let a = mealDrafts(userId),
        b = a.filter(d => d && (d.locked === true || d.date >= today));
    if (a.length !== b.length) saveMealDrafts(b, userId);
  }

  function loadAsk(key = ASK_KEY, max = ASK_MAX) {
    try {
      let a = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(a) ? a.filter(x => x && (x.role === 'user' || x.role === 'ai') && typeof x.text === 'string').slice(-max) : [];
    } catch (e) {
      return [];
    }
  }

  function saveAsk(history = (typeof root.askHistory !== 'undefined' ? root.askHistory : []), key = ASK_KEY, max = ASK_MAX) {
    try {
      localStorage.setItem(key, JSON.stringify((history || []).slice(-max)));
    } catch (e) {}
  }

  const exportsObj = {
    STORE_KEY,
    storeKey,
    LAST_BACKUP_KEY,
    SYNC_KEY,
    NOTIF_KEY,
    NOTIF_LIMIT,
    NOTIF_VISIBLE_MS,
    NOTIF_MAX_VISIBLE,
    CATALOG_CACHE_KEY,
    ASK_KEY,
    ASK_MAX,
    DIETITIAN_CHAT_LIMIT,
    DIETITIAN_CHAT_MAX_TEXT,
    loadState,
    writeLocal,
    serializeState,
    isProductLogAction,
    isLogAction,
    journalVerbKey,
    cleanProductHistory,
    goalValuesOf,
    ensureGoalPlans,
    syncGoalPlans,
    goalsOn,
    loadNotifications,
    saveNotifications,
    loadCachedCatalog,
    saveCachedCatalog,
    dietitianChatKey,
    loadDietitianChat,
    saveDietitianChat,
    mealDraftKey,
    mealDraftPrefKey,
    mealDrafts,
    saveMealDrafts,
    migrateKeepMealDrafts,
    cleanMealDrafts,
    loadAsk,
    saveAsk
  };

  Object.assign(root, exportsObj);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
