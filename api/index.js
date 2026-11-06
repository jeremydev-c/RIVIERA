import { config } from '../server/config.js';

// Vercel may reuse this between requests, so the app is only set up once.
let starting;

export default async function handler(req, res) {
  let app;
  try {
    starting ??= import('../server/app.js').then(({ createApp }) => createApp(config()));
    app = await starting;
  } catch (error) {
    starting = undefined;
    console.error(error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('The site could not start. Please try again shortly.');
    return;
  }
  app(req, res);
}
