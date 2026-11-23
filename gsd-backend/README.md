# GSD Inventory Management System

## Architecture

- `server.js` serves the static frontend and provides the Express REST API.
- `db.js` owns the MongoDB connection, indexes, seed data, password hashing, and transactions.
- `../gsd-frontend/jscript/app.js` handles page behavior and calls the API.
- Data is stored in MongoDB (MongoDB Atlas in production). See [../DEPLOY.md](../DEPLOY.md) for Render + Atlas deployment.

Passwords are hashed with Node.js `scrypt`. Login uses an HTTP-only, SameSite=Strict cookie and server-side sessions stored in MongoDB (they survive restarts). All data endpoints require an active session; user administration, reset-request review, backup, and wipe routes additionally require the Admin role. Stock changes and audit rows are written in one MongoDB transaction, and stock-outs use a conditional update so stock can never go negative, even under concurrent requests.

## File Structure

```
gsd-backend/
  server.js        Express API + server-side page guards + static hosting of gsd-frontend
  db.js            MongoDB collections/indexes, seed, hashing, transaction helper
  migrate-sqlite-to-mongo.js  One-time copy of the old data/gsd.sqlite into MongoDB (npm run migrate)
  test.js          End-to-end API test (npm test) against a throwaway in-memory MongoDB
  .env.example     Template for local settings (copy to .env)
gsd-frontend/
  index.html       Login + Forgot Password request
  inventory.html   Master item list, search/category/month filters, CSV export, print
  purchaseorder.html  PO / stock-in (creates new items on first PO)
  stockout.html    SRF / stock-out (blocks issuing more than available)
  returnslip.html  Return of unused items against an SRF (cannot exceed unreturned qty) + printable slip
  stockcard.html   Per-item ledger with running balance, CSV export, print layout
  settings.html    Admin only: JSON backup download, confirmed data wipe
  usermanagement.html Admin only: create/delete/deactivate users, reset passwords, review reset requests
  jscript/app.js   All page behaviour (talks to /api)
  css/nia-theme.css Shared theme + print styles
```

`jscript/script.js` and `css/style.css` are earlier localStorage prototypes and are not loaded by any page.

## Data Model

- **users**: name, username (unique), scrypt password hash, role (Admin/Staff), status (Active/Inactive)
- **inventory_items**: name (unique), category, unit, live quantity (never negative), reorder point
- **transactions**: item, type (PO / SRF / RETURN / OPENING), reference, date, quantity, unit cost, office, notes, JSON metadata (return-slip details), acting user. Each movement also stores the acting user's name so the audit trail survives user deletion.
- **password_reset_requests**: username, reason, status (Pending/Approved/Declined), reviewer
- **sessions** (expire automatically via TTL index), **counters** (numeric ids), **app_meta**

## Access Control

- Logged-out visitors requesting any module page are redirected to the login page by the server.
- Staff requesting `settings.html` or `usermanagement.html` are redirected to Inventory, the links are hidden, and every `/api/admin/*` call returns 403.

## Run Locally

Requires Node.js 22.5+ and a MongoDB replica set (a free MongoDB Atlas cluster works; transactions do not work on a standalone local `mongod`).

```powershell
cd gsd-backend
copy .env.example .env   # paste your MONGODB_URI into .env
npm.cmd install
npm.cmd run dev
```

`npm.cmd test` runs the end-to-end tests on a throwaway in-memory MongoDB (the first run downloads a MongoDB binary, ~600 MB, into your user cache).

Open `http://localhost:3000`.

Demo accounts for local development:

- Admin: `gsd_admin` / `ChangeMe!2026`
- Staff: `gsd_staff` / `StaffPass!2026`

When the database is empty, the first local run seeds the two accounts plus VINYL TILES and Portland Cement demo history (demo items are not seeded in production unless `GSD_SEED_DEMO=true`). A system wipe removes inventory, movement history, and password-reset requests, but preserves users.

## Production Notes

Before first production startup, set unique `GSD_ADMIN_PASSWORD` and `GSD_STAFF_PASSWORD` environment variables. Production startup refuses to seed accounts without them. Set `NODE_ENV=production` behind HTTPS so session cookies are marked Secure. Full steps for Render + MongoDB Atlas are in [../DEPLOY.md](../DEPLOY.md).
