import express from 'express';
import multer from 'multer';
import compression from 'compression';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSetting, setSetting, DEFAULT_DB } from './db.js';
import { PAGES, renderPage } from './pages.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STAGES = ['nominations', 'ballot', 'voting', 'crowned'];
const CATEGORIES = ['king', 'queen'];
const COURSES = ['Mains', 'Sides', 'Desserts', 'Drinks'];
const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE_YEAR = 365 * 24 * 60 * 60 * 1000;
const UPLOAD_LIMIT = 4 * 1024 * 1024; // Vercel rejects request bodies over 4.5 MB.

const clean = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const cleanBlock = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 160;
const sha = (value) => crypto.createHash('sha256').update(value).digest();
const newId = () => crypto.randomBytes(9).toString('hex');
const parseCookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((c) => c.length === 2));

// Stops a spreadsheet treating a submitted value as a formula.
const csvCell = (value) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

// Passes failures in async routes to the error handler below.
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const timestamp = (date) => (date ? date.toISOString().slice(0, 16).replace('T', ' ') : '');
const withId = ({ _id, ...doc }) => ({ id: _id, ...doc });
const bytes = (binary) => Buffer.from(binary.buffer.subarray(0, binary.position));

export async function createApp({ mongoUri, dbName = DEFAULT_DB, adminPassword, siteUrl = '', secureCookies = false }) {
  // Connects on first use, so pages that need no data still load if the database is down.
  let db;
  let close = async () => {};
  let connecting;
  const ensureDb = () => {
    connecting ??= openDb(mongoUri, dbName).then((opened) => {
      db = opened.db;
      close = opened.close;
    }).catch((error) => {
      connecting = undefined;
      throw error;
    });
    return connecting;
  };
  const collection = (name) => db.collection(name);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_LIMIT, files: 1 },
  });
  const receivePortrait = (req, res) => new Promise((resolve, reject) => {
    upload.single('portrait')(req, res, (error) => (error ? reject(error) : resolve()));
  });

  // Counts live in the database, because each request may reach a different server.
  const limit = (name, max, windowMs) => wrap(async (req, res, next) => {
    const now = Date.now();
    const _id = `${name}:${req.ip}:${Math.floor(now / windowMs)}`;
    let hits = 0;
    try {
      const entry = await collection('limits').findOneAndUpdate(
        { _id },
        { $inc: { hits: 1 }, $setOnInsert: { expires: new Date(now + windowMs) } },
        { upsert: true, returnDocument: 'after' },
      );
      hits = entry.hits;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    if (hits > max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
    next();
  });

  // The login is a signed cookie, so it works on any server without being stored.
  const sign = (expires) => crypto.createHmac('sha256', `riviera-session:${adminPassword}`).update(String(expires)).digest('hex');
  const validSession = (token = '') => {
    const [expires, signature = ''] = token.split('.');
    const expected = sign(expires);
    return signature.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      && Number(expires) > Date.now();
  };

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(compression());
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
        "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));

  // Reports whether the database is reachable, without revealing any connection details.
  app.get('/api/health', wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await ensureDb();
      await db.command({ ping: 1 });
      res.json({ database: 'ok', committeeLogin: Boolean(adminPassword) });
    } catch (error) {
      console.error(error);
      res.status(503).json({
        database: 'unavailable',
        problem: mongoUri ? error.name : 'MONGODB_URI is not set',
        committeeLogin: Boolean(adminPassword),
      });
    }
  }));

  app.use(['/api', '/portraits', '/vote', '/committee/cards'], wrap(async (req, res, next) => {
    await ensureDb();
    next();
  }));

  // Each browser gets an anonymous id, so one person backs a dish or votes once.
  const visitor = (req, res, next) => {
    let id = parseCookies(req).gr_v;
    if (!/^[a-f0-9]{32}$/.test(id || '')) {
      id = crypto.randomBytes(16).toString('hex');
      res.cookie('gr_v', id, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: COOKIE_YEAR });
    }
    req.visitor = id;
    next();
  };

  const origin = (req) => siteUrl || `${req.protocol}://${req.get('host')}`;

  const ballot = async () =>
    (await collection('nominations').find({ status: 'approved' }, { projection: { name: 1, category: 1, photo: 1 } })
      .sort({ name: 1 }).toArray()).map(withId);

  const voteCounts = async () => Object.fromEntries(
    (await collection('votes').aggregate([{ $group: { _id: '$nominee_id', votes: { $sum: 1 } } }]).toArray())
      .map((row) => [row._id, row.votes]),
  );

  const results = async () => {
    const [nominees, counts] = await Promise.all([ballot(), voteCounts()]);
    const out = {};
    for (const category of CATEGORIES) {
      const rows = nominees.filter((n) => n.category === category).map((n) => ({ ...n, votes: counts[n.id] ?? 0 }));
      const top = Math.max(0, ...rows.map((r) => r.votes));
      out[category] = top > 0
        ? rows.filter((r) => r.votes === top).map(({ id, name, photo }) => ({ id, name, photo }))
        : [];
    }
    return out;
  };

  const backCounts = async () => Object.fromEntries(
    (await collection('backs').aggregate([{ $group: { _id: '$dish_id', backs: { $sum: 1 } } }]).toArray())
      .map((row) => [row._id, row.backs]),
  );

  const dishesFor = async (who) => {
    const [dishes, counts, mine] = await Promise.all([
      collection('dishes').find({ status: 'approved' }).toArray(),
      backCounts(),
      collection('backs').find({ visitor: who }, { projection: { dish_id: 1 } }).toArray(),
    ]);
    const backed = new Set(mine.map((b) => b.dish_id));
    return dishes
      .map((d) => ({
        id: d._id, name: d.name, category: d.category, note: d.note,
        count: d.base_count + (counts[d._id] ?? 0), backed: backed.has(d._id),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  // ---- Public API ----------------------------------------------------------

  const codeFrom = (value) => clean(value, 12).toUpperCase();

  // Every vote needs a ballot card code. Sending the code here shows the guest which crowns it has used.
  app.get('/api/state', visitor, wrap(async (req, res) => {
    const stage = await getSetting(db, 'stage');
    const code = codeFrom(req.query.code);
    const [nominees, crowned, lineup, dishes, card, used] = await Promise.all([
      stage === 'nominations' ? [] : ballot(),
      stage === 'crowned' ? results() : null,
      collection('lineup').find().sort({ position: 1 }).toArray(),
      dishesFor(req.visitor),
      code ? collection('codes').findOne({ _id: code }) : null,
      code ? collection('votes').find({ voter: `code:${code}` }).toArray() : [],
    ]);
    res.set('Cache-Control', 'no-store').json({
      stage,
      requireCodes: true,
      code: code ? { value: code, valid: Boolean(card) } : null,
      nominees,
      results: crowned,
      myVotes: Object.fromEntries(used.map((v) => [v.category, v.nominee_id])),
      lineup: lineup.map((a) => (a.revealed
        ? { id: a._id, position: a.position, revealed: true, name: a.name, role: a.role }
        : { id: a._id, position: a.position, revealed: false })),
      dishes,
    });
  }));

  app.post('/api/enquiry', limit('enquiry', 6, 10 * 60_000), wrap(async (req, res) => {
    if (req.body.website) return res.json({ ok: true });
    const name = clean(req.body.name, 100);
    const email = clean(req.body.email, 160);
    const phone = clean(req.body.phone, 30);
    const message = cleanBlock(req.body.message, 800);
    const guests = Math.min(Math.max(Number.parseInt(req.body.guests, 10) || 1, 1), 50);
    if (!name) return res.status(400).json({ error: 'Please add your name.' });
    if (!isEmail(email)) return res.status(400).json({ error: 'Please add a valid email address.' });
    await collection('enquiries').insertOne({ _id: newId(), name, email, phone, guests, message, created_at: new Date() });
    res.status(201).json({ ok: true });
  }));

  app.post('/api/nominate', limit('nominate', 8, 10 * 60_000), wrap(async (req, res) => {
    try {
      await receivePortrait(req, res);
    } catch (error) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large. Please try a smaller one.' : 'That upload did not work.';
      return res.status(400).json({ error: message });
    }
    if (req.body.website) return res.json({ ok: true });
    if (await getSetting(db, 'stage') !== 'nominations') {
      return res.status(409).json({ error: 'Nominations are closed.' });
    }
    const name = clean(req.body.name, 80);
    const category = req.body.category;
    if (!name) return res.status(400).json({ error: "Please add the nominee's name." });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Choose Prom King or Prom Queen.' });
    if (!req.file) return res.status(400).json({ error: 'Please add a portrait.' });
    if (req.body.consent !== 'on') return res.status(400).json({ error: 'Please confirm you have permission to share this photo.' });

    let image;
    try {
      // Re-encoding drops location data and rejects anything that is not an image.
      const { default: sharp } = await import('sharp');
      image = await sharp(req.file.buffer, { limitInputPixels: 50_000_000 })
        .rotate()
        .resize(800, 1000, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      return res.status(400).json({ error: 'Please upload a JPG, PNG or WebP photo.' });
    }
    const _id = newId();
    await collection('nominations').insertOne({
      _id, name, category, image, status: 'pending', created_at: new Date(),
      photo: `${_id}.webp`,
      nominated_by: clean(req.body.nominated_by, 80),
      reason: cleanBlock(req.body.reason, 400),
    });
    res.status(201).json({ ok: true });
  }));

  // Only approved portraits are public. Pending ones are served through the admin route.
  app.get('/portraits/:file', wrap(async (req, res) => {
    const row = await collection('nominations').findOne({ photo: req.params.file, status: 'approved' }, { projection: { image: 1 } });
    if (!row) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=3600').type('webp').send(bytes(row.image));
  }));

  // Many guests share the venue's Wi-Fi address, so this limit is deliberately generous.
  app.post('/api/vote', limit('vote', 900, 60_000), wrap(async (req, res) => {
    if (await getSetting(db, 'stage') !== 'voting') return res.status(409).json({ error: 'Voting is not open.' });
    const nominee = await collection('nominations').findOne(
      { _id: String(req.body.nomineeId ?? ''), status: 'approved' },
      { projection: { category: 1 } },
    );
    if (!nominee) return res.status(404).json({ error: 'That nominee is not on the ballot.' });

    const code = codeFrom(req.body.code);
    if (!code) return res.status(403).json({ error: 'Enter the code from your ballot card first.' });
    if (!await collection('codes').findOne({ _id: code })) {
      return res.status(403).json({ error: 'That ballot code is not valid.' });
    }
    const voter = `code:${code}`;
    try {
      await collection('votes').insertOne({
        _id: `${nominee.category}:${voter}`,
        category: nominee.category, nominee_id: nominee._id, voter, created_at: new Date(),
      });
    } catch (error) {
      if (error.code === 11000) {
        const crown = nominee.category === 'king' ? 'Prom King' : 'Prom Queen';
        return res.status(409).json({ error: `This card has already voted for ${crown}.` });
      }
      throw error;
    }
    res.status(201).json({ ok: true, category: nominee.category, nomineeId: nominee._id });
  }));

  app.post('/api/dishes', limit('dish', 8, 10 * 60_000), wrap(async (req, res) => {
    if (req.body.website) return res.json({ ok: true });
    const name = clean(req.body.name, 60);
    const category = req.body.category;
    if (!name) return res.status(400).json({ error: 'Name the dish first.' });
    if (!COURSES.includes(category)) return res.status(400).json({ error: 'Choose a course.' });
    await collection('dishes').insertOne({
      _id: newId(), name, category, note: clean(req.body.note, 120), base_count: 0, status: 'pending', created_at: new Date(),
    });
    res.status(201).json({ ok: true });
  }));

  app.post('/api/dishes/:id/back', limit('back', 900, 60_000), visitor, wrap(async (req, res) => {
    const id = req.params.id;
    if (!await collection('dishes').findOne({ _id: id, status: 'approved' })) return res.sendStatus(404);
    const key = `${id}:${req.visitor}`;
    const removed = await collection('backs').deleteOne({ _id: key });
    if (!removed.deletedCount) {
      await collection('backs').updateOne({ _id: key }, { $set: { dish_id: id, visitor: req.visitor } }, { upsert: true });
    }
    res.json({ dishes: await dishesFor(req.visitor) });
  }));

  // ---- Committee -----------------------------------------------------------

  const admin = (req, res, next) => {
    if (!adminPassword || !validSession(parseCookies(req).gr_admin)) {
      return res.status(401).json({ error: 'Please log in.' });
    }
    next();
  };

  app.post('/api/admin/login', limit('login', 8, 15 * 60_000), (req, res) => {
    if (!adminPassword) return res.status(503).json({ error: 'ADMIN_PASSWORD has not been set on the server.' });
    const match = crypto.timingSafeEqual(sha(String(req.body.password ?? '')), sha(adminPassword));
    if (!match) return res.status(401).json({ error: 'That password is not right.' });
    const expires = Date.now() + SESSION_MS;
    res.cookie('gr_admin', `${expires}.${sign(expires)}`, { httpOnly: true, sameSite: 'strict', secure: secureCookies, maxAge: SESSION_MS });
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => res.clearCookie('gr_admin').json({ ok: true }));

  const adminData = async () => {
    const [stage, enquiries, nominations, votes, dishes, backs, lineup, codeCount, cardsUsed] = await Promise.all([
      getSetting(db, 'stage'),
      collection('enquiries').find().sort({ created_at: -1 }).toArray(),
      collection('nominations').find({}, { projection: { image: 0 } }).sort({ created_at: -1 }).toArray(),
      voteCounts(),
      collection('dishes').find().toArray(),
      backCounts(),
      collection('lineup').find().sort({ position: 1 }).toArray(),
      collection('codes').countDocuments(),
      collection('votes').distinct('voter'),
    ]);
    return {
      stage,
      enquiries: enquiries.map((e) => ({ ...withId(e), created_at: timestamp(e.created_at) })),
      nominations: nominations.map((n) => ({ ...withId(n), created_at: timestamp(n.created_at), votes: votes[n._id] ?? 0 })),
      dishes: dishes
        .map((d) => ({ ...withId(d), created_at: timestamp(d.created_at), count: d.base_count + (backs[d._id] ?? 0) }))
        .sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.count - a.count),
      lineup: lineup.map(withId),
      codeCount,
      cardsUsed: cardsUsed.length,
    };
  };

  app.get('/api/admin/data', admin, wrap(async (req, res) => res.set('Cache-Control', 'no-store').json(await adminData())));

  app.get('/api/admin/portraits/:file', admin, wrap(async (req, res) => {
    const row = await collection('nominations').findOne({ photo: req.params.file }, { projection: { image: 1 } });
    if (!row) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').type('webp').send(bytes(row.image));
  }));

  app.patch('/api/admin/settings', admin, wrap(async (req, res) => {
    const { stage } = req.body;
    if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown stage.' });
    await setSetting(db, 'stage', stage);
    res.json(await adminData());
  }));

  app.patch('/api/admin/nominations/:id', admin, wrap(async (req, res) => {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    await collection('nominations').updateOne({ _id: req.params.id }, { $set: { status } });
    res.json(await adminData());
  }));

  app.delete('/api/admin/nominations/:id', admin, wrap(async (req, res) => {
    await collection('votes').deleteMany({ nominee_id: req.params.id });
    await collection('nominations').deleteOne({ _id: req.params.id });
    res.json(await adminData());
  }));

  app.patch('/api/admin/dishes/:id', admin, wrap(async (req, res) => {
    const { status } = req.body;
    if (!['pending', 'approved', 'hidden'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    await collection('dishes').updateOne({ _id: req.params.id }, { $set: { status } });
    res.json(await adminData());
  }));

  app.patch('/api/admin/lineup/:id', admin, wrap(async (req, res) => {
    await collection('lineup').updateOne({ _id: req.params.id }, {
      $set: { name: clean(req.body.name, 80), role: clean(req.body.role, 80), revealed: Boolean(req.body.revealed) },
    });
    res.json(await adminData());
  }));

  app.post('/api/admin/codes', admin, wrap(async (req, res) => {
    const count = Math.min(Math.max(Number.parseInt(req.body.count, 10) || 0, 1), 2000);
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const codes = Array.from({ length: count }, () => ({
      _id: Array.from(crypto.randomBytes(7), (b) => alphabet[b % alphabet.length]).join(''),
    }));
    await collection('codes').insertMany(codes, { ordered: false }).catch((error) => {
      if (error.code !== 11000) throw error;
    });
    res.json(await adminData());
  }));

  // Printable ballot cards. Each QR code opens the vote with that card's code filled in.
  app.get('/committee/cards', wrap(async (req, res) => {
    if (!adminPassword || !validSession(parseCookies(req).gr_admin)) return res.redirect(302, '/committee');
    const codes = (await collection('codes').find().sort({ _id: 1 }).toArray()).map((c) => c._id);
    const site = origin(req);
    const host = site.replace(/^https?:\/\//, '');
    const cards = await Promise.all(codes.map(async (code) => {
      const qr = await QRCode.toString(`${site}/royal-court?code=${code}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
      return `<article class="card">
  <p class="card-top"><svg class="mark" viewBox="0 0 100 100" aria-hidden="true"><path d="M34 54a16 16 0 0 1 32 0z"/><rect x="12" y="58.5" width="76" height="3.4"/><rect x="24" y="66" width="52" height="3"/><rect x="34" y="72.8" width="32" height="2.6"/><rect x="43" y="79" width="14" height="2.2"/></svg>The Grand Riviera &middot; Royal Court ballot</p>
  <div class="card-mid">
    <div class="qr">${qr}</div>
    <div>
      <p class="label">Your code</p>
      <p class="code">${code}</p>
      <p class="rule">One vote for Prom King and one for Prom Queen.</p>
    </div>
  </div>
  <p class="how">Scan to vote, or open <b>${host}/royal-court</b> and enter your code. Each card works once.</p>
</article>`;
    }));
    res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Ballot cards · The Grand Riviera</title>
<link rel="stylesheet" href="/css/cards.css"></head>
<body>
<header class="bar"><p><b>${codes.length} ballot cards</b> ready to print. Cut along the dashed lines and give one to each guest at the door.</p>
<button id="print" type="button">Print cards</button> <a href="/committee">Back to the committee</a></header>
<main class="sheet">${cards.join('\n') || '<p>No cards yet. Make some on the committee page first.</p>'}</main>
<script src="/js/print-cards.js" defer></script>
</body></html>`);
  }));

  app.get('/api/admin/codes.csv', admin, wrap(async (req, res) => {
    const rows = await collection('codes').find().sort({ _id: 1 }).toArray();
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="ballot-codes.csv"' })
      .send(['code', ...rows.map((r) => r._id)].join('\r\n'));
  }));

  app.get('/api/admin/enquiries.csv', admin, wrap(async (req, res) => {
    const rows = await collection('enquiries').find().sort({ created_at: 1 }).toArray();
    const header = ['received', 'name', 'email', 'phone', 'guests', 'message'];
    const body = rows.map((r) =>
      [timestamp(r.created_at), r.name, r.email, r.phone, r.guests, r.message].map(csvCell).join(','));
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="enquiries.csv"' })
      .send([header.join(','), ...body].join('\r\n'));
  }));

  // ---- Pages ---------------------------------------------------------------

  const withOrigin = (file) => (req, res) => {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    res.type('html').send(html.replaceAll('%%SITE_URL%%', origin(req)));
  };

  for (const page of PAGES) {
    app.get(page.path, (req, res) => res.type('html').send(renderPage(page, origin(req))));
  }
  app.get('/royal-vote', (req, res) => res.redirect(301, '/royal-court'));

  // A nominee's own link. In WhatsApp it previews with their portrait.
  const sharedNominee = async (id, projection) => {
    if (await getSetting(db, 'stage') === 'nominations') return null;
    return collection('nominations').findOne({ _id: id, status: 'approved' }, { projection });
  };

  app.get('/vote/:id', wrap(async (req, res) => {
    const nominee = await sharedNominee(req.params.id, { name: 1, category: 1 });
    if (!nominee) return res.redirect(302, '/royal-court');
    const crown = nominee.category === 'king' ? 'Prom King' : 'Prom Queen';
    const page = PAGES.find((p) => p.path === '/royal-court');
    res.type('html').send(renderPage(page, origin(req), {
      title: `Vote for ${nominee.name} · ${crown}`,
      description: `${nominee.name} is on the ballot for ${crown} at The Grand Riviera Prom '26.`,
      image: `${origin(req)}/vote/${nominee._id}/card.jpg`,
      imageAlt: `Portrait of ${nominee.name}`,
      focus: nominee._id,
    }));
  }));

  app.get('/vote/:id/card.jpg', wrap(async (req, res) => {
    const nominee = await sharedNominee(req.params.id, { image: 1 });
    if (!nominee) return res.sendStatus(404);
    const { default: sharp } = await import('sharp');
    const card = await sharp(bytes(nominee.image))
      .resize(1200, 630, { fit: 'contain', background: '#0b0906' })
      .jpeg({ quality: 84 })
      .toBuffer();
    res.set('Cache-Control', 'public, max-age=3600').type('jpeg').send(card);
  }));

  app.get('/grand-riviera.ics', (req, res) => {
    const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const calendar = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Grand Riviera//Prom 26//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:prom-2026@thegrandriviera', `DTSTAMP:${stamp}`,
      'DTSTART:20261204T150000Z', 'DTEND:20261204T210000Z',
      "SUMMARY:The Grand Riviera Prom '26",
      'LOCATION:The Event Space\\, Westlands\\, Nairobi',
      `DESCRIPTION:Dress code: black and metallic gold. Ages 16 and above. Tickets: https://www.passly.co.ke/PROM26`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:The Grand Riviera is tomorrow', 'TRIGGER:-P1D', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    res.set('Content-Disposition', 'inline; filename="grand-riviera.ics"').type('text/calendar').send(calendar);
  });
  app.get('/privacy', withOrigin('privacy.html'));
  app.get('/committee', withOrigin('committee.html'));
  app.get('/robots.txt', (req, res) =>
    res.type('text').send(`User-agent: *\nDisallow: /committee\nDisallow: /api/\nSitemap: ${origin(req)}/sitemap.xml\n`));
  app.get('/sitemap.xml', (req, res) =>
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
      `${[...PAGES.map((p) => p.path), '/privacy'].map((p) => `<url><loc>${origin(req)}${p}</loc></url>`).join('')}</urlset>`,
    ));

  app.use(express.static(PUBLIC, {
    index: false,
    setHeaders: (res, file) => {
      const forever = /\.woff2$/.test(file);
      res.set('Cache-Control', forever ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That message is too long.' });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  app.locals.close = () => close();
  return app;
}
