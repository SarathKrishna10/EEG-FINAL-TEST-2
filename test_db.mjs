import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const base = process.env.DATABASE_URL;
const ref = 'ubtsekpbyedvxdkuvvph';
const pass = 'SARATH7034EEG';

const urls = [
  // Transaction pooler (6543) - postgres.ref user
  `postgresql://postgres.${ref}:${pass}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
  // Session pooler (5432) - postgres.ref user
  `postgresql://postgres.${ref}:${pass}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  // Direct IPv6 host (may fail if no IPv4)
  // Skip direct host since it's IPv6 only
];

for (const url of urls) {
  const masked = url.replace(/:([^:@]+)@/, ':***@');
  process.stdout.write(`Testing: ${masked} ... `);
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    const res = await pool.query('SELECT current_user');
    console.log(`✅ OK (user=${res.rows[0].current_user})`);
  } catch (e) {
    console.log(`❌ ${e.message}`);
  } finally {
    await pool.end();
  }
}
