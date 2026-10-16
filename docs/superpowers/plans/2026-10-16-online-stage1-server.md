# Online Play — Stage 1: Server, Storage, GM Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted Node server that serves Lodestar behind a GM password, stores the map library, the live session and all images server-side (SQLite + image files), while the static/offline Lodestar keeps working unchanged.

**Architecture:** Zero-dependency Node HTTP server (`node:http`, `node:sqlite`, `node:crypto`) in `server/`. The client learns it is online from `online-config.js`, which the repo ships as `window.LODESTAR_ONLINE = false` and the server overrides. In online mode the four IndexedDB record functions in `app.js` dispatch to a REST API, uploaded images become server URLs instead of data URLs, and the live session autosaves to the server. The server also converts any data-URL images it receives into files ("externalize"), as a safety net for imports, the demo map and old saves.

**Tech Stack:** Node ≥ 22.13 (Docker: `node:24-alpine`), `node:test`, `node:sqlite` (`DatabaseSync`), vanilla JS client (no build).

**Spec:** `docs/superpowers/specs/2026-10-16-online-play-design.md` (this plan = "Delivery stages" item 1). Stages 2–4 get their own plans.

## Global Constraints

- The offline app (static hosting or `file://`) must behave exactly as today. Every client change is gated on `ONLINE`.
- No npm runtime dependencies in this stage, and no build step for the client.
- Env vars:
  - `LODESTAR_GM_PASSWORD` (required; the server refuses to start without it)
  - `PORT` (default `8080`)
  - `DATA_DIR` (default `./data`; `/data` in Docker)
- Data layout: `DATA_DIR/lodestar.sqlite`, `DATA_DIR/images/<id>.<ext>`.
- No data URL may be stored in SQLite. Every `data:image/...;base64,` string is externalized to a file before it is written.
- Images are not public. They are served only with a valid GM session; stage 2 adds hero tokens.
- GM session cookie: HttpOnly, `SameSite=Lax`, 30-day lifetime, `Secure` when the request is HTTPS (`X-Forwarded-Proto: https` or a TLS socket).
- TLS is terminated by the reverse proxy. The server itself listens on plain HTTP.

## Review Focus

1. **Path traversal or file leaks in static serving.** `/../server/db.js`, `/server/auth.js`, `/data/lodestar.sqlite`, `/.git/config`, `/package.json` and `/docs/...` must all return 404. Covered in Task 1 tests.
2. **Login brute force.** A wrong password must not be cheap to retry. Each failed login waits 1000 ms before answering, and the comparison is constant-time. Covered in Task 2 tests.
3. **Huge or hostile uploads.** Image bodies over 25 MB and JSON bodies over 50 MB must get 413. Unknown image types must get 415, and the server must not crash. Covered in Task 3 tests.
4. **Large import from an offline export.** Importing a library export that holds multi-MB data URLs must leave no `data:` strings in SQLite, and every image must load afterwards. Covered in Task 4 tests.
5. **GM tab closed mid-change.** Autosave is debounced. Reopening the GM page must restore the last saved session (map, fog, tokens, initiative), with at most the last ~1 s of edits lost. Covered in Task 6 manual check.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | `"type": "module"`, `engines.node: ">=22.13"`, scripts `start: node server/index.js`, `test: node --test server/test/` |
| `server/index.js` | env parsing, `createServer({ dataDir, password })`, `listen` |
| `server/app.js` | HTTP router: static, login, API. Exports `createApp({ dataDir, password }) -> { server: http.Server, close() }` |
| `server/static.js` | allowlisted static file serving + `online-config.js` override |
| `server/auth.js` | password check, session cookie sign/verify |
| `server/db.js` | open SQLite, schema, map/kv queries |
| `server/images.js` | save, serve and inline image files; `externalizeImages` |
| `server/http-util.js` | `readBody(req, limit)`, `sendJson`, `sendError` |
| `server/login.html` | login form (served only by the server) |
| `server/test/helpers.js` | `startTestServer()` → `{ url, dataDir, login(), close() }` |
| `server/test/*.test.js` | one file per task |
| `online-config.js` | `window.LODESTAR_ONLINE = false;` (static default) |
| `index.html:767` | add `<script src="online-config.js"></script>` before `app.js` |
| `app.js` | `ONLINE` flag, API-backed record functions, `uploadImage`, session autosave/restore, logout |
| `Dockerfile`, `.dockerignore` | image build |
| `README.md` | "Self-hosting the online edition" section |

---

### Task 1: Server skeleton + allowlisted static serving

**Files:**
- Create: `package.json`, `server/index.js`, `server/app.js`, `server/static.js`, `server/http-util.js`, `server/test/helpers.js`, `server/test/static.test.js`, `online-config.js`
- Modify: `index.html:767`, `.gitignore` (add `data/`, `node_modules/`)

**Interfaces:**
- Produces:
  - `createApp({ dataDir: string, password: string }) -> { server: http.Server, close(): Promise<void> }`
  - `startTestServer() -> Promise<{ url: string, dataDir: string, login(): Promise<string /*cookie header*/>, close(): Promise<void> }>`. It uses a temp `dataDir`, password `"test-pass"` and port 0. `login()` stays a stub until Task 2.
  - `readBody(req, limitBytes) -> Promise<Buffer>`, which rejects with an `HttpError(413)` over the limit
  - `sendJson(res, status, value)`, `sendError(res, status, message)`
  - the class `HttpError(status, message)`

- [ ] **Step 1: Write the failing tests** in `server/test/static.test.js`
  - `serves app.js` → GET `/app.js` returns 200, `content-type` starts with `text/javascript`.
  - `serves online flag` → GET `/online-config.js` body is exactly `window.LODESTAR_ONLINE = true;\n`.
  - `blocks non-public files` → each of `/server/app.js`, `/%2e%2e/server/app.js`, `/../package.json`, `/package.json`, `/data/lodestar.sqlite`, `/.git/config`, `/docs/superpowers/specs/2026-10-16-online-play-design.md`, `/server/login.html` returns 404.
  - `serves manual assets` → GET `/manual.html` returns 200.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**
  - `static.js` serves files from the repo root (resolved from `import.meta.url`).
  - Allowed: top-level files with extensions `.html .js .css .svg .png .jpg .webp .mp3 .ico`, plus anything under `manual/` and `icons/`.
  - Never served: `package.json`, `package-lock.json` and anything under `server/`, `data/`, `docs/`, `node_modules/` or dot-directories.
  - Decode the path, `path.normalize` it, and reject the request if the resolved path escapes the root.
  - `/online-config.js` is answered in code, not from disk.
  - Set content types for the allowed extensions.
  - For now `index.js` reads only `PORT`, `DATA_DIR` and `LODESTAR_GM_PASSWORD` (exit with a clear message if the password is missing).
- [ ] **Step 4: Add** `<script src="online-config.js"></script>` immediately before `<script src="app.js"></script>` in `index.html`. Create `online-config.js` with `window.LODESTAR_ONLINE = false;`.
- [ ] **Step 5: Run** `npm test`. Expected: PASS. Also open `index.html` via `file://` and check that the app starts with no console errors.
- [ ] **Step 6: Commit** `feat(server): add static server with online flag`

### Task 2: GM login and session cookie

**Files:**
- Create: `server/auth.js`, `server/db.js` (kv table only for now), `server/login.html`, `server/test/auth.test.js`
- Modify: `server/app.js`, `server/test/helpers.js` (implement `login()`)

**Interfaces:**
- Consumes: `createApp`, `readBody`, `sendJson`
- Produces:
  - `openDb(file) -> Db` with `db.kvGet(key) -> any | undefined`, `db.kvSet(key, value)` (values are JSON) and `db.close()`
  - `createAuth({ db, password }) -> { checkPassword(pw): boolean, issueCookie(secure: boolean): string /*Set-Cookie value*/, isGm(req): boolean }`
  - cookie name `lodestar_gm`, value `<expiryMs>.<hex hmac-sha256(expiryMs)>`
  - HMAC key = `sha256(secret + password)`, where `secret` is 32 random bytes stored once in kv `"secret"`. Changing the password therefore invalidates every session.
  - `isGm` checks the HMAC with `timingSafeEqual` and checks that the expiry has not passed.
  - route guard used by later tasks: `requireGm(req, res) -> boolean` (sends 401 JSON for `/api/*`, a 302 to `/login` for pages)

- [ ] **Step 1: Write the failing tests** in `server/test/auth.test.js`
  - `GM page redirects when logged out` → GET `/` and `/index.html` give 302 with `location: /login`. GET `/login` gives 200 HTML containing `<form`.
  - `wrong password` → POST `/api/login` `{"password":"nope"}` gives 401, takes ≥ 1000 ms, and sets no `set-cookie`.
  - `right password` → gives 200. `set-cookie` contains `lodestar_gm=`, `HttpOnly`, `SameSite=Lax` and `Max-Age=2592000`, and no `Secure`. With header `x-forwarded-proto: https`, the cookie contains `Secure`.
  - `cookie unlocks GM page` → GET `/` with the cookie gives 200 and the body contains `app.js`.
  - `tampered cookie rejected` → change one hex char and GET `/` gives 302.
  - `password change invalidates` → log in, close the server, restart on the same `dataDir` with a different password, and the old cookie gets 302.
  - `logout` → POST `/api/logout` clears the cookie (`Max-Age=0`).
  - `api requires login` → GET `/api/maps` without a cookie gives 401.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `auth.js`, the kv part of `db.js` (`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`), the routes `GET /login`, `POST /api/login`, `POST /api/logout`, and the guard on `/` and `/index.html`.
  - Static assets other than the HTML entry stay public. The code is open source; the data is not.
  - `login.html` is a minimal form that posts JSON with `fetch` and redirects to `/` on 200. It uses the app's `styles.css`.
  - Password comparison: compare `sha256` digests with `timingSafeEqual`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): GM password login with signed session cookie`

### Task 3: Image store

**Files:**
- Create: `server/images.js`, `server/test/images.test.js`
- Modify: `server/app.js`

**Interfaces:**
- Produces:
  - `createImageStore(dir) -> { save(buf: Buffer, mime: string) -> { id, url }, path(id) -> string | null, toDataUrl(id) -> string | null }`
    - `id` = the first 32 hex chars of the sha256 of the bytes, plus the extension (`png|jpg|webp|gif`), e.g. `3fa9…c1.png`
    - `url` = `/api/images/<id>`
    - Saving the same bytes twice returns the same id and writes the file once.
  - `externalizeImages(value: any, store) -> any`: returns a deep copy where every string matching `/^data:image\/(png|jpeg|webp|gif);base64,/` is replaced by `store.save(...).url`
  - `inlineImages(value: any, store) -> any`: the inverse, used by export. Every string matching `^/api/images/<id>$` becomes a data URL.
  - routes:
    - `POST /api/images`: raw body, `content-type` is the image mime, limit 25 MB → `201 { id, url }`
    - `GET /api/images/:id` → the bytes with `cache-control: private, max-age=31536000, immutable`

- [ ] **Step 1: Write the failing tests** in `server/test/images.test.js`
  - `upload and fetch` → POST a 1×1 PNG with the GM cookie gives 201 and an id ending `.png`. GET returns identical bytes, `content-type: image/png` and the cache-control above.
  - `dedupe` → posting the same bytes twice gives the same id, and the `images/` directory has 1 file.
  - `requires GM` → POST and GET without a cookie both give 401.
  - `rejects type` → POST with `content-type: text/html` gives 415.
  - `rejects size` → a 26 MB body gives 413, and the server still answers the next request.
  - `bad id` → GET `/api/images/..%2fsqlite` and `/api/images/zzz` give 404.
  - `externalizeImages` (unit) → `{a:[{src:"data:image/png;base64,<png>"}], b:"x"}` becomes `{a:[{src:"/api/images/<id>.png"}], b:"x"}` and the input object is unchanged. `inlineImages` of that result round-trips to the original string.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Validate ids with `/^[0-9a-f]{32}\.(png|jpg|webp|gif)$/`. Map the mimes `image/png→png`, `image/jpeg→jpg`, `image/webp→webp`, `image/gif→gif`. Anything else gives 415.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): content-addressed image store`

### Task 4: Map library and session API

**Files:**
- Create: `server/test/maps.test.js`
- Modify: `server/db.js`, `server/app.js`

**Interfaces:**
- Consumes: `externalizeImages`, `inlineImages`, `requireGm`
- Produces (all GM-only, JSON body limit 50 MB):
  - `GET /api/maps` → `200 [record…]`: full records, so the existing `renderLibraryList(maps)` works unchanged (it reads `map.id`, `map.name`, `map.savedAt`, `map.state.imageName`)
  - `GET /api/maps/:id` → `200 record` | 404
  - `PUT /api/maps/:id` → body = a record as `saveSession()` builds it (`{id, app, version, name, savedAt, state}`). The server stores `externalizeImages(record)` and returns `200 { ok: true }`. The path id must equal `record.id` (400 otherwise). Ids are URL-encoded on the client because `makeMapId` produces names with spaces.
  - `DELETE /api/maps/:id` → `204`
  - `GET /api/export` → `200 { app, version, exportedAt, maps }`: the same shape as today's `exportLibrary()` payload, with `inlineImages` applied (so offline Lodestar can import it)
  - `GET /api/session` → `200 { state }` | `204` when none is saved
  - `PUT /api/session` → body `{ state }`, stored externalized in kv `"session"` → `200 { ok: true }`
  - schema: `CREATE TABLE IF NOT EXISTS maps (id TEXT PRIMARY KEY, name TEXT NOT NULL, saved_at TEXT NOT NULL, record TEXT NOT NULL)`

- [ ] **Step 1: Write the failing tests** in `server/test/maps.test.js`
  - `crud` → PUT `/api/maps/my%20map` with `{id:"my map", app:"Battlemap Screen and GM Streaming Tool", version:3, name:"My map", savedAt, state:{imageName:"a.png", floors:[]}}` gives 200. The list then has length 1, GET returns an equal record, DELETE gives 204, and the list is `[]`.
  - `id mismatch` → PUT `/api/maps/a` with `record.id = "b"` gives 400.
  - `externalizes on save` → save a record whose `state.floors[0].imageData` and `state.tokens[0].image` are PNG data URLs. GET returns `/api/images/…` URLs there. Reading the `maps` table directly, `record` does not contain `data:image`.
  - `export inlines` → after that save, `/api/export` `.maps[0].state.floors[0].imageData` starts with `data:image/png;base64,`.
  - `import of offline export` → PUT each map from a fixture shaped like an offline export (2 maps, each with a data-URL floor image). Both load back with `/api/images/` URLs, and the `images/` dir holds 2 files.
  - `session round-trip` → GET `/api/session` gives 204. PUT `{state:{grid:{size:70}}}`, then GET returns 200 with an equal state. A data URL inside the session state comes back externalized.
  - `json limit` → a PUT body over 50 MB gives 413.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and the `db.js` map functions: `listMaps()`, `getMap(id)`, `putMap(record)`, `deleteMap(id)`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): map library, export and session API`

### Task 5: Client — online storage backend

**Files:**
- Modify: `app.js` (record functions at app.js:1382–1393, `exportLibrary` at app.js:1290, `setup` at app.js:640, toolbar for logout)
- Modify: `index.html` (logout button in the library/file section, hidden unless online)

**Interfaces:**
- Consumes: the API from Task 4
- Produces (in `app.js`, used by Tasks 6–7):
  - `const ONLINE = Boolean(window.LODESTAR_ONLINE);`, declared next to `isPlayer` (app.js:240)
  - `api(method: string, path: string, body?: any) -> Promise<any>`
    - JSON in and out; `204` resolves `null`
    - a `401` does `location.href = "/login"` and rejects
    - other non-2xx responses reject with `Error(message from body or status)`
  - `saveMapRecord`, `listMapRecords`, `getMapRecord`, `deleteMapRecord` keep their names and promise signatures. When `ONLINE` they call `api("PUT"|"GET"|"DELETE", "/api/maps/" + encodeURIComponent(id))`; otherwise they use today's IndexedDB code (move it into `idb*`-prefixed functions).

- [ ] **Step 1: Implement** `ONLINE`, `api()`, the dispatching record functions, and an online branch in `exportLibrary` that downloads `await api("GET", "/api/export")` using the existing download code. `importLibrary` needs no change, because it calls `saveMapRecord`.
- [ ] **Step 2: Add** a "Log out" button: it runs `api("POST", "/api/logout")` and then sets `location.href = "/login"`. It is visible only when `ONLINE && !isPlayer`.
- [ ] **Step 3: Manual verification (online).**
  1. `LODESTAR_GM_PASSWORD=x npm start`, open `http://localhost:8080` → you land on `/login`. Log in.
  2. Load a map image, save it to the library and reload the page. The library lists the map, and Load restores it.
  3. Export → the downloaded JSON contains `data:image` URLs.
  4. Import that file into an offline `file://` Lodestar → the map loads.
  5. Import an offline export into the online app → the map loads, and `sqlite3 data/lodestar.sqlite "select count(*) from maps where record like '%data:image%'"` prints `0`.
- [ ] **Step 4: Manual verification (offline).** Open via `file://`. Save, load, delete, export and import in the library all behave as before. The network tab shows no `/api` calls.
- [ ] **Step 5: Commit** `feat(client): server-backed map library in online mode`

### Task 6: Client — session autosave and restore

**Files:**
- Modify: `app.js` (`broadcastState` at app.js:1858, `setup` at app.js:640, `setupStartScreen` at app.js:452)

**Interfaces:**
- Consumes: `api`, `ONLINE`, `loadSnapshot`, `migrateState`, `SAVE_FILE_VERSION`
- Produces:
  - `scheduleSessionSave()`: no-op unless `ONLINE && !isPlayer`. Debounced 800 ms. Calls `captureCurrentFloor()` and then `api("PUT", "/api/session", { state: JSON.parse(JSON.stringify(state)) })`. On failure it shows a non-blocking "Not saved — retrying" indicator and retries on the next change.
  - `restoreSession() -> Promise<boolean>`: GET `/api/session`. If it returns a state, apply it with the same steps `loadLibraryMap` uses (clear undo, `loadSnapshot(migrateState(state, SAVE_FILE_VERSION))`, `syncControlsFromState()`, `broadcastAssets()`, `renderAndSync()`) and resolve `true`.

- [ ] **Step 1: Implement.**
  - Call `scheduleSessionSave()` at the end of `broadcastState()`; it is the single choke point for GM state changes.
  - In `setup()` (GM, `ONLINE`), call `restoreSession()`. If it resolves `true` and any floor has `imageData`, dismiss the start screen without animation.
  - Music stays out of the session, as it stays out of `state` today.
- [ ] **Step 2: Manual verification.**
  1. Online, load a map, reveal some fog, place 2 tokens and add 2 combatants. Wait 1 s, then close the tab.
  2. Reopen `/` → the same map, fog, tokens, initiative and floor come back, with no start screen.
  3. In another browser, log in → you see the same session.
  4. Stop the server and make a change → the "Not saved" indicator appears. Start the server and make another change → the indicator clears.
- [ ] **Step 3: Commit** `feat(client): autosave and restore live session in online mode`

### Task 7: Client — upload images instead of data URLs

**Files:**
- Modify: `app.js`: `loadMapFile` (app.js:1064), `loadSplashFile` (app.js:1100), `bulkAddTokenImages` (app.js:3311), `loadTokenImage` (app.js:3379), `addImageFromDataURL` (app.js:3944)

**Interfaces:**
- Consumes: `ONLINE`
- Produces: `uploadImage(dataUrl: string) -> Promise<string>`
  - Offline: resolves `dataUrl` unchanged.
  - Online: converts the data URL to a Blob, POSTs it to `/api/images` with its mime type, and resolves the returned `url`. A 401 redirects to `/login`, like `api()`.

- [ ] **Step 1: Implement** `uploadImage`. At each of the five sites, pass the final data URL through `uploadImage` before assigning it to state. Do this after the existing `downscaleImage` where one exists, so the server stores the downscaled bytes. `getTokenImage`, `loadImage` and `loadSplashImage` already accept any `src`, so they need no change. On an upload error, show the same `window.alert("Could not read that image file.")` style message and leave state unchanged.
- [ ] **Step 2: Manual verification (online).**
  1. Load a map, a splash image, a token image, a bulk token drop and a dropped map image.
  2. Run `JSON.stringify(state).includes("data:image")` in the console → `false`.
  3. The projector popup (`?view=player`) shows the map and tokens.
  4. Reload → everything still renders.
- [ ] **Step 3: Manual verification (offline).** The same actions on `file://` work as before (data URLs).
- [ ] **Step 4: Commit** `feat(client): store uploaded images as server files in online mode`

### Task 8: Docker and self-hosting docs

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `README.md`

- [ ] **Step 1: Write the Dockerfile.**
  - `FROM node:24-alpine`, `WORKDIR /app`, copy the repo (`.dockerignore` excludes `data/`, `.git/`, `docs/`, `.claude/`, `node_modules/`).
  - `ENV DATA_DIR=/data PORT=8080`, `VOLUME /data`, `EXPOSE 8080`, `USER node`, `CMD ["node", "server/index.js"]`.
  - Make sure `/data` is writable by `node`.
- [ ] **Step 2: Verify.**
  1. `docker build -t lodestar-online .`
  2. `docker run --rm -p 8080:8080 -e LODESTAR_GM_PASSWORD=x -v "$PWD/data:/data" lodestar-online`
  3. Log in, save a map and restart the container → the map is still there.
  4. `docker run` without the password exits non-zero with a clear message.
- [ ] **Step 3: Write the README section** "Self-hosting the online edition":
  - `docker run` example
  - env var table
  - reverse proxy note: HTTPS required, WebSocket upgrade needed from stage 2, example Caddy snippet `lodestar.example.com { reverse_proxy localhost:8080 }`
  - backup = copy `DATA_DIR`
  - `npm test`
- [ ] **Step 4: Commit** `docs: self-hosting the online edition`
