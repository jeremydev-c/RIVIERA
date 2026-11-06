export const config = () => ({
  mongoUri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB || undefined,
  adminPassword: process.env.ADMIN_PASSWORD,
  siteUrl: (process.env.SITE_URL ?? '').replace(/\/$/, ''),
  secureCookies: process.env.NODE_ENV === 'production',
});
