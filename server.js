const express = require('express');
const path = require('path');
const crypto = require('crypto');
const pg = require('pg');
const { Pool } = pg;
const jwt = require('jsonwebtoken');

// The page and the server validate maps with the same code: map-model.js is
// UMD, so the browser loads it as window.M2Model and the server requires it.
const M2Model = require('./public/js/map-model');
const { exampleDoc } = require('./public/js/example-map');
const { demoMaps, sharedDemoDoc, trashedDemoDoc, lisbonVersions } = require('./server/demo-maps');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json({ limit: '512kb' }));

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') {
        req.user = claims;
        // Kept for the platform calls made on this person's behalf (the
        // member list), which authenticate with their own token.
        req.userToken = token;
      }
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// /health answers 503 while shutting down, so the platform stops sending
// traffic before the process goes away.
let shuttingDown = false;
app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting-down' });
  return res.json({ status: 'ok' });
});

// ── M2's API ─────────────────────────────────────────────────────────────
// Maps are personal notes, so every table here is staging:private and every
// write touches only the signed-in person's own rows. A map's owner may let
// others READ it (see "Sharing" below); nobody but the owner ever writes.

async function bootSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maps (
      id          text PRIMARY KEY,
      owner_id    text NOT NULL,
      title       text NOT NULL,
      doc         jsonb NOT NULL,
      idea_count  integer NOT NULL,
      created_at  timestamptz NOT NULL,
      updated_at  timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS maps_owner_updated ON maps (owner_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS profiles (user_id text PRIMARY KEY, welcomed_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS demo_seeds (user_id text PRIMARY KEY, seeded_at timestamptz NOT NULL);
    COMMENT ON TABLE maps IS 'staging:private';
    COMMENT ON TABLE profiles IS 'staging:private';
    COMMENT ON TABLE demo_seeds IS 'staging:private';

    -- Who can open a map besides its owner. NULL and 'private' are both
    -- Private, so every map made before sharing existed stays private.
    -- share_token is set only while visibility is 'link'.
    ALTER TABLE maps ADD COLUMN IF NOT EXISTS visibility text
      CHECK (visibility IN ('private', 'link', 'public'));
    ALTER TABLE maps ADD COLUMN IF NOT EXISTS share_token text;
    CREATE UNIQUE INDEX IF NOT EXISTS maps_share_token ON maps (share_token)
      WHERE share_token IS NOT NULL;
    -- The project members a map's owner added; each reads it whatever its
    -- visibility. username comes from the platform's member list, shared_by
    -- is the owner's username when they added the row.
    CREATE TABLE IF NOT EXISTS map_readers (
      map_id     text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      user_id    text NOT NULL,
      username   text NOT NULL,
      shared_by  text NOT NULL,
      added_at   timestamptz NOT NULL,
      PRIMARY KEY (map_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS map_readers_user ON map_readers (user_id);
    COMMENT ON TABLE map_readers IS 'staging:private';

    -- Bumped by every save. A save names the revision it was made from, so
    -- a tab or device holding an older copy is refused instead of
    -- overwriting a newer one (#12).
    ALTER TABLE maps ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

    -- A deleted map waits here for 30 days (Recently deleted, #30) before
    -- the hourly purge removes it for good. NULL means active: every read
    -- and write route filters deleted_at IS NULL, so a trashed map answers
    -- 404 for everyone, its owner included, until it is restored.
    ALTER TABLE maps ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    CREATE INDEX IF NOT EXISTS maps_deleted
      ON maps (owner_id, deleted_at) WHERE deleted_at IS NOT NULL;

    -- Version history (#32): a snapshot of a map as it was, written by the
    -- save that replaced it (the previous doc) and by a restore (the map
    -- just before going back). Personal notes: staging:private, and the
    -- rows go with their map when it is purged.
    CREATE TABLE IF NOT EXISTS map_versions (
      id          bigserial PRIMARY KEY,
      map_id      text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      revision    integer NOT NULL,
      doc         jsonb NOT NULL,
      idea_count  integer NOT NULL,
      created_at  timestamptz NOT NULL,
      reason      text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS map_versions_map_created
      ON map_versions (map_id, created_at DESC);
    COMMENT ON TABLE map_versions IS 'staging:private';
  `);
  if (IS_STAGING) {
    // A fixed "Anyone with the link" map owned by a fake person, so the
    // shared-link check has an address that always works. Staging only.
    const doc = sharedDemoDoc();
    await pool.query(
      `INSERT INTO maps (id, owner_id, title, doc, idea_count, created_at, updated_at, visibility, share_token)
       VALUES ('demo-shared-link', $1, $2, $3, $4, now(), now(), 'link', 'staging-demo-link')
       ON CONFLICT (id) DO NOTHING`,
      [DEMO_FRIEND, doc.nodes[0].text, JSON.stringify(doc), doc.nodes.length]
    );
    // A fake person's map trashed 31 days ago, so the boot purge below can
    // be seen removing it: the acceptance check that anything past 30 days
    // disappears. Staging only.
    const expired = trashedDemoDoc();
    await pool.query(
      `INSERT INTO maps (id, owner_id, title, doc, idea_count, created_at, updated_at, deleted_at)
       VALUES ('demo-expired-trash', $1, $2, $3, $4, now(), now(), now() - interval '31 days')
       ON CONFLICT (id) DO NOTHING`,
      [DEMO_FRIEND, expired.nodes[0].text, JSON.stringify(expired), expired.nodes.length]
    );
  }
}

const MAP_COLUMNS = 'id, title, doc, idea_count, created_at, updated_at, revision';

// The made-up person who owns the staging demo's shared maps.
const DEMO_FRIEND = 'staging-demo-friend';

// The map row when this caller may open it: its owner, a signed-in viewer
// (Public, or one of the people the owner added), or anyone holding the
// map's current secret link (guests included, through `share`). Null
// answers the same 404 as a missing map, whatever the reason.
async function readAccess(req, mapId, share) {
  if (!mapId || mapId.length > 64) return null;
  if (req.user) {
    const row = await pool.query(
      `SELECT ${MAP_COLUMNS}, owner_id FROM maps m
       WHERE m.id = $1 AND m.deleted_at IS NULL AND (m.owner_id = $2 OR m.visibility = 'public'
         OR EXISTS (SELECT 1 FROM map_readers r WHERE r.map_id = m.id AND r.user_id = $2))`,
      [mapId, String(req.user.id)]
    );
    if (row.rowCount) return { row: row.rows[0] };
  }
  if (share && typeof share === 'string' && share.length <= 64) {
    const row = await pool.query(
      `SELECT ${MAP_COLUMNS}, owner_id FROM maps
       WHERE id = $1 AND share_token = $2 AND visibility = 'link' AND deleted_at IS NULL`,
      [mapId, share]
    );
    if (row.rowCount) return { row: row.rows[0] };
  }
  return null;
}

// ── Live updates (#34) ───────────────────────────────────────────────────
// Everyone with a map open holds one SSE stream (GET /api/maps/:id/events).
// A save or a delete is announced ONCE through Postgres LISTEN/NOTIFY —
// always used, whatever the replica count — and each replica forwards the
// event to its own streams. Presence (who is on the map and which idea they
// hold) lives in memory per replica, refreshed by the clients themselves,
// so it needs no database and dies with the replica that holds it.

const LIVE_CHANNEL = 'm2_events';
const streams = new Map(); // map id -> Set of stream records
const MAX_STREAMS = 8;     // per user per replica; the ninth ends the oldest

function sseSend(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); }
  catch {}
}

function addStream(mapId, rec) {
  let set = streams.get(mapId);
  if (!set) { set = new Set(); streams.set(mapId, set); }
  // A stray client must not hold sockets forever.
  const mine = [...set].filter(s => s.userId === rec.userId);
  if (mine.length >= MAX_STREAMS) {
    const oldest = mine[0];
    set.delete(oldest);
    try { oldest.res.end(); } catch {}
  }
  set.add(rec);
}

function removeStream(mapId, rec) {
  const set = streams.get(mapId);
  if (!set) return;
  set.delete(rec);
  if (set.size === 0) streams.delete(mapId);
}

function endAllStreams() {
  for (const set of streams.values()) {
    for (const s of set) {
      sseSend(s.res, 'bye', {});
      try { s.res.end(); } catch {}
    }
  }
  streams.clear();
}

// ── Presence: in memory, swept with real time ────────────────────────────
const PRESENCE_TTL_MS = 40_000;
const presence = new Map(); // map id -> Map(userId -> { id, username, selectedId, at })
const PRESENCE_COLOURS = ['teal', 'amber', 'violet', 'rose', 'sky', 'green', 'orange', 'indigo', 'pink', 'slate'];
// From the user id, so every device gives the same person the same colour.
function presenceColour(userId) {
  const byte = crypto.createHash('sha1').update(String(userId)).digest()[0];
  return PRESENCE_COLOURS[byte % PRESENCE_COLOURS.length];
}
// The staging demo's host keeps an idea selected on their own maps, so the
// shared-link screens are never empty of people.
const demoSelection = new Map(); // map id -> idea id

function sendPresence(mapId) {
  const set = streams.get(mapId);
  if (!set || set.size === 0) return;
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  const byUser = presence.get(mapId);
  const people = [];
  if (byUser) {
    for (const p of byUser.values()) {
      if (p.at < cutoff) continue;
      people.push({ id: p.id, username: p.username, selectedId: p.selectedId, color: presenceColour(p.id) });
    }
  }
  if (IS_STAGING && demoSelection.has(mapId)) {
    people.push({
      id: DEMO_FRIEND, username: 'Staging demo friend',
      selectedId: demoSelection.get(mapId), color: presenceColour(DEMO_FRIEND),
    });
  }
  for (const s of set) sseSend(s.res, 'presence', { people });
}

const presenceSweep = setInterval(() => {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const [mapId, byUser] of presence) {
    let changed = false;
    for (const [id, p] of byUser) {
      if (p.at < cutoff) { byUser.delete(id); changed = true; }
    }
    if (byUser.size === 0) presence.delete(mapId);
    else if (changed) sendPresence(mapId);
  }
}, 5000).unref();

// ── The one announcement channel ─────────────────────────────────────────
function notify(payload) {
  pool.query('SELECT pg_notify($1, $2)', [LIVE_CHANNEL, JSON.stringify(payload)])
    .catch(err => console.warn('pg_notify failed: ' + err.message));
}

let listenClient = null;
let listenUp = false;      // has this replica ever completed a LISTEN?
let listenTries = 0;
const LISTEN_BACKOFF = [2000, 5000, 10000];

function deliver(ev) {
  if (!ev || typeof ev.mapId !== 'string') return;
  const set = streams.get(ev.mapId);
  if (!set || set.size === 0) return;
  for (const s of set) {
    // The saver learns its own save from the PUT's answer; everyone else
    // (and every guest) is told here.
    if (ev.kind === 'doc' && s.signedIn && ev.by === s.userId) continue;
    if (ev.kind === 'doc') sseSend(s.res, 'doc', { revision: ev.revision, by: ev.by });
    else sseSend(s.res, 'gone', {});
  }
}

function deliverAll(kind) {
  for (const set of streams.values()) {
    for (const s of set) sseSend(s.res, kind, {});
  }
}

// A dead pg client cannot reconnect, so each attempt makes a fresh one.
function startListener() {
  if (shuttingDown || listenClient) return;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  listenClient = client;
  let dead = false;
  const drop = () => {
    if (dead) return;
    dead = true;
    listenUp = false;
    if (listenClient === client) listenClient = null;
    client.end().catch(() => {});
    const wait = LISTEN_BACKOFF[Math.min(listenTries++, LISTEN_BACKOFF.length - 1)];
    setTimeout(startListener, wait).unref();
  };
  client.on('notification', msg => {
    let ev;
    try { ev = JSON.parse(msg.payload); } catch { return; }
    deliver(ev);
  });
  client.on('error', drop);
  client.on('end', drop);
  client.connect().then(async () => {
    await client.query('LISTEN ' + LIVE_CHANNEL);
    const first = !listenUp;
    listenUp = true;
    listenTries = 0;
    // After a gap in the announcements, streams fetch the missing time.
    if (!first) deliverAll('resync');
  }).catch(err => {
    console.warn('LISTEN setup failed: ' + err.message);
    drop();
  });
}

function mapSummary(row) {
  return {
    id: row.id,
    title: row.title,
    ideaCount: row.idea_count,
    updatedAt: row.updated_at.toISOString(),
    outline: M2Model.outline(row.doc),
  };
}

function mapFull(row) {
  return {
    id: row.id,
    title: row.title,
    doc: row.doc,
    ideaCount: row.idea_count,
    updatedAt: row.updated_at.toISOString(),
    revision: row.revision,
  };
}

async function insertMap(client, ownerId, doc, now) {
  const id = crypto.randomUUID();
  const title = doc.nodes[0].text.trim();
  await client.query(
    `INSERT INTO maps (id, owner_id, title, doc, idea_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [id, ownerId, title, JSON.stringify(doc), doc.nodes.length, now]
  );
  return id;
}

// The example map arrives the same way on every route that makes one.
function newExampleDoc() {
  const doc = exampleDoc();
  return doc;
}

app.get('/api/maps', async (req, res) => {
  try {
    if (!req.user) {
      // Guests can look around the example map, but nothing is kept.
      return res.json({ maps: [], guest: true, welcomed: true, demo: false, trashed: 0 });
    }
    const demo = IS_STAGING && req.query.demo === '1';
    const ownerId = String(req.user.id);
    if (demo) {
      // The staging demo is written once per viewing account, in one
      // transaction, so a reload changes nothing and the viewer's own edits
      // and deletions stay. It never touches profiles, so the welcome check
      // below is unaffected, and production never writes demo rows.
      const seeded = await pool.query(
        `INSERT INTO demo_seeds (user_id, seeded_at) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
        [ownerId, req.now]
      );
      if (seeded.rowCount > 0) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const map of demoMaps(req.now)) {
            await client.query(
              `INSERT INTO maps (id, owner_id, title, doc, idea_count, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
              ['demo-' + ownerId + '-' + map.key, ownerId, map.title,
                JSON.stringify(map.doc), map.doc.nodes.length, map.updatedAt, map.updatedAt]
            );
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }
      // One fake person's map shared with the viewer, so "Shared with you"
      // has a row. Idempotent, so it is safe on every ?demo=1 load; the
      // viewer's own demo maps stay Private.
      const shared = sharedDemoDoc();
      const sharedId = 'demo-sharedwith-' + ownerId;
      await pool.query(
        `INSERT INTO maps (id, owner_id, title, doc, idea_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (id) DO NOTHING`,
        [sharedId, DEMO_FRIEND, shared.nodes[0].text, JSON.stringify(shared),
          shared.nodes.length, new Date(req.now.getTime() - 3 * 86400000)]
      );
      await pool.query(
        `INSERT INTO map_readers (map_id, user_id, username, shared_by, added_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (map_id, user_id) DO NOTHING`,
        [sharedId, ownerId, String(req.user.username || ''), DEMO_FRIEND, req.now]
      );
      // One of the viewer's own maps already in Recently deleted, deleted 18
      // days ago, so the trash can be seen without deleting anything first.
      // Idempotent on every ?demo=1 load, so restoring it or deleting it for
      // good sticks until the next demo visit.
      const trashed = trashedDemoDoc();
      await pool.query(
        `INSERT INTO maps (id, owner_id, title, doc, idea_count, created_at, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7) ON CONFLICT (id) DO NOTHING`,
        ['demo-trash-' + ownerId, ownerId, trashed.nodes[0].text, JSON.stringify(trashed),
          trashed.nodes.length, new Date(req.now.getTime() - 19 * 86400000),
          new Date(req.now.getTime() - 18 * 86400000)]
      );
      // Two earlier versions of the demo Lisbon map (#32), so Version
      // history has something to show: one from about an hour ago, one from
      // the day before yesterday. Idempotent on every ?demo=1 load, and
      // only while the map is live and has no versions yet, so a restore
      // made during the demo keeps the versions it earned. Staging only.
      const lisbonId = 'demo-' + ownerId + '-lisbon';
      const lisbonV = lisbonVersions(req.now);
      await pool.query(
        `INSERT INTO map_versions (map_id, revision, doc, idea_count, created_at, reason)
         SELECT $1, v.revision, v.doc, v.idea_count, v.created_at, v.reason
         FROM unnest($2::int[], $3::jsonb[], $4::int[], $5::timestamptz[], $6::text[])
           AS v(revision, doc, idea_count, created_at, reason)
         WHERE EXISTS (
           SELECT 1 FROM maps WHERE id = $1 AND owner_id = $7 AND deleted_at IS NULL
         ) AND NOT EXISTS (
           SELECT 1 FROM map_versions WHERE map_id = $1
         )`,
        [lisbonId, lisbonV.map(v => v.revision),
          lisbonV.map(v => JSON.stringify(v.doc)), lisbonV.map(v => v.ideaCount),
          lisbonV.map(v => v.createdAt), lisbonV.map(v => v.reason), ownerId]
      );
    }
    const rows = await pool.query(
      `SELECT ${MAP_COLUMNS} FROM maps
       WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC`,
      [ownerId]
    );
    // Maps other people added this person to, never their own.
    const shared = await pool.query(
      `SELECT m.id, m.title, m.doc, m.idea_count, m.created_at, m.updated_at, r.shared_by
       FROM map_readers r JOIN maps m ON m.id = r.map_id
       WHERE r.user_id = $1 AND m.owner_id <> $1 AND m.deleted_at IS NULL
       ORDER BY m.updated_at DESC`,
      [ownerId]
    );
    // How many of the caller's maps are in Recently deleted right now: the
    // row at the bottom of Your maps only shows when there is something in.
    const trashedCount = await pool.query(
      `SELECT count(*)::int AS n FROM maps
       WHERE owner_id = $1 AND deleted_at IS NOT NULL
         AND deleted_at > now() - interval '30 days'`,
      [ownerId]
    );
    const welcomed = await pool.query('SELECT 1 FROM profiles WHERE user_id = $1', [ownerId]);
    return res.json({
      maps: rows.rows.map(mapSummary),
      shared: shared.rows.map(row => Object.assign(mapSummary(row), { sharedBy: row.shared_by })),
      welcomed: welcomed.rowCount > 0,
      demo,
      trashed: trashedCount.rows[0].n,
    });
  } catch (err) {
    console.error('GET /api/maps failed: ' + err.message);
    return res.status(500).json({ error: 'Could not load your maps' });
  }
});

app.post('/api/welcome', async (req, res) => {
  try {
    const ownerId = String(req.user.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO profiles (user_id, welcomed_at) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
        [ownerId, req.now]
      );
      let map = null;
      if (inserted.rowCount > 0) {
        // Only a first visit makes the example map; coming back never does.
        const id = await insertMap(client, ownerId, newExampleDoc(), req.now);
        const row = await client.query(`SELECT ${MAP_COLUMNS} FROM maps WHERE id = $1`, [id]);
        map = mapFull(row.rows[0]);
      }
      await client.query('COMMIT');
      return res.json({ map });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('POST /api/welcome failed: ' + err.message);
    return res.status(500).json({ error: 'Could not set up your first map' });
  }
});

app.post('/api/maps', async (req, res) => {
  try {
    const ownerId = String(req.user.id);
    let doc;
    if (req.body && req.body.from === 'example') {
      doc = newExampleDoc();
    } else if (req.body && req.body.doc !== undefined) {
      // A whole map, e.g. "Save mine as a copy" after a conflict. It starts
      // Private at revision 0 like any new map.
      doc = req.body.doc;
      const why = M2Model.validate(doc);
      if (why) return res.status(400).json({ error: why });
    } else {
      const title = typeof (req.body && req.body.title) === 'string' ? req.body.title.trim() : '';
      if (!title || title.length > M2Model.MAX_ROOT_TEXT) {
        return res.status(400).json({ error: 'Give the map a name of up to 80 characters' });
      }
      doc = { v: 1, nodes: [{ id: 'root', parent: null, text: title, x: 0, y: 0 }], layout: { auto: true } };
    }
    const id = await insertMap(pool, ownerId, doc, req.now);
    const row = await pool.query(`SELECT ${MAP_COLUMNS} FROM maps WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
    return res.json({ map: mapFull(row.rows[0]) });
  } catch (err) {
    console.error('POST /api/maps failed: ' + err.message);
    return res.status(500).json({ error: 'Could not create the map' });
  }
});

// Opening a map: its owner, anyone signed in when it is Public, and the
// people its owner added. Everyone else, guests included, gets the same 404
// as a map that doesn't exist, so the answer never says that it does.
// Guests reach a map only through its secret link (/api/shared/:token).
app.get('/api/maps/:id', async (req, res) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Map not found' });
    const userId = String(req.user.id);
    const access = await readAccess(req, req.params.id, null);
    if (!access) return res.status(404).json({ error: 'Map not found' });
    const level = access.row.owner_id === userId ? 'owner' : 'viewer';
    return res.json({ map: mapFull(access.row), access: level });
  } catch (err) {
    console.error('GET /api/maps/:id failed: ' + err.message);
    return res.status(500).json({ error: 'Could not open the map' });
  }
});

// A save carries the revision it was made from. When the map has moved on
// since (another tab or device saved), nothing is written and the answer is
// 409 with the server's current copy, so the page can ask which to keep.
app.put('/api/maps/:id', async (req, res) => {
  // One transaction (#32): the row is locked, the previous doc may go into
  // map_versions, then the save writes. Everything shares the one client.
  const client = await pool.connect();
  try {
    const doc = req.body && req.body.doc;
    const why = M2Model.validate(doc);
    if (why) return res.status(400).json({ error: why });
    const base = req.body.baseRevision;
    if (base !== undefined && !(Number.isInteger(base) && base >= 0 && base <= 2147483647)) {
      return res.status(400).json({ error: 'bad baseRevision' });
    }
    const ownerId = String(req.user.id);
    await client.query('BEGIN');
    const held = await client.query(
      `SELECT doc, idea_count, revision FROM maps
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id, ownerId]
    );
    if (!held.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Map not found' });
    }
    const current = held.rows[0];
    // A missing baseRevision comes from a tab opened before revisions
    // existed: it saves as before (last save wins) but still bumps the
    // revision, so newer tabs notice it. Remove once every client sends one.
    if (base !== undefined && current.revision !== base) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'conflict', revision: current.revision, doc: current.doc,
      });
    }
    // The map as it was goes into version history when it is worth
    // returning to (#32): a save that left under 80% of the ideas, or the
    // first save after 10 quiet minutes. req.now keeps the staging clock
    // consistent with the version's own age.
    const last = await client.query(
      'SELECT max(created_at) AS last_at FROM map_versions WHERE map_id = $1',
      [req.params.id]
    );
    const reason = M2Model.versionReason(
      current.idea_count, doc.nodes.length, last.rows[0].last_at, req.now
    );
    if (reason) {
      await client.query(
        `INSERT INTO map_versions (map_id, revision, doc, idea_count, created_at, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.params.id, current.revision, JSON.stringify(current.doc),
          current.idea_count, req.now, reason]
      );
    }
    const updated = await client.query(
      `UPDATE maps SET doc = $3, title = $4, idea_count = $5, updated_at = $6,
         revision = revision + 1
       WHERE id = $1 AND owner_id = $2
       RETURNING revision, updated_at`,
      [req.params.id, ownerId, JSON.stringify(doc), doc.nodes[0].text.trim(),
        doc.nodes.length, req.now]
    );
    if (reason) await pruneVersions(client, req.params.id);
    await client.query('COMMIT');
    // One announcement per save; each open stream hears it (the saver's own
    // stream skips it — the answer below already carries the revision).
    notify({ kind: 'doc', mapId: req.params.id, revision: updated.rows[0].revision, by: ownerId });
    return res.json({
      updatedAt: updated.rows[0].updated_at.toISOString(),
      revision: updated.rows[0].revision,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* already gone */ }
    console.error('PUT /api/maps/:id failed: ' + err.message);
    return res.status(500).json({ error: 'Could not save the map' });
  } finally {
    client.release();
  }
});

// ── Version history (#32) ────────────────────────────────────────────────
// How versions are kept: all versions of the last 24 hours, then one per
// day for 30 days, then one per week up to six months; anything older is
// gone. Real time (SQL now()): retention is data lifecycle, like the trash
// purge, not something the staging preview clock moves. Called inside the
// save and restore transactions, and for every map from the hourly purge.
async function pruneVersions(db, mapId) {
  const scope = mapId ? [mapId] : [];
  const andMap = mapId ? 'AND map_id = $1' : '';
  await db.query(
    `DELETE FROM map_versions WHERE id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (
           PARTITION BY map_id, date_trunc('day', created_at)
           ORDER BY created_at DESC) AS n
         FROM map_versions
         WHERE created_at < now() - interval '24 hours' ${andMap}
       ) d WHERE n > 1
     )`,
    scope
  );
  await db.query(
    `DELETE FROM map_versions WHERE id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (
           PARTITION BY map_id, date_trunc('week', created_at)
           ORDER BY created_at DESC) AS n
         FROM map_versions
         WHERE created_at < now() - interval '30 days'
           AND created_at >= now() - interval '6 months' ${andMap}
       ) d WHERE n > 1
     )`,
    scope
  );
  await db.query(
    `DELETE FROM map_versions WHERE created_at < now() - interval '6 months' ${andMap}`,
    scope
  );
}

// A version id is a number. Anything else (or a version that belongs to
// another map) is exactly the same 404 as a missing version.
function versionId(raw) {
  return /^\d+$/.test(raw) ? raw : null;
}

// The owner's version list, newest first, no docs: the sheet only shows
// when and how much, and fetches a doc only when a version is opened.
app.get('/api/maps/:id/versions', async (req, res) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Map not found' });
    const map = await ownedMap(req.params.id, String(req.user.id));
    if (!map) return res.status(404).json({ error: 'Map not found' });
    const rows = await pool.query(
      `SELECT id, created_at, idea_count, reason FROM map_versions
       WHERE map_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200`,
      [map.id]
    );
    return res.json({
      versions: rows.rows.map(row => ({
        id: String(row.id),
        createdAt: row.created_at.toISOString(),
        ideaCount: row.idea_count,
        reason: row.reason,
      })),
    });
  } catch (err) {
    console.error('GET /api/maps/:id/versions failed: ' + err.message);
    return res.status(500).json({ error: 'Could not load Version history' });
  }
});

app.get('/api/maps/:id/versions/:vid', async (req, res) => {
  try {
    if (!req.user) return res.status(404).json({ error: 'Map not found' });
    const vid = versionId(req.params.vid);
    if (!vid) return res.status(404).json({ error: 'Map not found' });
    const map = await ownedMap(req.params.id, String(req.user.id));
    if (!map) return res.status(404).json({ error: 'Map not found' });
    const row = await pool.query(
      `SELECT id, created_at, idea_count, reason, doc FROM map_versions
       WHERE id = $1 AND map_id = $2`,
      [vid, map.id]
    );
    if (!row.rowCount) return res.status(404).json({ error: 'Map not found' });
    const v = row.rows[0];
    return res.json({
      version: {
        id: String(v.id),
        createdAt: v.created_at.toISOString(),
        ideaCount: v.idea_count,
        reason: v.reason,
        doc: v.doc,
      },
    });
  } catch (err) {
    console.error('GET /api/maps/:id/versions/:vid failed: ' + err.message);
    return res.status(500).json({ error: 'Could not load the version' });
  }
});

// Restore: the map goes back to how the version shows it, and the map as it
// is now goes into history first, always, so nothing is lost even when the
// confirm sheet's words are not enough.
app.post('/api/maps/:id/versions/:vid/restore', async (req, res) => {
  const client = await pool.connect();
  try {
    const base = req.body && req.body.baseRevision;
    if (base !== undefined && !(Number.isInteger(base) && base >= 0 && base <= 2147483647)) {
      return res.status(400).json({ error: 'bad baseRevision' });
    }
    const vid = versionId(req.params.vid);
    if (!vid) return res.status(404).json({ error: 'Map not found' });
    if (!req.user) return res.status(404).json({ error: 'Map not found' });
    const ownerId = String(req.user.id);
    await client.query('BEGIN');
    const held = await client.query(
      `SELECT doc, idea_count, revision FROM maps
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id, ownerId]
    );
    if (!held.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Map not found' });
    }
    const current = held.rows[0];
    if (base !== undefined && current.revision !== base) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'conflict', revision: current.revision, doc: current.doc,
      });
    }
    const version = await client.query(
      'SELECT doc FROM map_versions WHERE id = $1 AND map_id = $2',
      [vid, req.params.id]
    );
    if (!version.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Map not found' });
    }
    const vDoc = version.rows[0].doc;
    if (M2Model.validate(vDoc)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'This version can’t be restored' });
    }
    await client.query(
      `INSERT INTO map_versions (map_id, revision, doc, idea_count, created_at, reason)
       VALUES ($1, $2, $3, $4, $5, 'before-restore')`,
      [req.params.id, current.revision, JSON.stringify(current.doc),
        current.idea_count, req.now]
    );
    const updated = await client.query(
      `UPDATE maps SET doc = $3, title = $4, idea_count = $5, updated_at = $6,
         revision = revision + 1
       WHERE id = $1 AND owner_id = $2
       RETURNING ${MAP_COLUMNS}`,
      [req.params.id, ownerId, JSON.stringify(vDoc), vDoc.nodes[0].text.trim(),
        vDoc.nodes.length, req.now]
    );
    await pruneVersions(client, req.params.id);
    await client.query('COMMIT');
    notify({ kind: 'doc', mapId: req.params.id, revision: updated.rows[0].revision, by: ownerId });
    return res.json({ map: mapFull(updated.rows[0]) });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* already gone */ }
    console.error('POST /api/maps/:id/versions/:vid/restore failed: ' + err.message);
    return res.status(500).json({ error: 'Could not restore the version' });
  } finally {
    client.release();
  }
});

// Deleting a map moves it to Recently deleted (#30): the row stays, its
// readers and sharing with it, and every other route stops answering as if
// it did not exist. Only the purge or Delete now really removes it.
app.delete('/api/maps/:id', async (req, res) => {
  try {
    const deleted = await pool.query(
      `UPDATE maps SET deleted_at = $3
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [req.params.id, String(req.user.id), req.now]
    );
    if (!deleted.rowCount) return res.status(404).json({ error: 'Map not found' });
    // Every open view of the map is told it is gone; they all answer like
    // the 404 a further GET would now give.
    notify({ kind: 'gone', mapId: req.params.id });
    return res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/maps/:id failed: ' + err.message);
    return res.status(500).json({ error: 'Could not delete the map' });
  }
});

// ── Recently deleted (#30) ───────────────────────────────────────────────
// The owner's trashed maps, kept 30 days from when they were deleted. Real
// time throughout: the purge and the countdown are data lifecycle, not
// something a staging preview clock should move.
const TRASH_DAYS = 30;
const TRASH_MS = TRASH_DAYS * 86400000;

function daysLeft(deletedAt) {
  const ms = deletedAt.getTime() + TRASH_MS - Date.now();
  return Math.min(TRASH_DAYS, Math.max(1, Math.ceil(ms / 86400000)));
}

app.get('/api/trash', async (req, res) => {
  try {
    if (!req.user) return res.json({ maps: [] });
    const rows = await pool.query(
      `SELECT ${MAP_COLUMNS}, deleted_at FROM maps
       WHERE owner_id = $1 AND deleted_at IS NOT NULL
         AND deleted_at > now() - interval '30 days'
       ORDER BY deleted_at DESC`,
      [String(req.user.id)]
    );
    return res.json({
      maps: rows.rows.map(row => Object.assign(mapSummary(row), {
        deletedAt: row.deleted_at.toISOString(),
        daysLeft: daysLeft(row.deleted_at),
      })),
    });
  } catch (err) {
    console.error('GET /api/trash failed: ' + err.message);
    return res.status(500).json({ error: 'Could not load Recently deleted' });
  }
});

app.post('/api/maps/:id/restore', async (req, res) => {
  try {
    const restored = await pool.query(
      `UPDATE maps SET deleted_at = NULL
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL
         AND deleted_at > now() - interval '30 days'
       RETURNING ${MAP_COLUMNS}`,
      [req.params.id, String(req.user.id)]
    );
    if (!restored.rowCount) return res.status(404).json({ error: 'Map not found' });
    return res.json({ map: mapSummary(restored.rows[0]) });
  } catch (err) {
    console.error('POST /api/maps/:id/restore failed: ' + err.message);
    return res.status(500).json({ error: 'Could not restore the map' });
  }
});

// Delete now, from Recently deleted. Only a map already in the trash can be
// removed here, so an active map can never be destroyed through this route.
app.delete('/api/maps/:id/permanent', async (req, res) => {
  try {
    const deleted = await pool.query(
      'DELETE FROM maps WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL',
      [req.params.id, String(req.user.id)]
    );
    if (!deleted.rowCount) return res.status(404).json({ error: 'Map not found' });
    return res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/maps/:id/permanent failed: ' + err.message);
    return res.status(500).json({ error: 'Could not delete the map for good' });
  }
});

// The hourly clean-up: anything trashed more than 30 days ago is gone for
// good, readers and all. Runs once at boot, then every hour; a failure is
// logged and retried an hour later, never crashing the process.
async function purgeTrash() {
  try {
    const gone = await pool.query(
      `DELETE FROM maps WHERE deleted_at < now() - interval '30 days'`
    );
    if (gone.rowCount > 0) {
      console.log(`Purged ${gone.rowCount} maps deleted over ${TRASH_DAYS} days ago`);
    }
    try {
      await pruneVersions(pool, null);
    } catch (err) {
      console.warn('pruneVersions failed: ' + err.message);
    }
  } catch (err) {
    console.warn('purgeTrash failed: ' + err.message);
  }
}

// ── Sharing ──────────────────────────────────────────────────────────────
// A map is Private (NULL or 'private': its owner and the people they add),
// 'link' (anyone holding its secret link, guests included) or 'public'
// (anyone signed in who has its link). Everyone but the owner reads it view
// only: PUT and DELETE above still filter on owner_id. A viewer's responses
// carry mapFull only; the token and the reader list come only from the
// owner-only routes below.

const VISIBILITIES = ['private', 'link', 'public'];

// 18 random bytes: 24 URL-safe characters nobody can guess.
function newShareToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// The map when the caller owns it, otherwise null, which every owner-only
// route answers with the same 404 as a missing map.
async function ownedMap(id, userId) {
  if (!userId) return null;
  const row = await pool.query(
    'SELECT id, visibility, share_token FROM maps WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  return row.rows[0] || null;
}

// The address to hand out: the secret link while visibility is 'link',
// otherwise the map's own id, which opens only for people allowed in. It goes
// through the platform's chromeless view, which embeds the app with the
// visitor's token and passes the inner path on.
function shareLink(map) {
  const inner = map.visibility === 'link' && map.share_token
    ? '/?share=' + map.share_token
    : '/?map=' + encodeURIComponent(map.id);
  if (!PLATFORM_ORIGIN) return inner;
  return PLATFORM_ORIGIN + '/app/m2-edf869/full?path=' + encodeURIComponent(inner);
}

async function sharingOf(map) {
  const readers = await pool.query(
    'SELECT user_id, username FROM map_readers WHERE map_id = $1 ORDER BY added_at, username',
    [map.id]
  );
  return {
    visibility: VISIBILITIES.includes(map.visibility) ? map.visibility : 'private',
    link: shareLink(map),
    readers: readers.rows.map(r => ({ id: r.user_id, username: r.username })),
  };
}

// The secret link. The only map route a guest can use, because a guest may
// GET anything under /api/ and this one asks for nothing but the token.
// A link that doesn't open (never existed, reset, or the map went Private or
// Public) answers 200 { map: null }, one answer for all of them: the browser
// logs a 404 as a console error, which would fail the dead-link check.
app.get('/api/shared/:token', async (req, res) => {
  try {
    const token = req.params.token;
    if (!token || token.length > 64) return res.json({ map: null });
    const row = await pool.query(
      `SELECT ${MAP_COLUMNS}, owner_id FROM maps
       WHERE share_token = $1 AND visibility = 'link' AND deleted_at IS NULL`,
      [token]
    );
    if (!row.rowCount) return res.json({ map: null });
    const access = req.user && row.rows[0].owner_id === String(req.user.id) ? 'owner' : 'viewer';
    return res.json({ map: mapFull(row.rows[0]), access, guest: !req.user });
  } catch (err) {
    console.error('GET /api/shared/:token failed: ' + err.message);
    return res.status(500).json({ error: 'Could not open the map' });
  }
});

app.get('/api/maps/:id/sharing', async (req, res) => {
  try {
    const map = await ownedMap(req.params.id, req.user ? String(req.user.id) : null);
    if (!map) return res.status(404).json({ error: 'Map not found' });
    return res.json(await sharingOf(map));
  } catch (err) {
    console.error('GET /api/maps/:id/sharing failed: ' + err.message);
    return res.status(500).json({ error: 'Could not load who can open the map' });
  }
});

// A switch to 'link' mints a token unless one exists; any other value
// drops it, so the old secret link stops working at once.
app.put('/api/maps/:id/sharing', async (req, res) => {
  try {
    const visibility = req.body && req.body.visibility;
    if (!VISIBILITIES.includes(visibility)) {
      return res.status(400).json({ error: 'Choose private, link or public' });
    }
    const updated = await pool.query(
      `UPDATE maps SET visibility = $3,
         share_token = CASE WHEN $3 = 'link' THEN COALESCE(share_token, $4) ELSE NULL END
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
       RETURNING id, visibility, share_token`,
      [req.params.id, String(req.user.id), visibility, newShareToken()]
    );
    if (!updated.rowCount) return res.status(404).json({ error: 'Map not found' });
    return res.json(await sharingOf(updated.rows[0]));
  } catch (err) {
    console.error('PUT /api/maps/:id/sharing failed: ' + err.message);
    return res.status(500).json({ error: 'Could not change who can open the map' });
  }
});

// Reset link: a new secret, so the old one stops working.
app.post('/api/maps/:id/sharing/link', async (req, res) => {
  try {
    const userId = String(req.user.id);
    const updated = await pool.query(
      `UPDATE maps SET share_token = $3
       WHERE id = $1 AND owner_id = $2 AND visibility = 'link' AND deleted_at IS NULL
       RETURNING id, visibility, share_token`,
      [req.params.id, userId, newShareToken()]
    );
    if (updated.rowCount) return res.json(await sharingOf(updated.rows[0]));
    if (!(await ownedMap(req.params.id, userId))) return res.status(404).json({ error: 'Map not found' });
    return res.status(409).json({ error: 'Only a map shared by link has a link to reset' });
  } catch (err) {
    console.error('POST /api/maps/:id/sharing/link failed: ' + err.message);
    return res.status(500).json({ error: 'Could not reset the link' });
  }
});

// ── Project members ──────────────────────────────────────────────────────
// The people a map can be shared with are this project's members, as the
// platform lists them (GET /members, "Members" in the platform
// conventions). The platform answers only members, with the caller's own
// token, so the list is cached per caller: one person's answer is never
// served to someone the platform would refuse. A minute's cache keeps the
// sheet and the reader check well inside the 120-a-minute limit.
const PLATFORM_API_BASE = (process.env.USERNODE_PLATFORM_API_V1_URL
  || process.env.USERNODE_PLATFORM_API_URL || '').replace(/\/+$/, '');
const MEMBERS_TTL_MS = 60_000;
const membersCache = new Map(); // caller id -> { at, members }

// { available, members: [{ id, username }] }, the caller included. Throws
// when the platform can't be reached or answers with an error.
async function projectMembers(req) {
  const callerId = String(req.user.id);
  const hit = membersCache.get(callerId);
  if (hit && Date.now() - hit.at < MEMBERS_TTL_MS) return { available: true, members: hit.members };
  if (!PLATFORM_API_BASE || !req.userToken) return { available: false, members: [] };
  const headers = { 'x-usernode-user-token': req.userToken };
  if (process.env.USERNODE_LLM_PROXY_TOKEN) {
    headers['x-usernode-app-token'] = process.env.USERNODE_LLM_PROXY_TOKEN;
  }
  const resp = await fetch(PLATFORM_API_BASE + '/members?limit=200', {
    headers, signal: AbortSignal.timeout(8000),
  });
  // Not a member (or an admin or check runner looking in): no roster.
  if (resp.status === 403) return { available: false, members: [] };
  if (!resp.ok) throw new Error('members answered ' + resp.status);
  const body = await resp.json();
  const members = (Array.isArray(body && body.members) ? body.members : [])
    .filter(m => m && m.id != null && m.username)
    .map(m => ({ id: String(m.id), username: String(m.username) }));
  const now = Date.now();
  for (const [key, entry] of membersCache) {
    if (now - entry.at >= MEMBERS_TTL_MS) membersCache.delete(key);
  }
  membersCache.set(callerId, { at: now, members });
  return { available: true, members };
}

app.get('/api/members', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'account_required' });
  try {
    const list = await projectMembers(req);
    const me = String(req.user.id);
    return res.json({
      available: list.available,
      members: list.members.filter(m => m.id !== me),
    });
  } catch (err) {
    console.warn('GET /api/members failed: ' + err.message);
    return res.status(502).json({ error: 'Could not load the project members' });
  }
});

app.post('/api/maps/:id/readers', async (req, res) => {
  try {
    const ownerId = String(req.user.id);
    const map = await ownedMap(req.params.id, ownerId);
    if (!map) return res.status(404).json({ error: 'Map not found' });
    const raw = req.body && req.body.userId;
    const userId = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    if (!userId) return res.status(400).json({ error: 'Choose someone to add' });
    if (userId === ownerId) return res.status(400).json({ error: 'This is already your map' });
    let list;
    try {
      list = await projectMembers(req);
    } catch (err) {
      console.warn('POST /api/maps/:id/readers members failed: ' + err.message);
      return res.status(502).json({ error: 'Could not load the project members' });
    }
    const member = list.members.find(m => m.id === userId);
    if (!member) return res.status(400).json({ error: 'Only project members can be added' });
    await pool.query(
      `INSERT INTO map_readers (map_id, user_id, username, shared_by, added_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (map_id, user_id) DO NOTHING`,
      [map.id, member.id, member.username, String(req.user.username || ''), req.now]
    );
    return res.json(await sharingOf(map));
  } catch (err) {
    console.error('POST /api/maps/:id/readers failed: ' + err.message);
    return res.status(500).json({ error: 'Could not add them' });
  }
});

// Access ends with the row: the reader's next request is a 404.
app.delete('/api/maps/:id/readers/:userId', async (req, res) => {
  try {
    const map = await ownedMap(req.params.id, String(req.user.id));
    if (!map) return res.status(404).json({ error: 'Map not found' });
    await pool.query('DELETE FROM map_readers WHERE map_id = $1 AND user_id = $2',
      [map.id, req.params.userId]);
    return res.json(await sharingOf(map));
  } catch (err) {
    console.error('DELETE /api/maps/:id/readers failed: ' + err.message);
    return res.status(500).json({ error: 'Could not remove them' });
  }
});

// ── The live stream and presence routes ──────────────────────────────────
// The stream is the GET; presence is refreshed by the client with POSTs.
// EventSource cannot set headers, so the page passes its token as ?token=
// (the auth middleware above reads it), and a secret link's share token as
// ?share= so a guest can hold a stream on the map the link opened.

app.get('/api/maps/:id/events', async (req, res) => {
  try {
    const share = typeof req.query.share === 'string' ? req.query.share : null;
    const access = await readAccess(req, req.params.id, share);
    if (!access) return res.status(404).json({ error: 'Map not found' });
    const row = access.row;
    const mapId = req.params.id;
    const userId = req.user ? String(req.user.id) : null;
    const rec = { res, userId, signedIn: !!userId, share };

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    sseSend(res, 'hello', { revision: row.revision, you: userId });
    addStream(mapId, rec);
    if (IS_STAGING && row.owner_id === DEMO_FRIEND) {
      const main = (row.doc.nodes || []).find(n => n.parent === 'root' && n.id !== 'root');
      demoSelection.set(mapId, main ? main.id : null);
    }
    sendPresence(mapId);

    // A comment line every 25 s keeps proxies from closing the stream, and
    // is also the moment access is checked again: sharing switched away
    // from the link, a reader was removed, the map deleted.
    const beat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
      readAccess(req, mapId, rec.share).then(a => {
        if (a || res.destroyed) return;
        sseSend(res, 'bye', {});
        removeStream(mapId, rec);
        try { res.end(); } catch {}
      }).catch(() => {});
    }, 25_000);
    beat.unref();

    req.on('close', () => {
      clearInterval(beat);
      removeStream(mapId, rec);
    });
  } catch (err) {
    console.error('GET /api/maps/:id/events failed: ' + err.message);
    return res.status(500).json({ error: 'Could not open the live stream' });
  }
});

app.post('/api/maps/:id/presence', async (req, res) => {
  try {
    const share = req.body && typeof req.body.share === 'string' ? req.body.share : null;
    const access = await readAccess(req, req.params.id, share);
    if (!access) return res.status(404).json({ error: 'Map not found' });
    const userId = String(req.user.id);
    const username = String(req.user.username || '').slice(0, 40);
    let selectedId = req.body ? req.body.selectedId : null;
    if (typeof selectedId !== 'string' || selectedId.length === 0 || selectedId.length > 40) {
      selectedId = null;
    }
    let byUser = presence.get(req.params.id);
    if (!byUser) { byUser = new Map(); presence.set(req.params.id, byUser); }
    const prev = byUser.get(userId);
    byUser.set(userId, { id: userId, username, selectedId, at: Date.now() });
    // A pure refresh (the 15 s keep-alive) is not worth an announcement;
    // arriving, or moving the selection, is.
    if (!prev || prev.selectedId !== selectedId) sendPresence(req.params.id);
    return res.status(204).end();
  } catch (err) {
    console.error('POST /api/maps/:id/presence failed: ' + err.message);
    return res.status(500).json({ error: 'Could not update presence' });
  }
});

app.post('/api/maps/:id/presence/leave', async (req, res) => {
  try {
    const share = req.body && typeof req.body.share === 'string' ? req.body.share : null;
    const access = await readAccess(req, req.params.id, share);
    if (!access) return res.status(204).end();
    const byUser = presence.get(req.params.id);
    if (byUser && byUser.delete(String(req.user.id))) sendPresence(req.params.id);
    return res.status(204).end();
  } catch (err) {
    console.error('POST /api/maps/:id/presence/leave failed: ' + err.message);
    return res.status(500).json({ error: 'Could not update presence' });
  }
});

// Unknown API paths answer JSON, never the HTML shell.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));


// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/m2-edf869/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/m2-edf869/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await bootSchema();
  // The trash clean-up runs once now (which also shows the staging seed of a
  // 31-day-old map going), then every hour. Unref'd so it never holds the
  // process open on shutdown.
  purgeTrash();
  setInterval(purgeTrash, 60 * 60 * 1000).unref();
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  startListener();
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  // Stop accepting connections, let the requests in flight finish (at most
  // 3 s), close the pool, then exit. SIGTERM and SIGINT both land here, and
  // the guard keeps the second signal from running it twice.
  const DRAIN_MS = 3000;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // The streams end first — each is told the server is going away — so
    // the drain below never waits on an open SSE response. The LISTEN
    // connection and the presence sweep go with them.
    endAllStreams();
    if (listenClient) { const c = listenClient; listenClient = null; c.end().catch(() => {}); }
    clearInterval(presenceSweep);
    server.close();
    if (server.closeIdleConnections) server.closeIdleConnections();
    setTimeout(() => {
      if (server.closeAllConnections) server.closeAllConnections();
    }, DRAIN_MS).unref();
    pool.end().then(() => process.exit(0)).catch(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch(err => { console.error(err); process.exit(1); });
