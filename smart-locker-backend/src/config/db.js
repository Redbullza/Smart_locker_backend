const { Pool } = require('pg');


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c TimeZone=Asia/Bangkok',
  ssl: {
    rejectUnauthorized: false, // จำเป็นสำหรับการเชื่อมต่อ Supabase บน Cloud
  },
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PG client:', err);
});

module.exports = pool;
