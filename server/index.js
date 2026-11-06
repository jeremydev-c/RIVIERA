import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file: the host provides environment variables directly.
}

const settings = config();

if (!settings.adminPassword) console.warn('ADMIN_PASSWORD is not set, so the committee login is disabled.');

if (!settings.mongoUri) {
  if (process.env.NODE_ENV === 'production') throw new Error('MONGODB_URI is not set.');
  const { MongoMemoryServer } = await import('mongodb-memory-server-core');
  fs.mkdirSync('./data/mongo', { recursive: true });
  const local = await MongoMemoryServer.create({ instance: { dbPath: './data/mongo', storageEngine: 'wiredTiger' } });
  settings.mongoUri = local.getUri();
  console.log('Using a private local database in ./data/mongo.');
}

const { PORT = 3000 } = process.env;
const app = await createApp(settings);

app.listen(PORT, () => console.log(`The Grand Riviera is open at http://localhost:${PORT}`));
