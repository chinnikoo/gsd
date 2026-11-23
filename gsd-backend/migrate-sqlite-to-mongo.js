// One-time copy of the old SQLite database (data/gsd.sqlite) into MongoDB.
//
//   node --env-file=.env migrate-sqlite-to-mongo.js [path/to/gsd.sqlite] [--replace]
//
// Needs MONGODB_URI (and optionally MONGODB_DB, default "gsd"). Refuses to run if the target database
// already has users, unless --replace is given, which first DELETES all GSD collections in that database.
// Users keep their existing passwords (the scrypt hashes are copied as-is).
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { MongoClient } = require('mongodb');

async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes('--replace');
  const sqlitePath = args.find(arg => !arg.startsWith('--')) || path.join(__dirname, 'data', 'gsd.sqlite');
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI first (see DEPLOY.md).');

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const all = sql => sqlite.prepare(sql).all().map(row => ({ ...row }));
  const users = all('SELECT * FROM users ORDER BY id');
  const items = all('SELECT * FROM inventory_items ORDER BY id');
  const transactions = all('SELECT * FROM transactions ORDER BY id');
  const requests = all('SELECT * FROM password_reset_requests ORDER BY id');
  const meta = all('SELECT * FROM app_meta');
  const userName = new Map(users.map(user => [user.id, user.name]));

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || 'gsd');
    const names = ['users', 'inventory_items', 'transactions', 'password_reset_requests', 'sessions', 'counters', 'app_meta'];
    if (await db.collection('users').countDocuments() > 0) {
      if (!replace) throw new Error(`Database "${db.databaseName}" already has users. Re-run with --replace to overwrite it.`);
      for (const name of names) await db.collection(name).deleteMany({});
    }

    const insert = async (name, docs) => { if (docs.length) await db.collection(name).insertMany(docs); };
    await insert('users', users.map(user => ({ ...user, username_key: user.username.toLowerCase() })));
    await insert('inventory_items', items.map(item => ({ ...item, name_key: item.name.toLowerCase() })));
    await insert('transactions', transactions.map(row => {
      let metadata = {};
      try { metadata = JSON.parse(row.metadata || '{}'); } catch {}
      return { ...row, metadata, reference_key: row.reference.toLowerCase(), actor_name: userName.get(row.actor_id) ?? null };
    }));
    await insert('password_reset_requests', requests.map(row => ({ ...row, reviewer_name: userName.get(row.reviewer_id) ?? null })));
    await insert('app_meta', meta.map(row => ({ _id: row.key, value: row.value })));
    const maxId = rows => rows.reduce((max, row) => Math.max(max, row.id), 0);
    await insert('counters', [
      { _id: 'users', seq: maxId(users) },
      { _id: 'inventory_items', seq: maxId(items) },
      { _id: 'transactions', seq: maxId(transactions) },
      { _id: 'password_reset_requests', seq: maxId(requests) }
    ]);
    console.log(`Migrated into "${db.databaseName}": ${users.length} users, ${items.length} items, ${transactions.length} movements, ${requests.length} reset requests.`);
  } finally {
    await client.close();
    sqlite.close();
  }
}

main().catch(error => {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
});
