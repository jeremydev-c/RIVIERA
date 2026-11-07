import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { createApp } from './app.js';

const PASSWORD = 'test-committee-password';
let server;
let base;
let app;
let mongo;
let adminCookie;

const send = async (url, { method = 'GET', body, cookie } = {}) => {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: isForm ? body : body && JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  return {
    status: res.status,
    cookie: (res.headers.getSetCookie()[0] || '').split(';')[0],
    data: type.includes('json') ? await res.json() : await res.text(),
  };
};

const photo = () => sharp({ create: { width: 200, height: 300, channels: 3, background: '#c9a24a' } }).jpeg().toBuffer();

const nominate = async (name, category, overrides = {}) => {
  const form = new FormData();
  form.set('name', name);
  form.set('category', category);
  form.set('consent', 'on');
  form.set('portrait', new Blob([await photo()], { type: 'image/jpeg' }), 'p.jpg');
  Object.entries(overrides).forEach(([k, v]) => form.set(k, v));
  return send('/api/nominate', { method: 'POST', body: form });
};

before(async () => {
  mongo = await MongoMemoryServer.create();
  app = await createApp({ mongoUri: mongo.getUri(), adminPassword: PASSWORD });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await app.locals.close();
  await mongo.stop();
});

test('the page ships its content and share image in the raw HTML', async () => {
  const { status, data } = await send('/');
  assert.equal(status, 200);
  assert.match(data, /og:image/);
  assert.match(data, /KES 2,400/);
  assert.match(data, /Westlands/);
  assert.doesNotMatch(data, /%%SITE_URL%%/);
});

test('every page has its own title and the shared navigation', async () => {
  const titles = new Set();
  for (const path of ['/tickets', '/invite', '/dress-code', '/lineup', '/royal-court', '/menu', '/questions']) {
    const { status, data } = await send(path);
    assert.equal(status, 200);
    titles.add(data.match(/<title>(.*?)<\/title>/)[1]);
    assert.match(data, new RegExp(`href="${path}" aria-current="page"`));
    assert.doesNotMatch(data, /%%[A-Z_]+%%/);
  }
  assert.equal(titles.size, 7);
  const old = await fetch(`${base}/royal-vote`, { redirect: 'manual' });
  assert.equal(old.headers.get('location'), '/royal-court');
  assert.equal((await send('/nothing-here')).status, 404);
});

test('sharing, Instagram and calendar are on the page', async () => {
  const { data } = await send('/tickets');
  assert.match(data, /https:\/\/wa\.me\/\?text=.*%2Ftickets/);
  assert.match(data, /instagram\.com\/the\.grand\.riviera/);
  assert.match(data, /data-calendar/);
  const calendar = await fetch(`${base}/grand-riviera.ics`);
  const body = await calendar.text();
  assert.match(calendar.headers.get('content-type'), /text\/calendar/);
  assert.match(body, /DTSTART:20261204T150000Z\r\nDTEND:20261204T210000Z/);
  assert.match(body, /LOCATION:The Event Space\\, Westlands/);
});

test('pages still load when the database is missing', async () => {
  const offline = await createApp({ adminPassword: PASSWORD });
  const offlineServer = await new Promise((resolve) => { const s = offline.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${offlineServer.address().port}`;
  for (const path of ['/', '/tickets', '/dress-code', '/invite', '/menu', '/grand-riviera.ics']) {
    assert.equal((await fetch(url + path)).status, 200, path);
  }
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 503);
  assert.equal((await health.json()).problem, 'MONGODB_URI is not set');
  const state = await fetch(`${url}/api/state`);
  assert.equal(state.status, 500);
  assert.match((await state.json()).error, /try again/);
  await new Promise((resolve) => offlineServer.close(resolve));
  await offline.locals.close();
});

test('the health check reports a working database', async () => {
  const { status, data } = await send('/api/health');
  assert.equal(status, 200);
  assert.deepEqual(data, { database: 'ok', committeeLogin: true });
});

test('board starts from the old counts and hides champagne', async () => {
  const { data } = await send('/api/state');
  assert.equal(data.stage, 'nominations');
  assert.equal(data.dishes[0].name, 'Ice Cream');
  assert.equal(data.dishes[0].count, 9);
  assert.ok(!data.dishes.some((d) => d.name === 'Champagne'));
  assert.ok(data.lineup.every((a) => !a.revealed && !('name' in a)));
});

test('enquiry validates and stores', async () => {
  assert.equal((await send('/api/enquiry', { method: 'POST', body: { name: 'A', email: 'nope' } })).status, 400);
  const ok = await send('/api/enquiry', { method: 'POST', body: { name: 'Amina', email: 'amina@example.com', guests: 4 } });
  assert.equal(ok.status, 201);
});

test('backing a dish toggles and counts one per person', async () => {
  const first = await send('/api/state');
  const cookie = first.cookie;
  const dish = first.data.dishes.find((d) => d.name === 'Gaks');
  const on = await send(`/api/dishes/${dish.id}/back`, { method: 'POST', cookie });
  assert.equal(on.data.dishes.find((d) => d.id === dish.id).count, dish.count + 1);
  const off = await send(`/api/dishes/${dish.id}/back`, { method: 'POST', cookie });
  assert.equal(off.data.dishes.find((d) => d.id === dish.id).count, dish.count);
});

test('a suggested dish waits for the committee', async () => {
  await send('/api/dishes', { method: 'POST', body: { name: 'Pilau', category: 'Mains' } });
  const { data } = await send('/api/state');
  assert.ok(!data.dishes.some((d) => d.name === 'Pilau'));
});

test('admin routes need a login', async () => {
  assert.equal((await send('/api/admin/data')).status, 401);
  assert.equal((await send('/api/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  const login = await send('/api/admin/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(login.status, 200);
  adminCookie = login.cookie;
  assert.equal((await send('/api/admin/data', { cookie: adminCookie })).status, 200);
});

test('a login works on any server and cannot be forged', async () => {
  const other = await createApp({ mongoUri: mongo.getUri(), adminPassword: PASSWORD });
  const otherServer = await new Promise((resolve) => { const s = other.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${otherServer.address().port}/api/admin/data`;
  assert.equal((await fetch(url, { headers: { Cookie: adminCookie } })).status, 200);
  const forged = adminCookie.replace(/=\d+\./, `=${Date.now() + 9e9}.`);
  assert.equal((await fetch(url, { headers: { Cookie: forged } })).status, 401);
  await new Promise((resolve) => otherServer.close(resolve));
  await other.locals.close();
});

test('nomination needs portrait and consent, and rejects non-images', async () => {
  const noConsent = await nominate('Test', 'king', { consent: 'off' });
  assert.equal(noConsent.status, 400);
  const bad = new FormData();
  bad.set('name', 'Test');
  bad.set('category', 'king');
  bad.set('consent', 'on');
  bad.set('portrait', new Blob(['not an image'], { type: 'image/jpeg' }), 'p.jpg');
  assert.equal((await send('/api/nominate', { method: 'POST', body: bad })).status, 400);
});

test('full royal court: moderation, voting once, codes, crowning', async () => {
  const cookie = adminCookie;
  assert.equal((await nominate('Baraka', 'king')).status, 201);
  assert.equal((await nominate('Otieno', 'king')).status, 201);
  assert.equal((await nominate('Wanjiru', 'queen')).status, 201);
  let { data } = await send('/api/admin/data', { cookie });
  const byName = Object.fromEntries(data.nominations.map((n) => [n.name, n]));

  // A pending portrait is private.
  assert.equal((await send(`/portraits/${byName.Baraka.photo}`)).status, 404);

  for (const name of ['Baraka', 'Otieno', 'Wanjiru']) {
    await send(`/api/admin/nominations/${byName[name].id}`, { method: 'PATCH', cookie, body: { status: 'approved' } });
  }
  assert.equal((await send(`/portraits/${byName.Baraka.photo}`)).status, 200);

  const early = await fetch(`${base}/vote/${byName.Baraka.id}`, { redirect: 'manual' });
  assert.equal(early.headers.get('location'), '/royal-court');

  await send('/api/admin/settings', { method: 'PATCH', cookie, body: { stage: 'ballot' } });
  const shared = await send(`/vote/${byName.Baraka.id}`);
  assert.match(shared.data, /<title>Vote for Baraka · Prom King<\/title>/);
  assert.match(shared.data, new RegExp(`/vote/${byName.Baraka.id}/card\\.jpg`));
  assert.match(shared.data, new RegExp(`data-focus="${byName.Baraka.id}"`));
  const preview = await fetch(`${base}/vote/${byName.Baraka.id}/card.jpg`);
  assert.equal((await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width, 1200);
  assert.equal((await send('/api/state')).data.nominees.length, 3);
  assert.equal((await send('/api/vote', { method: 'POST', body: { nomineeId: byName.Baraka.id } })).status, 409);
  assert.equal((await nominate('Late', 'king')).status, 409);

  await send('/api/admin/settings', { method: 'PATCH', cookie, body: { stage: 'voting' } });
  const noCode = await send('/api/vote', { method: 'POST', body: { nomineeId: byName.Baraka.id } });
  assert.equal(noCode.status, 403);
  const wrong = await send('/api/vote', { method: 'POST', body: { nomineeId: byName.Baraka.id, code: 'WRONG' } });
  assert.equal(wrong.status, 403);

  await send('/api/admin/codes', { method: 'POST', cookie, body: { count: 2 } });
  const csv = (await send('/api/admin/codes.csv', { cookie })).data;
  const code = csv.split('\r\n')[1];
  assert.equal((await send('/api/vote', { method: 'POST', body: { nomineeId: byName.Baraka.id, code: code.toLowerCase() } })).status, 201);
  const again = await send('/api/vote', { method: 'POST', body: { nomineeId: byName.Otieno.id, code } });
  assert.equal(again.status, 409);
  assert.match(again.data.error, /already voted for Prom King/);
  assert.equal((await send('/api/vote', { method: 'POST', body: { nomineeId: byName.Wanjiru.id, code } })).status, 201);

  const card = (await send(`/api/state?code=${code.toLowerCase()}`)).data;
  assert.deepEqual(card.code, { value: code, valid: true });
  assert.equal(card.myVotes.king, byName.Baraka.id);
  assert.equal(card.myVotes.queen, byName.Wanjiru.id);
  assert.equal((await send('/api/state?code=NOPE')).data.code.valid, false);

  const committee = (await send('/api/admin/data', { cookie })).data;
  assert.equal(committee.codeCount, 2);
  assert.equal(committee.cardsUsed, 1);
  const locked = await fetch(`${base}/committee/cards`, { redirect: 'manual' });
  assert.equal(locked.headers.get('location'), '/committee');
  const sheet = await send('/committee/cards', { cookie });
  assert.match(sheet.data, new RegExp(`class="code">${code}<`));
  const expectedQr = await QRCode.toString(`${base}/royal-court?code=${code}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  assert.ok(sheet.data.includes(expectedQr), 'the QR code opens the vote with this card filled in');
  assert.equal((sheet.data.match(/<article class="card">/g) ?? []).length, 2);
  assert.match(sheet.data, /<svg[^>]*viewBox="0 0 \d+ \d+"/);

  await send('/api/admin/settings', { method: 'PATCH', cookie, body: { stage: 'crowned' } });
  const { results } = (await send('/api/state')).data;
  assert.equal(results.king[0].name, 'Baraka');
  assert.equal(results.queen[0].name, 'Wanjiru');
});

test('a revealed act appears publicly', async () => {
  const cookie = adminCookie;
  const { data } = await send('/api/admin/data', { cookie });
  await send(`/api/admin/lineup/${data.lineup[0].id}`, { method: 'PATCH', cookie, body: { name: 'The Quartet', role: 'Live band', revealed: true } });
  const { lineup } = (await send('/api/state')).data;
  assert.equal(lineup[0].name, 'The Quartet');
  assert.equal(lineup[1].revealed, false);
});

test('spreadsheet export neutralises formulas', async () => {
  await send('/api/enquiry', { method: 'POST', body: { name: '=HYPERLINK("x")', email: 'b@example.com' } });
  const { data } = await send('/api/admin/enquiries.csv', { cookie: adminCookie });
  assert.match(data, /"'=HYPERLINK/);
});
