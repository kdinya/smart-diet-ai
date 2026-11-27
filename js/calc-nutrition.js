// Smart Diet AI - Nutrition Calculation & Pure Domain Logic
// Pure mathematical functions for nutrition, portions, composite dishes, and macro calculations.

function normalizeNutritionNumber(raw) {
  let v = String(raw || '').trim().replace(/\s/g, '');
  if (v.includes(',') && v.includes('.'))
    v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else if (v.includes(','))
    v = v.replace(',', '.');
  let n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10000 ? String(Math.round(n * 100) / 100) : '';
}

function parseImportedNutrition(text) {
  let lines = String(text || '').replace(/\u00a0/g, ' ').split(/\r?\n/).map(x => x.trim()).filter(Boolean),
      all = lines.join('\n'),
      out = { kcal: '', protein: '', fat: '', carbs: '' };
  let num = '([0-9]{1,3}(?:[ .][0-9]{3})*(?:[,.][0-9]+)?|[0-9]+(?:[,.][0-9]+)?)';
  let gramRe = new RegExp('(?<![\\p{L}])(' + num + ')\\s*(?:g|г)(?![\\p{L}])', 'giu');
  let isDaily = line => /recommended daily|добов\w+ норм|рекомендован\w+ норм|daily value|%\s*daily/i.test(line);
  let firstGram = line => {
    let m = [...line.matchAll(gramRe)];
    return m.length ? normalizeNutritionNumber(m[0][1]) : '';
  };
  let lastGram = line => {
    let m = [...line.matchAll(gramRe)];
    return m.length ? normalizeNutritionNumber(m[m.length - 1][1]) : '';
  };
  let kcal = all.match(new RegExp('(?<![\\p{L}])(' + num + ')\\s*(?:kcal|ккал)(?![\\p{L}])', 'iu'));
  if (kcal) out.kcal = normalizeNutritionNumber(kcal[1]);
  let defs = [
    ['protein', /(?<![\p{L}])(?:protein[s]?|білк[а-яіїєґ]*|белк[а-яіїєґ]*)(?![\p{L}])/iu],
    ['fat', /(?<![\p{L}])(?:fat[s]?|жир[а-яіїєґ]*)(?![\p{L}])/iu],
    ['carbs', /(?<![\p{L}])(?:carbohydrates?|carbs?|вуглевод[а-яіїєґ]*|углевод[а-яіїєґ]*)(?![\p{L}])/iu]
  ];
  for (let [key, label] of defs) {
    for (let i = 0; i < lines.length; i++) {
      let m = lines[i].match(label);
      if (!m || isDaily(lines[i])) continue;
      let after = lines[i].slice(m.index + m[0].length),
          before = lines[i].slice(0, m.index);
      let found = (!isDaily(after) && firstGram(after)) || (!isDaily(before) && lastGram(before)) || '';
      if (!found) {
        for (let line of lines.slice(i + 1, Math.min(lines.length, i + 4))) {
          if (isDaily(line)) continue;
          let g = firstGram(line);
          if (g) {
            found = g;
            break;
          }
        }
      }
      if (found) {
        out[key] = found;
        break;
      }
    }
  }
  return out;
}

function calcFmt(k, v) {
  return k === 'kcal' ? String(Math.round(v)) : String(Number(v.toFixed(1)));
}

function nutrientState(used, need) {
  let r = need > 0 ? used / need : (used > 0 ? 2 : 1);
  return r < 0.9 ? 'under' : r <= 1.1 ? 'ok' : r <= 1.25 ? 'high' : 'over';
}

function compositeTotals(components) {
  let total = { grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 };
  (components || []).filter(c => c.enabled !== false).forEach(c => {
    ['grams', 'kcal', 'protein', 'fat', 'carbs'].forEach(k => {
      total[k] += (+c[k] || 0);
    });
  });
  return {
    grams: Math.round(total.grams * 10) / 10,
    kcal: Math.round(total.kcal),
    protein: Math.round(total.protein * 10) / 10,
    fat: Math.round(total.fat * 10) / 10,
    carbs: Math.round(total.carbs * 10) / 10
  };
}

function normalizeFoodComponentsForEntry(components, portions, targetGrams, absolute = false) {
  let n = portions > 0 ? portions : 1,
      items = (components || []).map(c => {
        let enabled = c.enabled !== false,
            rawG = (+c.grams || 0) / (absolute ? n : 1),
            rawN = ['kcal', 'protein', 'fat', 'carbs'].map(k => (+c[k] || 0) / (absolute ? n : 1));
        return { c, enabled, rawG, rawN };
      }),
      activeG = items.filter(x => x.enabled).reduce((sum, x) => sum + x.rawG, 0),
      scale = activeG > 0 && targetGrams > 0 ? targetGrams / activeG : 1;
  return items.map(({ c, enabled, rawG, rawN }) => {
    let unitG = rawG * (enabled ? scale : 1),
        unitN = rawN.map(v => v * (enabled ? scale : 1));
    return {
      id: c.id,
      name: c.name,
      grams: Math.round(unitG * n * 10) / 10,
      kcal: Math.round(unitN[0] * n * 10) / 10,
      protein: Math.round(unitN[1] * n * 10) / 10,
      fat: Math.round(unitN[2] * n * 10) / 10,
      carbs: Math.round(unitN[3] * n * 10) / 10,
      enabled,
      portion: n,
      baseGrams: Math.round(unitG * 10) / 10,
      ...(c.isBase || c.id === '__base__' ? { isBase: true } : {})
    };
  });
}

function scaleNutrients(nutrients, baseGrams, targetGrams) {
  let base = +baseGrams > 0 ? +baseGrams : 100,
      target = +targetGrams >= 0 ? +targetGrams : base,
      factor = base > 0 ? target / base : 1;
  return {
    grams: Math.round(target * 10) / 10,
    kcal: Math.round((+nutrients?.kcal || 0) * factor),
    protein: Math.round((+nutrients?.protein || 0) * factor * 10) / 10,
    fat: Math.round((+nutrients?.fat || 0) * factor * 10) / 10,
    carbs: Math.round((+nutrients?.carbs || 0) * factor * 10) / 10
  };
}

function scaleComponentGrams(currentGrams, currentTotalG, newTotalG) {
  if (!(currentTotalG > 0 && newTotalG > 0)) return currentGrams;
  let scale = newTotalG / currentTotalG;
  return Math.round(currentGrams * scale * 10) / 10;
}

function planFloor(p) {
  return p?.sex === 'female' ? 1200 : 1500;
}

function calcProteinTarget(weight, targetWeight) {
  if (!weight || weight <= 0) return 0;
  let ref = targetWeight && targetWeight < weight ? Math.min(weight, targetWeight * 1.15) : weight;
  return Math.min(1.8 * ref, 2.2 * weight);
}

function calcMacrosFor(kcal, customProtein, targetProtein) {
  let protein = Math.round(Math.min(+customProtein || +targetProtein || 0, kcal * 0.4 / 4));
  let fat = Math.round(kcal * 0.27 / 9);
  return {
    protein,
    fat,
    carbs: Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))
  };
}

// Global browser / Node.js export compatibility
if (typeof window !== 'undefined') {
  window.normalizeNutritionNumber = normalizeNutritionNumber;
  window.parseImportedNutrition = parseImportedNutrition;
  window.calcFmt = calcFmt;
  window.nutrientState = nutrientState;
  window.compositeTotals = compositeTotals;
  window.normalizeFoodComponentsForEntry = normalizeFoodComponentsForEntry;
  window.scaleNutrients = scaleNutrients;
  window.scaleComponentGrams = scaleComponentGrams;
  window.planFloor = planFloor;
  window.calcProteinTarget = calcProteinTarget;
  window.calcMacrosFor = calcMacrosFor;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeNutritionNumber,
    parseImportedNutrition,
    calcFmt,
    nutrientState,
    compositeTotals,
    normalizeFoodComponentsForEntry,
    scaleNutrients,
    scaleComponentGrams,
    planFloor,
    calcProteinTarget,
    calcMacrosFor
  };
}
