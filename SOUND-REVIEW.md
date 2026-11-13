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

## The engine sweep (2026-11-10): the instrument presets onto the engines built for them

AJ: "do a sweep of presets that might be better suited with the new engines. For example, we have a piano preset that
would be better with piano." `node tools/make-engine-sweep.mjs` rendered 35 presets NOW and on their engine, labeled,
by family (piano, mallets, brass, strings, reeds, flutes; `soundtests/engine-sweep/`). 27 "afters" were CrunchyBGM's
ear-picked patch for the same instrument at the SFX preset's own pitch, length, width and room; 8 were designed here
(Honky-tonk, Toy Piano as a tine, French Horn, Brass Section, Sax Sigh, Reed Section, Bass Reed, Ocarina).

**AJ's verdict: all 35 to the engine.** "Every engine sound is a dramatic improvement over the previous one… No
kidding, they really are all that much better." Applied with `--apply`: same names, same sections, each with its own
`_vary` (DEFAULT_VARY jitters `drive` and `decay`, which sit at 0 on these engines and would be pushed UP — random
saturation on a physical model). The audio hash moved on exactly those 35 lines; no fixture, Wizard, layer or footstep
line moved.

**This does not contradict "an engine that looks wrong is not a defect."** That lesson is about the triage: a name and
an engine disagreeing PREDICTED nothing for Bubble Pop and Glass Shatter. These were instruments with a purpose-built
physical model, mostly already judged by ear in BGM, so the right lever existed and was proven before the round.

**Open:** the older engine presets of the same instrument ("Struck Piano", "Struck Marimba", "Bowed Cello", "Blown
Saxophone"…) now sound close to the converted ones. Whether to keep both, retune one apart, or retire one is AJ's call.

## The chirp engine (2026-11-10): birdsong and insects, wave 27

The birds and insects were plain oscillators (Bird Chirp and Bird Trill a sine, Cricket Chirp a square). A prototype
engine, "chirp" (`tools/proto/chirp.mjs`, rounds in `soundtests/proto-chirp/`), modeled them as what they are: a
bird's syrinx (near-pure whistles on fast pitch gestures, organized into syllables and phrases, sometimes two voices
at once) and a cricket's stridulation (a carrier gated into wing-stroke pulses grouped into chirps, `rasp` for a
katydid), under one syllable scheduler with a chorus of individuals. Five blind rounds, each the current preset (or the
nearest one, for a gap) against three takes that differ in idea.

**AJ's verdict: "Literally every chirp is perfect."** Every take was kept, as ARCHETYPES: a preset's `_alts` are other
versions its BUTTON plays (one at random, never the same twice running).

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Bird Chirp | today's sine chirp, unchanged | cheep, two-voice tsee-wit, chip call |
| Bird Trill | today's preset, unchanged | flat sparrow trill, accelerating falling cascade, two-voice liquid roll |
| Cricket Chirp | today's preset, attack 0 -> 0.001 (it started on a step: a click) | field cricket, katydid rasp, tree-cricket purr |
| **Songbird Phrase** (new, a gap) | sparrow-style song of sections | robin-style carol, thrush flute + flourish (2 layers) |
| **Night Insects** (new, a gap) | six field crickets | meadow of three species (3 layers), tree crickets chirping in time |

The native renders are the takes AJ heard: the engine buffer is sample-identical to the prototype's over the heard span,
and through the app's chain the residual is -66 dB or lower on every take. The prototype ran each take through the
real chain as an imported sample with the control's room, so nothing was lost in the port.

## The creature engine (2026-11-10): animal and monster calls, wave 28

38 of the 51 Animal / Monster presets were the formant engine: a perfectly steady saw through three bandpasses holding
ONE vowel, with a sine wobble and a one-way sweep. AJ: they "sound nothing like animals". A call is a TRAJECTORY (a meow
is the mouth opening then closing while the pitch rises then falls; a moo a closed nasal hum opening into "oo") and its
source is a larynx (the period jitters, the level shimmers, rough calls go subharmonic, period-double, then chaotic).
The prototype, "creature" (`tools/proto/creature.mjs`, rounds in `soundtests/proto-creature/`): a glottal pulse with
jitter, shimmer, roughness and breath, a Klatt cascade tract whose formants follow the mouth and vowel, a nasal branch,
body size. Five blind rounds, each the current preset (or the nearest, for a gap) against three takes of different idea.

**AJ's verdict: the engine won every round.** His picks, the losers of today's presets gone:

| Preset | Base | Alts |
|---|---|---|
| Cat Meow | "m-YAOW": nasal hum opening wide, 492 -> 650 -> 435 Hz | kitten "mew" (1 kHz, 0.4 s) |
| **Cow Moo** (new) | "mmm-OOO": closed hum into a rounded oo, 134 -> 150 -> 106 Hz, cow-sized tract | |
| **Dog Bark** (new) | one big "WOOF": chaotic source, much breath, 260 Hz falling | |
| Monster Growl | snarl into a roar, period-doubled | deep chaotic rattle; tonal sub-octave throat growl |
| Wolf Howl | a yip into a long falling howl, 557 -> 420 -> 350 Hz | |

**Cow Moo and Dog Bark reuse names** that 1.2 removed: they were formant presets todo.md called "they don't sound
good at all" (commit d29f421). Nothing treats the names specially (no rename table, no fixture, custom categories skip
missing names), so a saved category naming them just finds the new sound.

The native renders are the takes AJ heard: pitch contours match to a few Hz at every 50 ms point, and the mouth (the
spectral centroid) traces the same rise and fall. Two engineering changes from the prototype: the tract's coefficients
are recomputed every 16 samples and RAMPED (6-8x cheaper; held in steps they turned the 48-pole cascade's every step
into a transient), and a level calibration so a creature preset does not lean on Normalize (rawPeak 0.59-0.87 on all
eight versions, so Normalize moves them 0.3-3.7 dB).

**Open:** the other ~30 formant animals (howls, growls, roars, bellows, snarls, Horse Neigh, Duck Quack...) are the
obvious next round on this engine. The big-bodied takes are dark (under 2% of their energy above 1 kHz); AJ picked
them anyway, which is the verdict on that doubt.

## The weather engine (2026-11-10): wind, rain and thunder, wave 29

All 42 Nature presets but a few were a sine plus filtered noise. Noise fakes wind passably, so this was the least
certain of the engine rounds. The prototype, "weather" (`tools/proto/weather.mjs`, rounds in
`soundtests/proto-weather/`), models what the air and the water DO: wind as turbulence whose band and level follow a
seeded gust curve, with edge-tone whistles whose pitch rises with the gust and that only sing when it is strong; rain as
separate drops (random arrivals, exponential sizes, spread over an area) hitting a surface (a click, a leaf's tap, or
water's slap and a ringing Minnaert bubble) over a hiss; thunder as N-waves arriving from every 12 m of a tortuous,
branched bolt, low-passed by distance, compressed into a few seconds. Five blind rounds, today's preset against three
interpretations each.

**AJ's verdict: the engine won every round, and two controls held up too.**

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Thunder | today's preset, unchanged | close strike (a crack, then the roll), distant rumble, rolling overhead (in-cloud) |
| Heavy Rain | today's preset (the particle engine), unchanged | deluge on a lake, sheets across foliage, downpour on a roof |
| Rain | **rain on a pond** (plinking bubbles) | on leaves, on pavement |
| Wind Gust | **a gust through a gap** (two whistles at its peak) | buffeting, open field |
| Howling Squall | **a storm front** (very gusty, no whistle) | shrieking rigging, chimney howl |

The native renders match the takes AJ heard: wind and thunder trace the same envelope (correlation 0.97-1.00 at 25 ms)
at the same centroid (within 4%) and the same color-against-level; rain is another shower of the same statistics,
its seeds re-picked so the centroid (within 6%), crest and color-against-level match each heard take, because whether
a drop falls follows the envelope's attack curve, which differs from the prototype's.

**Measured, before the round:** the model's wind brightens as it strengthens (level-to-centroid correlation +0.56 to
+0.90; today's Wind Gust was -0.61), light rain has 11-31 separately audible drops a second (today's Rain: none), and
the thunder has 3-5 swells (today's: none). Heavy rain at 1500+ drops a second converges back toward noise, which is
probably why the particle preset held up.

**Open:** the other noise beds in Nature (Wind Gust 2, Windswept Gust, Howling Hollow, Frozen Squall, the Drizzles,
Thunder 2, Thunderclap) are the obvious next round on this engine. Surf, waterfalls and streams are not modeled.

## The motor engine (2026-11-10): engines, rotors and steam, wave 30

The vehicles in Machine were generic oscillators: Car Engine a saw, Chainsaw a saw, Helicopter an impact burst, Train a
sine with noise. The prototype, "motor" (`tools/proto/motor.mjs`, rounds in `soundtests/proto-motor/`), builds them
from what they are: a train of FIRING EVENTS at the rate the rpm sets (four-stroke rpm x cylinders / 120 a second,
two-stroke / 60, a rotor's blades, a locomotive's four chuffs a wheel turn), each slightly irregular, through a
quarter-wave exhaust pipe and a muffler that opens with the throttle, with pops on the let-off, a tail rotor, a turbine
or blower whine and rail clacks in pairs. Five blind rounds (Car Engine, Chainsaw, Helicopter, Train, and the gap
Motorcycle, whose control was Car Engine), today's preset against three interpretations each.

**AJ's verdict: the engine won every round; Car Engine's control held up too.**

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Car Engine | today's preset, unchanged | V8 lumpy idle with a blip, a small four revving, a six pulling away |
| Chainsaw | **pull start** (it catches, flares and settles to a ragged idle) | cutting (bogs under load), idle then trigger |
| Helicopter | **four-blade hover** (22 slaps/s, tail buzz, turbine) | big two-blade whop |
| Train | **steam departure** (chuffs speeding up 1.7 -> 6/s) | steam at speed with rail clacks |
| Motorcycle (NEW) | **sport four screaming** to 13000 rpm | two-stroke dirt bike ring-ding, V-twin blip and crackle |

**How close the presets are to what AJ heard:** the steady takes (hover, whop, both steam) render through the native
engine as the SAME audio as the take (correlation 0.995-1.000, loudness curve within 0.1 dB). The revving takes were
keyframed by hand in the round and are now the engine's rev rows (idle, rev at, rev up, peak, hold, rev down, settle,
three throttles), which reproduce the curve's shape but not its every keyframe, so the random stream (misfires, pops)
falls differently; those seeds were RE-PICKED, from 400, to the take with the closest loudness curve, firing rate and
centroid. Firing rates on the audio match the take's within a few percent through each rev; centroids within 5%;
the 50 ms loudness curve within 1-2 dB RMS for most, 4-5 dB for the two with heavy overrun pops (V-twin, dirt bike:
the pops land at other moments) and the pull start. The dirt bike's two revs come from `motorRevs` 2, its first rev
down cut short by the second as in the take.

**Level:** AJ heard every take at -18 LUFS. As presets (Normalize on, peak-normalized like everything else) the
versions are set with `gain` to about -16 LUFS each (gain capped at 1: the muscle car's alt reaches -17.4, the pull
start -18.7), in line with the weather and creature presets (-15 to -20). Car Engine's unchanged base is -9.5, so
on that one button the three alts are 6-8 dB quieter than the base.

**Open:** Airplane Takeoff/Landing (a propeller is a rotor) and Drone Hover are the obvious next round on this engine;
a jet turbine, an electric motor (Servo/Grinding/Hydraulic Motor) and Doppler fly-bys are not modeled.

## The blast engine (2026-11-11): explosions and gunshots, wave 31

18 of 26 Explosions were a sine + noise + the `boom` stage, and the Guns sat on the `impact` engine: neither modeled what
a blast IS. The prototype, "blast" (`tools/proto/blast.mjs`, rounds in `soundtests/proto-blast/`), builds one from the
physics: a Friedlander PRESSURE WAVE (near-instant rise, decay, a long negative phase) whose length follows cube-root
scaling with the charge, the fireball or muzzle gas, a sub rumble, debris landing at flight times, a bullet's supersonic
N-wave crack and the gun's mechanism; then carries it to the listener: air absorption and pulse lengthening with
distance, and the PLACE as an impulse response built from geometry (ground reflection, street facades, a room's image
sources, canyon walls, forest scattering). Five blind rounds (Explosion, Grenade Blast, Distant Boom, Pistol Shot,
Sniper Rifle), today's preset against three interpretations each.

**AJ's verdict: the engine won every round; today's preset lost every one.**

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Explosion | **open ground, 25 m** (~0.8 kg: fireball, rumble, dirt falling back, a far treeline) | |
| Grenade Blast | **open, 15 m, physical** (the pressure wave at its real ~2 ms: a hard crack-thump) | |
| Distant Boom | **through the woods, 600 m** (the trees take the highs out of the thump, a dense wash, no echoes) | across a valley, 800 m (dark smeared echoes) |
| Pistol Shot | **a street, 20 m** (a dull report and the facades' flutter) | |
| Sniper Rifle | **at the shooter, open** (crack on the muzzle blast, a far echo, the bolt worked, the casing) | |

**How close the presets are to what AJ heard:** the engine is the prototype's maths, so each preset renders the take's
own seed. Against the take as AJ heard it (the round's limiting and -18 LUFS matching), through the exported engine:
the 50 ms loudness curve within 0.01-0.46 dB RMS, correlation 0.90-0.98, centroid within 6% (Distant Boom 14-19%
higher: the chain's DC block takes a little of the sub), share below 150 Hz within 2-6 points (57.6 -> 53.9% on
Explosion, 64 -> 59% and 80 -> 75% on the two distant ones, same cause), and the echo delays by construction (the place
is built by the same code from the same seed). The onset traces agree sample for sample (Explosion: a direct front, then
the ground reflection 0.2 ms behind it lifts it to the peak); a 12 kHz low-pass at Butterworth Q (the chain's filter
cannot be bypassed: a 40 Hz high-pass, weather's choice, cut the booms' low end by up to half) adds one sample
of rise on a gun's front. Upward of 10 kHz the takes carried under 0.5% of their energy.

**The peak problem, solved in the engine:** a gunshot keeps nearly all its energy in ~10 ms, so against a 400 ms
loudness block its crest is 18-27 dB, and three gun takes needed a second limiter pass the master Limiter could not give.
**Peak control** (`blastPeak`, 0-2) is the app's own lookahead limiter run on the blast ALONE, before the chain: up to 1
one pass, past 1 a second (the round's "1+0.1" is Peak control 1.1). Every round limiter value moved into it (Explosion
0.3, Grenade Blast 0.9, Pistol Shot 0.4, Sniper Rifle 1.1), so no blast preset uses the master Limiter, and `gain` after
the chain stays a plain level (a master Limiter after the gain pins the peak at its ceiling whatever the gain, which
broke Variations' loudness matching on Explosion).

**Level:** AJ heard every take at -18 LUFS. As presets (Normalize on, gain 1 unless noted) they land at Explosion -18.8,
Grenade Blast -18.3, Distant Boom -18.0 (gain 0.91; its alt -18.1 at 0.85), Pistol Shot -18.5, Sniper Rifle -18.5.

**Variations:** a blast is STRETCHABLE (its sound sits at fixed times, so a longer buffer only lets its place ring out;
`fitTail` may grow one to max(3 s, its length + 1 s)), and its Size and Place length only shrink in a take (they ARE its
length). Simulated on Explosion over 80 packs at 0.5: no take ends louder than the test allows (worst -41 dB).

**Open:** Gunshot, Rifle Crack, Shotgun, Magnum Shot, Snub Report, Heavy Round and the other Explosions (Explosion 2,
Barrel Burst, Massive Blast, Concussive Kaboom, Cavern Shockwave, Nuke Rumble, Distant Wallop) are the obvious next round
on this engine; a burst (Repeat > 1) re-gates the one blast rather than firing again, so Full Auto and 3-Round Burst
are not served yet.

## The spring engine (2026-11-11): boings, doorstops and the jaw harp, wave 32

The boings and bounces were pitch sweeps on a sine (Cartoon Boing, Boing Spring), a triangle (Springy Boing) or a pulse
(Bouncy Blip). A real spring is a DISPERSIVE medium: the highs run along the coil faster than the lows, so a tap comes
back as a falling chirp on every round trip, and a coil closed into a short loop rings with its partials stretched
apart. The prototype, "spring" (`tools/proto/spring.mjs`, rounds in `soundtests/proto-spring/`), has three types: a
COIL (a feedback loop with a chain of allpasses designed so each echo glides evenly in octaves, falling or rising), a
DOORSTOP (the same loop one period long, the tip's sway moving its level and pitch) and a TWANG (a jaw harp: a plucked
steel reed through the player's mouth, whose resonance picks out single harmonics and glides or wobbles). Five blind
rounds (Cartoon Boing, Springy Boing, Bouncy Blip, and two gaps: Doorstop Spring against Boing Spring, Jaw Harp against
Didgeridoo), today's preset against three interpretations each.

**AJ's verdict: the engine won every round, four of them with the twang; today's preset lost every one.**

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Cartoon Boing | **jaw harp "bwoing"** (110 Hz reed, the mouth up 1.6 octaves, a little wobble; its reverb kept) | |
| Springy Boing | **falling twang** (147 Hz, the mouth from "ee" down 1.6 octaves, wobbling 14 times a second) | |
| Bouncy Blip | **twang up** (a short 262 Hz "bwip", the mouth up two octaves in 0.14 s) | |
| Doorstop Spring (new, Cartoon / Misc) | **big floor spring** (110 Hz, the most dispersion, a 4.5 Hz swing, ~2 s ring) | |
| Jaw Harp (new, Instruments / Guitars & Plucked) | **played riff** (three plucks on a 98 Hz reed, mouth up / down / up; 3 layers) | the single "bwoing" |

**How close the presets are to what AJ heard:** the engine is the prototype's maths and each preset names its take's
seed, on a chassis that mirrors the round's chain (40 Hz high-pass, no resonance, no drive, a 15 ms release). Through
the exported engine against the WAV AJ heard: correlation 1.0000 on all six, the 50 ms level curve within 0.08 dB, the
mouth's glide at 0.03/0.1/0.2/0.35/0.6 s identical (Cartoon Boing 646 -> 2196 Hz), the doorstop's partials (1, 2.13,
3.48 at 109.9 Hz) and its sway (4.5 Hz, 4.4 dB) identical. The riff's later plucks first came out 0.7 dB low (each layer
is levelled on its own peak, the take was a raw sum); layer gain 1.08 closes it to 0.08 dB. The rising coil's start
tick (flagged in the round) is in no shipped preset: every one starts from a silent first sample with no onset step
larger than the sound's own.

**Level:** gains set so each lands at its take's loudness: Cartoon Boing -19.6, Springy Boing -20.1, Doorstop Spring
-19.8 (gain 1; their takes were peak-capped at -19.1 to -19.6), Bouncy Blip -18.0 (0.6), Jaw Harp -18.0 (0.86), its alt
-18.9 (1). With Normalize off a spring is levelled by the engine (peaks 0.54-0.70, beside Cat Meow's 0.53).

**Open:** Boing Spring, Bounce, Turbo Bounce, Bouncy Sproing, Slippery Sproing, Squishy Boing, Silly Boing and the Wobble
presets are the obvious next round on this engine; spring-tank reverb drips (the coil type) have no preset yet.

## The servo engine (2026-11-11): electric motors, gearboxes and clockwork, wave 33

The Machine category's electric and mechanical sounds were oscillators with a sweep: Servo Motor a saw sliding up with a
ring mod, Robot Servo a square, Mechanical Whir a saw with vibrato, Conveyor Belt a saw retriggered nine times a second,
Clockwork Whir a ring-modded saw. The prototype, "servo" (`tools/proto/servo.mjs`, rounds in `soundtests/proto-servo/`),
builds them from ONE SHAFT whose rotation every sound is locked to: a magnetic whine at rotor slots x the speed, a brushed
motor's commutator buzz and sparks, a gear-mesh tone per stage (teeth x that shaft's speed, warbling with sidebands when
worn), mains hum, bearing hiss, knocks once per turn of a chosen shaft, and for clockwork an escapement and a winding
ratchet. The speed follows the power with inertia (a kick of current on the way up, a braked stop or a long coast), and a
servo's move ends in the click of its gears settling. Five blind rounds, today's preset against three interpretations each.

**AJ's verdict: the engine won every round; today's preset lost every one.** All shipped CLEAN (the old patches' bitcrush
and downsample were not carried over: AJ picked the clean takes).

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Servo Motor | **seek and settle** (a long move, a correction, a nudge, each with its stop click, then the holding buzz) | one long hobby-servo sweep |
| Robot Servo | **quick zip** (a tiny geared servo, 0.23 s of motion at 13200 rpm, a plastic stop click) | two-step (two zips, then the holding buzz) |
| Mechanical Whir | **worn gear train** (a gearmotor's two worn stages warbling, a chipped tooth knocking each turn) | mains induction motor (hum + rotor whine, coasting down), bare brushed motor spinning up and coasting |
| Conveyor Belt | **slat conveyor starting** (the hum arrives, the motor pulls up to speed, the slats' clatter accelerates to ~9/s) | slat conveyor running, rubber belt rumbling with a splice thump |
| Clockwork Whir | **governor whir** (a wind-up toy's fly fan and gear train buzzing, slowing as the spring runs down, a cam's pawl clicking) | |

**How close the presets are to what AJ heard:** the engine is the prototype's maths and each preset names its take's
seed, on a chassis that mirrors the round's chain (attack 4 ms, release 20 ms, cutoff 16 kHz, no resonance, no drive, no
crush, no reverb: every control was dry). Through the exported engine against the WAV AJ heard: correlation 1.0000 on nine
of eleven, 50 ms level curves within 0.3 dB, centroids within 1.4%. The governor whir is 0.9986 (the engine judges its
levels against the curve's top speed, 62 rps, where the round used 60). The worn gear train is 0.71, because the round
held its load at 0.5 for the first 20 ms and the rows hold 0.6 from the start; its loudness curve is within 0.21 dB and
its lines and knocks are identical to the hertz (commutator 548.0, first mesh 602.2, second mesh 128.0, whine 256.3 Hz;
12.9 knocks/s). The other takes' measured lines (round KEY.md) therefore hold: the hobby servo's mesh 1607 Hz and
commutator 964 Hz, the induction motor's rotor whine 773 Hz over 120 Hz hum, the conveyor's ~8.5 slat clacks/s, the
governor's 492 / 82 Hz meshes and ~9 cam clicks/s.

**Level:** AJ heard every take at -18 LUFS. As presets (Normalize on, peak-normalized like everything else) each is set
with `gain` to -16.0 LUFS, the motor engine's level (gains 0.45-0.82). With Normalize off the engine levels the buffer
(RMS 0.12, peak capped 0.9, the motor's rule): -17.8 to -22.2 LUFS.

**Open:** Servo Twitch, Electric Whir, Grinding Motor, Hydraulic Motor, Gear Grind and Overclocked Ratchet are the obvious
next round on this engine (the ratchet and escapement are built and have rows, but no shipped preset uses them yet);
Drone Hover is a brushless motor with a propeller (a rotor), between this engine and the motor's.

## The friction engine (2026-11-11): creaks, squeaks and squeals, wave 34

The creaks and squeaks were oscillators: Creaking Door, Trapdoor Creak and Heavy Gate a saw with heavy vibrato through a
resonant bandpass, Squeaky Toy a saw sliding up with vibrato. The prototype, "friction" (`tools/proto/friction.mjs`,
rounds in `soundtests/proto-friction/`), builds them from STICK-SLIP: a contact dragged along a surface under a pressure
grips, loads, slips (the friction falls with sliding speed), snaps the load into a resonant body (wood panel, iron,
rubber over an air cavity, wood on an iron pin) and grips again. Slow, the slips are separate ticks whose rate follows the
push; faster they run together into a groan; on a ringing body they LOCK to a body mode and squeal. Five blind rounds,
today's preset against three interpretations each (the fifth a gap, a brake, against Nails on Chalkboard).

**AJ's verdict: the engine won every round; today's creak "failed spectacularly compared to the new ones".** All shipped
clean (no crush carried over).

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Creaking Door | **hinge groan** (a wooden door on an iron pin: ticks speed up to ~380/s through the swing, catching briefly into a ~520 Hz groan, then slow back into ticks) | |
| Trapdoor Creak | **lift** (a hatch lifting: ticks speeding from 10 to ~170/s into a short groan, then falling away) | iron eek (the rusty hinge alone, locked on ~1.42 kHz) |
| Squeaky Toy | **squeeze** (rubber over a cavity: unsettled at ~600 Hz, then it JUMPS onto the cavity, ~920-940 Hz) | |
| Heavy Gate | **iron hinge** (an iron gate under its weight: slow, big, uneven ticks, 10-60/s, the iron ringing under each) | |
| Brake Squeal (NEW, Machine, after Gear Grind) | **cart** (a mine cart's block brake: a ~430 Hz squeal, a grind as the grip changes, a halt with the wheel ringing) | |

**How close the presets are to what AJ heard:** the engine is the prototype's maths and each preset names its take's seed
(`fricSeed`; the model seeds from the body's pitch and that row together, as the round did), on a chassis that mirrors the
round's chain (filter open at 12 kHz, no resonance, no drive) with the control preset's own Space settings. The round faded
each take's model out over its last 30 ms; the presets do that with the envelope (attack 1 ms, hold to 31 ms before the
push ends, a 30 ms decay to 0), so the reverb rings on exactly as it did. Through the exported engine against the WAV AJ
heard: correlation 1.0000 on all six, the 50 ms level curve a constant offset (the gain) within 0.3 dB, centroids and the
100 ms pitch tracks identical (Creaking Door 621 Hz and its 519 Hz catch; the eek 1423 Hz; the toy 596 / 938 / 919 Hz; the
gate's 237-241 Hz ring; the brake's 432 / 428 Hz squeal and 1260 Hz ring).

**Level:** AJ heard every take at -18 LUFS. As presets (Normalize on) each is set with `gain` to -16.0 LUFS, the level the
motor and servo engines use (gains 0.28-0.66). With Normalize off the engine levels the buffer (`frictionLevel`: RMS 0.12,
peak capped 0.9; the bodies differ ~40 dB raw): -19.3 to -25.8 LUFS (the locked squeals sit lowest).

**The seed (the model is chaotic):** every preset pins `fricSeed`. Varied over the `_vary` range (seed 0 to 2x), Creaking
Door, Trapdoor Creak, Squeaky Toy and Heavy Gate keep their behavior on every seed tried (the toy locks on 919-938 Hz on
all twelve; the creaks stay ticks with an occasional brief catch), so they vary the seed fully. The brake does not: the
same rows squeal at ~430 Hz on some seeds, at the wheel's 1260 Hz mode on others, or barely squeal and mostly grind. Its
`_vary` moves the seed by 10% only (139-169), where it keeps squeal-then-grind with the squeal's length and note varying.

**Open:** Wooden Door Open, Chest Open, Gauntlet Creak, Loony Squeak, Rubber Stretch and Nails on Chalkboard are the
obvious next round on this engine; the rubber body cannot change size during a squeeze (a real toy's cavity does), so a
squeak cannot glide.

## The flow engine (2026-11-11): streams, waterfalls, surf and pouring, wave 35

The moving water in Nature was a sine plus filtered noise (Waterfall, Ocean Surf, Stream Babble, Wave of Water, the Tides
and Cascades), and Water / Liquid is the bubble engine, which does single bubbles but scatters them uniformly: no body of
water. The prototype, "flow" (`tools/proto/flow.mjs`, rounds in `soundtests/proto-flow/`), models what the water does: a
STREAM as pockets (a gap behind a stone, an eddy), each with one bubble size and a figure, firing clusters of Minnaert
bubbles that come back (`babble`: Poisson to near-periodic), some pockets hollow cavities, over turbulence; a WATERFALL as
the dense limit, thousands of bubbles a second merging into a pitched roar, with thunder and thumps at the base and spray;
SURF as a cycle every 6-12 s (the swell builds, the wave breaks along its front so the crash travels across the field,
foam fizzes, the wash runs up, then a long drawback: a hiss over sand or stones knocking over pebbles); POURING as a jet
exciting the air column over the liquid, a quarter-wave tube whose note climbs, faster and faster, as it fills. Five
blind rounds, today's preset against three interpretations each (the fifth a gap, filling a bottle, against Pouring Water).

**AJ's verdict: the engine won or matched every round, and three controls held up.**

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Waterfall | today's preset, unchanged | at the plunge pool, across the valley, cascade over rocks |
| Ocean Surf | today's preset (2 s), unchanged | heavy shore break, pebble beach, sandy beach (12 s each) |
| Wave of Water | today's preset, unchanged | lapping wave, shore break, wave on rocks |
| Stream Babble | **trickle** (four pockets of small bubbles, ~2.3 kHz, plinks coming back near-regularly) | |
| Filling a Bottle (NEW, Water / Liquid, beside Pouring Water) | **glugging into a flask** (~6 glugs a second, the note climbing ~430 Hz to ~1.9 kHz) | bottle under a tap (a clearer climb, ~320 Hz to ~2 kHz) |

**How close the presets are to what AJ heard:** the engine is the prototype's maths and each version names its take's
seed (`flowSeed`), on a chassis that mirrors the round's chain (filter open at 20 kHz Butterworth, no drive, gain 1) with
the control preset's own reverb. Through the exported engine against the takes: centroids within 3%, band shares within
4 points, the 250 ms loudness curve within 0.0-0.3 dB on average (worst single step 1.4 dB, on surf), the pour's pitch
track identical (431 -> 1873 Hz, 323 -> 1960 Hz).

**Level:** AJ heard every take at -18 LUFS. The three kept bases are louder than their alts with Normalize on (peak
normalized, so a crash or a sparse roar sits lower): Waterfall's alts 2.1-2.6 dB under it, Ocean Surf's 3.1-5.1, Wave of
Water's 0.7-4.6. Each alt gets the app's Limiter at the smallest 0.1 step that puts it within 1 dB of its base: Waterfall
0.1 / 0.1 / 0.1 (-8.3 / -7.9 / -7.9 against -7.8); Ocean Surf 0.3 / 0.3 / 0.2 (-14.7 / -14.0 / -13.8 against -13.8);
Wave of Water 0 / 0.1 / 0.2 (-13.4 / -12.3 / -13.6 against -12.7). **That is not free on surf:** the crash's rise over
the swell (its steepest 250 ms) goes 17.3 -> 14.9 dB (heavy shore break), 16.5 -> 14.9 (pebble beach) and 10.9 -> 9.1
(sandy beach), against under 1 dB on the single waves and nothing audible on the waterfalls' steady roar. If the surf alts
read squashed, their limiter goes back to what AJ heard (0.1 / 0 / 0) and they sit 3-5 dB under today's preset. **AJ, 2026-11-12: keep the gentler limiting.** Stream
Babble (-16.7) and Filling a Bottle (-10.9 / -11.0) keep the round's gain 1. With Normalize off the engine levels the
buffer (`flowLevel`: RMS 0.12, peak capped 0.9).

**Measured, before the round:** surf's wave period, from the envelope's autocorrelation over 60 s, lands on the setting
(5.7 / 7.1 / 8.1 s for 6 / 7.5 / 8); the vessel's pitch rises on 91-100% of steps (Pouring Water: 560 -> 732 Hz); the
stream's babble is real but MODEST in the audio (recurrence 0.10 -> 0.20 in a trickle as babble goes 0 -> 0.9, blurred
in a brook where pockets share a band). Whether that is what made Stream Babble's trickle win is a listening question.

**Open:** the other water beds in Nature (Water Ambient, Restless / Rushing Tide, Windswept / Restless / Quiet Cascade,
Frozen Stream) and Bubbling Stream, Watering Can and Water Swirl in Water / Liquid are the obvious next round on this
engine. The pour cannot pour OUT (a bottle emptying glugs with a FALLING note); surf has no rocks for spray to hit.

## New presets on the new engines (2026-11-11): 25 sounds for parts no preset used

AJ: "let's add them, then if they seem odd, I'll do an ab test". So these went straight in without a blind round. Each was
designed by measurement against its engine's shipped presets (level median, timing, pitch) and rendered to
`soundtests/new-presets/` for listening; any that sound off get a round afterwards.

| Engine | Unused part it shows off | Presets |
|---|---|---|
| chirp | Buzz (wings), no preset before | Mosquito, Housefly, Hummingbird (hum + chip layer), Cicada Drone (cricket mode) |
| spring | Coil, no preset before | Spring Tank Crash, Slinky |
| friction | Wood body, no preset before | Chair Scrape, Floorboard Creak (+ quick-step alt), Ship Hull Creak, Rope Creak |
| blast | downrange crack, Street/Canyon/Indoors, black powder, debris | Bullet Whiz, Sniper From Afar, Canyon Blast, Mine Charge, Cannon, Dynamite; Bolt-Action Reload (layers) |
| servo | ratchet, escapement, mains hum, PWM, stop click | Ratchet Wrench (+ coarse alt), Winding a Toy, Clock Tick (+ tall-case alt), Pocket Watch, Fridge Hum, Cordless Drill, Electric Car Pass, Ceiling Fan |

Found on the way, fixed: **the wing buzz's Doppler ran backwards for half the seeds** (`chirpBuzz` flipped the pan with
the flight direction but not the pitch; now `-span * dir * xr`). No preset used Buzz before, and the new ones use seeds
that fly `dir +1`, where the fix is a no-op. **`chirpPitch`'s minimum was 500** while its help text said a wing buzzes at
100-600 Hz: now 40, so Housefly (190) and Hummingbird (62) show on the slider.

Engine limits the agents reported (none acted on): the downrange crack's level is tied to the report's, so Bullet Whiz's
crack may read as a tick before a thump (the A/B candidate); the blast engine cannot play a bolt without a shot (hence
layers); the ratchet click has a fixed 4300 Hz pitch; the servo PWM whine does not track speed; the Wood friction body is
dark (little above 1 kHz), so its presets sit at higher body frequencies; Hold buzz is still unused. The clocks sit ~5 dB
under the servo median on purpose (a sparse tick). Over the Length macro's 2 s: Clock Tick (4 s), Fridge Hum, Ceiling Fan,
Electric Car Pass, Sniper From Afar, Canyon Blast.

## Creature redo (2026-11-12): every Animal / Monster sound off the formant engine

AJ: "Rooster Crow sounds horrible on the formant engine", then "anything in that category that's using formant should be
redone. Formant sounds cool for what it should be used by, but none of those should be using it." 35 of the 59 Animal /
Monster presets were on wave 13; all 35 moved to the creature engine (wave 28), same names, sections and order. Heard as
labeled before/after (`soundtests/creature-redo/`) and **all kept**: "a big improvement" (animals), "significantly
better" (the family), "all named are better". Formant stays where it belongs: the 31 voice, choir and robot presets
elsewhere are untouched.

| Group | Sounds | How |
|---|---|---|
| Animals (8) | Distant Cluck, Cluck, Rooster Crow (+ a bantam alt), Duck Quack, Horse Neigh, Owl Hoot, Frog Croak, Bat Screech | one design each from the real call's structure; Rooster Crow and Owl Hoot are one creature call per syllable (layers); Horse Neigh is a whinny + a quiet second voice + a low nicker; Frog Croak a pulsed rattle (`crFlutter`) |
| Named monsters (4) | Goblin Chatter, Troll Grunt (+ an "uh-HUH" alt), Beast Roar, Monster Growl 2 | character pieces; Goblin Chatter is two voices trading vowels then a snicker (a `repeat` burst cannot change vowel); Monster Growl 2 is a rumble then a "RAH!" strike, so it peaks late where Monster Growl peaks early |
| The family (23) | Giant Growl … Guttural Growl | composed from two tables in `tools/proto/creature-redo-family.mjs`: an ADJECTIVE is a body (size, pitch, larynx) and a NOUN is a call shape (contour, mouth, vowel, envelope), so "Tiny Roar" is a small body roaring. No per-name overrides; only a computed level trim. The median pair distance rose 2.65 -> 3.32 and the closest pair 0.51 -> 1.01, so the near-duplicates `todo.md` worried about came apart rather than being purged |

**Level:** matched to the creature median, -15.9 LUFS (Distant Cluck 6 dB under on purpose). The formant takes played at
-2 to -7 LUFS, so these are 9-14 dB quieter than before, in line with the rest of the creature presets.

**Engine limits found on the way (not fixed):** Variations vary layer 1 of a layered sound only, so Rooster Crow and Owl
Hoot keep their `freq` vary within a semitone (a wider one detunes the first syllable from the rest); a `repeat` burst
cannot fade or change vowel; roughness doubles the period from ~0.25 up, so a rough call is heard (and pitch-tracked)
an octave below `freq`; breath follows the voice's level, so a pure hiss needs a noise layer.

## Fire redo (2026-11-12): 28 fires as layered builds

AJ's to-do said "Redo some of the fire ones too"; all 28 were redesigned and heard as labeled before/after
(`soundtests/fire-redo/`), and **all kept**: "all of the new ones sound better". The 24 Fire presets plus Campfire
Crackle (Nature; it was a plain oscillator), Crackling Fire, Dragon Fire Breath and Fireball Cast, in place.

**A fire is a stack, so each is 3-4 layers:** the ROAR is the weather engine's wind (its band brightens as the envelope
rises, so a flare brightens as it surges, with slow random swells; as layer 1 it also lets the Duration slider stretch
and makes Variations re-roll the fire through `wxSeed`); CRACKLE is the particle engine, sparse and **driven 0.25-0.4**
(undriven, peak normalization leaves only the biggest pop: 0.4 audible pops a second against 6-9 driven); HISS is dense
high-passed particles; and an EVENT layer: a blast-engine "foomp" for ignitions, whoosh for flares and passes, a friction
scratch for the match, bubble gloops for the molten ones, a creature growl under the dragon.

**The family (13)** is two tables in `tools/proto/fire-redo.mjs`, no per-name overrides: an adjective is the fire
(Searing white-hot and hissy, Kindled small twig snaps, Smoldering smoky and guttering, Blazing big with body, Molten
gloops and grit, Infernal huge and driven, Ashen dim and sparse) and a noun is the event (Ignite a catch then a bloom,
Flare a surge and fall, Torch a steady burn, Blaze and Flame sustained, Scorch a sear, Whoosh a pass).

**Level:** today's Fire section spanned 21.8 dB (-25.5 to -3.7 LUFS); the new ones sit on its median, -12.1, with
deliberate offsets (Ember Crackle -8 dB; Match Strike and Fire Sparks -3; the small/smoky ones -2; the infernos +1).
Four run past 2 s, all with weather as layer 1: Fire 2.5, Inferno Roar 3.5, Searing Blaze 2.38, Molten Flame 2.8.

**Engine limits found (not fixed):** particle pops come evenly spaced with jitter and never below 5 a second, while
real resin pops come in bursts; no engine makes a flame's irregular low throb ("puffing"); layer 1 cannot sit under the
others in the mix; the 4-layer cap is why Scorch's sear replaces the hiss. A dedicated fire model would add the throb
and the bursts; not built, since the existing engines carried every part.

## Horror and robot redo (2026-11-12): 67 sounds onto the newer engines

AJ: "What about robot and horror noises? Can we sweep those to see if our new engines suit them better?" Three designers,
labeled before/after (`soundtests/horror-redo/`, `soundtests/robot-redo/`), and every redesign **kept**: "all the horrors
sound quite good", "robots are all better too". This sweep, unlike the creature and fire passes, was told to KEEP where
today's sound is already the right lever, and did.

| Group | Redesigned | Kept, and why |
|---|---|---|
| Horror, named (29) | 27: heartbeats as impact lub-dubs at three tempos; the jump scares split into a slam, an orchestral stab (bowed strings a semitone apart) and a creature lunge; wails, moans, screams, the demon roar and the laugh on the creature engine; whispers as breath through a moving tract; Horror Drone and Tension Riser on the bowed engine; Nails on Chalkboard on friction; bells, chimes, chains and the Music Box on modal and bar | Dead Tone, Dread Pulse: abstract synthesis by nature |
| Horror family (31) | all 31, two tables in `tools/proto/horror-redo-family.mjs`: the NOUN picks the engine (Toll one free-ringing modal strike, Knell three muffled ones; Wail/Moan/Groan/Shriek/Murmur creature voices; Rattle bones; Stinger a slam + bowed screech; Pulse an oscillator throb with thuds), the ADJECTIVE the treatment (Hollow band-passed in a big room, Rotting crushed, Dreadful slower/lower with a sub, Forsaken distant, Cursed a tritone double + ring mod, Whispering all breath, Wretched ragged) | none |
| Robots (18) | 9: Power Up / Down as a matched servo pair (contactor, hum, gears up; coast-down and a clunk), Stomp (impact + blast weight + steel ring + a servo), Servo Twitch / Drone / Chime on the servo engine, Robot Talk as pitched chatter (it was six identical beeps, a twin of Robot Beep), Robot Yes / No with a quiet nod / shake servo under the unchanged word | the beeps and Robot Alarm (a beep IS a square wave), the three formant robot voices (synthetic voice is what formant is for), the three servo presets already picked by ear |

**Level:** horror on its section median (-10.4 LUFS), robots on Machine's (-7.3), with stated offsets (whispers and
transients under, jump scares over). Today's horror and robot oscillators were very loud (Nails on Chalkboard -0.8 LUFS),
so many new ones are 5-10 dB quieter than before.

**Engine limits found (not fixed):** the creature engine always voices, so a whisper is breath 1 plus a high-pass; a
burst cannot go under 1 a second and a layer's delay caps at 2 s, so a slow heartbeat or a funeral knell spends layers;
modal and bar strike identically each shot; the modal engine has no bell partial table (hum and tierce cost layers);
bowed tremolo thumps below ~50 Hz at slow strokes (a high-pass fixes it); the Limiter puts DC into low asymmetric
pulses; servo whine stops the instant power is cut (Power Down coasts on the geared type).

## The gap list (game sounds with no preset, 2026-10-29; a name check, so it overstates coverage)

- Shooter: ~~reload, shell casing~~ (round 3); dry fire, scope, hit marker skipped (conventions).
- Platformer: ~~double jump, checkpoint, dash~~ (round 2).
- Combat: ~~knockout, enemy death~~ (round 3).
- Objects / movement: ~~swim, crawl~~ (round 3), ~~wood break~~ (round 4).
- UI / puzzle: ~~slider / scroll, line clear, rotate~~ (round 3).
- Electric: covered by Transformer Buzz now; more (mains hum, neon) only if AJ wants them.
- One preset only (may or may not be good): stomp, ladder, bow, potion drink, chest, equip, summon, ricochet, rocket,
  crit, generator hum, helicopter, train, typing, achievement, grab / throw, barrel.
