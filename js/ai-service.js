// Smart Diet AI - AI Service & Prompt Engineering Module
// Providers: Gemini, Groq, OpenAI, Anthropic Claude, xAI Grok
// Manages AI requests, fallback chains, timeouts, prompt templates, and response parsers.

const AI_IDS = ['gemini', 'openai', 'anthropic', 'groq', 'xai'];
const AI_AUTO_PROVIDERS = ['gemini', 'groq'];
const AI_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{1,79}$/;
const AI_BUDGET_MS = 40000;
const AI_SWITCH_PAUSE_MS = 300;

const AI_MODELS = {
  gemini: {
    auto: ['gemini-3.5-flash-lite'],
    list: [
      { id: 'gemini-3.5-flash-lite', free: true, trains: true },
      { id: 'gemini-3.8-flash', free: true, trains: true }
    ]
  },
  groq: {
    auto: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    list: [
      { id: 'openai/gpt-oss-120b', free: true },
      { id: 'openai/gpt-oss-20b', free: true }
    ]
  },
  openai: {
    auto: ['gpt-6-luna'],
    list: [
      { id: 'gpt-6-luna' },
      { id: 'gpt-6.1-sol' }
    ]
  },
  anthropic: {
    auto: ['claude-haiku-5-5'],
    list: [
      { id: 'claude-haiku-5-5' }
    ]
  },
  xai: {
    auto: ['grok-4.3', 'grok-4.7'],
    list: [
      { id: 'grok-4.3' },
      { id: 'grok-4.7' }
    ]
  }
};

var aiModelUsed = '';
var lastAi = null;

const escStr = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getLang = () => (typeof lang === 'function' ? lang() : (typeof window !== 'undefined' && typeof window.lang === 'function' ? window.lang() : 'en'));
const getT = (k) => (typeof t === 'function' ? t(k) : (typeof window !== 'undefined' && typeof window.t === 'function' ? window.t(k) : k));
const getState = () => (typeof state !== 'undefined' && state ? state : (typeof window !== 'undefined' && window.state ? window.state : null));

function aiAutoAllowed(id) {
  return aiModelChoice(id) !== 'auto' || AI_AUTO_PROVIDERS.includes(id);
}

function aiTimeLeft(deadline, max) {
  let left = deadline - Date.now();
  if (left < 500) throw Error(getLang() === 'uk' ? 'Модель відповідає повільно.' : 'The model is responding slowly.');
  return Math.min(max, left);
}

async function aiFetch(url, init, deadline) {
  let c = new AbortController(),
      timer = setTimeout(() => c.abort(), aiTimeLeft(deadline, 18000));
  try {
    let r = await fetch(url, { ...init, signal: c.signal }),
        j = await r.json().catch(() => ({}));
    return { r, j };
  } catch (e) {
    if (e.name === 'AbortError') throw Error(getLang() === 'uk' ? 'Модель відповідає повільно.' : 'The model is responding slowly.');
    if (e instanceof TypeError) throw Error(getLang() === 'uk' ? 'Не вдалося з’єднатися із сервером. Перевір інтернет.' : 'Could not reach the server. Check your internet connection.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(key, prompt, jsonMode, deadline, models) {
  let body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: jsonMode ? 'minimal' : 'low' }
    }
  }, last, quota = false;
  if (jsonMode) body.generationConfig.responseMimeType = 'application/json';

  for (let model of [].concat(models || AI_MODELS.gemini.auto)) {
    let url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let attempt = 0; attempt < 2; attempt++) {
      let controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), aiTimeLeft(deadline, 20000)),
          retry = false;
      try {
        let r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: controller.signal
        }), j = await r.json();

        if (r.ok) {
          if (j.candidates?.[0]?.finishReason === 'MAX_TOKENS' || j.candidates?.[0]?.finishReason === 'LENGTH') throw Error(getT('aiCutOff'));
          let parts = j.candidates?.[0]?.content?.parts || [],
              text = parts.filter(x => !x.thought).map(x => x.text || '').join('') || parts.map(x => x.text || '').join('');
          if (text) {
            aiModelUsed = model;
            if (typeof window !== 'undefined') window.aiModelUsed = model;
            return text;
          }
          last = Error('Gemini returned an empty response');
          quota = false;
          retry = attempt === 0;
        } else {
          last = Error(j.error?.message || `Gemini HTTP ${r.status}`);
          quota = r.status === 429;
          if (r.status === 500 || r.status === 503) retry = attempt === 0;
          else if (!quota) throw last;
        }
      } catch (e) {
        if (e === last) throw e;
        if (e.name === 'AbortError') {
          last = Error(getLang() === 'uk' ? 'Модель відповідає повільно.' : 'The model is responding slowly.');
          throw last;
        } else if (e instanceof TypeError) {
          throw Error(getLang() === 'uk' ? 'Не вдалося з’єднатися з Gemini. Перевір інтернет і дозволені HTTP-реферери API-ключа.' : 'Could not reach Gemini. Check your internet connection and API key HTTP referrer restrictions.');
        } else throw e;
      } finally {
        clearTimeout(timer);
      }
      if (!retry) break;
      await new Promise(r => setTimeout(r, 600));
    }
  }
  throw quota
    ? Error(getLang() === 'uk' ? 'Денний ліміт безкоштовного ключа Gemini вичерпано. Він оновлюється опівночі за тихоокеанським часом. Скористайся іншим ключем або увімкни білінг у Google AI Studio.' : 'The free Gemini key daily limit is used up. It resets at midnight Pacific time. Use another key or enable billing in Google AI Studio.')
    : last;
}

async function callOpenAICompat(url, models, key, prompt, jsonMode, deadline) {
  let last;
  for (let model of [].concat(models)) {
    for (let withJson of jsonMode ? [true, false] : [false]) {
      let body = { model, messages: [{ role: 'user', content: prompt }] };
      if (/^gpt-6/.test(model)) {
        body.reasoning_effort = 'low';
      } else body.temperature = .2;
      if (withJson) body.response_format = { type: 'json_object' };

      let { r, j } = await aiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(body)
      }, deadline);

      if (r.ok) {
        let choice = j.choices?.[0];
        if (choice?.finish_reason === 'length') throw Error(getT('aiCutOff'));
        let out = choice?.message?.content || '';
        if (out) {
          aiModelUsed = model;
          if (typeof window !== 'undefined') window.aiModelUsed = model;
          return out;
        }
        last = Error(getT('emptyReply'));
        break;
      }

      let msg = j.error?.message || j.error || j.message || `HTTP ${r.status}`;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
      last = Error(msg);
      if (withJson && /response_format|json/i.test(msg)) continue;
      if (r.status === 404 || /model/i.test(msg)) break;
      throw last;
    }
  }
  throw last;
}

async function callAnthropic(key, prompt, deadline, models) {
  let model = [].concat(models || [])[0] || 'claude-haiku-5-5',
      { r, j } = await aiFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] })
      }, deadline);
  if (!r.ok) throw Error(j.error?.message || `HTTP ${r.status}`);
  if (j.stop_reason === 'max_tokens') throw Error(getT('aiCutOff'));
  let out = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
  if (out) {
    aiModelUsed = model;
    if (typeof window !== 'undefined') window.aiModelUsed = model;
  }
  return out;
}

var AI_PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    run: (k, p, j, d, m) => callGemini(k, p, j, d, m)
  },
  openai: {
    name: 'OpenAI',
    run: (k, p, j, d, m) => callOpenAICompat('https://api.openai.com/v1/chat/completions', m, k, p, j, d)
  },
  anthropic: {
    name: 'Anthropic Claude',
    run: (k, p, j, d, m) => callAnthropic(k, p, d, m)
  },
  groq: {
    name: 'Groq',
    run: (k, p, j, d, m) => {
      if (/^xai-/i.test(k)) throw Error(getT('keyIsXai'));
      return callOpenAICompat('https://api.groq.com/openai/v1/chat/completions', m, k, p, j, d);
    }
  },
  xai: {
    name: 'xAI Grok',
    run: (k, p, j, d, m) => {
      if (/^gsk_/i.test(k)) throw Error(getT('keyIsGroq'));
      return callOpenAICompat('https://api.x.ai/v1/chat/completions', m, k, p, j, d);
    }
  }
};

function aiModelChoice(id) {
  let s = getState();
  let m = (s?.ai?.models || {})[id];
  return m && m !== 'auto' ? m : 'auto';
}

function aiModelsFor(id) {
  let m = aiModelChoice(id);
  return m === 'auto' ? AI_MODELS[id].auto : [m];
}

function modelsFromUi(id) {
  if (typeof document === 'undefined') return null;
  let sel = document.querySelector(`.ai-model-sel[data-ai-model="${id}"]`);
  if (!sel) return null;
  if (sel.value === 'auto') return AI_MODELS[id].auto;
  if (sel.value === 'custom') {
    let input = document.querySelector(`[data-ai-custom="${id}"]`),
        v = ((input && input.value) || '').trim();
    return AI_MODEL_RE.test(v) ? [v] : null;
  }
  return [sel.value];
}

function aiModelUi(id) {
  if (typeof document === 'undefined') return;
  let sel = document.querySelector(`.ai-model-sel[data-ai-model="${id}"]`);
  if (!sel) return;
  let input = document.querySelector(`[data-ai-custom="${id}"]`),
      warn = document.querySelector(`[data-ai-warn="${id}"]`),
      custom = sel.value === 'custom';
  if (input) input.classList.toggle('hidden', !custom);
  let eff = sel.value === 'auto' ? AI_MODELS[id].auto[0] : custom ? ((input && input.value) || '').trim() : sel.value,
      info = AI_MODELS[id].list.find(x => x.id === eff);
  if (warn) warn.classList.toggle('hidden', !(info && info.trains));
}

function fillAiModelSelects() {
  if (typeof document === 'undefined') return;
  let selects = document.querySelectorAll('.ai-model-sel');
  selects.forEach(sel => {
    let id = sel.dataset.aiModel;
    if (!id || !AI_MODELS[id]) return;
    let cur = aiModelChoice(id),
        list = AI_MODELS[id].list,
        known = cur === 'auto' || list.some(x => x.id === cur),
        free = getT('aiModelFree');
    sel.innerHTML = `<option value="auto">${escStr(AI_AUTO_PROVIDERS.includes(id) ? getT('aiModelAuto') : getT('aiModelAutoOff'))}</option>` +
      list.map(x => `<option value="${escStr(x.id)}">${escStr(x.id)}${x.free ? ' · ' + escStr(free) : ''}</option>`).join('') +
      `<option value="custom">${escStr(getT('aiModelCustom'))}</option>`;
    sel.value = known ? cur : 'custom';
    let input = document.querySelector(`[data-ai-custom="${id}"]`);
    if (input && !known && !input.value) input.value = cur;
    aiModelUi(id);
  });
}

async function testAiModel(id) {
  if (typeof document === 'undefined') return;
  let out = document.querySelector(`[data-ai-result="${id}"]`),
      keyEl = document.querySelector(`[data-ai-key="${id}"]`),
      key = (keyEl ? keyEl.value : '').trim(),
      models = modelsFromUi(id);
  if (!out) return;
  if (!models) return out.textContent = getT('aiModelBad');
  if (!key) return out.textContent = getT('aiTestNoKey');
  out.textContent = getT('aiTestRunning');
  try {
    aiModelUsed = '';
    if (typeof window !== 'undefined') window.aiModelUsed = '';
    let r = await AI_PROVIDERS[id].run(key, 'Reply with one word: OK', false, Date.now() + 25000, models);
    out.textContent = r && r.trim() ? getT('aiTestOk').replace('{model}', aiModelUsed || models[0]) : getT('aiTestFail') + getT('emptyReply');
  } catch (e) {
    out.textContent = getT('aiTestFail') + (e.message || String(e));
  }
}

function aiActive() {
  let s = getState();
  if (!s || !s.ai || !Array.isArray(s.ai.order) || !s.ai.keys) return [];
  return s.ai.order.filter(id => s.ai.keys[id]);
}

async function callAi(prompt, jsonMode = true) {
  let ids = aiActive();
  if (!ids.length) throw Error(getT('needKey'));
  ids = ids.filter(aiAutoAllowed);
  if (!ids.length) throw Error(getT('aiAutoOnlyFree'));
  let errs = [], deadline = Date.now() + AI_BUDGET_MS;
  let s = getState();
  for (let id of ids) {
    if (errs.length) {
      if (deadline - Date.now() < 500) break;
      await new Promise(r => setTimeout(r, AI_SWITCH_PAUSE_MS));
    }
    let P = AI_PROVIDERS[id];
    try {
      let key = s?.ai?.keys?.[id];
      let out = await P.run(key, prompt, jsonMode, deadline, aiModelsFor(id));
      if (out) {
        lastAi = { name: P.name, model: aiModelUsed, skipped: errs.slice() };
        if (typeof window !== 'undefined') {
          window.lastAi = lastAi;
          window.aiModelUsed = aiModelUsed;
        }
        return out;
      }
      throw Error(getLang() === 'uk' ? 'Порожня відповідь.' : 'Empty response.');
    } catch (e) {
      errs.push({ name: P.name, msg: e.message || String(e) });
    }
  }
  throw Error(errs.length === 1 ? errs[0].msg : errs.map(x => `${x.name}: ${x.msg}`).join('\n'));
}

async function requestAdvice(prompt) {
  return callAi(prompt, true);
}

// Prompt & Parsing Logic

function nutritionPrompt(product, meal, b, eaten, currentLang, tFn) {
  let uk = currentLang === 'uk';
  let tMeal = tFn ? tFn(meal) : meal;
  let targetMeal = b?.targetMeal ?? 500;
  let totalKcal = b?.total ?? 2000;
  let consumedKcal = Math.round(b?.consumed ?? 0);
  let usedP = Math.round(b?.used?.protein ?? 0), targetP = Math.round(b?.target?.protein ?? 100);
  let usedF = Math.round(b?.used?.fat ?? 0), targetF = Math.round(b?.target?.fat ?? 70);
  let usedC = Math.round(b?.used?.carbs ?? 0), targetC = Math.round(b?.target?.carbs ?? 242);
  let eatenStr = Array.isArray(eaten) && eaten.length ? eaten.join('; ') : '';

  return uk
    ? `Ти — уважний помічник з харчування, не лікар. Продукти користувача: «${product}». Прийом їжі: «${tMeal}». Якщо користувач назвав одну готову складену страву й уточнив її склад або спосіб приготування (наприклад, «млинці на молоці», «борщ з курячим м’ясом», «кава з молоком», «вівсянка на воді», «яєчня з помідорами»), рахуй це як ОДНУ готову страву і не додавай молоко, м’ясо чи інші її складники окремими позиціями. Розділяй лише явно названі незалежні продукти (наприклад, «борщ, куряче філе, хліб»). Для кожної окремої названої страви чи продукту підбери реалістичну вагу в грамах. Ніколи не розбивай одну вагу чи кількість того самого продукту на кілька однакових позицій: «500 г хліба» — це одна позиція з grams=500. Рахуй ТІЛЬКИ ті продукти, які назвав користувач: не додавай у items жодних інших позицій, навіть якщо раціону чогось бракує. Якщо користувач сам вказав вагу чи кількість, використовуй саме її. Поради й пропозиції (що можна додати) пиши лише текстом у note. ${eatenStr ? `Уже внесено на цей прийом їжі сьогодні: ${eatenStr}. Це лише контекст для поради в note і для балансу дня: не додавай ці продукти в items.` : ''} Орієнтир для цього прийому — ${targetMeal} ккал (потрібен лише для поради в note, не змінюй через нього список і порції), враховуючи добову ціль ${totalKcal} ккал, уже спожиті ${consumedKcal} ккал і БЖВ за день: білки ${usedP}/${targetP} г, жири ${usedF}/${targetF} г, вуглеводи ${usedC}/${targetC} г. Не проси користувача вводити ціль. Поверни тільки JSON у форматі {"items":[{"name":"Курка","grams":150,"kcal":248,"protein":46,"fat":5,"carbs":0}],"total":{"kcal":248,"protein":46,"fat":5,"carbs":0},"note":"коротка практична порада"}. Якщо чогось не вистачає для збалансованого дня, напиши це в note. Оцінки приблизні, без медичних тверджень.`
    : `You are a careful nutrition helper, not a doctor. User foods: "${product}". Meal: ${tMeal}. If the user names one prepared composite dish and specifies an ingredient or preparation (for example, "pancakes with milk", "borsch with chicken", "coffee with milk", "oatmeal with water", or "eggs with tomatoes"), calculate it as ONE prepared dish and do not add milk, meat, or other ingredients separately. Split only explicitly listed independent foods (for example, "borsch, chicken breast, bread"). Choose a realistic gram portion for each independently named dish or food. Never split one amount of the same food into several identical items: "500 g of bread" is one item with grams=500. Calculate ONLY the foods the user named: never add any other items to items, even if the diet lacks something. If the user gave a weight or amount, use exactly that. Put suggestions (what could be added) only as text in note. ${eatenStr ? `Already logged for this meal today: ${eatenStr}. This is context only for the note and the day's balance: do not add these foods to items.` : ''} The suggested amount for this meal is ${targetMeal} kcal (for the note only; do not change the item list or portions because of it), considering the daily target ${totalKcal} kcal, already eaten ${consumedKcal} kcal, and daily macros protein ${usedP}/${targetP} g, fat ${usedF}/${targetF} g, carbs ${usedC}/${targetC} g. Do not ask for a target. Return only JSON: {"items":[{"name":"Chicken","grams":150,"kcal":248,"protein":46,"fat":5,"carbs":0}],"total":{"kcal":248,"protein":46,"fat":5,"carbs":0},"note":"brief practical tip"}. Put any missing daily balance advice in note. Estimates are approximate and not medical advice.`;
}

const isNumVal = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
const badAiMsg = (currentLang) => (currentLang || getLang()) === 'uk' ? 'ШІ повернув неповний результат: немає частини значень. Спробуй ще раз.' : 'AI returned an incomplete result: some values are missing. Try again.';

function parseNutrition(txt, options = {}) {
  let currentLang = options.lang || getLang();
  let tFn = options.t || getT;
  let limName = (typeof LIM !== 'undefined' && LIM.name) ? LIM.name : 120;
  let limNum = (typeof LIM !== 'undefined' && LIM.num) ? LIM.num : 10000;

  let s = String(txt || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim(),
      a = s.indexOf('{'),
      b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw Error(currentLang === 'uk' ? 'ШІ не повернув дані у потрібному форматі.' : 'AI returned an invalid result.');

  let o = JSON.parse(s.slice(a, b + 1)),
      items = Array.isArray(o.items) ? o.items : [];
  if (!items.length && Number(o.grams) > 0) {
    items = [{ name: o.name || tFn('foodDish'), grams: o.grams, kcal: o.kcal, protein: o.protein, fat: o.fat, carbs: o.carbs }];
  }

  items = items.map((x, i) => {
    if (!x || typeof x !== 'object' || ![x.grams, x.kcal, x.protein, x.fat, x.carbs].every(isNumVal) || !(Number(x.grams) > 0)) {
      throw Error(badAiMsg(currentLang));
    }
    let it = {
      name: String(x.name || `${tFn('foodDish')} ${i + 1}`).slice(0, limName),
      grams: Math.min(limNum, Math.max(0, Math.round(Number(x.grams) || 0))),
      kcal: Math.min(limNum, Math.max(0, Math.round(Number(x.kcal) || 0))),
      protein: Math.min(limNum, Math.max(0, Math.round(Number(x.protein) || 0))),
      fat: Math.min(limNum, Math.max(0, Math.round(Number(x.fat) || 0))),
      carbs: Math.min(limNum, Math.max(0, Math.round(Number(x.carbs) || 0)))
    };
    return it;
  }).filter(x => x.grams > 0);

  items = items.reduce((acc, x) => {
    let m = acc.find(y => y.name.trim().toLowerCase() === x.name.trim().toLowerCase());
    if (m) ['grams', 'kcal', 'protein', 'fat', 'carbs'].forEach(f => m[f] += x[f]);
    else acc.push({ ...x });
    return acc;
  }, []);

  items = items.map(x => ({
    ...x,
    grams: Math.min(limNum, x.grams),
    kcal: Math.min(limNum, x.kcal),
    protein: Math.min(limNum, x.protein),
    fat: Math.min(limNum, x.fat),
    carbs: Math.min(limNum, x.carbs)
  }));

  if (items.length > 12) throw Error(badAiMsg(currentLang));
  if (!items.length) throw Error(currentLang === 'uk' ? 'Не вдалося визначити вагу порції.' : 'Could not estimate portion weight.');

  let sum = k => items.reduce((n, x) => n + x[k], 0);
  return {
    items,
    total: { kcal: sum('kcal'), protein: sum('protein'), fat: sum('fat'), carbs: sum('carbs') },
    note: String(o.note || '')
  };
}

async function requestNutrition(product, meal, onRetry, options = {}) {
  let currentLang = options.lang || getLang();
  let tFn = options.t || getT;
  let todayIso = options.iso || (typeof iso === 'function' ? iso() : '');
  let b = options.calorieBudget || (typeof calorieBudget === 'function' ? calorieBudget(todayIso, meal) : {
    targetMeal: 500,
    total: 2000,
    consumed: 0,
    used: { protein: 0, fat: 0, carbs: 0 },
    target: { protein: 100, fat: 70, carbs: 242 }
  });
  let eaten = options.eaten || (typeof mealItems === 'function' ? mealItems(todayIso, meal) : []);
  let prompt = nutritionPrompt(product, meal, b, eaten, currentLang, tFn);
  let last;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let txt = await requestAdvice(prompt);
      let info = lastAi;
      let n = parseNutrition(txt, { lang: currentLang, t: tFn });
      n.ai = info;
      return n;
    } catch (e) {
      last = e;
      let m = String(e?.message || e).toLowerCase();
      let retryable = /slow|timeout|timed out|failed to fetch|could not reach|could not estimate portion|high demand|overloaded|temporarily|unavailable|503|429|invalid result|needed format|empty response|returned an invalid|не вдалося з’єднатися|повільно|форматі|визначити вагу/.test(m);
      if (attempt || !retryable) throw e;
      if (onRetry) onRetry();
      await new Promise(r => setTimeout(r, 700));
    }
  }
  throw last || Error('Nutrition calculation failed');
}

function mealPlanPrompt(foods, budget, remaining, retry, planMeals, options = {}) {
  let currentLang = options.lang || getLang();
  let uk = currentLang === 'uk';
  let tFn = options.t || getT;
  let curDate = options.mealPlanDate || (typeof mealPlanDate !== 'undefined' ? mealPlanDate : '');
  let todayIso = options.todayIso || (typeof iso === 'function' ? iso() : '');
  let r = remaining, k = Math.round, u = budget.used;
  let when = curDate === todayIso ? (uk ? 'решту сьогодні' : 'the rest of today') : (uk ? 'завтра' : 'tomorrow');
  let shares = { breakfast: .25, lunch: .35, dinner: .30, snack: .10 };
  let wsum = planMeals.reduce((s, m) => s + (shares[m] || 0), 0);
  let split = planMeals.map(m => `${tFn(m)} ≈${k(r.kcal * (shares[m] || 0) / wsum)} kcal`).join(', ');
  let names = planMeals.map(m => tFn(m)).join(', ');
  let left = uk ? `${k(r.kcal)} ккал, Б${k(r.protein)} Ж${k(r.fat)} В${k(r.carbs)} г` : `${k(r.kcal)} kcal, P ${k(r.protein)}, F ${k(r.fat)}, C ${k(r.carbs)} g`;
  let used = uk ? `${k(u.kcal)} ккал, Б${k(u.protein)} Ж${k(u.fat)} В${k(u.carbs)} г` : `${k(u.kcal)} kcal, P ${k(u.protein)}, F ${k(u.fat)}, C ${k(u.carbs)} g`;

  let text = uk
    ? `Склади повноцінний план харчування на ${when} ВИКЛЮЧНО з вибраних користувачем готових продуктів. Використовуй їхні збережені харчові значення на зазначені грами як єдине джерело; не додавай продукти і не вигадуй значення.
Залишок до денних цілей: ${left}. Уже записано на цей день: ${used}. Усі страви разом не мають перевищувати залишок калорій і макронутрієнтів.
Плануй ТІЛЬКИ прийоми: ${names}. Інші прийоми вже записані або пропущені, їх не додавай.
Розподіли калорії по прийомах (орієнтири): ${split}.
Кожен прийом зі списку — це повноцінна їжа: основне джерело білка або складна страва, плюс гарнір (крупа, картопля, паста, хліб) і/або овочі чи жири з вибраних продуктів. Тобто 2–4 позиції в прийомі. Один продукт може бути в кількох прийомах, але не більше 1000 г на позицію.
Не повторюй вже записану їжу і не роби надто малих порцій.
Поверни ТІЛЬКИ JSON: {"items":[{"id":"product-id","grams":180,"meal":"lunch"}]}, де meal — breakfast, lunch, dinner або snack.
Доступні продукти: ${JSON.stringify(foods)}`
    : `Create a complete meal plan for ${when} using ONLY the user's selected saved prepared foods. Use their saved nutrition values for the stated grams as the sole source; add no foods and invent no values.
Remaining daily targets: ${left}. Already logged for this day: ${used}. All items together must not exceed the remaining calories and macros.
Plan ONLY these meals: ${names}. Other meals are already logged or skipped; do not add them.
Split calories across meals (guideline): ${split}.
Each planned meal is a real meal: a main protein source or substantial dish, plus a side (grain, potatoes, pasta, bread) and/or vegetables or fat from the selected foods. That means 2–4 items per meal. A food may appear in several meals, but no more than 1000 g per item.
Don't repeat food already logged and don't make very small portions.
Return ONLY JSON: {"items":[{"id":"product-id","grams":180,"meal":"lunch"}]}, where meal is breakfast, lunch, dinner or snack.
Available saved foods: ${JSON.stringify(foods)}`;

  return retry ? text + '\n' + retry : text;
}

function parseMealPlanItems(raw, allowed, options = {}) {
  let tFn = options.t || getT;
  let mealOrder = options.mealOrder || (typeof MEAL_ORDER !== 'undefined' ? MEAL_ORDER : ['breakfast', 'lunch', 'dinner', 'snack']);
  let txt = String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  let i = txt.indexOf('{'), j = txt.lastIndexOf('}');
  if (i < 0 || j < i) throw Error(tFn('mealPlanTooFew'));
  let parsed = JSON.parse(txt.slice(i, j + 1));
  if (!Array.isArray(parsed.items) || !parsed.items.length) throw Error(tFn('mealPlanTooFew'));
  let items = parsed.items.map(x => {
    let p = x && allowed.get(String(x.id)),
        g = Number(x && x.grams),
        m = x && x.meal;
    if (!p || !Number.isFinite(g) || g <= 0 || g > 1000 || !mealOrder.includes(m) || !(+p.grams > 0)) throw Error(tFn('mealPlanTooFew'));
    if ([p.grams, p.kcal, p.protein, p.fat, p.carbs].some(v => Number(v) < 0)) throw Error(tFn('mealPlanTooFew'));
    let ig = Math.round(g);
    if (ig <= 0) throw Error(tFn('mealPlanPortionZero'));
    let r = ig / +p.grams;
    return {
      id: p.id,
      name: p.name,
      meal: m,
      grams: ig,
      kcal: Math.round((+p.kcal || 0) * r),
      protein: Math.round((+p.protein || 0) * r),
      fat: Math.round((+p.fat || 0) * r),
      carbs: Math.round((+p.carbs || 0) * r)
    };
  });
  if (items.length > 16) throw Error(tFn('mealPlanTooFew'));
  return items;
}

function analysisPrompt(date, meal, items, options = {}) {
  let currentLang = options.lang || getLang();
  let uk = currentLang === 'uk';
  let tFn = options.t || getT;
  let all = meal === 'day';
  let budgetFn = options.nutritionBudget || (typeof nutritionBudget === 'function' ? nutritionBudget : () => ({ target: { kcal: 2000, protein: 100, fat: 70, carbs: 242 } }));
  let target = budgetFn(date).target;
  let splitMap = options.mealSplit || (typeof MEAL_SPLIT !== 'undefined' ? MEAL_SPLIT : { breakfast: .25, lunch: .35, dinner: .4 });
  let share = all ? 1 : (splitMap[meal] || 0);
  let sumFn = options.sumFor || (typeof sumFor === 'function' ? sumFor : () => ({ kcal: 0, protein: 0, fat: 0, carbs: 0 }));
  let used = all ? sumFn(date) : sumFn(date, meal);
  let fmt = v => Math.round(+v || 0);
  let label = all ? (uk ? 'весь день' : 'the whole day') : (uk ? 'прийом «' + tFn(meal).toLowerCase() + '»' : 'the ' + tFn(meal).toLowerCase() + ' meal');
  let rows = items.map(f => `- ${String(f.name || '').slice(0, 80)}: ${fmt(f.grams)} g, ${fmt(f.kcal)} kcal, protein ${fmt(f.protein)} g, fat ${fmt(f.fat)} g, carbs ${fmt(f.carbs)} g`).join('\n');
  let goal = `${fmt(target.kcal * share)} kcal, protein ${fmt(target.protein * share)} g, fat ${fmt(target.fat * share)} g, carbs ${fmt(target.carbs * share)} g`;

  let missLine = !all ? '' : (() => {
    let hour = options.hour ?? new Date().getHours();
    let todayIso = options.todayIso || (typeof iso === 'function' ? iso() : '');
    let isToday = date === todayIso;
    let now = new Date();
    let clock = options.clock || (String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
    let order = ['breakfast', 'lunch', 'dinner'];
    let stateFoods = options.foods || (typeof state !== 'undefined' && state?.foods) || [];
    let has = options.hasMeal || (m => stateFoods.some(f => f.date === date && f.meal === m && (typeof foodIsCounted === 'function' ? foodIsCounted(f) : true)));
    let pending = order.filter(m => !has(m));
    let laterLogged = m => order.slice(order.indexOf(m) + 1).some(has);
    let cut = { breakfast: 12, lunch: 16, dinner: 24 };
    let skipped = pending.filter(laterLogged).map(m => tFn(m).toLowerCase());
    let late = pending.filter(m => !laterLogged(m) && (!isToday || hour >= cut[m])).map(m => tFn(m).toLowerCase());
    let ahead = pending.filter(m => !laterLogged(m) && isToday && hour < cut[m]).map(m => tFn(m).toLowerCase());
    let L = [uk ? `Поточний час: ${clock}.` : `Current time: ${clock}.`];
    if (skipped.length) L.push(uk ? `Не записано, але пізніші прийоми вже є: ${skipped.join(', ')}. Ймовірно, їх пропущено.` : `Not logged, but later meals are already recorded: ${skipped.join(', ')}. These were most likely skipped.`);
    if (late.length) L.push(uk ? `Не записано, хоча звичний час уже минув: ${late.join(', ')}. Це могло бути пропущено, а могло бути не внесено, тому не стверджуй напевно.` : `Not logged although the usual time has passed: ${late.join(', ')}. It may have been skipped or simply not recorded, so do not state it as certain.`);
    if (ahead.length) L.push(uk ? `Ще попереду сьогодні: ${ahead.join(', ')}. Не вважай їх пропущеними.` : `Still ahead today: ${ahead.join(', ')}. Do not treat them as skipped.`);
    if (!pending.length) L.push(uk ? 'Усі основні прийоми їжі вже записано.' : 'All main meals are already logged.');
    L.push(uk ? 'Якщо прийом пропущено, не пропонуй компенсувати його голодуванням чи жорсткими обмеженнями. Дай звичайну пораду для наступного прийому.' : 'If a meal was skipped, do not suggest making up for it with fasting or strict restriction. Give a normal tip for the next meal.');
    L.push(uk ? `Залишок на решту дня: ${fmt(target.kcal - used.kcal)} kcal (від’ємне значення означає перевищення).` : `Remaining for the rest of the day: ${fmt(target.kcal - used.kcal)} kcal (a negative value means over the target).`);
    return L.join('\n');
  })();

  let sum = `${fmt(used.kcal)} kcal, protein ${fmt(used.protein)} g, fat ${fmt(used.fat)} g, carbs ${fmt(used.carbs)} g`;

  return uk
    ? `Ти — загальний помічник з харчування, не лікар. Проаналізуй ${label} за записами щоденника користувача. Відповідай українською, коротко і простим текстом, без JSON і таблиць. Структура: 1) оцінка у 2–3 реченнях: чи збалансовано відносно орієнтирів; 2) чого бракує або чого забагато; 3) 2–3 прості конкретні поради для наступного прийому їжі або решти дня. Не вважай нові продукти вже з’їденими. Цифри є оцінкою. Медичні питання передай лікарю.\nОрієнтир: ${goal}.\n${missLine}\nЗаписи:\n${rows}\nРазом: ${sum}.`
    : `You are a general nutrition assistant, not a doctor. Analyze ${label} from the user's diary entries. Answer in English, briefly and in plain text, without JSON or tables. Structure: 1) an assessment in 2-3 sentences: is it balanced against the targets; 2) what is missing or too much; 3) 2-3 simple, concrete tips for the next meal or the rest of the day. Do not treat new foods as already eaten. Numbers are estimates. Refer medical questions to a clinician.\nTarget: ${goal}.\n${missLine}\nEntries:\n${rows}\nTotal: ${sum}.`;
}

function askPrompt(prior, q, options = {}) {
  let currentLang = options.lang || getLang();
  let uk = currentLang === 'uk';
  let who = r => r === 'user' ? (uk ? 'Користувач' : 'User') : (uk ? 'Асистент' : 'Assistant');
  let convo = (prior || []).map(m => `${who(m.role)}: ${m.text}`).join('\n');
  let s = getState();
  let v = options.verbosity || s?.prefs?.aiVerbosity || 'balanced';
  let style = uk
    ? (v === 'brief' ? 'Відповідай дуже коротко: 1–3 речення або короткі тези, лише суть.' : v === 'detailed' ? 'Відповідай розгорнуто, з докладними поясненнями та практичними прикладами.' : 'Відповідай збалансовано: 1–2 зрозумілі абзаци або короткий список.')
    : (v === 'brief' ? 'Answer very briefly: 1-3 sentences or short bullets, only the essentials.' : v === 'detailed' ? 'Answer in detail with thorough explanation and practical examples.' : 'Answer in a balanced length: 1-2 clear paragraphs or a short list.');
  let clarity = uk
    ? "Відповідай максимально виразно, внятно, зрозуміло та по суті, без заплутаних чи незрозумілих формулювань. Структуруй думку так, щоб читач одразу зрозумів головне."
    : "Answer as clearly, coherently, and articulately as possible, straight to the point without confusing or convoluted phrasing. Structure your thoughts so the key takeaway is immediately obvious.";

  return uk
    ? `Ти — загальний помічник з харчування, не лікар. Відповідай українською. ${clarity} ${style} Звичайні відповіді пиши текстом. Якщо у відповіді рекомендуєш конкретні продукти, які користувач може додати до раціону, поверни валідний JSON без markdown у форматі {"items":[{"name":"Вівсянка","grams":50,"kcal":190,"protein":7,"fat":3,"carbs":32}],"summary":"Коротка порада"}; у кожному продукті вкажи невелику реалістичну порцію та всі числові значення поживності як приблизні оцінки. Не повертай items для загальних пояснень чи порівнянь, якщо користувач не просить рекомендації продуктів. Не використовуй і не запитуй особисті дані користувача. На медичні питання порадь звернутися до лікаря. Цифри подавай як орієнтир.${convo ? `\n\nПопередня розмова:\n${convo}` : ''}\n\nПитання: ${q}`
    : `You are a general nutrition assistant, not a doctor. Answer in English. ${clarity} ${style} Write ordinary replies as plain text. When recommending specific foods the user could add to their diary, return valid JSON without markdown in this format: {"items":[{"name":"Oats","grams":50,"kcal":190,"protein":7,"fat":3,"carbs":32}],"summary":"Brief practical advice"}; include a realistic small serving and every numeric nutrition value as an approximate estimate for each item. Do not return items for general explanations or comparisons unless the user asks for food recommendations. Do not use or ask for personal data. For medical questions, advise seeing a clinician. Numbers are estimates.${convo ? `\n\nEarlier conversation:\n${convo}` : ''}\n\nQuestion: ${q}`;
}

function parseAskProductReply(text, options = {}) {
  let limName = (typeof LIM !== 'undefined' && LIM.name) ? LIM.name : 120;
  let limNum = (typeof LIM !== 'undefined' && LIM.num) ? LIM.num : 10000;
  let clean = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    let data = JSON.parse(clean);
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return null;
    let products = data.items.map(x => {
      if (!x || typeof x !== 'object') return null;
      let n = k => x[k], pick = (...keys) => {
        for (let k of keys) if (n(k) !== undefined && n(k) !== null && n(k) !== '') return n(k);
        return null;
      }, values = {
        grams: pick('grams', 'amount_g'),
        kcal: pick('kcal', 'calories_kcal'),
        protein: pick('protein', 'protein_g'),
        fat: pick('fat', 'fat_g'),
        carbs: pick('carbs', 'carbs_g')
      }, name = String(x.name || '').trim().slice(0, limName);
      if (!name || Object.values(values).some(v => v === null || !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > limNum) || !(Number(values.grams) > 0)) return null;
      return { name, grams: Number(values.grams), kcal: Number(values.kcal), protein: Number(values.protein), fat: Number(values.fat), carbs: Number(values.carbs) };
    }).filter(Boolean);
    return products.length ? { data, products } : null;
  } catch (_) {
    return null;
  }
}

function formatDietitianReply(text, options = {}) {
  let raw = String(text || '').trim(), clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!((clean.startsWith('{') && clean.endsWith('}')) || (clean.startsWith('[') && clean.endsWith(']')))) return raw;
  try {
    let data = JSON.parse(clean), parts = [];
    let uk = (options.lang || getLang()) === 'uk';
    if (Array.isArray(data.comparison)) data.comparison.forEach(x => {
      if (!x) return;
      let line = '• ' + (x.name || ''), nums = [];
      if (x.calories_kcal != null) nums.push(x.calories_kcal + ' kcal');
      if (x.protein_g != null) nums.push((uk ? 'Б: ' : 'P: ') + x.protein_g + ' g');
      if (x.fat_g != null) nums.push((uk ? 'Ж: ' : 'F: ') + x.fat_g + ' g');
      if (x.carbs_g != null) nums.push((uk ? 'В: ' : 'C: ') + x.carbs_g + ' g');
      if (x.sugar_g != null) nums.push((uk ? 'цукри: ' : 'sugar: ') + x.sugar_g + ' g');
      if (nums.length) line += ' (' + nums.join(', ') + ')';
      if (x.notes) line += ' — ' + x.notes;
      parts.push(line);
    });
    if (Array.isArray(data.items)) data.items.forEach(x => {
      if (!x) return;
      let line = '• ' + (x.name || '');
      if (x.grams != null) line += ' ' + x.grams + ' g';
      if (x.kcal != null) line += ' (' + x.kcal + ' kcal)';
      if (x.notes || x.note) line += ' — ' + (x.notes || x.note);
      parts.push(line);
    });
    if (data.summary) parts.push(data.summary);
    if (data.note && !parts.includes(data.note)) parts.push(data.note);
    if (data.answer) parts.push(data.answer);
    if (parts.length) return parts.join('\n\n');
    return Object.entries(data).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
  } catch (_) {
    return raw;
  }
}

function dailyRecommendationPrompt(p, c, rec, maintenance, currentLang) {
  let uk = (currentLang || getLang()) === 'uk';
  let age = (typeof ageOf === 'function' ? ageOf(p) : p?.age);
  let pWeight = (typeof planWeight === 'function' ? planWeight(p) : (p?.calculationWeight || p?.currentWeight || 0));
  return uk
    ? `Напиши коротке пояснення (2–3 речення) до добової цілі для дорослого. Профіль: вік ${age}; стать ${p.sex}; зріст ${p.height} см; поточна вага ${pWeight} кг; ${maintenance ? 'мета — підтримувати поточну вагу' : 'цільова вага ' + p.targetWeight + ' кг'}; активність ${p.activity}. Розраховано: підтримка ≈ ${c.tdee} ккал/день, ціль ${c.kcal} ккал/день, темп ≈ ${c.pace} кг/тиждень, білок ${rec.protein} г. Поверни тільки JSON: {"note":"пояснення українською"}. Не змінюй числа, не обіцяй терміни. Якщо ціль може бути небезпечною, порадь звернутися до медичного фахівця.`
    : `Write a brief explanation (2-3 sentences) of the daily target for an adult. Profile: age ${age}; sex ${p.sex}; height ${p.height} cm; current weight ${pWeight} kg; ${maintenance ? 'goal is to maintain current weight' : 'target weight ' + p.targetWeight + ' kg'}; activity ${p.activity}. Calculated: maintenance ≈ ${c.tdee} kcal/day, target ${c.kcal} kcal/day, pace ≈ ${c.pace} kg/week, protein ${rec.protein} g. Return only JSON: {"note":"explanation in English"}. Do not change the numbers or promise timelines. If the goal may be unsafe, recommend a clinician.`;
}

// Global browser / Node.js export compatibility
if (typeof window !== 'undefined') {
  window.AI_IDS = AI_IDS;
  window.AI_AUTO_PROVIDERS = AI_AUTO_PROVIDERS;
  window.AI_MODEL_RE = AI_MODEL_RE;
  window.AI_BUDGET_MS = AI_BUDGET_MS;
  window.AI_SWITCH_PAUSE_MS = AI_SWITCH_PAUSE_MS;
  window.AI_MODELS = AI_MODELS;
  window.aiModelUsed = aiModelUsed;
  window.lastAi = lastAi;
  window.aiAutoAllowed = aiAutoAllowed;
  window.aiTimeLeft = aiTimeLeft;
  window.aiFetch = aiFetch;
  window.callGemini = callGemini;
  window.callOpenAICompat = callOpenAICompat;
  window.callAnthropic = callAnthropic;
  window.AI_PROVIDERS = AI_PROVIDERS;
  window.aiModelChoice = aiModelChoice;
  window.aiModelsFor = aiModelsFor;
  window.modelsFromUi = modelsFromUi;
  window.aiModelUi = aiModelUi;
  window.fillAiModelSelects = fillAiModelSelects;
  window.testAiModel = testAiModel;
  window.aiActive = aiActive;
  window.callAi = callAi;
  window.requestAdvice = requestAdvice;
  window.nutritionPrompt = nutritionPrompt;
  window.isNumVal = isNumVal;
  window.badAiMsg = badAiMsg;
  window.parseNutrition = parseNutrition;
  window.requestNutrition = requestNutrition;
  window.mealPlanPrompt = mealPlanPrompt;
  window.parseMealPlanItems = parseMealPlanItems;
  window.analysisPrompt = analysisPrompt;
  window.askPrompt = askPrompt;
  window.parseAskProductReply = parseAskProductReply;
  window.formatDietitianReply = formatDietitianReply;
  window.dailyRecommendationPrompt = dailyRecommendationPrompt;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AI_IDS,
    AI_AUTO_PROVIDERS,
    AI_MODEL_RE,
    AI_BUDGET_MS,
    AI_SWITCH_PAUSE_MS,
    AI_MODELS,
    aiAutoAllowed,
    aiTimeLeft,
    aiFetch,
    callGemini,
    callOpenAICompat,
    callAnthropic,
    AI_PROVIDERS,
    aiModelChoice,
    aiModelsFor,
    modelsFromUi,
    aiModelUi,
    fillAiModelSelects,
    testAiModel,
    aiActive,
    callAi,
    requestAdvice,
    nutritionPrompt,
    isNumVal,
    badAiMsg,
    parseNutrition,
    requestNutrition,
    mealPlanPrompt,
    parseMealPlanItems,
    analysisPrompt,
    askPrompt,
    parseAskProductReply,
    formatDietitianReply,
    dailyRecommendationPrompt
  };
}
