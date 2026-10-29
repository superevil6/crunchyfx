# Sound review: the SFX care pass (from 2026-10-29)

AJ, 2026-10-28: SFX "is capable of cool sounds, but it's missing some obvious ones, and some of the existing sounds or
engines being used to make the sounds are just the wrong lever." Run as BLIND A/B ROUNDS, the way BGM's instrument
review runs: `node tools/make-ab.mjs <round>` writes `soundtests/ab-<round>/` (takes loudness-matched to -18 LUFS and
shuffled, `LISTEN.md`, `KEY.md` to read after). AJ says a letter; that design is kept. The takes differ in KIND (another
engine, a layered build), and the current preset is always one of them, so it is heard against the others.

## Rounds

| Round | Question | Takes | AJ's pick | Result |
|---|---|---|---|---|
| electric-buzz | a gap: no electrical buzz | mains hum, transformer, neon flicker, live wire (layered) | D, **transformer** | new preset **Transformer Buzz** (Machine) |
| bubble-pop | today a sine sweep; the bubble engine unused | current, bubble engine, bubble + pop click, wet plop | D, **current** | kept as it is |
| glass-shatter | today a triangle in noise; the modal engine unused | current, modal shards, falling shards, heavy pane | B, **current** | kept as it is |
| double-jump | a gap | higher hop, flip whoosh (layered), twinkle (layered), wing flap (layered) | A, **flip whoosh** | new preset **Double Jump** (Retro / Arcade) |
| checkpoint | a gap | bell arpeggio, flag unfurl (layered), 8-bit arpeggio, warm bell (layered) | A, **flag unfurl** | new preset **Checkpoint** (Retro / Arcade) |
| dash | a gap | air whoosh, dash burst (layered), 8-bit noise sweep, boost (layered) | A, **dash burst** | new preset **Dash** (Footsteps / Movement) |
| reload | a gap | mag swap, quick, revolver (layered); 8-bit (control) | D, **quick** | **Quick Reload** (Guns) |
| shell-casing | a gap | bounces, brass roll, heavy shell (layered); tinkle (control) | C, **plain tinkle (control)** | **Shell Casing** (Guns) |
| enemy-death | a gap | poof, groan + thud, dissolve (layered); 8-bit (control) | B **groan + thud**, and A **8-bit (control)** | **Enemy Death** (Hits / Melee) and **Retro Enemy Death** (Retro / Arcade): two, "one may fit a game type better" |
| knockout | a gap | bell, slide down, stars (layered); heavy impact (control) | C, **bell** | **Knockout** (Hits / Melee) |
| crawl | a gap | cloth rustle, vent, dirt (layered); scrape (control) | A, **plain scrape (control)** | **Crawl** (Footsteps / Movement) |
| swim | a gap | swish + bubbles, splash stroke, underwater (layered); swish (control) | A, **swish + bubbles** | **Swim Stroke** (Footsteps / Movement) |
| line-clear | a gap | zap + sparkle, 8-bit + swish, crunch + chime (layered); arpeggio (control) | A, **zap + sparkle** | **Line Clear** (UI) |
| rotate | a gap | whoosh + tick, ratchet, click + rise (layered); blip (control) | C, **whoosh + tick** | **Rotate** (UI) |
| slider | a gap | pitched tick, wood tick, digital (layered); click (control) | A, **plain click (control)** | **Slider Tick** (UI) |
| dry-fire, scope, hit-marker | gaps | four each | **skipped** | no preset: conventions learned from particular games, "an abstract noise that doesn't really have a proper answer" |
| wood-break | a gap | crack (control); knock + splinters, plank snap, crate smash (layered) | A "is the best, but it doesn't really sound much like it" | the takes mixed different objects (crate, plank, branch): rerolled around A |
| wood-break-2 | A + one wood cue each | A unchanged (control), fiber tear, hollow knock, dry snap, everything | D, **fiber tear** | **Wood Break** (Doors / Containers): the crack + a dense burst of tiny crackles (the grain tearing) |
| spell-fire | the Wizard's Spell was swell + sparkle + a material layer for every material | today's spell (control), ignite roar, fireball, flame burst | **fireball** | the Wizard's fire spell |
| spell-ice / -2 / -3 | ice | round 1: freeze or shard cast, "neither are great"; round 2 (rerolled): frost bells and ice forming, "combine b and then a", then "swap the order" | **ice forming, then the frost bells** (round 3, all of the forming + the bells) | the Wizard's ice spell |
| spell-electric | electric | control, bolt, charge release, spark chain | **bolt** (with the transformer buzz) | the Wizard's electric spell |
| spell-water | water | control, wave surge, bubble blast, water whip | **wave surge**, and the **bubble blast** | both: the nine alternate |
| spell-magic | arcane | control, arcane burst, rune chime, warp | **warp** | the Wizard's magic spell |
| spell-stone | earth | control, earth slam, boulder, quake | **quake** ("quakish") and **earth slam** ("petrifying") | both: the nine alternate |
| spell-slime | poison | control, acid splash, toxic cloud, goo blob | **goo blob**, and the **toxic cloud** | both: the nine alternate |

## What the rounds taught

- **An engine that "looks wrong" is not a defect.** The name-vs-engine triage (58 flags, about 20 real by reading)
  predicted Bubble Pop and Glass Shatter were on the wrong lever. Blind, AJ picked the current one both times. So the
  triage is NOT a worklist: spend rounds on the GAPS and on sounds AJ flags by ear, not on remaking presets because of
  their engine.
- Tremolo + Flicker (2026-10-28) made the buzz possible; the winning take uses a 120 Hz tremolo.
- Round 2: all three gap winners were LAYERED builds (a core sound plus the motion's own air or chime).
- Round 3 kept a plain single-layer CONTROL in every round. The control won for the small, frequent sounds (shell
  casing, crawl, slider tick) and shared the win for enemy death (the 8-bit one). Layered builds won the bigger moments
  (reload, knockout, swim, line clear, rotate). So: layer the events; keep the constant little sounds simple.
- AJ skips a round when the sound is a learned convention with no natural answer (hit marker, scope, dry fire). Gap
  rounds should be for sounds a person can judge by ear; conventions belong to the Wizard or a reference game.
- Round 5 (spells): the control (today's generic cast) lost every time. A FUSED design won each material: one event, an
  attack / body / tail in the element's own sound. AJ often hears TWO that are both right and different (quake vs
  petrifying slam): the Wizard alternates them across its nine, which is also its variety. AJ can compose too: ice was
  "the forming, then the bells", two takes joined in order.
- A round about ONE object beats a round about a category: "wood break" mixed crate, plank and branch, and nothing won.
  Rerolled around the nearest pick, one cue at a time, it found the cue that makes wood (the grain tearing).

## The gap list (game sounds with no preset, 2026-10-29; a name check, so it overstates coverage)

- Shooter: ~~reload, shell casing~~ (round 3); dry fire, scope, hit marker skipped (conventions).
- Platformer: ~~double jump, checkpoint, dash~~ (round 2).
- Combat: ~~knockout, enemy death~~ (round 3).
- Objects / movement: ~~swim, crawl~~ (round 3), ~~wood break~~ (round 4).
- UI / puzzle: ~~slider / scroll, line clear, rotate~~ (round 3).
- Electric: covered by Transformer Buzz now; more (mains hum, neon) only if AJ wants them.
- One preset only (may or may not be good): stomp, ladder, bow, potion drink, chest, equip, summon, ricochet, rocket,
  crit, generator hum, helicopter, train, typing, achievement, grab / throw, barrel.
