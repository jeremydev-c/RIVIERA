// Builds the WhatsApp/social share image and the iOS home-screen icon from vector art.
import sharp from 'sharp';
import fs from 'node:fs';

const rays = (cx, cy, inner, outer, count) => {
  let d = '';
  for (let i = 0; i <= count; i += 1) {
    const a = Math.PI + (i / count) * Math.PI;
    const long = i % 2 === 0;
    const end = long ? outer : outer * .78;
    const spread = 0.022;
    const p = (r, t) => `${(cx + r * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`;
    d += `M${p(end, a)}L${p(inner, a - spread)}L${p(inner, a + spread)}Z`;
  }
  return d;
};

const bars = [[860, 11], [620, 9], [430, 8], [270, 6], [130, 5]]
  .map(([w, h], i) => `<rect x="${600 - w / 2}" y="${442 + i * 22}" width="${w}" height="${h}"/>`).join('');

const fonts = fs.existsSync('C:/Windows/Fonts/bod_b.ttf') ? 'Bodoni MT' : 'Didot, Georgia, serif';

const share = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="foil" x1="0" x2="1" y1="0" y2=".3">
      <stop offset="0" stop-color="#a67c2c"/><stop offset=".3" stop-color="#fbeebc"/>
      <stop offset=".52" stop-color="#c79a3e"/><stop offset=".78" stop-color="#f3dc9a"/><stop offset="1" stop-color="#a67c2c"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="66%" r="60%"><stop offset="0" stop-color="#b98a35"/><stop offset=".5" stop-color="#4a3210"/><stop offset="1" stop-color="#0b0906"/></radialGradient>
  </defs>
  <clipPath id="disc"><circle cx="600" cy="430" r="190"/></clipPath>
  <rect width="1200" height="430" fill="url(#glow)"/>
  <rect y="430" width="1200" height="200" fill="#0b0906"/>
  <path d="${rays(600, 430, 205, 470, 44)}" fill="#e9c874" opacity=".38"/>
  <path d="M410 430a190 190 0 0 1 380 0z" fill="url(#foil)"/>
  <g fill="#e9c874">${bars}</g>
  <text x="600" y="150" text-anchor="middle" font-family="${fonts}" font-size="104" letter-spacing="14" fill="#fbeebc">THE GRAND</text>
  <text x="600" y="330" text-anchor="middle" font-family="${fonts}" font-style="italic" font-size="190" fill="#fbeebc">Riviera</text>
  <text clip-path="url(#disc)" x="600" y="330" text-anchor="middle" font-family="${fonts}" font-style="italic" font-size="190" fill="#120c05">Riviera</text>
  <text x="600" y="606" text-anchor="middle" font-family="Century Gothic, Arial, sans-serif" font-size="27" letter-spacing="5" fill="#fbeebc">FRI 4 DEC · WESTLANDS, NAIROBI · TICKETS FROM KES 2,400</text>
</svg>`;

await sharp(Buffer.from(share)).png({ compressionLevel: 9 }).toFile('public/img/share.png');
await sharp('public/img/favicon.svg', { density: 300 }).resize(180, 180).png().toFile('public/img/apple-touch-icon.png');
console.log('Images written to public/img');
