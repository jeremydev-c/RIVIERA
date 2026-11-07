import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIEWS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'views');
const view = (name) => fs.readFileSync(path.join(VIEWS, `${name}.html`), 'utf8').trim();

// The evening runs in this order. Each page sits later in the night than the last,
// which sets the sun's position in its header and the time on the nav clock.
export const PAGES = [
  {
    path: '/', view: 'home',
    title: "The Grand Riviera Prom '26 · 4 December, Westlands, Nairobi",
    description: "Friday 4 December, 6 PM to midnight at The Event Space, Westlands, Nairobi. Food, live music, photobooths and the crowning of Prom King and Queen. Ages 16 and above. Early bird tickets from KES 2,400.",
  },
  {
    path: '/tickets', view: 'tickets', label: 'Tickets',
    title: "Tickets · The Grand Riviera Prom '26",
    description: 'Early bird tickets from KES 2,400. Friday 4 December, 6 PM to midnight at The Event Space, Westlands. Ages 16 and above.',
    eyebrow: 'Tickets',
    heading: 'Early bird <em>tickets are out</em>',
    blurb: 'Limited, and released in waves.',
  },
  {
    path: '/invite', view: 'invite', label: "I'm Going", script: '/js/invite.js',
    title: "I'm Going · The Grand Riviera Prom '26",
    description: 'Type your name and get a personal gold invitation to post on your Instagram or WhatsApp status.',
    eyebrow: "I'm going",
    heading: 'Tell everyone <em>you are coming</em>',
    blurb: 'Make your personal gold invitation in seconds.',
  },
  {
    path: '/dress-code', view: 'dress-code', label: 'Dress Code',
    title: "Dress Code · The Grand Riviera Prom '26",
    description: 'Black and metallic gold, cut long. The dress code applies to every guest and is upheld at the door.',
    eyebrow: 'The dress code',
    heading: 'Dress <em>to be remembered</em>',
    blurb: 'Arrive dressed for the room you are walking into.',
  },
  {
    path: '/lineup', view: 'lineup', label: 'Lineup',
    title: "Lineup · The Grand Riviera Prom '26",
    description: 'The names on the stage at The Grand Riviera stay sealed until the committee breaks each seal.',
    eyebrow: 'The lineup',
    heading: 'Sealed <em>until the curtain lifts</em>',
    blurb: 'The committee breaks each seal as the night approaches.',
  },
  {
    path: '/royal-court', view: 'royal-court', label: 'Royal Court',
    title: "Royal Court · The Grand Riviera Prom '26",
    description: 'Put a name forward for Prom King and Queen, then vote live on the night.',
    eyebrow: 'The Royal Court',
    heading: 'Prom King <em>&amp;</em> Queen',
    blurb: 'Nominate, then vote live on the night.',
  },
  {
    path: '/menu', view: 'menu', label: 'The Table',
    title: "The Table · The Grand Riviera Prom '26",
    description: 'Food is provided for every guest, and the menu is built from what you ask for. Back a dish or suggest your own.',
    eyebrow: 'The Table',
    heading: 'You choose <em>the menu</em>',
    blurb: 'The committee builds the menu from this board.',
  },
  {
    path: '/questions', view: 'questions', label: 'Questions',
    title: "Questions · The Grand Riviera Prom '26",
    description: 'Age limit, dress code, tickets, the crowning and how to find The Event Space in Westlands.',
    eyebrow: 'Before you come',
    heading: 'Good <em>questions</em>',
    blurb: 'Everything else you need to know.',
  },
];

const SHARE_IMAGE = '/img/share.png';
const SHARE_ALT = 'A gold sun setting over a dark sea, above the words The Grand Riviera';
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const whatsappLink = (url) => {
  const text = `The Grand Riviera Prom '26 is on Friday 4 December at The Event Space, Westlands. Tickets from KES 2,400: ${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
};

const nav = (current) => PAGES.filter((p) => p.label).map((p) =>
  `      <a href="${p.path}"${p === current ? ' aria-current="page"' : ''}>${p.label}</a>`).join('\n');

const index = () => `<ul class="page-index">${PAGES.filter((p) => p.label).map((p, i) => `
    <li><a href="${p.path}">
      <span class="page-index-no">No. ${i + 1}</span>
      <span class="page-index-name">${p.label}</span>
      <span class="page-index-note">${p.blurb}</span>
      <svg aria-hidden="true"><use href="#i-arrow"/></svg>
    </a></li>`).join('')}
  </ul>`;

const pageHero = (page) => `<section class="page-hero" id="hero" data-horizon=".17" data-span=".12">
  <canvas id="sky" aria-hidden="true"></canvas>
  <div class="page-hero-text">
    <p class="eyebrow">${page.eyebrow}</p>
    <h1>${page.heading}</h1>
    <p class="page-hero-blurb">${page.blurb}</p>
  </div>
</section>`;

const next = (page) => {
  const after = PAGES[PAGES.indexOf(page) + 1];
  if (!after) return view('midnight');
  return `<section class="next-page"><a href="${after.path}">
  <span class="eyebrow">Next</span>
  <span class="next-page-name">${after.label}</span>
  <svg aria-hidden="true"><use href="#i-arrow"/></svg>
</a></section>`;
};

export function renderPage(page, siteUrl, share = {}) {
  const position = PAGES.indexOf(page);
  const body = view(page.view)
    .replace('%%TICKET%%', () => view('ticket'))
    .replace('%%INDEX%%', () => index())
    .replace('%%MIDNIGHT%%', () => view('midnight'));
  const content = page.path === '/' ? body : `${pageHero(page)}\n\n${body}\n\n${next(page)}`;
  const fields = {
    TITLE: share.title ? escapeHtml(share.title) : page.title,
    DESCRIPTION: share.description ? escapeHtml(share.description) : page.description,
    PATH: page.path,
    IMAGE: share.image ?? `${siteUrl}${SHARE_IMAGE}`,
    IMAGE_ALT: share.imageAlt ? escapeHtml(share.imageAlt) : SHARE_ALT,
    FOCUS: share.focus ?? '',
    WHATSAPP: whatsappLink(`${siteUrl}${page.path}`),
    SCRIPTS: page.script ? `<script src="${page.script}" defer></script>` : '',
    NIGHT: (position / PAGES.length).toFixed(3),
    NIGHT_END: ((position + 1) / PAGES.length).toFixed(3),
    HEAD: page.path === '/' ? view('home-head') : '',
    NAV: nav(page),
    CONTENT: content,
  };
  return Object.entries(fields)
    .reduce((html, [key, value]) => html.replaceAll(`%%${key}%%`, () => value), view('layout'))
    .replaceAll('%%SITE_URL%%', () => siteUrl);
}
