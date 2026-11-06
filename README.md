# The Grand Riviera

The website for The Grand Riviera Prom '26: tickets, the live Royal Court vote, the dish board, the lineup and a committee dashboard.

## Run it on your computer

Requires [Node.js](https://nodejs.org) 22.5 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. The committee dashboard is at `/committee`, and its password is in the `.env` file.

To run the automated tests:

```bash
npm test
```

## Put it online

Use any host that runs Node.js and offers a persistent disk (Render, Railway, Fly.io or a VPS). The disk matters: it holds the votes, nominations and portraits.

| Setting | Value |
| --- | --- |
| Build command | `npm install --omit=dev` |
| Start command | `npm start` |
| `NODE_ENV` | `production` |
| `ADMIN_PASSWORD` | A long password of your own |
| `SITE_URL` | Your final address, such as `https://thegrandriviera.co.ke` |
| `DATA_DIR` | The path of your persistent disk |

Do not upload `.env` or the `data` folder. Back up the `DATA_DIR` folder on the day of the event.

## Change the details

- **Ticket link, price, date, venue and wording:** the files in `views/`, one per page. Shared parts such as the menu are in `views/layout.html`, and page titles are in `server/pages.js`.
- **Countdown:** the `DOORS` and `CLOSE` dates at the top of `public/js/site.js`.
- **Share image:** edit `scripts/make-images.js`, then run `npm run og`.

## Run the Royal Court from `/committee`

1. **Nominations open.** Approve or reject each entry. Check the photo and confirm the person agreed.
2. **Ballot published.** Approved nominees appear publicly. Nominations close.
3. **Live vote open.** Open this on the night.
4. **Crowned.** The winners appear on the site. A tie shows all tied nominees.

Without ballot codes, each browser gets one vote, and someone determined could vote again in a private window. For a vote that cannot be stuffed, generate codes, print one for each guest, and tick **Require a ballot code**.

Once the ballot is published, each nominee's card has a Share button. It sends a link such as `/vote/12`, which previews in WhatsApp with their portrait.

## How it is built

- `server/` is the Express API, with SQLite for storage and sharp to clean uploaded photos.
- `views/` holds the HTML for each page, which the server joins to the shared layout.
- `public/` is hand-written CSS and JavaScript with no build step.
- `public/js/sky.js` draws the animated hero.
