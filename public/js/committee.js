(() => {
  const $ = (selector) => document.querySelector(selector);
  const STAGES = [
    ['nominations', 'Nominations open'],
    ['ballot', 'Ballot published'],
    ['voting', 'Live vote open'],
    ['crowned', 'Crowned'],
  ];

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else node.setAttribute(key, value);
    });
    node.append(...children);
    return node;
  };

  const api = async (url, method = 'GET', json) => {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: json ? { 'Content-Type': 'application/json' } : undefined,
      body: json ? JSON.stringify(json) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      showLogin();
      throw new Error(data.error);
    }
    if (!res.ok) throw new Error(data.error || 'That did not work.');
    return data;
  };

  const showLogin = () => {
    $('#panel').hidden = true;
    $('#login').hidden = false;
  };

  const update = async (url, method, json) => render(await api(url, method, json));

  const button = (label, onclick, cls = '') => el('button', { class: `mini ${cls}`, type: 'button', text: label, onclick });

  const render = (data) => {
    $('#login').hidden = true;
    $('#panel').hidden = false;

    const pendingNoms = data.nominations.filter((n) => n.status === 'pending').length;
    const pendingDishes = data.dishes.filter((d) => d.status === 'pending').length;
    const stat = (value, label, alert) => el('li', { class: alert ? 'alert' : '' }, el('b', { text: value }), el('span', { text: label }));
    $('#stats').replaceChildren(
      stat(data.enquiries.length, 'Enquiries'),
      stat(data.enquiries.reduce((sum, e) => sum + e.guests, 0), 'Guests enquired'),
      stat(pendingNoms, 'Nominations to review', pendingNoms > 0),
      stat(pendingDishes, 'Dishes to review', pendingDishes > 0),
      stat(data.nominations.reduce((sum, n) => sum + n.votes, 0), 'Votes cast'),
    );

    $('#stagePick').replaceChildren(...STAGES.map(([value, label]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(data.stage === value), text: label,
      onclick: () => update('/api/admin/settings', 'PATCH', { stage: value }),
    })));
    $('#requireCodes').checked = data.requireCodes;
    $('#codeCount').textContent = data.codeCount;

    $('#noms').replaceChildren(...(data.nominations.length ? data.nominations.map((n) => el('article', { class: `nom ${n.status}` },
      el('img', { src: `/api/admin/portraits/${n.photo}`, alt: `Portrait submitted for ${n.name}` }),
      el('div', { class: 'nom-body' },
        el('h3', { text: n.name }),
        el('p', { text: `${n.category === 'king' ? 'Prom King' : 'Prom Queen'} · ${n.status} · ${n.votes} votes` }),
        n.nominated_by ? el('p', { text: `From ${n.nominated_by}` }) : '',
        n.reason ? el('p', { text: n.reason }) : ''),
      el('div', { class: 'nom-actions' },
        button('Approve', () => update(`/api/admin/nominations/${n.id}`, 'PATCH', { status: 'approved' }), n.status === 'approved' ? 'on' : ''),
        button('Reject', () => update(`/api/admin/nominations/${n.id}`, 'PATCH', { status: 'rejected' }), n.status === 'rejected' ? 'on' : ''),
        button('Delete', () => {
          if (confirm(`Delete ${n.name}, their photo and any votes? This cannot be undone.`)) update(`/api/admin/nominations/${n.id}`, 'DELETE');
        }, 'danger')))) : [el('p', { class: 'empty', text: 'No nominations yet.' })]));

    $('#dishes').replaceChildren(...data.dishes.map((d) => el('div', { class: `row ${d.status === 'pending' ? 'pending' : ''}` },
      el('div', {}, el('span', { class: 'row-title', text: d.name }), el('small', { text: `${d.category} · ${d.count} backers · ${d.status}${d.note ? ` · ${d.note}` : ''}` })),
      el('div', { class: 'row-actions' },
        button('Show', () => update(`/api/admin/dishes/${d.id}`, 'PATCH', { status: 'approved' }), d.status === 'approved' ? 'on' : ''),
        button('Hide', () => update(`/api/admin/dishes/${d.id}`, 'PATCH', { status: 'hidden' }), d.status === 'hidden' ? 'on' : '')))));

    $('#lineup').replaceChildren(...data.lineup.map((act) => {
      const name = el('input', { value: act.name ?? '', placeholder: `Act ${act.position} name`, 'aria-label': `Act ${act.position} name` });
      const role = el('input', { value: act.role ?? '', placeholder: 'Role, such as Live band', 'aria-label': `Act ${act.position} role` });
      const save = (revealed) => update(`/api/admin/lineup/${act.id}`, 'PATCH', { name: name.value, role: role.value, revealed });
      return el('div', { class: 'row' }, el('div', { class: 'act-form' }, name, role,
        el('div', { class: 'row-actions' },
          button('Save', () => save(Boolean(act.revealed))),
          button(act.revealed ? 'Seal' : 'Reveal', () => save(!act.revealed), act.revealed ? 'on' : ''))));
    }));

    $('#enquiries').replaceChildren(...(data.enquiries.length ? data.enquiries.map((e) => el('div', { class: 'row' },
      el('div', {}, el('span', { class: 'row-title', text: `${e.name} · ${e.guests} guest${e.guests === 1 ? '' : 's'}` }),
        el('small', { text: [e.email, e.phone, e.created_at].filter(Boolean).join(' · ') })),
      e.message ? el('p', { class: 'row-msg', text: e.message }) : '')) : [el('p', { class: 'empty', text: 'No enquiries yet.' })]));
  };

  $('#login').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('#login .form-msg');
    message.textContent = '';
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: event.target.password.value }),
    });
    if (res.ok) {
      event.target.reset();
      render(await api('/api/admin/data'));
    } else {
      const data = await res.json().catch(() => ({}));
      message.classList.add('error');
      message.textContent = data.error || 'That did not work.';
    }
  });

  $('#logout').addEventListener('click', async () => {
    await api('/api/admin/logout', 'POST');
    showLogin();
  });

  $('#requireCodes').addEventListener('change', (event) => update('/api/admin/settings', 'PATCH', { requireCodes: event.target.checked }));

  $('#codeForm').addEventListener('submit', (event) => {
    event.preventDefault();
    update('/api/admin/codes', 'POST', { count: event.target.count.value });
  });

  api('/api/admin/data').then(render).catch(showLogin);
})();
