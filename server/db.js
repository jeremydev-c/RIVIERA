import { MongoClient } from 'mongodb';

// The site keeps its own database, so it stays apart from anything else on the cluster.
export const DEFAULT_DB = 'grand_riviera';

// The board as it stood on the previous site, so earlier votes are not lost.
// Champagne stays hidden until the committee decides, because this is a 16+ event.
const SEED_DISHES = [
  ['ice-cream', 'Ice Cream', 'Desserts', null, 9, 'approved'],
  ['doughnuts', 'Doughnuts', 'Desserts', 'Coconut glazed', 7, 'approved'],
  ['nyama-choma', 'Nyama Choma', 'Mains', null, 6, 'approved'],
  ['glazed-ham', 'Glazed Ham', 'Mains', null, 4, 'approved'],
  ['gaks', 'Gaks', 'Sides', null, 3, 'approved'],
  ['champagne', 'Champagne', 'Drinks', 'Champagne popping', 2, 'hidden'],
];

const upsertNew = (_id, fields) => ({
  updateOne: { filter: { _id }, update: { $setOnInsert: fields }, upsert: true },
});

// Every write only fills in what is missing, so two servers starting together cannot clash.
async function seed(db) {
  if (await db.collection('settings').findOne({ _id: 'seeded' })) return;
  await db.collection('limits').createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
  await db.collection('votes').createIndex({ nominee_id: 1 });
  await db.collection('backs').createIndex({ dish_id: 1 });
  await db.collection('settings').bulkWrite([
    upsertNew('stage', { value: 'nominations' }),
    upsertNew('require_codes', { value: false }),
  ], { ordered: false });
  await db.collection('dishes').bulkWrite(SEED_DISHES.map(([_id, name, category, note, base_count, status]) =>
    upsertNew(_id, { name, category, note, base_count, status, created_at: new Date() })), { ordered: false });
  await db.collection('lineup').bulkWrite([1, 2, 3, 4].map((position) =>
    upsertNew(`act-${position}`, { position, name: '', role: '', revealed: false })), { ordered: false });
  await db.collection('settings').updateOne({ _id: 'seeded' }, { $set: { value: true } }, { upsert: true });
}

export async function openDb(uri, name = DEFAULT_DB) {
  if (!uri) throw new Error('MONGODB_URI is not set.');
  const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(name);
  await seed(db);
  return { db, close: () => client.close() };
}

export const getSetting = async (db, key) => (await db.collection('settings').findOne({ _id: key }))?.value;

export const setSetting = (db, key, value) =>
  db.collection('settings').updateOne({ _id: key }, { $set: { value } }, { upsert: true });
