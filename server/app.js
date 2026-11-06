import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import compression from 'compression';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSetting, setSetting } from './db.js';
import { PAGES, renderPage } from './pages.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STAGES = ['nominations', 'ballot', 'voting', 'crowned'];
const CATEGORIES = ['king', 'queen'];
const COURSES = ['Mains', 'Sides', 'Desserts', 'Drinks'];
const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE_YEAR = 365 * 24 * 60 * 60 * 1000;

const clean = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const cleanBlock = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 160;
const sha = (value) => crypto.createHash('sha256').update(value).digest();
const parseCookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((c) => c.length === 2));

// Stops a spreadsheet treating a submitted value as a formula.
const csvCell = (value) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

function rateLimiter() {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt < now) hits.delete(key);
  }, 60_000);
  sweep.unref();
  return (name, max, windowMs) => (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
    next();
  };
}

export function createApp({ dataDir, adminPassword, siteUrl = '', secureCookies = false }) {
  const db = openDb(dataDir);
  const portraitsDir = path.join(dataDir, 'portraits');
  const limit = rateLimiter();
  const sessions = new Map();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });

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

  const ballot = () =>
    db.prepare("SELECT id, name, category, photo FROM nominations WHERE status = 'approved' ORDER BY name").all();

  const results = () => {
    const out = {};
    for (const category of CATEGORIES) {
      const rows = db.prepare(
        `SELECT n.id, n.name, n.photo, COUNT(v.voter) AS votes
         FROM nominations n LEFT JOIN votes v ON v.nominee_id = n.id AND v.category = n.category
         WHERE n.status = 'approved' AND n.category = ?
         GROUP BY n.id ORDER BY votes DESC`,
      ).all(category);
      const top = rows[0]?.votes ?? 0;
      out[category] = top > 0
        ? rows.filter((r) => r.votes === top).map(({ id, name, photo }) => ({ id, name, photo }))
        : [];
    }
    return out;
  };

  const dishesFor = (who) =>
    db.prepare(
      `SELECT d.id, d.name, d.category, d.note,
              d.base_count + (SELECT COUNT(*) FROM backs b WHERE b.dish_id = d.id) AS count,
              EXISTS (SELECT 1 FROM backs b WHERE b.dish_id = d.id AND b.visitor = ?) AS backed
       FROM dishes d WHERE d.status = 'approved' ORDER BY count DESC, d.name`,
    ).all(who).map((d) => ({ ...d, backed: Boolean(d.backed) }));

  // ---- Public API ----------------------------------------------------------

  app.get('/api/state', visitor, (req, res) => {
    const stage = getSetting(db, 'stage');
    const requireCodes = getSetting(db, 'require_codes') === '1';
    const myVotes = {};
    if (!requireCodes) {
      for (const row of db.prepare('SELECT category, nominee_id FROM votes WHERE voter = ?').all(req.visitor)) {
        myVotes[row.category] = row.nominee_id;
      }
    }
    res.set('Cache-Control', 'no-store').json({
      stage,
      requireCodes,
      nominees: stage === 'nominations' ? [] : ballot(),
      results: stage === 'crowned' ? results() : null,
      myVotes,
      lineup: db.prepare('SELECT id, position, revealed, name, role FROM lineup ORDER BY position').all()
        .map((a) => (a.revealed ? { ...a, revealed: true } : { id: a.id, position: a.position, revealed: false })),
      dishes: dishesFor(req.visitor),
    });
  });

  app.post('/api/enquiry', limit('enquiry', 6, 10 * 60_000), (req, res) => {
    if (req.body.website) return res.json({ ok: true });
    const name = clean(req.body.name, 100);
    const email = clean(req.body.email, 160);
    const phone = clean(req.body.phone, 30);
    const message = cleanBlock(req.body.message, 800);
    const guests = Math.min(Math.max(Number.parseInt(req.body.guests, 10) || 1, 1), 50);
    if (!name) return res.status(400).json({ error: 'Please add your name.' });
    if (!isEmail(email)) return res.status(400).json({ error: 'Please add a valid email address.' });
    db.prepare('INSERT INTO enquiries (name, email, phone, guests, message) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, phone, guests, message);
    res.status(201).json({ ok: true });
  });

  app.post('/api/nominate', limit('nominate', 8, 10 * 60_000), (req, res) => {
    upload.single('portrait')(req, res, async (uploadError) => {
      if (uploadError) {
        const message = uploadError.code === 'LIMIT_FILE_SIZE' ? 'That photo is over 8 MB.' : 'That upload did not work.';
        return res.status(400).json({ error: message });
      }
      if (req.body.website) return res.json({ ok: true });
      if (getSetting(db, 'stage') !== 'nominations') {
        return res.status(409).json({ error: 'Nominations are closed.' });
      }
      const name = clean(req.body.name, 80);
      const category = req.body.category;
      if (!name) return res.status(400).json({ error: "Please add the nominee's name." });
      if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Choose Prom King or Prom Queen.' });
      if (!req.file) return res.status(400).json({ error: 'Please add a portrait.' });
      if (req.body.consent !== 'on') return res.status(400).json({ error: 'Please confirm you have permission to share this photo.' });

      const file = `${crypto.randomBytes(12).toString('hex')}.webp`;
      try {
        // Re-encoding drops location data and rejects anything that is not an image.
        await sharp(req.file.buffer, { limitInputPixels: 50_000_000 })
          .rotate()
          .resize(800, 1000, { fit: 'cover', position: 'attention' })
          .webp({ quality: 82 })
          .toFile(path.join(portraitsDir, file));
      } catch {
        return res.status(400).json({ error: 'Please upload a JPG, PNG or WebP photo.' });
      }
      db.prepare('INSERT INTO nominations (name, category, nominated_by, reason, photo) VALUES (?, ?, ?, ?, ?)')
        .run(name, category, clean(req.body.nominated_by, 80), cleanBlock(req.body.reason, 400), file);
      res.status(201).json({ ok: true });
    });
  });

  // Only approved portraits are public. Pending ones are served through the admin route.
  app.get('/portraits/:file', (req, res) => {
    const row = db.prepare("SELECT photo FROM nominations WHERE photo = ? AND status = 'approved'").get(req.params.file);
    if (!row) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=3600').sendFile(row.photo, { root: path.resolve(portraitsDir) });
  });

  app.post('/api/vote', limit('vote', 60, 60_000), visitor, (req, res) => {
    if (getSetting(db, 'stage') !== 'voting') return res.status(409).json({ error: 'Voting is not open.' });
    const nominee = db.prepare("SELECT id, category FROM nominations WHERE id = ? AND status = 'approved'")
      .get(Number(req.body.nomineeId) || 0);
    if (!nominee) return res.status(404).json({ error: 'That nominee is not on the ballot.' });

    let voter = req.visitor;
    if (getSetting(db, 'require_codes') === '1') {
      const code = clean(req.body.code, 12).toUpperCase();
      if (!db.prepare('SELECT code FROM codes WHERE code = ?').get(code)) {
        return res.status(403).json({ error: 'That ballot code is not valid.' });
      }
      voter = `code:${code}`;
    }
    const { changes } = db.prepare('INSERT OR IGNORE INTO votes (category, nominee_id, voter) VALUES (?, ?, ?)')
      .run(nominee.category, nominee.id, voter);
    if (!changes) return res.status(409).json({ error: 'This ballot has already been cast.' });
    res.status(201).json({ ok: true, category: nominee.category, nomineeId: nominee.id });
  });

  app.post('/api/dishes', limit('dish', 8, 10 * 60_000), (req, res) => {
    if (req.body.website) return res.json({ ok: true });
    const name = clean(req.body.name, 60);
    const category = req.body.category;
    if (!name) return res.status(400).json({ error: 'Name the dish first.' });
    if (!COURSES.includes(category)) return res.status(400).json({ error: 'Choose a course.' });
    db.prepare('INSERT INTO dishes (name, category, note) VALUES (?, ?, ?)')
      .run(name, category, clean(req.body.note, 120));
    res.status(201).json({ ok: true });
  });

  app.post('/api/dishes/:id/back', limit('back', 120, 60_000), visitor, (req, res) => {
    const id = Number(req.params.id) || 0;
    if (!db.prepare("SELECT id FROM dishes WHERE id = ? AND status = 'approved'").get(id)) return res.sendStatus(404);
    const removed = db.prepare('DELETE FROM backs WHERE dish_id = ? AND visitor = ?').run(id, req.visitor);
    if (!removed.changes) db.prepare('INSERT INTO backs (dish_id, visitor) VALUES (?, ?)').run(id, req.visitor);
    res.json({ dishes: dishesFor(req.visitor) });
  });

  // ---- Committee -----------------------------------------------------------

  const admin = (req, res, next) => {
    const token = parseCookies(req).gr_admin;
    const expires = sessions.get(token);
    if (!expires || expires < Date.now()) {
      sessions.delete(token);
      return res.status(401).json({ error: 'Please log in.' });
    }
    next();
  };

  app.post('/api/admin/login', limit('login', 8, 15 * 60_000), (req, res) => {
    if (!adminPassword) return res.status(503).json({ error: 'ADMIN_PASSWORD has not been set on the server.' });
    const match = crypto.timingSafeEqual(sha(String(req.body.password ?? '')), sha(adminPassword));
    if (!match) return res.status(401).json({ error: 'That password is not right.' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    res.cookie('gr_admin', token, { httpOnly: true, sameSite: 'strict', secure: secureCookies, maxAge: SESSION_MS });
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    sessions.delete(parseCookies(req).gr_admin);
    res.clearCookie('gr_admin').json({ ok: true });
  });

  const adminData = () => {
    const tally = db.prepare('SELECT nominee_id, COUNT(*) AS votes FROM votes GROUP BY nominee_id').all();
    const votes = Object.fromEntries(tally.map((t) => [t.nominee_id, t.votes]));
    return {
      stage: getSetting(db, 'stage'),
      requireCodes: getSetting(db, 'require_codes') === '1',
      enquiries: db.prepare('SELECT * FROM enquiries ORDER BY id DESC').all(),
      nominations: db.prepare('SELECT * FROM nominations ORDER BY id DESC').all()
        .map((n) => ({ ...n, votes: votes[n.id] ?? 0 })),
      dishes: db.prepare(
        `SELECT d.*, d.base_count + (SELECT COUNT(*) FROM backs b WHERE b.dish_id = d.id) AS count
         FROM dishes d ORDER BY d.status = 'pending' DESC, count DESC`,
      ).all(),
      lineup: db.prepare('SELECT * FROM lineup ORDER BY position').all(),
      codeCount: db.prepare('SELECT COUNT(*) AS n FROM codes').get().n,
    };
  };

  app.get('/api/admin/data', admin, (req, res) => res.set('Cache-Control', 'no-store').json(adminData()));

  app.get('/api/admin/portraits/:file', admin, (req, res) => {
    const row = db.prepare('SELECT photo FROM nominations WHERE photo = ?').get(req.params.file);
    if (!row) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').sendFile(row.photo, { root: path.resolve(portraitsDir) });
  });

  app.patch('/api/admin/settings', admin, (req, res) => {
    const { stage, requireCodes } = req.body;
    if (stage !== undefined) {
      if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown stage.' });
      setSetting(db, 'stage', stage);
    }
    if (requireCodes !== undefined) setSetting(db, 'require_codes', requireCodes ? '1' : '0');
    res.json(adminData());
  });

  app.patch('/api/admin/nominations/:id', admin, (req, res) => {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    db.prepare('UPDATE nominations SET status = ? WHERE id = ?').run(status, Number(req.params.id));
    res.json(adminData());
  });

  app.delete('/api/admin/nominations/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT photo FROM nominations WHERE id = ?').get(id);
    if (row) {
      db.prepare('DELETE FROM votes WHERE nominee_id = ?').run(id);
      db.prepare('DELETE FROM nominations WHERE id = ?').run(id);
      fs.rmSync(path.join(portraitsDir, path.basename(row.photo)), { force: true });
    }
    res.json(adminData());
  });

  app.patch('/api/admin/dishes/:id', admin, (req, res) => {
    const { status } = req.body;
    if (!['pending', 'approved', 'hidden'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    db.prepare('UPDATE dishes SET status = ? WHERE id = ?').run(status, Number(req.params.id));
    res.json(adminData());
  });

  app.patch('/api/admin/lineup/:id', admin, (req, res) => {
    db.prepare('UPDATE lineup SET name = ?, role = ?, revealed = ? WHERE id = ?')
      .run(clean(req.body.name, 80), clean(req.body.role, 80), req.body.revealed ? 1 : 0, Number(req.params.id));
    res.json(adminData());
  });

  app.post('/api/admin/codes', admin, (req, res) => {
    const count = Math.min(Math.max(Number.parseInt(req.body.count, 10) || 0, 1), 2000);
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const insert = db.prepare('INSERT OR IGNORE INTO codes (code) VALUES (?)');
    for (let i = 0; i < count; i += 1) {
      insert.run(Array.from(crypto.randomBytes(7), (b) => alphabet[b % alphabet.length]).join(''));
    }
    res.json(adminData());
  });

  app.get('/api/admin/codes.csv', admin, (req, res) => {
    const rows = db.prepare('SELECT code FROM codes ORDER BY code').all();
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="ballot-codes.csv"' })
      .send(['code', ...rows.map((r) => r.code)].join('\r\n'));
  });

  app.get('/api/admin/enquiries.csv', admin, (req, res) => {
    const rows = db.prepare('SELECT * FROM enquiries ORDER BY id').all();
    const header = ['received', 'name', 'email', 'phone', 'guests', 'message'];
    const body = rows.map((r) =>
      [r.created_at, r.name, r.email, r.phone, r.guests, r.message].map(csvCell).join(','));
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="enquiries.csv"' })
      .send([header.join(','), ...body].join('\r\n'));
  });

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
  const sharedNominee = (id) => {
    if (getSetting(db, 'stage') === 'nominations') return null;
    return db.prepare("SELECT id, name, category, photo FROM nominations WHERE id = ? AND status = 'approved'")
      .get(Number(id) || 0);
  };

  app.get('/vote/:id', (req, res) => {
    const nominee = sharedNominee(req.params.id);
    if (!nominee) return res.redirect(302, '/royal-court');
    const crown = nominee.category === 'king' ? 'Prom King' : 'Prom Queen';
    const page = PAGES.find((p) => p.path === '/royal-court');
    res.type('html').send(renderPage(page, origin(req), {
      title: `Vote for ${nominee.name} · ${crown}`,
      description: `${nominee.name} is on the ballot for ${crown} at The Grand Riviera Prom '26.`,
      image: `${origin(req)}/vote/${nominee.id}/card.jpg`,
      imageAlt: `Portrait of ${nominee.name}`,
      focus: nominee.id,
    }));
  });

  app.get('/vote/:id/card.jpg', async (req, res, next) => {
    const nominee = sharedNominee(req.params.id);
    if (!nominee) return res.sendStatus(404);
    try {
      const portrait = await fs.promises.readFile(path.join(portraitsDir, path.basename(nominee.photo)));
      const card = await sharp(portrait)
        .resize(1200, 630, { fit: 'contain', background: '#0b0906' })
        .jpeg({ quality: 84 })
        .toBuffer();
      res.set('Cache-Control', 'public, max-age=3600').type('jpeg').send(card);
    } catch (error) {
      next(error);
    }
  });

  app.get('/grand-riviera.ics', (req, res) => {
    const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const calendar = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Grand Riviera//Prom 26//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:prom-2026@thegrandriviera', `DTSTAMP:${stamp}`,
      'DTSTART:20261204T150000Z', 'DTEND:20261204T210000Z',
      "SUMMARY:The Grand Riviera Prom '26",
      'LOCATION:The Event Space\\, Westlands\\, Nairobi',
      `DESCRIPTION:Dress code: black and metallic gold. Ages 16+. Tickets: https://www.passly.co.ke/PROM26`,
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

  app.locals.close = () => db.close();
  return app;
}
