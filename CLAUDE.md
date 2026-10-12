# M2 — notes for Claude Code

This app runs on **Homeroom**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Homeroom's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom's dev-chat
the platform fixes the base commit, and none of this applies.

## Starter template

The screen this app currently ships — the "Starter template" hero with
the app's thumbnail tile and the plain-English note on how the app gets
built (by asking Homeroom bot) — is placeholder content from the
Homeroom starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- rewrite `README.md` to describe the actual app.

Keep the `usernode-dev-console@1` forwarder `<script>` when rewriting the
HTML — that block is platform infrastructure, not template content. So is
the bridge `<script>`. The design kit is not placeholder either: build the
real app with it, and fill in "## Design" below.

The screen has a light and a dark look and follows the viewer's Homeroom
theme, switching live when they change it: the theme `<script>` right after
the bridge tag sets a `dark` class on `<html>`. Keep that script, and give
everything you build both looks (the design kit's colour tokens carry both), unless one
fixed look is the point of this app, like a game's own scene; then say so
under "## Design" below. Unless a request asks for one, add
no theme picker: the viewer's Homeroom setting is the control. "The
platform's light/dark theme inside the app frame" in the platform
conventions has the details.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About M2

Build modern, easy-to-use mind maps. M2 is for thinking on paper: a map
grows out from one central idea, each main idea gets its own colour, and
its branches curve outward and thin as they go. Maps are personal notes,
private by default, and they save on their own as you work. A map's owner
can share it view only (Private plus the people they add, Anyone with the
link, or Public); nobody but the owner ever changes it. The canvas is the app: everything else (Your maps, the sheets, the
save status) stays out of its way.

## Design

This app's look. The first real version set it; every later change
follows it, and updates it when a request changes the look on purpose.

- **Palette:** a pen and coloured markers on clean paper. Neutrals are
  cool and slightly blue, like paper under daylight (ground `244 246 248`
  light / `16 19 26` dark, surface white / `26 30 40`, cool grey line and
  muted). The action colour is ink (`27 33 48` / `236 239 244`): the
  central pill and the one primary button on each screen. Branch colours,
  lines and outlines only, never text: teal, amber, violet, rose, sky —
  `--branch-teal` … `--branch-sky`, brighter in the dark look. Danger is
  berry red, focus is cobalt.
- **Signature element:** the hand-drawn feel of a classic mind map in
  clean vector shapes — colour-coded branches that curve out of the centre
  and thin at each level (about 7, 3, then 2 world px), each outer branch
  ending by underlining its idea. One branch keeps one colour centre to
  tips. The same drawing recurs in miniature as each map's thumbnail, in
  the app mark, the home-screen icon and the featured card (`brand/`).
- **Type scale:** `text-title` 28/36 bold, `text-heading` 20/28 semibold,
  `text-body` 16/24, `text-small` 14/20, one friendly rounded system face
  (`ui-rounded`, falling back to the system sans) for everything.
- The canvas keeps both looks: ink pill in light, chalk-light pill on
  dark ground, branch colours brightened, dot grid dimmed. No theme
  picker; the viewer's Homeroom setting is the control.

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and components
(`btn-primary`, `btn-secondary`, `field`, `list` and `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`, plus
the canvas pieces: `.canvas`, `.world`, `.idea*`, `.c-*`/`.b-*`, `.topbar`,
`.bottom-bar`, `.thumb`, `.icon`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. 5.0"), never a bare value that could pass for one
  already entered.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry.
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions). M2's demo is the eight
  maps `server/demo-maps.js` seeds behind `?demo=1`.
- No cards in cards, no uppercase eyebrows, no emoji as icons.

## App-specific conventions

- A map is one JSONB document (`{ v: 1, nodes: [...] }`), validated by
  `public/js/map-model.js` on both sides — the page and `server.js`
  require the same file, so never fork the validation.
- The map's title mirrors its root idea's text; `maps.title` exists so
  Your maps can sort and label without opening every doc.
- `maps`, `profiles`, `demo_seeds` and `map_readers` are
  `staging:private`: maps are personal notes. Every write route stays
  owner-only (filtered on `owner_id`); reading someone else's map goes
  through one access check in `GET /api/maps/:id` (Public, or a
  `map_readers` row) or the secret link (`GET /api/shared/:token`). A map
  someone can't open answers exactly like a missing one, never 403, and a
  viewer's responses never carry `share_token` or the reader list. Guests
  get the example map in memory, never stored, and open a shared map only
  by its secret link.
- `maps.visibility` is NULL or `'private'` (Private), `'link'` or
  `'public'`. `share_token` exists only while it is `'link'`; switching
  away nulls it and Reset link replaces it. People are added from the
  platform's member list (`GET /api/members`, cached a minute per caller),
  never from people who happened to open the app.
- Idea anchors are world pixels: the centre of a pill, the near end of an
  outer idea's underline. Keep placement rules in the model, not the view.
- Maps nest 10 levels deep (`MAX_DEPTH`; the central idea is level 0). A
  new idea is placed past the end of its parent's drawn width (measured on
  the page, estimated from the text elsewhere), so deep chains never overlap.
- Links are named lines between any two ideas, outside the tree: the
  optional `doc.links` array (`{ id, from, to, text }`, an empty text is an
  unnamed link drawn as a dot), validated by the same `map-model.js`. They
  have no direction (two ideas are linked once), are drawn muted and dashed
  so they never pass for a branch, and go with either idea when it is
  deleted (`removeSubtree` carries them for Undo). At most 200 a map, names
  up to 60 characters.
- Avoid adding new dependencies; express, pg and jsonwebtoken cover it.
