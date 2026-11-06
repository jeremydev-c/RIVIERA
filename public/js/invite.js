// Draws the "I'm going" card in the browser. The name never leaves the guest's device.
(() => {
  const canvas = document.getElementById('inviteCanvas');
  const ctx = canvas.getContext('2d');
  const form = document.getElementById('inviteForm');
  const message = form.querySelector('.form-msg');
  const action = document.getElementById('inviteAction');
  const W = 1080;
  const H = 1920;
  const HORIZON = 1180;
  const SUN = 390;
  const PLACEHOLDER = 'Your name';

  const foil = (x0, x1, stops) => {
    const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
    stops.forEach(([at, colour]) => gradient.addColorStop(at, colour));
    return gradient;
  };
  const paleFoil = () => foil(90, 990, [[0, '#e9c874'], [.3, '#fff6d6'], [.52, '#f0d48a'], [.74, '#fff6d6'], [1, '#e3bd66']]);

  const fitFont = (text, style, family, start, maxWidth) => {
    let size = start;
    do {
      ctx.font = `${style} ${size}px ${family}`;
      size -= 2;
    } while (ctx.measureText(text).width > maxWidth && size > 40);
  };

  // Text at this scale loses Bodoni's hairlines, so a fine outline keeps them visible.
  const heavyText = (text, x, y, weight) => {
    ctx.lineWidth = weight;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };

  const spacedCaps = (text, y, size, colour, spacing) => {
    ctx.font = `500 ${size}px Jost`;
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillStyle = colour;
    ctx.fillText(text, W / 2 + spacing / 2, y);
    ctx.letterSpacing = '0px';
  };

  const drawSky = () => {
    ctx.fillStyle = '#0b0906';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, HORIZON);
    ctx.clip();
    const glow = ctx.createRadialGradient(W / 2, HORIZON, SUN * .8, W / 2, HORIZON, SUN * 2.3);
    glow.addColorStop(0, 'rgba(201, 150, 60, .62)');
    glow.addColorStop(.45, 'rgba(110, 72, 22, .3)');
    glow.addColorStop(1, 'rgba(11, 9, 6, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, HORIZON);

    // The rays alternate long and short, like the logo.
    for (let i = 0; i <= 48; i += 1) {
      const angle = Math.PI + (i / 48) * Math.PI;
      const length = i % 2 ? SUN * 1.3 : SUN * 1.72;
      const spread = .012;
      ctx.beginPath();
      ctx.moveTo(W / 2 + (SUN + 16) * Math.cos(angle - spread), HORIZON + (SUN + 16) * Math.sin(angle - spread));
      ctx.lineTo(W / 2 + (SUN + 16) * Math.cos(angle + spread), HORIZON + (SUN + 16) * Math.sin(angle + spread));
      ctx.lineTo(W / 2 + length * Math.cos(angle), HORIZON + length * Math.sin(angle));
      ctx.closePath();
      ctx.fillStyle = 'rgba(233, 200, 116, .3)';
      ctx.fill();
    }

    const disc = ctx.createLinearGradient(0, HORIZON - SUN, 0, HORIZON);
    disc.addColorStop(0, '#c99a42');
    disc.addColorStop(.6, '#e6c477');
    disc.addColorStop(1, '#f6dfa0');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(W / 2, HORIZON, SUN, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // The sun's reflection, broken into the same tapering bars as the logo.
    [[880, 13], [650, 11], [460, 9], [300, 8], [170, 6], [80, 5]].forEach(([width, height], i) => {
      ctx.fillStyle = `rgba(233, 200, 116, ${.95 - i * .1})`;
      ctx.fillRect((W - width) / 2, HORIZON + 16 + i * 30, width, height);
    });

    ctx.strokeStyle = 'rgba(233, 200, 116, .6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(44, 44, W - 88, H - 88);
  };

  const draw = (name) => {
    drawSky();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    const shown = name || PLACEHOLDER;
    ctx.globalAlpha = name ? 1 : .5;
    fitFont(shown, 'italic 500', 'Bodoni', 138, 860);
    ctx.fillStyle = paleFoil();
    heavyText(shown, W / 2, 318, 1.5);
    ctx.globalAlpha = 1;

    spacedCaps('IS GOING TO', 396, 34, '#fbeebc', 12);

    ctx.font = '600 212px Bodoni';
    ctx.letterSpacing = '12px';
    ctx.fillStyle = paleFoil();
    heavyText('GRAND', W / 2 + 6, 620, 2.5);
    ctx.letterSpacing = '0px';

    // "Riviera" turns to black ink where it crosses the sun, as it does on the site.
    ctx.font = 'italic 500 268px Bodoni';
    ctx.fillStyle = paleFoil();
    heavyText('Riviera', W / 2, 890, 2.5);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, HORIZON, SUN, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#160f06';
    heavyText('Riviera', W / 2, 890, 2.5);
    ctx.restore();

    ctx.font = '500 66px Bodoni';
    ctx.fillStyle = '#fbeebc';
    heavyText('Friday 4 December', W / 2, 1460, 1);
    spacedCaps('6 PM TO MIDNIGHT', 1524, 30, '#e9e0cc', 7);
    spacedCaps('THE EVENT SPACE, WESTLANDS', 1572, 30, '#e9e0cc', 7);
    spacedCaps('@THE.GRAND.RIVIERA', 1652, 32, '#e9c874', 8);
  };

  const name = () => form.name.value.trim();

  const makeFile = () => new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const slug = name().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guest';
      resolve(new File([blob], `grand-riviera-${slug}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', .93);
  });

  const download = (file) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const canShareFiles = () => {
    const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'probe.jpg', { type: 'image/jpeg' });
    return Boolean(navigator.canShare?.({ files: [probe] }));
  };
  if (canShareFiles()) action.textContent = 'Share your card';

  form.name.addEventListener('input', () => {
    message.textContent = '';
    message.classList.remove('error');
    draw(name());
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.classList.remove('error');
    if (!name()) {
      message.classList.add('error');
      message.textContent = 'Type your name first.';
      form.name.focus();
      return;
    }
    const file = await makeFile();
    if (canShareFiles()) {
      try {
        await navigator.share({ files: [file] });
        message.textContent = 'Now tag @the.grand.riviera.';
      } catch (error) {
        if (error.name !== 'AbortError') {
          download(file);
          message.textContent = 'Saved. Post it and tag @the.grand.riviera.';
        }
      }
      return;
    }
    download(file);
    message.textContent = 'Saved. Post it and tag @the.grand.riviera.';
  });

  // Draw straight away, then again once the brand fonts are ready.
  draw('');
  Promise.all(['500 66px Bodoni', '600 212px Bodoni', 'italic 500 268px Bodoni', '500 34px Jost']
    .map((font) => document.fonts.load(font))).then(() => draw(name()));
})();
