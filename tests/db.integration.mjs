// Database checks for the dedicated TEST Supabase project.
// Creates throwaway users, checks RLS, friend and product-share rules and account deletion, then removes the users.
// Uses Node 22 built-in fetch only.
import { randomUUID } from 'node:crypto';

const PRODUCTION_REF = 'wscprmtjjbevesrchhjr';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const BASE = env('TEST_SUPABASE_URL').replace(/\/+$/, '');
const ANON = env('TEST_SUPABASE_ANON_KEY');
const SERVICE = env('TEST_SUPABASE_SERVICE_ROLE_KEY');

let baseUrl;
try {
  baseUrl = new URL(BASE);
} catch (e) {
  throw new Error(`Invalid TEST_SUPABASE_URL: ${e.message}`);
}
const testHostMatch = baseUrl.hostname.match(/^([a-z0-9_-]+)\.supabase\.co$/i);
if (!testHostMatch) {
  throw new Error(`TEST_SUPABASE_URL hostname '${baseUrl.hostname}' does not match expected pattern <project-ref>.supabase.co`);
}
const testProjectRef = testHostMatch[1].toLowerCase();
if (testProjectRef === PRODUCTION_REF.toLowerCase() || BASE.toLowerCase().includes(PRODUCTION_REF.toLowerCase())) {
  throw new Error(`Refusing to run: TEST_SUPABASE_URL points to the production project (${PRODUCTION_REF}).`);
}

const dbUrlStr = process.env.TEST_DATABASE_URL;
if (dbUrlStr) {
  let dbUrl;
  try {
    dbUrl = new URL(dbUrlStr);
  } catch (e) {
    throw new Error(`Invalid TEST_DATABASE_URL: ${e.message}`);
  }
  if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol)) {
    throw new Error('TEST_DATABASE_URL must use PostgreSQL protocol.');
  }
  const dbHost = dbUrl.hostname.toLowerCase();
  const dbUser = decodeURIComponent(dbUrl.username).toLowerCase();
  if (dbHost === `db.${PRODUCTION_REF}.supabase.co` || dbUser.endsWith(`.${PRODUCTION_REF}`)) {
    throw new Error(`Refusing to run: TEST_DATABASE_URL points to the production project (${PRODUCTION_REF}).`);
  }
  if (!/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(dbHost) || dbUser !== `postgres.${testProjectRef}`) {
    throw new Error(`TEST_DATABASE_URL must use the IPv4-reachable Supabase pooler and username postgres.${testProjectRef}.`);
  }
}

const runId = randomUUID().slice(0, 8);
const PASSWORD = `${randomUUID()}Aa1!`;
const emails = {
  a: `ci-${runId}-a@example.com`,
  b: `ci-${runId}-b@example.com`,
  c: `ci-${runId}-c@example.com`,
};
const ids = {};
const tokens = {};
let failures = 0;

const eq = (value) => `eq.${value}`;
const rows = (r) => (Array.isArray(r.json) ? r.json.length : -1);
const denied = (r) => r.status >= 400;
const emptyOrDenied = (r) => denied(r) || (Array.isArray(r.json) && r.json.length === 0);
const describe = (r) => `HTTP ${r.status}${r.json?.message ? `: ${r.json.message}` : ''}`;

function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok && detail) console.log(`     ${detail}`);
}

async function call(method, path, { key = ANON, token, body, prefer } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${token ?? key}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function rest(name, { as, method = 'GET', query = '', body, prefer } = {}) {
  const service = as === 'service';
  return call(method, `/rest/v1/${name}${query ? `?${query}` : ''}`, {
    key: service ? SERVICE : ANON,
    token: as && !service ? tokens[as] : undefined,
    body,
    prefer,
  });
}

function rpc(name, { as, body }) {
  return call('POST', `/rest/v1/rpc/${name}`, { token: as ? tokens[as] : undefined, body });
}

const admin = (method, path, body) => call(method, `/auth/v1/admin${path}`, { key: SERVICE, body });

async function createUser(key) {
  const r = await admin('POST', '/users', { email: emails[key], password: PASSWORD, email_confirm: true });
  if (r.status >= 300 || !r.json?.id) throw new Error(`Could not create test user ${key}: ${describe(r)}`);
  ids[key] = r.json.id;
}

async function signIn(key) {
  const r = await call('POST', '/auth/v1/token?grant_type=password', {
    body: { email: emails[key], password: PASSWORD },
  });
  if (!r.json?.access_token) throw new Error(`Could not sign in test user ${key}: ${describe(r)}`);
  tokens[key] = r.json.access_token;
}

const shareBody = (from, to, name) => ({
  from_user: from, to_user: to, name, grams: 100, kcal: 200, protein: 10, fat: 5, carbs: 20,
});

async function run() {
  let r;
  for (const key of ['a', 'b', 'c']) await createUser(key);
  for (const key of ['a', 'b', 'c']) await signIn(key);

  const A = ids.a;
  const B = ids.b;
  const C = ids.c;
  const day = new Date().toISOString().slice(0, 10);

  // Owner writes
  r = await rest('food_entries', {
    as: 'a', method: 'POST', prefer: 'return=representation',
    body: { user_id: A, name: 'CI oatmeal', meal_type: 'breakfast', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60, entry_date: day, components: [{ id: 'c-oats', name: 'Oats', grams: 100, kcal: 350, protein: 12, fat: 6, carbs: 60, enabled: true }] },
  });
  const foodId = r.json?.[0]?.id;
  check('Owner can insert a food entry', r.status === 201 && !!foodId, describe(r));

  r = await rest('weight_entries', { as: 'a', method: 'POST', body: { user_id: A, value: 97, entry_date: day } });
  check('Owner can insert a weigh-in', r.status === 201, describe(r));

  r = await rest('products', {
    as: 'a', method: 'POST',
    body: { user_id: A, name: 'CI product', grams: 100, kcal: 200, protein: 10, fat: 5, carbs: 20, verified: true },
  });
  check('Owner can insert a product', r.status === 201, describe(r));

  r = await rest('user_profiles', { as: 'a', method: 'POST', body: { user_id: A, data: { name: 'CI A', goals: { kcal: 2000 } } } });
  check('Owner can save a profile document', r.status === 201, describe(r));

  r = await rest('food_entries', { as: 'a', query: `user_id=${eq(A)}&select=id` });
  check('Owner reads own food entries', rows(r) === 1, describe(r));
  r = await rest('weight_entries', { as: 'a', query: `user_id=${eq(A)}&select=id` });
  check('Owner reads own weigh-ins', rows(r) === 1, describe(r));
  r = await rest('products', { as: 'a', query: `user_id=${eq(A)}&select=id` });
  check('Owner reads own products', rows(r) === 1, describe(r));
  r = await rest('food_entries', { as: 'a', query: `id=${eq(foodId)}&select=components` });
  check('Diary entry keeps its dish ingredients', Array.isArray(r.json?.[0]?.components) && r.json[0].components[0]?.id === 'c-oats', describe(r));
  r = await rest('products', { as: 'a', query: `user_id=${eq(A)}&select=verified` });
  check('Product verified flag is stored', Array.isArray(r.json) && r.json[0]?.verified === true, describe(r));
  r = await rest('user_profiles', { as: 'a', query: `user_id=${eq(A)}&select=user_id` });
  check('Owner reads own profile document', rows(r) === 1, describe(r));

  // Anonymous visitor access verified after private rows are seeded
  let rAnon = await rest('food_entries');
  check('Anonymous visitor cannot read food diary when entries exist', emptyOrDenied(rAnon), describe(rAnon));
  rAnon = await rest('user_profiles');
  check('Anonymous visitor cannot read synced profiles when rows exist', emptyOrDenied(rAnon), describe(rAnon));
  rAnon = await rest('weight_entries');
  check('Anonymous visitor cannot read weight entries when rows exist', emptyOrDenied(rAnon), describe(rAnon));
  r = await rest('products', {
    as: 'a', method: 'POST',
    body: { user_id: A, name: 'CI companion product', grams: 100, kcal: 50, protein: 0, fat: 0, carbs: 10, companions: [{ id: '22222222-2222-4222-8222-222222222222', grams: 30 }] },
  });
  check('Owner can save a product with usual add-ons', r.status === 201, describe(r));
  r = await rest('products', { as: 'a', query: `user_id=${eq(A)}&name=${eq('CI companion product')}&select=companions` });
  check('Usual add-ons are read back unchanged', Array.isArray(r.json) && r.json.length === 1 && r.json[0].companions[0].grams === 30, describe(r));
  r = await rest('products', { as: 'a', query: `user_id=${eq(A)}&name=${eq('CI product')}&select=companions` });
  check('Products without add-ons default to an empty list', Array.isArray(r.json) && r.json.length === 1 && Array.isArray(r.json[0].companions) && r.json[0].companions.length === 0, describe(r));

  r = await rest('products', {
    as: 'a', method: 'POST',
    body: { user_id: A, name: 'CI composite product', grams: 250, kcal: 300, protein: 20, fat: 10, carbs: 30, components: [{ id: '22222222-2222-4222-8222-222222222222', grams: 150 }] },
  });
  check('Owner can save a product with recipe components', r.status === 201, describe(r));
  r = await rest('products', { as: 'a', query: `user_id=${eq(A)}&name=${eq('CI composite product')}&select=components` });
  check('Recipe components are read back unchanged', Array.isArray(r.json) && r.json.length === 1 && r.json[0].components[0].grams === 150, describe(r));
  r = await rest('products', { as: 'a', query: `user_id=${eq(A)}&name=${eq('CI product')}&select=components` });
  check('Products without recipe components default to an empty list', Array.isArray(r.json) && r.json.length === 1 && Array.isArray(r.json[0].components) && r.json[0].components.length === 0, describe(r));
  rAnon = await rest('products');
  check('Anonymous visitor cannot read user products when rows exist', emptyOrDenied(rAnon), describe(rAnon));
  rAnon = await rest('profiles');
  check('Anonymous visitor cannot read profiles table', emptyOrDenied(rAnon), describe(rAnon));
  rAnon = await rpc('request_friend', { body: { code: 'AAAAAAAA' } });
  check('Anonymous visitor cannot call request_friend', denied(rAnon), describe(rAnon));
  rAnon = await rpc('app_user_names', { body: {} });
  check('Anonymous visitor cannot call app_user_names', denied(rAnon), describe(rAnon));
  let rLimits = await rest('friend_request_limits', { as: 'a' });
  check('Friend rate-limit table is hidden from users', denied(rLimits), describe(rLimits));

  // Same-day weigh-in upsert, as the app does it
  r = await rest('weight_entries', {
    as: 'a', method: 'POST', query: 'on_conflict=user_id,entry_date',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { user_id: A, value: 96, entry_date: day },
  });
  check('Same-day weigh-in upsert replaces the value', r.status < 300 && Number(r.json?.[0]?.value) === 96, describe(r));
  r = await rest('weight_entries', { as: 'a', query: `user_id=${eq(A)}&select=value` });
  check('Only one weigh-in per day remains', rows(r) === 1 && Number(r.json[0].value) === 96, describe(r));

  // Constraints
  r = await rest('food_entries', { as: 'a', method: 'POST', body: { user_id: A, name: 'bad kcal', kcal: -1, entry_date: day } });
  check('Negative calories are rejected', denied(r), describe(r));
  r = await rest('food_entries', { as: 'a', method: 'POST', body: { user_id: A, name: 'bad meal', meal_type: 'brunch', entry_date: day } });
  check('Unknown meal type is rejected', denied(r), describe(r));
  r = await rest('weight_entries', { as: 'a', method: 'POST', body: { user_id: A, value: 0, entry_date: day } });
  check('Zero weight is rejected', denied(r), describe(r));
  r = await rest('weight_entries', { as: 'a', method: 'POST', body: { user_id: A, value: 95, entry_date: day } });
  check('Duplicate weigh-in for the same day is rejected', denied(r), describe(r));
  r = await rest('user_profiles', {
    as: 'a', method: 'PATCH', query: `user_id=${eq(A)}`, prefer: 'return=representation',
    body: { data: { blob: 'x'.repeat(17000) } },
  });
  check('Oversized profile document is rejected', denied(r), describe(r));

  // Isolation between accounts
  r = await rest('food_entries', { as: 'b', query: `user_id=${eq(A)}&select=id` });
  check('Other user cannot read food entries', emptyOrDenied(r), describe(r));
  r = await rest('weight_entries', { as: 'b', query: `user_id=${eq(A)}&select=id` });
  check('Other user cannot read weigh-ins', emptyOrDenied(r), describe(r));
  r = await rest('products', { as: 'b', query: `user_id=${eq(A)}&select=id` });
  check('Other user cannot read products', emptyOrDenied(r), describe(r));
  r = await rest('user_profiles', { as: 'b', query: `user_id=${eq(A)}&select=user_id` });
  check('Other user cannot read the profile document', emptyOrDenied(r), describe(r));
  r = await rest('food_entries', { as: 'b', method: 'POST', body: { user_id: A, name: 'spoof', kcal: 1, entry_date: day } });
  check('Other user cannot insert under another account', denied(r), describe(r));
  r = await rest('food_entries', {
    as: 'b', method: 'PATCH', query: `id=${eq(foodId)}`, prefer: 'return=representation', body: { name: 'hacked' },
  });
  check('Other user cannot edit a food entry', emptyOrDenied(r), describe(r));
  r = await rest('weight_entries', { as: 'b', method: 'DELETE', query: `user_id=${eq(A)}`, prefer: 'return=representation' });
  check('Other user cannot delete weigh-ins', emptyOrDenied(r), describe(r));
  r = await rest('food_entries', { as: 'a', query: `id=${eq(foodId)}&select=name` });
  check('Food entry is unchanged after the attempts', r.json?.[0]?.name === 'CI oatmeal', describe(r));
  r = await rest('weight_entries', { as: 'a', query: `user_id=${eq(A)}&select=id` });
  check('Weigh-in survives the attempted deletion', rows(r) === 1, describe(r));

  // Friends and product sharing
  r = await rest('profiles', { as: 'a', query: `user_id=${eq(A)}&select=friend_code` });
  const codeA = r.json?.[0]?.friend_code;
  r = await rest('profiles', { as: 'b', query: `user_id=${eq(B)}&select=friend_code` });
  const codeB = r.json?.[0]?.friend_code;
  check('Each user has a friend code', !!codeA && !!codeB, describe(r));

  r = await rest('profiles', { as: 'c', query: `user_id=${eq(A)}&select=user_id` });
  check('Stranger cannot read another profile', emptyOrDenied(r), describe(r));

  r = await rpc('request_friend', { as: 'a', body: { code: codeB } });
  check('Friend request is sent', r.json === 'ok', JSON.stringify(r.json));

  // Friendship is pending: neither participant may read the other's profile yet
  r = await rest('profiles', { as: 'b', query: `user_id=${eq(A)}&select=user_id` });
  check('Addressee cannot read profile while friendship request is pending', emptyOrDenied(r), describe(r));
  r = await rest('profiles', { as: 'a', query: `user_id=${eq(B)}&select=user_id` });
  check('Requester cannot read profile while friendship request is pending', emptyOrDenied(r), describe(r));

  r = await rpc('request_friend', { as: 'b', body: { code: codeA } });
  check('Reverse request accepts the friendship', r.json === 'accepted', JSON.stringify(r.json));
  r = await rpc('request_friend', { as: 'a', body: { code: codeB } });
  check('Repeated request does not create a duplicate', r.json === 'already', JSON.stringify(r.json));
  r = await rpc('request_friend', { as: 'c', body: { code: 'AAAAAAAA' } });
  check('Unknown friend code returns not_found', r.json === 'not_found', JSON.stringify(r.json));

  r = await rest('profiles', { as: 'b', query: `user_id=${eq(A)}&select=user_id` });
  check('Friends can read each other profile', rows(r) === 1, describe(r));

  const recipeComponents = [{ id: 'component-oats', name: 'CI oats', grams: 60, kcal: 230, protein: 8, fat: 4, carbs: 40 }, { id: 'component-milk', name: 'CI milk', grams: 100, kcal: 50, protein: 3, fat: 2, carbs: 5 }];
  r = await rest('product_shares', {
    as: 'a', method: 'POST', prefer: 'return=representation', body: { ...shareBody(A, B, 'CI shared 1'), components: recipeComponents },
  });
  const shareOne = r.json?.[0]?.id;
  check('Friend can receive a shared product', r.status === 201 && !!shareOne, describe(r));
  r = await rest('product_shares', { as: 'b', query: `id=${eq(shareOne)}&select=components` });
  const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
  check('Recipient receives all shared recipe components', JSON.stringify(sortKeys(r.json?.[0]?.components)) === JSON.stringify(sortKeys(recipeComponents)), describe(r));

  r = await rest('product_shares', { as: 'a', method: 'POST', body: shareBody(A, C, 'CI to stranger') });
  check('Cannot share with a non-friend', denied(r), describe(r));
  r = await rest('product_shares', { as: 'b', method: 'POST', body: shareBody(A, B, 'CI spoof') });
  check('Cannot send a share on behalf of another user', denied(r), describe(r));

  r = await rest('product_shares', { as: 'b', query: `to_user=${eq(B)}&select=id` });
  check('Recipient sees the inbox item', rows(r) === 1, describe(r));
  r = await rest('product_shares', { as: 'c', query: `id=${eq(shareOne)}&select=id` });
  check('Stranger cannot see the share', emptyOrDenied(r), describe(r));

  r = await rest('product_shares', { as: 'b', method: 'DELETE', query: `id=${eq(shareOne)}`, prefer: 'return=representation' });
  check('Recipient can remove an inbox item', rows(r) === 1, describe(r));
  r = await rest('product_shares', { as: 'a', query: `from_user=${eq(A)}&select=id` });
  check('Sender no longer sees the removed share', rows(r) === 0, describe(r));

  r = await rest('product_shares', { as: 'a', method: 'POST', prefer: 'return=representation', body: shareBody(A, B, 'CI recall') });
  const shareTwo = r.json?.[0]?.id;
  check('Sender can send a second share', r.status === 201 && !!shareTwo, describe(r));
  r = await rest('product_shares', { as: 'a', method: 'DELETE', query: `id=${eq(shareTwo)}`, prefer: 'return=representation' });
  check('Sender can recall a pending share', rows(r) === 1, describe(r));
  r = await rest('product_shares', { as: 'b', query: `to_user=${eq(B)}&select=id` });
  check('Recalled share is gone from the inbox', rows(r) === 0, describe(r));

  const pair = `or=(and(requester.eq.${A},addressee.eq.${B}),and(requester.eq.${B},addressee.eq.${A}))`;
  r = await rest('friendships', { as: 'a', method: 'DELETE', query: pair, prefer: 'return=representation' });
  check('Either friend can remove the friendship', rows(r) === 1, describe(r));
  r = await rest('profiles', { as: 'b', query: `user_id=${eq(A)}&select=user_id` });
  check('Profile is hidden after unfriending', emptyOrDenied(r), describe(r));
  r = await rest('product_shares', { as: 'a', method: 'POST', body: shareBody(A, B, 'CI after unfriend') });
  check('Cannot share after unfriending', denied(r), describe(r));

  r = await rpc('app_user_names', { as: 'a', body: {} });
  check('Signed-in user can read app user names', Array.isArray(r.json) && r.json.length >= 2, describe(r));
  check('App user names expose only display_name', Array.isArray(r.json) && r.json.every(row => Object.keys(row).join() === 'display_name'), describe(r));

  // Friend invite links: one-time, expiring, and never self-accepted
  r = await rpc('create_friend_invite', { as: 'a', body: {} });
  const inviteToken = r.json;
  check('Inviter gets a 22-character invite token', typeof inviteToken === 'string' && /^[0-9a-f]{22}$/.test(inviteToken), describe(r));
  r = await rpc('create_friend_invite', { as: 'a', body: {} });
  check('Repeated invite request reuses the active token', r.json === inviteToken, describe(r));
  r = await rpc('accept_friend_invite', { as: 'a', body: { invite_token: inviteToken } });
  check('Inviter cannot accept their own invite', r.json === 'self', describe(r));
  r = await rpc('accept_friend_invite', { as: 'c', body: { invite_token: 'not-a-token' } });
  check('Malformed invite token is rejected', r.json === 'invalid', describe(r));
  r = await rpc('accept_friend_invite', { as: 'c', body: { invite_token: inviteToken } });
  check('Invite creates a pending request for the recipient', r.json === 'ok', JSON.stringify(r.json));
  r = await rest('friendships', { as: 'c', query: `requester=${eq(A)}&addressee=${eq(C)}&select=status` });
  check('Recipient sees the invite as a pending request from the inviter', Array.isArray(r.json) && r.json.length === 1 && r.json[0].status === 'pending', describe(r));
  r = await rpc('accept_friend_invite', { as: 'c', body: { invite_token: inviteToken } });
  check('Used invite cannot be reused', r.json === 'used', JSON.stringify(r.json));
  r = await rest('friendships', { as: 'c', method: 'PATCH', query: `requester=${eq(A)}&addressee=${eq(C)}`, body: { status: 'accepted' } });
  check('Recipient confirms the invited request', r.status < 300, describe(r));
  r = await rpc('create_friend_invite', { as: 'b', body: {} });
  const expiredToken = r.json;
  r = await rest('friend_invites', { as: 'service', method: 'PATCH', query: `token=${eq(expiredToken)}`, body: { expires_at: '2000-01-01T00:00:00Z' } });
  r = await rpc('accept_friend_invite', { as: 'c', body: { invite_token: expiredToken } });
  check('Expired invite is rejected', r.json === 'expired', JSON.stringify(r.json));

  // Deleting an account removes its data
  r = await admin('DELETE', `/users/${A}`);
  check('Test account can be deleted', r.status < 300, describe(r));
  if (r.status < 300) delete ids.a;
  for (const name of ['food_entries', 'weight_entries', 'products', 'user_profiles', 'profiles']) {
    r = await rest(name, { as: 'service', query: `user_id=${eq(A)}&select=user_id` });
    check(`Deleting the account removes its ${name}`, rows(r) === 0, describe(r));
  }
}

async function cleanup() {
  for (const key of ['a', 'b', 'c']) {
    if (!ids[key]) continue;
    const r = await admin('DELETE', `/users/${ids[key]}`);
    if (r.status >= 300) {
      failures += 1;
      console.log(`FAIL could not remove test user ${key}: ${describe(r)}`);
    }
  }
}

try {
  await run();
} catch (error) {
  failures += 1;
  console.log(`FAIL unexpected error: ${error.message}`);
}
await cleanup();

console.log(failures ? `\n${failures} database check(s) failed` : '\nAll database checks passed');
process.exitCode = failures ? 1 : 0;
