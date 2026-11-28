// Smart Diet AI - Shared Product Catalog Module
// Handles catalog product validation, companion and addon mapping, copy/publish data prep and remote sync.

(function(root) {
  'use strict';

  function companionSnapshot(item) {
    return {
      name: String(item?.name || "").slice(0, 120),
      grams: +item?.grams || 100,
      kcal: +item?.kcal || 0,
      protein: +item?.protein || 0,
      fat: +item?.fat || 0,
      carbs: +item?.carbs || 0,
    };
  }

  function catalogAddonMap(p) {
    const map = new Map();
    (Array.isArray(p && p.companions) ? p.companions : []).forEach((c) => {
      if (
        c &&
        typeof c.id === "string" &&
        c.item &&
        typeof c.item === "object" &&
        c.item.name
      ) {
        map.set(c.id, { id: c.id, ...companionSnapshot(c.item) });
      }
    });
    return map;
  }

  function buildCatalogCompanions(list, existing, productsPool) {
    const kept = existing || new Map();
    const pool = productsPool || (typeof state !== 'undefined' && Array.isArray(state.products) ? state.products : []);
    const sanitize = typeof sanitizeCompanionList === 'function'
      ? sanitizeCompanionList
      : (arr) => (Array.isArray(arr) ? arr.filter((x) => x && typeof x.id === 'string') : []);

    return sanitize(list)
      .map((c) => {
        const src = kept.get(c.id) || pool.find((x) => x.id === c.id);
        return src
          ? {
              id: c.id,
              grams: c.grams,
              on: c.on !== false,
              item: companionSnapshot(src),
            }
          : null;
      })
      .filter(Boolean);
  }

  function isProductInCatalog(name, list) {
    const normalizeKey = typeof prodKey === 'function'
      ? prodKey
      : (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const k = normalizeKey(name);
    const items = list || (typeof catalogProducts !== 'undefined' && Array.isArray(catalogProducts) ? catalogProducts : []);
    return items.some((cp) => normalizeKey(cp.name) === k);
  }

  function isCatalogProductInMine(p, myProducts) {
    const normalizeKey = typeof prodKey === 'function'
      ? prodKey
      : (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const k = normalizeKey(p?.name || "");
    const pool = myProducts || (typeof state !== 'undefined' && Array.isArray(state.products) ? state.products : []);
    return !!k && Array.isArray(pool) && pool.some((own) => normalizeKey(own.name) === k);
  }

  function buildCatalogProductRow(p, targetName, existingCompanions, catalogAddonSnap) {
    return {
      name: (targetName || p.name || "").trim(),
      grams: +p.grams || 100,
      kcal: +p.kcal || 0,
      protein: +p.protein || 0,
      fat: +p.fat || 0,
      carbs: +p.carbs || 0,
      verified: Boolean(p.verified),
      note: typeof p.note === "string" ? p.note.trim().slice(0, 2000) : "",
      companions: buildCatalogCompanions(
        p.companions || existingCompanions || [],
        catalogAddonSnap,
        typeof state !== 'undefined' ? state.products : []
      ),
      components: Array.isArray(p.components)
        ? JSON.parse(JSON.stringify(p.components))
        : [],
    };
  }

  function prepareCopiedCatalogProduct(cp, targetName, existingProducts, copySuffix = 'копія') {
    const pool = existingProducts || (typeof state !== 'undefined' && Array.isArray(state.products) ? state.products : []);
    const name = (targetName || cp.name || "").trim();
    const normalizeKey = typeof prodKey === 'function'
      ? prodKey
      : (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

    const item = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : ('prod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      name,
      grams: +cp.grams || 100,
      kcal: +cp.kcal || 0,
      protein: +cp.protein || 0,
      fat: +cp.fat || 0,
      carbs: +cp.carbs || 0,
      verified: Boolean(cp.verified),
      note: typeof cp.note === "string" ? cp.note : "",
      companions: [],
      components: Array.isArray(cp.components)
        ? JSON.parse(JSON.stringify(cp.components))
        : [],
    };

    const snaps = catalogAddonMap(cp);
    const addonItems = [];
    const sanitize = typeof sanitizeCompanionList === 'function'
      ? sanitizeCompanionList
      : (arr) => (Array.isArray(arr) ? arr.filter((x) => x && typeof x.id === 'string') : []);

    for (const c of sanitize(cp.companions)) {
      const snap = snaps.get(c.id);
      if (!snap) continue;
      let target = pool.find(
        (x) =>
          normalizeKey(x.name) === normalizeKey(snap.name) &&
          ["grams", "kcal", "protein", "fat", "carbs"].every(
            (k) => Math.abs((+x[k] || 0) - snap[k]) < 0.001,
          ),
      );
      if (!target) {
        const addonName = pool.some((x) => normalizeKey(x.name) === normalizeKey(snap.name))
          ? `${snap.name} (${copySuffix})`
          : snap.name;
        target = {
          ...snap,
          id: typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : ('prod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
          name: addonName,
          verified: false,
          note: "",
          companions: [],
          components: [],
        };
        addonItems.push(target);
      }
      item.companions.push({
        id: target.id,
        grams: c.grams,
        on: c.on !== false,
      });
    }

    return { item, addonItems };
  }

  async function fetchCatalogProductsData(sbClient) {
    if (!sbClient) return { data: null, error: 'no_client' };
    try {
      const { data, error } = await sbClient
        .from("catalog_products")
        .select("*")
        .order("name");
      if (!error && Array.isArray(data)) {
        if (typeof saveCachedCatalog === 'function') {
          saveCachedCatalog(data);
        }
        return { data, error: null };
      }
      return { data: null, error: error || 'no_data' };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  const exportsObj = {
    companionSnapshot,
    catalogAddonMap,
    buildCatalogCompanions,
    isProductInCatalog,
    isCatalogProductInMine,
    buildCatalogProductRow,
    prepareCopiedCatalogProduct,
    fetchCatalogProductsData
  };

  Object.assign(root, exportsObj);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
