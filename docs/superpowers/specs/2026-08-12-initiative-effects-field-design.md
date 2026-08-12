# Initiative "Effects" Text Field — Design

**Date:** 2026-08-12
**Status:** Approved

## Problem

GM has no way to track freeform status effects/conditions (e.g. "Poisoned, Prone", "Bless (2 rounds)") on a combatant in the Initiative tracker. Needs a per-combatant text field GM can edit mid-battle, visible to both GM and players — same visibility rule as the existing `concentration` badge ([[2026-08-05-initiative-concentration-design]]).

## Data Model

Each combatant object in `state.initiative.combatants` gains:

```js
effects: "" // string, default empty
```

Set in `addCombatant()` (app.js:4080) alongside `concentration: false`. Existing saved maps predate this field, so every read site falls back with `c.effects || ""` rather than assuming it exists.

## GM Initiative Row

`renderInitiativePanel()` (app.js:4265) — add a third line per row, below the existing `.init-hp-line`:

```html
<div class="init-effects-line">
  <input class="init-effects-input" type="text" data-field="effects" value="{escaped c.effects}" placeholder="Effects (e.g. Poisoned, Bless)" title="Status effects">
</div>
```

- Full-width text input, no label — placeholder communicates purpose when empty.
- Value is HTML-escaped via the existing `escapeHtml()` helper (same as the name field).

## Change Handling

The existing delegated `change` listener on `controls.initList` (app.js:893–907) gains an `else if` branch:

```js
} else if (event.target.matches("[data-field='effects']")) {
  c.effects = event.target.value.trim();
}
```

Fires on blur/Enter — same as the `hp`/`init` fields, not on every keystroke. This matters here specifically because `updateInitiativeUI()` fully replaces `controls.initList.innerHTML` on every call; an `input`-event listener would re-render mid-keystroke and steal focus/cursor position. `change` avoids that.

After the branch, the existing shared tail (`updateInitiativeUI(); broadcastState();`) applies unchanged.

## Player/GM-shared Overlay

`renderInitiativeOverlay()` (app.js:4311) — unlike HP (GM-only), effects are visible to **both** GM and players whenever the overlay is shown at all (mirrors the `concentration` badge's visibility, not HP's). For each combatant where `effects` is non-empty, render a small muted span next to their name:

```html
<span class="init-ov-effects">{escaped c.effects}</span>
```

- Omitted entirely when `effects` is empty — no placeholder/empty state shown.
- Not editable — read-only indicator, matching the badge pattern. The only interactive control is the GM row input.

## Sync

No new message type. Follows the existing "mutate `state.x` → render → `broadcastState()`" pattern already used by every other initiative mutator.

## Styling

Add to `styles.css` near the existing `.init-hp-*` / `.init-conc-badge` rules:
- `.init-effects-line` — full-width flex row wrapper (mirrors `.init-hp-line`).
- `.init-effects-input` — text input, same visual treatment as `.init-hp-input` (background/border/radius) but full width instead of fixed width.
- `.init-ov-effects` — small muted inline text for the overlay, placed near `.init-conc-badge` (~styles.css:2246).

## Documentation

Following the pattern set by the AoE line tool ([[2026-08-06-aoe-line-design]]), add a short mention of the effects field to README.md's feature list and to the manual (manual.html / manual/) initiative tracker section.

## Out of Scope

- No structured effect list (durations, auto-expiry, icons) — plain freeform text only.
- No effect suggestions/autocomplete.
- No character limit beyond the browser default.
