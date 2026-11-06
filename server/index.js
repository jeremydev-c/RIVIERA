import { createApp } from './app.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file: the host provides environment variables directly.
}

const { ADMIN_PASSWORD, DATA_DIR = './data', PORT = 3000, SITE_URL = '', NODE_ENV } = process.env;

if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set, so the committee login is disabled.');

const app = createApp({
  dataDir: DATA_DIR,
  adminPassword: ADMIN_PASSWORD,
  siteUrl: SITE_URL.replace(/\/$/, ''),
  secureCookies: NODE_ENV === 'production',
});

app.listen(PORT, () => console.log(`The Grand Riviera is open at http://localhost:${PORT}`));
