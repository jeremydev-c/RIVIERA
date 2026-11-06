import { createApp } from '../server/app.js';
import { config } from '../server/config.js';

// Vercel may reuse this between requests, so the database connection is opened once.
let starting;

export default async function handler(req, res) {
  starting ??= createApp(config()).catch((error) => {
    starting = undefined;
    throw error;
  });
  const app = await starting;
  app(req, res);
}
