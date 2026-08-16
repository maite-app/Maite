# Maite

A small companion grows in the corner of your screen while you use Claude Code.

> **Maite** — **mate**, **AI**, and *aite* (Japanese for "the one you're up against").
> Three words folded into five letters. Not a pet you keep. A partner you work with.

*(The repository, the data directory and the environment variables are all still `aipet`. Only the visible name changed.)*

Just use Claude Code the way you already do. It levels up, and **the mix of tools you reach for decides its class and how it looks**. There is nothing to feed, tap or collect. Your work log *is* the character sheet.

Work on your laptop, work in Claude Code on the web — stand up the server and **it's the same one creature** either way.

**日本語 → [README.ja.md](README.ja.md)**

![Maite](docs/preview.png)

## Privacy

> **Only derived facts are recorded. Not one byte of content is stored.**
>
> **Nothing leaves your machine by default.** Those derived facts go to storage you own, and only once you configure sync yourself.

Here is everything the hook writes to `~/.aipet/events.jsonl`:

```json
{"t":1786659596374,"e":"PostToolUse","s":"63528a31","p":"fa748169","tool":"Bash","ok":true}
```

- `s` / `p` — the first 8 characters of the SHA-1 of the session id and the working directory. All we need is "same or different", so there is no reason to keep the plaintext. Your repository names and your employer's paths never appear.
- **Never stored** — prompt text, tool arguments, file paths, commands, command output, commit messages, hostnames.

Configure nothing and it **never touches the network**. Configure sync and that one line above goes to your own Cloudflare account — the content and the paths were never in it to begin with, so nothing new is exposed. What goes where is written out in [server/README.md](server/README.md).

## Install

```sh
npm install
npm run install-hooks   # adds the hook to ~/.claude/settings.json
npm start               # launch the overlay
```

`install-hooks` won't clobber hooks you already have. It's idempotent, and it leaves a backup at `~/.claude/settings.json.aipet-backup`.

To remove it:

```sh
npm run uninstall-hooks
```

Either way, restart Claude Code to pick up the change.

**Quit** — there's no tray icon yet, so `Ctrl+C` in the terminal you ran `npm start` from.
**Hide for a moment** — `Ctrl/Cmd + Shift + P`

## How it grows

| | |
|---|---|
| **EXP** | From prompts, tool calls and compactions. Failed tool calls still count for a little — an attempt is an attempt |
| **Daily cap** | 3,000 EXP/day. High enough that a genuinely long day lands almost whole, low enough that farming is pointless. The number came from measurement: at 1,500 a real 12.6-hour, 1,269-tool-call day threw away 53% of itself |
| **Level** | Deliberately fast early on — if it doesn't feel like it's growing in the first few days, nobody sticks around. Cap is Lv999, which is a promise that nothing breaks up there, not a destination |
| **Class** | Settles at Lv3, and keeps moving if your mix flips. Change how you work and the look changes with you |

Five classes:

| Class | Tools that feed it |
|---|---|
| Artisan | `Bash` |
| Seeker | `WebSearch` `WebFetch` `mcp__*` |
| Builder | `Write` `Edit` |
| Scholar | `Read` `Grep` `Glob` |
| Commander | `Task` |

Antenna at Lv3, crown at Lv10, aura at Lv15. Until a class settles it stays colourless; the moment it does, colour arrives.

## Where this is going

Phases 0 and 1 are done — the hook, growth, the desktop overlay, the phone view,
skills, auto-battles, idle expeditions, the dungeon, titles and skins.

- **Phase 2** — ghost battles against other people's creatures at a similar level.
  No new infrastructure needed; it is a matter of swapping the sparring partner for
  a real one. Worth doing not for the fight itself but for the fact that somebody
  else's creature turns up on your screen.
- **Phase 3** — elemental matchups, gear and weekly events. The first two landed
  early (the dungeon brought them forward), so what is left here is events.
- **Not in the plan yet, but wanted** — a packaged installer, so you do not need
  Node installed to run it.

Beyond that there is no roadmap, on purpose. **This gets built in whatever direction
the people writing it find interesting**, and it will keep being built that way. It
is not a product with a backlog to burn down — it is the thing in the corner of the
screen while the real work happens, and it improves when someone has an idea worth
trying.

If you have such an idea, open an issue. Small, strange and specific is welcome;
that is where most of what is already here came from.

**The full guide → [docs/GUIDE.md](docs/GUIDE.md).**
**Why it is built this way → [docs/DESIGN.md](docs/DESIGN.md).**

## Licence

[MIT](LICENSE). Use it, change it, ship it — keep the copyright notice, and accept that it comes with **no warranty**.

Forking it into your own hooks and your own job names is very much encouraged.
