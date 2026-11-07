# The Grand Riviera

The website for The Grand Riviera Prom '26: tickets, the live Royal Court vote, the dish board, the lineup and a committee dashboard.

## Run it on your computer

Requires [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. The committee dashboard is at `/committee`, and its password is in the `.env` file. Without `MONGODB_URI`, the site uses a private local database in `data/`.

To run the automated tests:

```bash
npm test
```

## Put it online with Vercel

The site stores everything in MongoDB, in its own database called `grand_riviera`, so it stays apart from anything else on your cluster.

1. In MongoDB Atlas, open **Network Access** and allow `0.0.0.0/0`. Vercel has no fixed address. Use a long database password.
2. In Vercel, import this GitHub repository. Leave the framework as **Other**.
3. Under **Environment Variables**, add:

| Name | Value |
| --- | --- |
| `MONGODB_URI` | Your MongoDB connection string |
| `ADMIN_PASSWORD` | A long password of your own, for `/committee` |
| `SITE_URL` | Optional. Your final address, such as `https://thegrandriviera.co.ke` |

4. Deploy. The database and its starting data are created on the first visit.

Vercel's free Hobby plan is for non-commercial use only, so a paid event may need the Pro plan. Never commit `.env` or your connection string.

## Change the details

- **Ticket link, price, date, venue and wording:** the files in `views/`, one per page. Shared parts such as the menu are in `views/layout.html`, and page titles are in `server/pages.js`.
- **Countdown:** the `DOORS` and `CLOSE` dates at the top of `public/js/site.js`.
- **Share image:** edit `scripts/make-images.js`, then run `npm run og`.

## Run the Royal Court from `/committee`

1. **Nominations open.** Approve or reject each entry. Check the photo and confirm the person agreed.
2. **Ballot published.** Approved nominees appear publicly. Nominations close.
3. **Live vote open.** Open this on the night.
4. **Crowned.** The winners appear on the site. A tie shows all tied nominees.

Every vote needs a ballot card. Under **Ballot cards**, make one per guest, then **Print all cards** (8 per A4 page) and hand them out at the door. Guests scan the QR code to open the vote with their code filled in. Each card votes once for King and once for Queen, so nobody can vote twice.

Once the ballot is published, each nominee's card has a Share button. It sends a link such as `/vote/12`, which previews in WhatsApp with their portrait.

## How it is built

- `server/` is the Express API, with MongoDB for storage and sharp to clean uploaded photos.
- `api/index.js` is the entry point Vercel runs.
- `views/` holds the HTML for each page, which the server joins to the shared layout.
- `public/` is hand-written CSS and JavaScript with no build step.
- `public/js/sky.js` draws the animated hero.
