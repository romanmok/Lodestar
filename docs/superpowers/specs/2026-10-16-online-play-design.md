# Online Play — Design

**Date:** 2026-10-16
**Status:** Draft — awaiting review
**Branch:** `online` (fork `romanmok/Lodestar`)

## Why

The GM used to run games in person: Lodestar's player view on a projector, physical miniatures moved by hand. The group now plays online, everyone on their own device. The goal is a self-hosted "online edition" of Lodestar on the GM's own domain where:

- players see the battle map in their own browser and move their own hero,
- the GM sees and moves heroes and monsters,
- monsters can be grouped in initiative (shared initiative, individual stats),
- campaign data (heroes, maps, fights in progress) survives between sessions.

## Goals

1. A small server that serves the app, relays live state between GM and players, and persists data in SQLite.
2. GM access protected by a password; players get per-hero secret links.
3. A **Players** menu: the campaign's hero roster, with per-hero link.
4. Heroes and monsters shown as tokens on every connected screen; players drag their own hero, GM drags anything.
5. Monster groups in the initiative panel: one initiative, per-member HP / AC / concentration.
6. Token sizes 1, 4 or 9 cells (1×1, 2×2, 3×3).
7. Avatar icon sets: one per D&D 2024 class (for heroes) and common D&D monsters (for monsters).
8. Map and token images stored as files on the server, not base64.

## Non-goals (first version)

- Chat, voice, dice roller. Voice **and music/SFX** go through Discord; the built-in music player stays local to the GM (and the local projector popup) and is not streamed to remote players.
- Player tools other than moving their own hero: no ping, measure or AoE templates for players (may be added later on demand).
- Hero tokens outside combat: heroes appear on the map only via initiative.
- Character sheets beyond the fields listed below.
- Per-player fog / line of sight. All players see the same player view.
- Rules enforcement: no movement limits by speed or turn order. The GM polices the rules.
- Multiple GMs or multiple campaigns per server.
- User accounts / logins for players.

## Anti-goals (would be failure even if it "works")

- A player link revealing what the projector view's *payload* hides today: GM-only labels, hidden AoE markers, notes, other heroes' links. Monster HP must also be stripped server-side from player payloads.
  - **Accepted risk (decided):** like the projector today, players receive all tokens, fog shapes and the map image and the fog is drawn client-side. A player inspecting their traffic can see monsters under fog. No server-side fog geometry.
- The GM screen being reachable without the password.
- The existing offline Lodestar (static, IndexedDB, `?view=player` popup) breaking. Online behaviour switches on only when the app is served by the online server.
- Players' maps loading slowly because multi-MB base64 images go over the WebSocket.

## Current state (relevant facts)

- Whole app is `app.js` (~5800 lines) + `index.html` + `styles.css`. No build, no dependencies, no tests.
- Player view = same page with `?view=player`, opened as a popup; view-only (`onPointerDown` returns early when `isPlayer`, app.js:5043).
- Sync: `BroadcastChannel("fog-table-state")` + `postMessage` via `relay()` (app.js:439). Message types: `sync` (full `sanitizedState()`), `view`, `assets`, `ping`, `measure`, `music`, `player-ready`, `viewport`. Pattern everywhere: mutate `state` → `render()` → `broadcastState()`.
- Storage: IndexedDB map library (`openMapDatabase`, app.js:1352). Images read with `readAsDataURL` and kept as data URLs in floor records (`floor.imageData`), token `image`, placed `images`, `splash.imageData`.
- Floors: `makeFloor()` (app.js:248) → `{imageData, rooms, strokes, tokens, stairs, images, notes, aoeMarkers, view, ...}`. Fog is vector (rooms/strokes).
- Tokens: `{id, x, y, cells, color, label, image, combatantId}`; `cells` slider is 1–4 (side length) in `index.html:367`.
- Initiative: `state.initiative = {active, showPlayers, showOverlay, round, turn, combatants[]}`; combatant `{id, name, type: player|npc|monster, init, hp, maxHp, concentration}` (`addCombatant`, app.js:4074). Approved but unimplemented `effects` field: `docs/superpowers/specs/2026-08-12-initiative-effects-field-design.md`.

## Architecture

### Server

- **Node.js**, single process, packaged as one **Docker** image (`docker run` with a mounted data volume). Builder picks libraries; keep dependencies minimal (e.g. `ws` + `better-sqlite3` or Node's built-in `node:sqlite`).
- Serves the static app files, a small HTTP API, image files, and one WebSocket endpoint.
- Config via env vars: `LODESTAR_GM_PASSWORD` (required), `PORT`, `DATA_DIR` (default `/data`). TLS is terminated by the GM's reverse proxy (HTTPS/WSS); the server itself may be plain HTTP.
- **Data directory** layout: `DATA_DIR/lodestar.sqlite`, `DATA_DIR/images/<id>.<ext>`.

### Source of truth

The **server** is authoritative. The GM browser loads state from the server and sends mutations to it; the server persists them and fans out to all clients. If the GM closes the tab mid-fight and reopens (from any machine), everything is where it was.

The builder decides granularity (whole-snapshot saves vs. per-entity ops), but:
- Player clients must only ever receive the **sanitized** view, filtered server-side with at least today's `sanitizedState()` rules (app.js:1842) plus: monster/NPC HP and AC stripped, other heroes' link tokens never sent. Fog-hidden tokens are *not* filtered (accepted risk, see Anti-goals).
- High-frequency messages (`view`, token drag in progress, `measure`, `ping`) are relayed live and need not hit SQLite on every frame; final positions must be persisted.

### Online vs. offline mode

The client detects the online server (e.g. a `/api/health` probe or a flag injected into `index.html`). Offline (static hosting, file://): exactly today's behaviour. Online: storage goes to the server API, sync goes over WebSocket. The local projector popup (`?view=player`) keeps working in online mode too.

### Persistence (SQLite)

Everything IndexedDB stores today, plus new data:
- map library records (floors with fog, tokens, stairs, notes, AoE markers, placed images…), with image fields replaced by image IDs/URLs,
- hero roster (Players menu),
- current session state: which map/floor is loaded, initiative (incl. groups), splash/blackout, grid, player view settings.

Schema is the builder's call. Storing map records as JSON blobs in a table is acceptable.

### Images

- Uploads (map, token image, placed image, splash) go to `POST /api/images` → saved to `DATA_DIR/images/`, return `{id, url}`. State stores the URL/ID, never a data URL.
- Served with long cache headers (content-addressed ID, e.g. hash, recommended).
- Images on the server are readable by anyone holding a valid player link or GM session (not public). Map images under fog are still fetchable by a player who knows the URL — acceptable, same as today's projector.
- JSON **import** of existing offline exports converts embedded data URLs into stored files. Export can embed images back as data URLs so exports stay portable.
- PDF viewer stays session-only (unchanged).

## Access

### GM

- `/` (GM screen) requires login: password form → server checks `LODESTAR_GM_PASSWORD` → sets an HttpOnly, Secure session cookie (long-lived, e.g. 30 days). Logout button.
- Without a GM session, the API and WebSocket refuse GM operations.

### Player links

- Each hero has a secret link: `https://<domain>/p/<token>` (or `?hero=<token>`), token = long random string (≥128 bits).
- Link is permanent for the campaign. Players menu has **Copy link** and **Regenerate link** (old link stops working immediately; connected socket on the old token is dropped).
- No login for players; the link is the credential.

## Players menu (GM)

New toolbar menu/panel **Players**, listing the campaign's heroes. Per hero:

| Field | Notes |
|---|---|
| Name | text |
| Class | one of the 12 D&D 2024 classes (Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard) |
| Initial avatar | icon from the class set; defaults to the first icon of the chosen class |
| Color | token color |
| AC | number |
| HP | current / max |
| Link | Copy / Regenerate |

Add / edit / delete hero. Roster persists in SQLite across sessions.

### Player screen (hero link)

- Same map as the projector player view (fog, hidden things hidden), but the player **pans and zooms freely** in their own browser; their camera is independent of the GM's red player frame. (The GM's player-frame and its camera control still drive the local projector popup.)
- A small panel for **their own hero**: the player can edit **all** hero fields (name, class, avatar, color, AC, HP). Changes sync to GM and persist.
- Player can drag **only their own hero's token**. Server rejects moves of any other token from a hero connection. Snapping follows the GM's grid snap setting.
- No other map interaction for players (no ping/measure/AoE).
- Initiative overlay visible when the GM has `showPlayers` on, same visibility rules as today (monster HP hidden; concentration and effects visible).
- Connection status indicator ("GM offline" / "reconnecting"). Auto-reconnect.

### Hero ↔ combatant ↔ token

- Hero tokens exist **only through initiative**. Starting/adding to initiative, GM **adds heroes from the roster** (pick one or "add all"). This creates a combatant with `type: "player"` and `heroId`, linked to a token by `combatantId`.
- **Placement:** a newly added hero's token starts **unplaced**. The player sees a "Place your hero" prompt and clicks/taps a cell on the map to put it there; after that they drag it as usual. The GM can also place or move it. Unplaced tokens are not drawn on anyone's map (GM row shows "not placed").
- When the hero is removed from initiative (or initiative is cleared), their token is removed. *(Builder's call, flagged: ending the fight clears tokens with their combatants.)*
- Hero HP/AC are the **same value** everywhere: editing HP in the initiative row updates the hero, and the player editing their HP updates the initiative row. (Implementation: combatant references the hero rather than copying.)
- Hero token image = hero's avatar icon, tinted/framed with hero color.
- Initiative value for heroes: entered by the GM in the initiative row (as today). Players entering their own roll is a nice-to-have, not required.

## Monster groups (initiative)

Example fight: heroes, a goblin boss with own initiative, a group of 6 goblins sharing one initiative.

Panel shows:
1. each hero as its own row,
2. "Goblin Boss" as a normal single row,
3. "Goblins ×6" as one **group row** (one initiative value), expandable to 6 member sub-rows, each with its **own HP, max HP, AC, concentration** (and `effects` once that spec lands).

Rules:
- Turn order: the group takes one turn slot; "next turn" advances past the whole group.
- Add form gains: **Count** (default 1; >1 creates a group), **AC**, **Size** (1 / 4 / 9 cells), **Avatar** (monster icon picker). Members are named "Goblin 1…6", HP/AC copied from the form, editable individually afterwards.
- Group can be collapsed/expanded (GM-only UI state). Removing a member removes its token; removing the group removes all.
- Each member gets its own token showing its number so "Goblin 3" on the map matches the row. **Placement:** after adding, the GM places them on the map: placement mode where each click puts the next unplaced member ("Place Goblin 2 of 6…", Esc to stop; remaining stay unplaced and can be placed later from the row). Same for single monsters/NPCs.
- Monster at 0 HP: token stays on the map, dimmed, until the GM removes it.
- Only the GM moves monster tokens.
- Single (non-group) monsters and NPCs also gain AC, Size, Avatar.

Data model is the builder's call; a suggested shape: combatant `{..., type: "group", members: [{id, name, hp, maxHp, ac, concentration}], avatar, cells}` with tokens linking via `combatantId` + `memberId`. Must remain loadable from snapshots without the new fields (`|| default` at read sites, as in the effects spec).

## Token sizes

Token `cells` = side length; allowed values exposed in UI as **1 cell (1×1), 4 cells (2×2), 9 cells (3×3)**. The existing slider (1–4) may stay for manual tokens; the initiative add form uses the three named sizes.

## Avatar icon sets

Source: **game-icons.net** (CC BY 3.0; authors Lorc, Delapouite et al.). Official WotC art is **not** used. Icons are bundled as SVG in the repo (e.g. `icons/classes/`, `icons/monsters/`) and credited in `CREDITS.md` with license text and per-author attribution.

### Classes (3 per class; first = default)

| Class | Icons (game-icons.net path) |
|---|---|
| Barbarian | delapouite/barbarian, lorc/battle-axe, lorc/axe-swing |
| Bard | lorc/lyre, delapouite/harp, delapouite/flute |
| Cleric | lorc/holy-symbol, lorc/angel-wings, lorc/holy-grail |
| Druid | delapouite/oak-leaf, lorc/wolf-howl, delapouite/bear-head |
| Fighter | lorc/crossed-swords, lorc/visored-helm, lorc/sword-clash |
| Monk | delapouite/monk-face, lorc/fist, delapouite/high-kick |
| Paladin | lorc/winged-sword, lorc/checked-shield, lorc/sword-in-stone |
| Ranger | lorc/high-shot, lorc/bowman, lorc/archery-target |
| Rogue | lorc/hood, lorc/cloak-dagger, lorc/ninja-mask |
| Sorcerer | lorc/fire-ray, lorc/dragon-breath, lorc/lightning-helix |
| Warlock | lorc/pentagram-rose, lorc/horned-skull, lorc/third-eye |
| Wizard | delapouite/wizard-face, lorc/pointy-hat, lorc/wizard-staff |

Download URL pattern: `https://game-icons.net/icons/ffffff/000000/1x1/<author>/<name>.svg` (or the `game-icons/icons` GitHub repo). Player avatar picker may show all class icons, not only their class's.

### Monsters

Verified to exist: delapouite/goblin-head, delapouite/orc-head, delapouite/ogre, delapouite/giant, lorc/minotaur, lorc/harpy, lorc/hydra, lorc/wyvern, lorc/dragon-head, lorc/werewolf, delapouite/vampire-dracula, lorc/ghost, delapouite/mummy-head, delapouite/golem-head, delapouite/rock-golem, delapouite/gargoyle, lorc/cyclops, delapouite/mimic-chest, delapouite/slime, delapouite/brain-tentacle, lorc/lizardman, lorc/imp, lorc/cultist, delapouite/bandit, delapouite/dwarf-face, delapouite/centaur, delapouite/unicorn, lorc/fairy, lorc/angel-outfit, lorc/wolf-head, delapouite/bear-head, delapouite/rat, delapouite/bat, lorc/snake, lorc/scorpion, lorc/crab, lorc/shark-jaws, delapouite/eagle-head, lorc/horse-head, lorc/frog, lorc/wasp-sting, lorc/centipede, lorc/worm-mouth, lorc/sea-serpent, lorc/octopus, lorc/tentacle-strike, lorc/mushroom-gills.

Builder extends the set from the game-icons.net catalog to cover the most common Monster Manual creatures (skeleton, zombie, spider, kobold, gnoll, etc. — pick the closest icon), plus one generic icon per D&D creature type (Aberration, Beast, Celestial, Construct, Dragon, Elemental, Fey, Fiend, Giant, Humanoid, Monstrosity, Ooze, Plant, Undead) as fallback. Picker has a text search by name. Target: ~60–80 icons.

## Delivery stages

One design, implemented in stages; each stage leaves the app working:
1. Server + SQLite + image files + GM password; online mode loads/saves via server; offline mode untouched.
2. WebSocket sync to remote players; hero links; free player camera; player drags own token.
3. Players menu, hero editing by players, avatars (class icons), hero ↔ combatant link.
4. Monster groups, AC/Size/Avatar in add form, monster icons, numbered/dimmed tokens.

## Left to the builder

- Libraries, file layout of the server, API shape, message protocol details, SQLite schema.
- Whether `app.js` is split into modules (allowed if it stays build-free).
- Conflict handling when GM and player edit the same hero field at once (last write wins is fine).
- Icon rendering on tokens (tinting, frame, number badge style), picker UI.
- Tests: there are none today; add server-side tests at least for auth, sanitization (player never receives hidden data), and link regeneration.
- Docs: README section on self-hosting (Docker, env vars, reverse proxy), manual entries for new features.
