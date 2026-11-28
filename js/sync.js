// Smart Diet AI - Cloud Synchronization & Data Reconciliation Module
// Handles row mapping for Supabase tables, queue normalization, conflict/rejection tracking, and batch sync operations.

(function(root) {
  'use strict';

  function isDataError(e) {
    return !!(e && e.code && /^(22|23|42501)/.test(e.code));
  }

  function cloudFoodRow(x, userId = (typeof user !== 'undefined' ? user?.id : null)) {
    if (!x || !userId) return null;
    const name = String(x.name || "").trim().slice(0, 180);
    if (!name) return null;
    const num = (k) => Math.min(9999999, Math.max(0, Math.round((+x[k] || 0) * 100) / 100));
    const sanitize = typeof sanitizeEntryComponents === 'function' ? sanitizeEntryComponents : (c) => c;
    return {
      id: x.id,
      user_id: userId,
      name,
      meal_type: ["breakfast", "lunch", "dinner", "snack"].includes(x.meal) ? x.meal : "breakfast",
      grams: num("grams"),
      kcal: num("kcal"),
      protein: num("protein"),
      fat: num("fat"),
      carbs: num("carbs"),
      entry_date: x.date || (typeof iso === 'function' ? iso() : new Date().toISOString().slice(0, 10)),
      snack_id: x.snackId || null,
      meal_order: Number.isFinite(+x.mealOrder) ? +x.mealOrder : null,
      ...(Array.isArray(x.components) && x.components.length
        ? { components: sanitize(x.components) }
        : {}),
    };
  }

  function cloudProductRow(x, userId = (typeof user !== 'undefined' ? user?.id : null)) {
    if (!x || !userId) return null;
    const name = String(x.name || "").trim().slice(0, 120);
    if (!name) return null;
    const num = (k) => Math.min(9999999, Math.max(0, Math.round((+x[k] || 0) * 100) / 100));
    const sanitizeCompanions = typeof sanitizeCompanionList === 'function' ? sanitizeCompanionList : (c) => c;
    const sanitizeComponents = typeof sanitizeComponentList === 'function' ? sanitizeComponentList : (c) => c;
    return {
      id: x.id,
      user_id: userId,
      name,
      grams: num("grams"),
      kcal: num("kcal"),
      protein: num("protein"),
      fat: num("fat"),
      carbs: num("carbs"),
      verified: !!x.verified,
      updated_at: new Date(x.updatedAt || Date.now()).toISOString(),
      ...(typeof x.note === "string"
        ? { note: x.note.trim().slice(0, 2000) }
        : { note: "" }),
      ...(Array.isArray(x.companions)
        ? { companions: sanitizeCompanions(x.companions) }
        : {}),
      ...(Array.isArray(x.components)
        ? { components: sanitizeComponents(x.components) }
        : {}),
    };
  }

  function cloudWeightRow(x, userId = (typeof user !== 'undefined' ? user?.id : null)) {
    if (!x || !userId) return null;
    const v = +x.value;
    if (!(v > 0 && v < 1000)) return null;
    return {
      id: x.id,
      user_id: userId,
      value: Math.round(v * 100) / 100,
      entry_date: x.date || (typeof iso === 'function' ? iso() : new Date().toISOString().slice(0, 10)),
    };
  }

  function normalizeSyncQueue(raw, ownerUid = null) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return {
        foods: Array.isArray(raw.foods) ? raw.foods.filter(x => typeof x === 'string') : [],
        weights: Array.isArray(raw.weights) ? raw.weights.filter(x => typeof x === 'string') : [],
        delFoods: Array.isArray(raw.delFoods)
          ? raw.delFoods
              .map((x) =>
                typeof x === "string"
                  ? { id: x, u: ownerUid }
                  : x,
              )
              .filter((x) => x && typeof x.id === "string")
              .map((x) => ({
                id: x.id,
                u: typeof x.u === "string" ? x.u : null,
                ...(x.food &&
                typeof x.food === "object" &&
                x.food.id === x.id
                  ? { food: x.food }
                  : {}),
              }))
          : [],
        delWeights: Array.isArray(raw.delWeights)
          ? raw.delWeights
              .map((x) =>
                typeof x === "string"
                  ? { d: x, u: ownerUid }
                  : x,
              )
              .filter((x) => x && x.d)
          : [],
        products: Array.isArray(raw.products) ? raw.products.filter(x => typeof x === 'string') : [],
        delProducts: Array.isArray(raw.delProducts) ? raw.delProducts.filter(x => typeof x === 'string') : [],
        profile: !!raw.profile,
        rejected: Array.isArray(raw.rejected) ? raw.rejected.filter(r => r && r.kind && r.id) : [],
      };
    }
    return {
      foods: [],
      weights: [],
      delFoods: [],
      delWeights: [],
      products: [],
      delProducts: [],
      profile: false,
      rejected: [],
    };
  }

  function localSummary(queue = (typeof syncQueue !== 'undefined' ? syncQueue : null), appState = (typeof state !== 'undefined' ? state : null)) {
    const q = queue || {};
    const s = appState || {};
    return {
      foods: Array.isArray(s.foods) ? s.foods.length : 0,
      weights: Array.isArray(s.weights) ? s.weights.length : 0,
      products: Array.isArray(s.products) ? s.products.length : 0,
      pending:
        (Array.isArray(q.foods) ? q.foods.length : 0) +
        (Array.isArray(q.weights) ? q.weights.length : 0) +
        (Array.isArray(q.delFoods) ? q.delFoods.length : 0) +
        (Array.isArray(q.delWeights) ? q.delWeights.length : 0) +
        (Array.isArray(q.products) ? q.products.length : 0) +
        (Array.isArray(q.delProducts) ? q.delProducts.length : 0) +
        (q.profile ? 1 : 0),
    };
  }

  function hasLocalData(queue = (typeof syncQueue !== 'undefined' ? syncQueue : null), appState = (typeof state !== 'undefined' ? state : null)) {
    const c = localSummary(queue, appState);
    const prefs = appState?.prefs;
    const hasProf = typeof hasProfileData === 'function'
      ? hasProfileData(prefs)
      : (prefs && typeof prefs === 'object' && Object.keys(prefs).length > 0);
    return !!(
      c.foods ||
      c.weights ||
      c.products ||
      c.pending ||
      hasProf
    );
  }

  function enqueueItem(queue, kind, id) {
    if (!queue || !Array.isArray(queue[kind])) return false;
    if (queue[kind].includes(id)) return true;
    queue[kind].push(id);
    return true;
  }

  function dequeueItem(queue, kind, id) {
    if (!queue || !Array.isArray(queue[kind])) return;
    queue[kind] = queue[kind].filter((x) => x !== id);
  }

  function queueAllItems(queue, appState) {
    if (!queue || !appState) return;
    const deleted = new Set((queue.delFoods || []).map((x) => x.id));
    queue.products = [
      ...new Set([
        ...(queue.products || []),
        ...((appState.products || []).map((x) => x.id)),
      ]),
    ];
    queue.foods = [
      ...new Set([
        ...(queue.foods || []),
        ...((appState.foods || []).filter((x) => !deleted.has(x.id)).map((x) => x.id)),
      ]),
    ];
    queue.weights = [
      ...new Set([
        ...(queue.weights || []),
        ...((appState.weights || []).map((x) => x.id)),
      ]),
    ];
  }

  function forgetFoodItem(queue, appState, id, ownerUid) {
    if (!queue) return false;
    const food = (appState?.foods || []).find((x) => x.id === id);
    queue.foods = (queue.foods || []).filter((x) => x !== id);
    queue.delFoods = (queue.delFoods || []).filter((x) => x.id !== id);
    if (ownerUid) {
      queue.delFoods.push({
        id,
        u: ownerUid,
        ...(food ? { food: { ...food } } : {}),
      });
    }
    return true;
  }

  function rememberRejectedItem(queue, kind, id) {
    if (!queue) return;
    if (!Array.isArray(queue.rejected)) queue.rejected = [];
    if (!queue.rejected.some((r) => r.kind === kind && r.id === id)) {
      queue.rejected.push({ kind, id });
    }
  }

  function forgetRejectedItem(queue, kind, id) {
    if (!queue || !Array.isArray(queue.rejected)) return;
    queue.rejected = queue.rejected.filter((r) => !(r.kind === kind && r.id === id));
  }

  function pruneRejectedItems(queue, pools) {
    if (!queue || !Array.isArray(queue.rejected)) return 0;
    queue.rejected = queue.rejected.filter(
      (r) =>
        pools[r.kind] &&
        pools[r.kind].some((x) => x.id === r.id) &&
        !queue[r.kind]?.includes(r.id),
    );
    return queue.rejected.length;
  }

  async function sendRowsBatch(sbClient, table, onConflict, items) {
    if (!sbClient) return { done: [], rejected: [], error: 'no_client' };
    let { error } = await sbClient.from(table).upsert(
      items.map((x) => x.row),
      { onConflict },
    );
    if (
      error &&
      table === "products" &&
      /column.*note/i.test(error.message || "")
    ) {
      items.forEach((x) => {
        delete x.row.note;
      });
      ({ error } = await sbClient.from(table).upsert(
        items.map((x) => x.row),
        { onConflict },
      ));
    }
    if (!error)
      return { done: items.map((x) => x.id), rejected: [], error: "" };
    if (!isDataError(error))
      return { done: [], rejected: [], error: error.message };
    const res = { done: [], rejected: [], error: "" };
    for (const it of items) {
      const r = await sbClient.from(table).upsert(it.row, { onConflict });
      if (!r.error) res.done.push(it.id);
      else if (isDataError(r.error)) res.rejected.push(it.id);
      else {
        res.error = r.error.message;
        break;
      }
    }
    return res;
  }

  async function fetchAllRowsPaged(sbClient, table, userId) {
    if (!sbClient || !userId) return { data: null, error: 'no_client_or_user' };
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sbClient
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .order("id")
        .range(from, from + 999);
      if (error) return { data: null, error };
      rows.push(...data);
      if (data.length < 1000) return { data: rows, error: null };
    }
  }

  const exportsObj = {
    isDataError,
    cloudFoodRow,
    cloudProductRow,
    cloudWeightRow,
    normalizeSyncQueue,
    localSummary,
    hasLocalData,
    enqueueItem,
    dequeueItem,
    queueAllItems,
    forgetFoodItem,
    rememberRejectedItem,
    forgetRejectedItem,
    pruneRejectedItems,
    sendRowsBatch,
    fetchAllRowsPaged
  };

  Object.assign(root, exportsObj);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
