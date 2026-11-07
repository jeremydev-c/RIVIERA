(() => {
  document.documentElement.classList.add('js');

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const DOORS = new Date('2026-12-04T18:00:00+03:00').getTime();
  const CLOSE = new Date('2026-12-05T00:00:00+03:00').getTime();

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    });
    node.append(...children);
    return node;
  };

  const SVG = 'http://www.w3.org/2000/svg';
  const icon = (id) => {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  };

  const api = async (url, options = {}) => {
    const init = { credentials: 'same-origin', ...options };
    if (options.json) {
      init.method = options.method || 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(options.json);
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  };

  // Countdown ----------------------------------------------------------------
  const countdown = $('#countdown');
  if (countdown) {
    const units = Object.fromEntries($$('[data-unit]').map((b) => [b.dataset.unit, b]));
    const tick = () => {
      const now = Date.now();
      if (now >= DOORS) {
        countdown.classList.add('tonight');
        countdown.textContent = now < CLOSE ? 'Tonight, until midnight' : 'What a night.';
        return;
      }
      const left = Math.floor((DOORS - now) / 1000);
      const values = {
        days: Math.floor(left / 86400),
        hours: Math.floor(left / 3600) % 24,
        minutes: Math.floor(left / 60) % 60,
        seconds: left % 60,
      };
      Object.entries(values).forEach(([unit, value]) => {
        units[unit].textContent = String(value).padStart(2, '0');
      });
      setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    tick();
  }

  // Scroll: nav, the 6 PM to midnight clock, the sticky buy bar, the manifesto -
  const nav = $('#nav');
  const hero = $('#hero');
  const buybar = $('#buybar');
  const clockTime = $('#clockTime');
  const clockBar = $('#clockBar');
  const manifesto = $('#manifesto');
  const midnight = $('.midnight');
  const nightStart = Number(document.body.dataset.night);
  const nightEnd = Number(document.body.dataset.nightEnd);

  const GILDED = new Set(['remembered,', 'memories']);
  const words = manifesto ? manifesto.textContent.split(' ').map((word) => {
    const span = el('span', { text: word });
    if (GILDED.has(word)) span.dataset.gild = '';
    return span;
  }) : [];
  if (manifesto) {
    manifesto.setAttribute('aria-label', manifesto.textContent);
    manifesto.textContent = '';
    words.forEach((span, i) => manifesto.append(span, i < words.length - 1 ? ' ' : ''));
  }

  const clockFor = (progress) => {
    const quarter = Math.round(progress * 24); // 15-minute steps from 6:00 to 12:00.
    const hour = 6 + Math.floor(quarter / 4);
    const minutes = String((quarter % 4) * 15).padStart(2, '0');
    return hour === 12 ? '12:00 AM' : `${hour}:${minutes} PM`;
  };

  let scrollQueued = false;
  const onScroll = () => {
    scrollQueued = false;
    const y = scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    const pageProgress = clamp(y / Math.max(max, 1), 0, 1);
    const progress = nightStart + (nightEnd - nightStart) * pageProgress;
    clockTime.textContent = clockFor(progress);
    clockBar.style.transform = `scaleX(${progress})`;
    nav.classList.toggle('solid', y > hero.offsetHeight * .72);

    const clearOfEnd = !midnight || midnight.getBoundingClientRect().top > innerHeight;
    buybar.classList.toggle('show', y > hero.offsetHeight * .8 && clearOfEnd);

    if (manifesto) {
      const rect = manifesto.getBoundingClientRect();
      const lit = clamp((innerHeight * .82 - rect.top) / (rect.height + innerHeight * .3), 0, 1) * words.length;
      words.forEach((span, i) => {
        span.classList.toggle('lit', i < lit);
        if ('gild' in span.dataset) span.classList.toggle('gild', i < lit);
      });
    }
  };
  const queueScroll = () => {
    if (!scrollQueued) {
      scrollQueued = true;
      requestAnimationFrame(onScroll);
    }
  };
  addEventListener('scroll', queueScroll, { passive: true });
  addEventListener('resize', queueScroll);
  onScroll();

  // Mobile menu --------------------------------------------------------------
  const menuBtn = $('#menuBtn');
  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  $$('#navLinks a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenu(false);
  });

  // Calendar: Apple devices open the event file, everyone else gets Google Calendar.
  const GOOGLE_CALENDAR = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("The Grand Riviera Prom '26")}`
    + '&dates=20261204T150000Z/20261204T210000Z'
    + `&location=${encodeURIComponent('The Event Space, Westlands, Nairobi')}`
    + `&details=${encodeURIComponent('Dress code: black and metallic gold. Ages 16 and above. Tickets: https://www.passly.co.ke/PROM26')}`;
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  if (!isApple) {
    $$('[data-calendar]').forEach((link) => {
      link.href = GOOGLE_CALENDAR;
      link.target = '_blank';
      link.rel = 'noopener';
    });
  }

  // Reveals ------------------------------------------------------------------
  const revealer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        revealer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  const watch = (root = document) => {
    $$('[data-reveal]', root).forEach((node, i) => {
      node.style.setProperty('--d', `${(i % 4) * .08}s`);
      revealer.observe(node);
    });
  };
  watch();

  // The ticket tilts toward the pointer and the foil follows it --------------
  const ticket = $('#ticket');
  if (ticket && matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) {
    ticket.addEventListener('pointermove', (event) => {
      const rect = ticket.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      ticket.style.transform = `rotateY(${(x - .5) * 7}deg) rotateX(${(.5 - y) * 7}deg)`;
      ticket.style.setProperty('--mx', `${x * 100}%`);
    });
    ticket.addEventListener('pointerleave', () => { ticket.style.transform = ''; });
  }

  // Dialog -------------------------------------------------------------------
  $$('[data-open]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.open).showModal());
  });
  $$('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
    });
  });

  // Forms --------------------------------------------------------------------
  const wireForm = (form, submit) => {
    const message = $('.form-msg', form);
    const button = $('button[type=submit]', form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = '';
      message.classList.remove('error');
      button.disabled = true;
      try {
        message.textContent = await submit(new FormData(form));
        form.reset();
        form.dispatchEvent(new Event('reset-done'));
      } catch (error) {
        message.classList.add('error');
        message.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  };

  wireForm($('#enquiryForm'), async (data) => {
    await api('/api/enquiry', { json: Object.fromEntries(data) });
    return 'Sent. The committee will be in touch.';
  });

  const dishForm = $('#dishForm');
  if (dishForm) {
    wireForm(dishForm, async (data) => {
      await api('/api/dishes', { json: Object.fromEntries(data) });
      return 'Thanks. It joins the board once the committee has seen it.';
    });
  }

  // Lineup -------------------------------------------------------------------
  const lineupList = $('#lineupList');
  const renderLineup = (lineup) => {
    lineupList.replaceChildren(...lineup.map((act) => {
      if (act.revealed) {
        return el('li', { class: 'envelope open', 'data-reveal': '' },
          el('p', { text: act.role || 'On the night' }), el('h3', { text: act.name }));
      }
      return el('li', { class: 'envelope', 'data-reveal': '', 'aria-label': `Act ${act.position}, still sealed` },
        el('span', { class: 'seal' }, icon('sunmark')),
        el('span', { class: 'envelope-label' }, el('span', { text: `No. ${act.position}` }), el('span', { text: 'Sealed' })));
    }));
    watch(lineupList);
  };

  // Royal Court --------------------------------------------------------------
  const STAGES = ['nominations', 'ballot', 'voting', 'crowned'];
  const courtBody = $('#courtBody');
  const CATEGORY_NAMES = { king: 'Prom King', queen: 'Prom Queen' };
  let ballotCode = '';
  let courtKey = '';
  const codedVotes = {};

  // Phone photos can be larger than the host accepts, so they are resized before uploading.
  const shrinkPhoto = async (file) => {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', .9); });
      return blob ? new File([blob], 'portrait.jpg', { type: 'image/jpeg' }) : file;
    } catch {
      return file;
    }
  };

  const nominationForm = () => {
    const form = el('form', { class: 'card form', novalidate: '' });
    form.innerHTML = `
      <h3>Put a name forward</h3>
      <p class="form-help">Every entry needs a portrait. Nothing goes public until the committee has reviewed it.</p>
      <label class="upload">
        <input type="file" name="portrait" accept="image/jpeg,image/png,image/webp" required>
        <span class="upload-thumb"><svg aria-hidden="true"><use href="#i-crown"/></svg></span>
        <span class="upload-text"><b>Add a portrait</b>Face and shoulders, fully dressed, on their own. Up to 8 MB.</span>
      </label>
      <label class="field"><span>Nominee's name</span><input name="name" maxlength="80" required autocomplete="off"></label>
      <fieldset class="field">
        <legend>Nominating for</legend>
        <div class="chips">
          <label><input type="radio" name="category" value="king" required><span>Prom King</span></label>
          <label><input type="radio" name="category" value="queen"><span>Prom Queen</span></label>
        </div>
      </fieldset>
      <label class="field"><span>Your name (optional)</span><input name="nominated_by" maxlength="80" autocomplete="name"></label>
      <label class="field"><span>Why they deserve the crown (optional)</span><textarea name="reason" rows="2" maxlength="400"></textarea></label>
      <label class="check"><input type="checkbox" name="consent" required>
        <span>This person knows about this nomination and agrees to their photo being used. If they are under 18, a parent or guardian agrees too.</span></label>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn btn-foil" type="submit"><span>Submit nomination</span></button>
      <p class="form-msg" role="status"></p>`;

    const input = $('input[type=file]', form);
    const thumb = $('.upload-thumb', form);
    const label = $('.upload-text b', form);
    input.addEventListener('change', () => {
      const [file] = input.files;
      if (!file) return;
      thumb.replaceChildren();
      thumb.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
      label.textContent = file.name;
    });
    form.addEventListener('reset-done', () => {
      thumb.style.backgroundImage = '';
      thumb.replaceChildren(icon('i-crown'));
      label.textContent = 'Add a portrait';
    });
    wireForm(form, async (data) => {
      const portrait = data.get('portrait');
      if (portrait?.size) data.set('portrait', await shrinkPhoto(portrait));
      await api('/api/nominate', { method: 'POST', body: data });
      return 'Received. The committee will review your nomination.';
    });
    return form;
  };

  const nomineeShareLink = (nominee, state) => {
    const crown = CATEGORY_NAMES[nominee.category];
    const url = `${location.origin}/vote/${nominee.id}`;
    const text = state.stage === 'voting'
      ? `Vote for ${nominee.name} for ${crown} at The Grand Riviera: ${url}`
      : `${nominee.name} is on the ballot for ${crown} at The Grand Riviera: ${url}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  const renderNominee = (nominee, state) => {
    const voted = state.myVotes[nominee.category];
    const card = el('li', { class: `nominee${voted === nominee.id ? ' picked' : ''}`, 'data-nominee': nominee.id },
      el('img', { src: `/portraits/${nominee.photo}`, alt: `Portrait of ${nominee.name}`, loading: 'lazy' }),
      el('h4', { text: nominee.name }));
    if (state.stage === 'voting') {
      if (voted === nominee.id) {
        card.append(el('p', { class: 'nominee-picked', text: 'Your vote' }));
      } else if (!voted) {
        const button = el('button', { class: 'btn btn-foil', type: 'button' }, el('span', { text: 'Vote' }));
        button.addEventListener('click', () => vote(nominee, button, state));
        card.append(button);
      }
    }
    card.append(el('a', {
      class: 'nominee-share', href: nomineeShareLink(nominee, state), target: '_blank', rel: 'noopener',
    }, icon('i-whatsapp'), el('span', { text: 'Share' })));
    return card;
  };

  const vote = async (nominee, button, state) => {
    const notice = $('#voteMsg');
    notice.textContent = '';
    notice.classList.remove('error');
    if (state.requireCodes && !ballotCode) {
      notice.classList.add('error');
      notice.textContent = 'Enter the ballot code from your card first.';
      $('#ballotCode').focus();
      return;
    }
    button.disabled = true;
    try {
      await api('/api/vote', { json: { nomineeId: nominee.id, code: ballotCode } });
      if (state.requireCodes) {
        // The server cannot link a code to this browser, so remember the choice here for display.
        codedVotes[nominee.category] = nominee.id;
        state.myVotes[nominee.category] = nominee.id;
        courtKey = '';
        renderCourt(state);
      } else {
        await load();
      }
    } catch (error) {
      notice.classList.add('error');
      notice.textContent = error.message;
      button.disabled = false;
    }
  };

  const renderBallot = (state) => {
    const nodes = [];
    if (state.stage === 'ballot') {
      nodes.push(el('p', { class: 'court-wait', text: 'The official ballot is out. The live vote opens on the night, and the crowns go to the highest count.' }));
    } else {
      const intro = el('div', { class: 'court-wait' },
        el('p', { text: 'The live vote is open. One ballot for King, one for Queen.' }));
      if (state.requireCodes) {
        const box = el('label', { class: 'field code-box' }, el('span', { text: 'Ballot code from your card' }));
        const input = el('input', { id: 'ballotCode', maxlength: '12', autocomplete: 'off', autocapitalize: 'characters', value: ballotCode });
        input.addEventListener('input', () => { ballotCode = input.value.trim(); });
        box.append(input);
        intro.append(box);
      }
      intro.append(el('p', { id: 'voteMsg', class: 'form-msg', role: 'status' }));
      nodes.push(intro);
    }
    for (const category of ['king', 'queen']) {
      const nominees = state.nominees.filter((n) => n.category === category);
      if (nominees.length) {
        nodes.push(el('div', { class: 'ballot-group' }, el('h3', { text: CATEGORY_NAMES[category] }),
          el('ul', { class: 'nominees' }, ...nominees.map((n) => renderNominee(n, state)))));
      }
    }
    if (!state.nominees.length) nodes.push(el('p', { class: 'court-wait', text: 'The official list is on its way.' }));
    return nodes;
  };

  const renderCrowned = (state) => {
    const cards = ['king', 'queen'].flatMap((category) => state.results[category].map((winner) =>
      el('article', { class: 'crowned-card' },
        el('img', { src: `/portraits/${winner.photo}`, alt: `Portrait of ${winner.name}` }),
        el('p', { text: CATEGORY_NAMES[category] }),
        el('h3', { text: winner.name }))));
    return cards.length
      ? [el('div', { class: 'crowned' }, ...cards)]
      : [el('p', { class: 'court-wait', text: 'The crowns are about to be announced.' })];
  };

  // Arriving from a nominee's shared link brings their card into view once.
  let focusId = document.body.dataset.focus;
  const focusNominee = () => {
    const card = focusId && $(`[data-nominee="${focusId}"]`);
    if (!card) return;
    focusId = '';
    card.classList.add('focused');
    card.scrollIntoView({ block: 'center' });
  };

  const renderCourt = (state) => {
    // A poll must not wipe a half-filled form, so only redraw when the content changes.
    const key = JSON.stringify([state.stage, state.requireCodes, state.nominees, state.results, state.myVotes]);
    if (key === courtKey) return;
    courtKey = key;

    const now = STAGES.indexOf(state.stage);
    $$('#courtSteps li').forEach((step, i) => {
      step.classList.toggle('done', i < now);
      step.classList.toggle('now', i === now);
      if (i === now) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });

    if (state.stage === 'nominations') {
      const rules = el('ul', { class: 'court-rules' },
        el('li', { text: 'Put a name forward with a portrait.' }),
        el('li', { text: 'The committee reviews every entry and publishes the official ballot.' }),
        el('li', { text: 'The live vote opens on the night.' }),
        el('li', { text: 'The crowns go to the highest count, before the last song.' }));
      courtBody.replaceChildren(el('div', { class: 'court-grid' },
        el('div', { class: 'court-copy' },
          el('h3', { text: 'Who should wear the crown?' }),
          el('p', { text: 'Nominations are open now. The ballot stays sealed until the committee announces the list.' }),
          rules),
        nominationForm()));
    } else if (state.stage === 'crowned') {
      courtBody.replaceChildren(...renderCrowned(state));
    } else {
      courtBody.replaceChildren(...renderBallot(state));
    }
    focusNominee();
  };

  // The Table ----------------------------------------------------------------
  const board = $('#board');
  const renderBoard = (dishes) => {
    const top = Math.max(...dishes.map((d) => d.count), 1);
    board.replaceChildren(...dishes.map((dish, i) => {
      const meta = dish.note ? `${dish.category} · ${dish.note}` : dish.category;
      const bar = el('i');
      bar.style.width = `${(dish.count / top) * 100}%`;
      const button = el('button', {
        class: 'back-btn', type: 'button', 'aria-pressed': String(dish.backed),
        'aria-label': `${dish.backed ? 'Stop backing' : 'Back'} ${dish.name}, ${dish.count} backers`,
      }, el('span', { text: dish.backed ? 'Backed' : 'Back this' }), el('b', { text: dish.count }));
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const data = await api(`/api/dishes/${dish.id}/back`, { method: 'POST' });
          renderBoard(data.dishes);
        } catch {
          button.disabled = false;
        }
      });
      return el('li', { class: 'dish' },
        el('span', { class: 'dish-rank', text: i + 1 }),
        el('div', {}, el('h3', { text: dish.name }), el('p', { class: 'dish-meta', text: meta }),
          el('div', { class: 'dish-bar' }, bar)),
        button);
    }));
  };

  // Live data, only on the pages that show it --------------------------------
  let lineupKey = '';
  const load = async () => {
    const state = await api('/api/state');
    if (state.requireCodes) Object.assign(state.myVotes, codedVotes);
    if (lineupList) {
      const nextLineup = JSON.stringify(state.lineup);
      if (nextLineup !== lineupKey) {
        lineupKey = nextLineup;
        renderLineup(state.lineup);
      }
    }
    if (courtBody) renderCourt(state);
    if (board && !board.contains(document.activeElement)) renderBoard(state.dishes);
  };

  if (lineupList || courtBody || board) {
    load().catch(() => {
      const failed = el('p', { class: 'court-wait', text: 'Live updates are unavailable right now. Please refresh in a moment.' });
      (courtBody || lineupList || board).replaceChildren(failed);
    });
    setInterval(() => {
      if (!document.hidden) load().catch(() => {});
    }, 20_000);
  }
})();
