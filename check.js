const Database = require('better-sqlite3');
const db = new Database('ai-island.db');
const rows = db.prepare('SELECT id, title_en, title_fa FROM news LIMIT 3').all();
rows.forEach(r => {
  console.log('---');
  console.log('EN:', r.title_en);
  console.log('FA:', r.title_fa);
});