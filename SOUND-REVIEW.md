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

## Doors / Containers redo (2026-11-12): 16 sounds built from the event

AJ: the category is "pretty weak"; heard as labeled before/after (`soundtests/doors-redo/`) and every redesign kept:
"doors are quite a bit better". The impact engine is noise only, so a knock or a slam had no wood or steel in it; each
redesign is the object's sequence of events with a real body under the hit: knock / slam / cabinet on modal panels
(~140-260 Hz) plus latch and frame rattle (Door Knock alt: a steel door); Wooden Door Open and Chest Open as latch,
hinged-wood friction creak, swing or lid thump; Vault Door as a geared servo bolt, a deep clunk, the steel ringing and an
iron hinge groan (2.95 s); Latch Click, Lock Bolt (pins, then the bolt), Safe Tumbler (detents, then the gate), Chain
Clink and Key Jingle (four keys at their own rates) as small modal metal; Metal Locker and Cell Door Clang without
today's sustained noise bed; Shop Bell as one shop bell and its clapper (today's ding-dong read as a doorbell); Drawer
Slide (runners, stop, contents); Sliding Door as an automatic door's servo and seal thud (alt: pushed by hand).
**Kept:** Wood Break, Chair Scrape, Heavy Gate, Trapdoor Creak (picked by ear), Elevator Ding (a chime is the idiom).
**Level:** today's median -9.6 LUFS; transients landed under it with the Limiter capped at 0.4 (Door Slam -14.9), and
Metal Locker / Latch Click are ~8 dB quieter than today's hot versions.
**Found on the way:** modal partials start at phase 0, so a modal hit needs noise or an impact layer for its strike;
410 preset values sit outside their PARAMS ranges (mostly an open filter at 13-20 kHz, long stretch-engine durations,
long bell decays, creak holds), which play as written but are clamped by Variations, Breed and the macros.

## Sci-Fi & Hazard redo (2026-11-13): 38 sounds, hazards physical and devices synthetic

AJ: the category is "pretty weak"; heard as labeled before/after (`soundtests/scifi-redo/`) and every redesign kept:
"they're all better". Judged two ways. HAZARDS are physical: Gas Leak, Gas Puff and Steam Vent as weather-wind jets with
edge-tone whistles and hiss; Toxic Bubble, Acid Splash and Acid Sizzle on flow, bubble and driven particle; Meteor
Descent a late-peaking roar with burning crackle ending in a blast (3.18 s); Comet Whoosh a pass with a sparkling tail;
Tesla Coil narrow driven 120 Hz pulses with spark snaps. DEVICES stay synthetic, redesigned within that idiom: Laser 2 a
damped-spring "pew" blaster, Laser Charge a ratcheting FM whine into the shot, Warp Drive / Warp Drive 2 engage and drop
out, Teleporter Hum, Force Field, Flying Saucer, Vortex Whoosh, Energy Drain, Scan Complete. **The 19 bred names**
(random July patches) are two tables in `tools/proto/scifi-redo.mjs`: the adjective is a treatment plus a signature layer
(Ionized sparks, Photon a glockenspiel glint, Reactor a servo plant hum, Toxic gloops, Warp a whoosh rush, Alien an FM
voice, Radioactive Geiger ticks, Quantum an octave stutter), the noun the event (Charge, Surge, Beam, Scan, Whoosh, Drip,
Leak, Alarm, Hum, Field, Pulse). **Kept:** Laser (the classic sweep), Sci-Fi Brass, Slinky, Ping-Pong Pluck.
**Level:** today's median -8.9 LUFS with an 18.6 dB spread; many of today's were loud bred noise beds, so Gas Leak,
Photon Drip and Ionized Alarm are 8-9 dB quieter. Closest pair 0.41 -> 1.49.
**Same day, the range fix:** Breed, Variations and the macros clamp each value to its row widened to include the sound's
own value, so the 410 values past their sliders survive a change (row `ranges/…`, which fails without it).

## The glass engine (2026-11-13): glass and ceramics breaking and clinking, wave 36

Glass Shatter was a triangle at 2.4 kHz buried in crushed noise with an echo (it had beaten three modal / particle builds
blind in the care pass: a modal bank rang like a bell), Glass Clink the modal bank, and nothing modeled what a breaking
object DOES. The prototype, "glass" (`tools/proto/glass.mjs`, rounds in `soundtests/proto-glass/`), builds it from one
strike: the contact pulse (a fist's 1.5 ms is a dull knock, a stone's 40 us rings every mode), the intact object's own
modes (a vessel's shell modes in warbling pairs, a pane's dense plate modes from a low whump, a solid's sparse ones; the
material's loss sets the ring), then, if it breaks, a train of crack snaps and a fizz of micro-cracks with the body's ring
choked, and N PIECES, each a tiny plate ringing at its own pitch (smaller is higher and shorter), born ringing, jostled as
they part, flying, landing at their flight times and bouncing as balls do (the gaps shrinking), a big piece breaking again
as it lands, the big ones rocking to rest and sliding. Materials glass, crystal, porcelain, clay, ice. Five blind rounds:
Glass Shatter and Glass Clink against today's presets, and three gaps (Window Smash, Bottle Break, Pot Smash) against the
best layered build of today's engines, three interpretations each.

**AJ's picks: the model won every gap and Glass Shatter, and tied Glass Clink.** Glass Shatter A, C, D (every model take;
today's preset, B, dropped); Window Smash B, C; Bottle Break A, B, D; Pot Smash A, B, C; Glass Clink all four, today's
preset (C) included, so it stays the base and the three model takes join as alts.

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Glass Shatter | **dropped tumbler** (a drinking glass on tile: the tick, its ~1.27 kHz ring choked as it breaks, ~35 pieces bouncing over ~0.35 s) | thrown at a wall (~150 pieces and ~135 re-breaks raining onto stone to ~1.1 s), crunched in place (short and crunchy, 0.6 s) |
| Glass Clink | today's preset, unchanged (modal, 0.3 s) | crystal wine toast (warbling, 1.6 s), champagne flutes (nearly one beating note), two tumblers held in the hand (damped) |
| Window Smash (NEW, Explosions) | **stone through** (a 4 mm pane's 70 Hz whump, a train of snaps, ~90 pieces and ~100 re-breaks dropping out of the frame to ~1.2 s) | a small pane punched (a dull fist, pieces onto a wooden floor, 1.0 s) |
| Bottle Break (NEW, Explosions) | **dropped on concrete** (thick glass: the ~890 Hz body bonk, ~27 chunky pieces bouncing hard) | a thrown potion (bright crack, a quick bright rain), smashed over a table edge (a dull heavy blow, dull landings on wood) |
| Pot Smash (NEW, Explosions) | **off a shelf** (a porcelain vase: a ~645 Hz hollow ring, a gritty crunch, chunky pieces clattering and sliding) | a big earthenware urn (the heaviest, chunks that clunk), a clay pot smashed by a sword (dry, gritty, quick) |

**How close the presets are to what AJ heard:** the engine is the prototype's maths, sample-identical on all 15 model
takes, and each version names its take's seed (`glSeed`). The chassis mirrors the round: no drive, gain 1, the round's
reverb, and the filter OPEN as a 40 Hz Butterworth high-pass (the chain's filter cannot be bypassed; blast's 12 kHz
low-pass took 16-24% off every take's centroid, since the fizz lives at 4.5-15 kHz). Through the exported engine against
the takes: centroid within 1.3% (Bottle Break's base 4.0%, see Level), share above 4 kHz within 3 points, loudness at the
take's own peak within 0.85 dB, the 50 ms loudness curve within 0.00-0.63 dB RMS after one offset, except Glass Shatter's
crunch alt (3.1 dB: its body matches within 1 dB but the tail sits 2-5 dB lower, because the round's limiter ran AFTER
the reverb and lifted it) and Bottle Break's table-edge alt (1.6 dB, its last 50 ms: the round's end fade also ran after
the reverb).

**Peak control, as blast's:** a break is peaky (the crack, the pieces parting together), so eight of the picked takes
needed the app's Limiter to reach -18 LUFS. `glPeak` (0-2) is the app's own limiter on the glass alone, before the chain
(one pass to 1, a second past 1), so `gain` stays a plain level after it and Variations can level a pack (the web row
checks a Glass Shatter, Window Smash and Pot Smash pack: within 1 dB). No glass preset uses the master Limiter.

**Level:** the shipped buffered engines' presets (weather, blast, friction, flow) measure a median -16.5 LUFS with
Normalize on, so the bar is -18.5 .. -14.5. Each version keeps the round's limiting where it lands inside and otherwise
takes the smallest 0.05 step of glPeak that does: Glass Shatter -18.4 (0.3) / -17.9 (0.25, round 0.2) / -18.4 (0.65,
round 0.6); Window Smash -15.2 / -15.1 (0); Bottle Break -18.1 (0.1, round 0) / -16.6 (0) / -18.4 (0.5); Pot Smash -18.1
(0.35, round 0.3) / -18.4 (0.65, round 0.6) / -18.4 (0.15, round 0.1); Glass Clink's alts -17.8 (0.1) / -18.3 (0) /
-16.0 (0). Peaks 0.90, no DC. With Normalize off `glassLevel` sits them at -15.9 .. -21.5. **Open for AJ: Glass Clink's
kept base renders at -6.2 LUFS, 10-12 dB louder than its alts**, so repeat clicks jump in level. Flow's rule (each alt
within 1 dB of a kept base) would need glPeak ~1.8 on the wine toast, which flattens the ring (its loudness curve moves
6 dB); the alternative is a lower gain on the base, which changes a preset AJ kept as it is.

**Open:** Glass Ping, Teacup Ting and Ice (Magic) are the obvious next round on this engine (a tap, a ceramic ting, ice
cracking); the Explosions' urban debris (`blastDebrisType` 2) could borrow the pieces. A crack that does not
end in a break (a pane cracking, a glass splitting) is reachable with Break around 0.2-0.4 but untested by ear.

## The crowd engine (2026-11-13): chatter, cheering, applause, reactions and chants, wave 37

A crowd in the app was one voice or one texture standing in for many: Crowd Cheer one formant voice holding an "ah"
with some noise, Crowd Applause the particle engine's even crackle, Chant Loop one voice repeated, and no chatter or
audience reaction at all. The prototype, "crowd" (`tools/proto/crowd.mjs`, rounds in `soundtests/proto-crowd/` and
`soundtests/proto-crowd-2/`), is MANY people, each doing their own thing: they stand round the listener at 0.9 a square
metre (or a distance off), so a near voice's level is set by the density and a bigger crowd is only a little louder
but much thicker; the nearest 28 are voices (a jittered saw through a 5-formant tract, a register and a pace of their
own), planned in phones and phrases and talking in conversations (one speaks, the others listen and say "mm"), or
calling out (a cheer's aah / yeah / woo / hey, ooh, aww, boo, a voiced gasp, a laugh), or chanting on a shared beat,
smeared by where each one stands; the rest are a statistical bed whose flicker fades as 1/sqrt(members). The nearest 32
clappers are hands (flat palms bright, cupped hands with a low pop), each at its own pace; the far ones a stream of the
same claps and a band of noise. Whistles at random people. A swell (start, peak at, end) is who has joined. Levels are
measured, not assumed (a reference voice and clap, calibrated once per sample rate).

**AJ's picks, round 1** (five sounds, three model takes each against today's preset or the best layered build): cheers,
applause and chants WON. Crowd Cheer A, B, D (every model take, today's preset dropped); Crowd Applause the theatre
(400 people); Stadium Chant "HEY" on every beat and "de-FENSE" (clap-clap-hey not). Chatter and the gasp did not: talk
was "everyone is making the same syllable noise" (busy-tavern "the least odd"), the silent inhaled gasp "odd in
general" (gasp-into-ooh only if forced). **Round 2** rebuilt talk (phones joined phone to phone, phrase contours,
conversations) and the reactions (a VOICED gasp, an ooh and an aww that read alone, a sweet aww appended), and AJ
picked the market (200 people) for chatter, the 2000-strong arena gasp, the theatre and stadium ooh, and the theatre,
stadium and sweet aww. **The bigger crowd won every time**: the 14-person small-group applause, the 30-person
small-room ooh, the nine at a quiet dinner and the 28-voice busy tavern all lost to a bigger crowd of the same sound
(only the 35-person party cheer made it, as an alt). Small close groups, where every voice is individual and the
model's talk is heard with no bed under it, are the known weak spot.

| Preset | Base (what every other reader of PRESETS uses) | Alts |
|---|---|---|
| Crowd Cheer (REPLACED) | **in the stands** (2500 people shouting aah / yeah / woo / hey, some clapping and whistles, swelling from a third to everyone at 1.2 s and settling) | from outside the stadium (3000, 74 m off: a dark "AAAH" roar), a party (35, every voice individual, lively clapping) |
| Crowd Applause (REPLACED) | **a theatre** (400 clapping, each at their own pace, joining in half a second and dropping out to a tenth, a few woos) | none |
| Stadium Chant (NEW) | **"HEY!" on every beat** (2500, 118 BPM, 90% together, clapping) | "de-FENSE" (3000, 100 BPM, claps filling the rests) |
| Audience Ooh (NEW) | **a theatre** (300, each once: "oh-ooh" climbing and sliding down) | a stadium (2500, shouted) |
| Audience Aww (NEW) | **a theatre, let down** (300, a falling "aww" ending in a sigh) | a stadium let down (2500), a sweet "aww" (120, rising and falling, soft) |
| Audience Gasp (NEW) | **an arena** (2000, a voiced "HUH!" within 0.15 s, the room ringing after) | none |
| Crowd Chatter (NEW) | **a market** (200, the nearest 28 in pairs and threes, haggling, the rest a bed; open air) | none |

All seven sit in Crackle / Particle beside where Crowd Cheer and Crowd Applause were; the picker's Voice row holds the
engine. Chant Loop, Alien Chatter, Goblin Chatter and every other preset are untouched; nothing (Foundry, Wizard,
STYLES, fixtures, tests) named the two replaced presets.

**How close the presets are to what AJ heard:** the engine is the prototype's maths, sample-identical on all 13 shipped
takes, and each version names its take's seed (`cwSeed`). The rounds rendered each crowd for its length and then 0.9 s
more for the room to ring. A row does that here, **Ring-out** (`cwTail`, 0-2 s, default 0): the crowd lasts the
Duration less it, and the amp envelope's release lands where the CROWD stops, so a 3.5 s cheer is a 4.4 s preset whose
last 0.9 s is the stadium's reverb. (Without it the takes could not be reproduced inside the rows: the envelope's
release always ends at the Duration, and holding the crowd silent for the tail would need a Hold far past its 1 s
row.) The chassis mirrors the round: no drive, the round's reverb, width 0.85, the filter OPEN as glass's 40 Hz
Butterworth high-pass, the round's raised-cosine envelope as the app's linear attack and release (20 ms / 0.3 s; the
chants 0.12 / 0.4, the market 0.35 / 0.4). Through the exported engine against the take WAVs: centroid within 1.1%
(de-FENSE 3.1%, below), loudness at the take's own peak within 0.47 dB, the 50 ms loudness curve 0.01-0.03 dB RMS on
the round-2 reactions and 0.3-1.3 dB on the busier beds (the cheers and chants are rendered by an engine round 2 moved,
below; the market's worst frame is its first 50 ms, where a linear 0.35 s attack sits ~9 dB over the round's raised
cosine; elsewhere the worst frame is the last 50 ms, the app's 256-sample end fade against the round's 60 ms).

**Round 1's takes on round 2's engine:** round 2 changed talk, and the cheers and chants have a few near people talking
between the shouts, so those five takes moved (the applause did not: its 3% voices all call). The cheers stay within
1.1% of their centroid at the default Group size (correlation 0.96-0.99 with the files AJ heard). **The chants were
further out** (hey-hey-hey's centroid +8.7%, de-FENSE +12.1%: the talkers between the beats now take turns, so the
chant reads brighter), and AJ picked the round-1 texture, so **Stadium Chant ships with Group size 0** (everyone talking
on their own, round 1's density): centroid +0.6% / +3.1%, the long-term third-octave spectrum within 0.99 / 0.58 dB
(2.17 / 1.10 at the default), the 50 ms curve 1.19 / 0.91 dB RMS (1.33 / 1.17). Sample correlation is a hair lower at
Group size 0 (0.88 / 0.93 against 0.91 / 0.94: the chanters are the same samples either way and the talkers differ
either way), so the texture, not the waveform, decided it.

**Peak control, as glass's:** `cwPeak` (0-2) is the app's limiter on the crowd alone, before the chain; no crowd preset
uses the master Limiter. Only the applause needed it (the round gave it the Limiter at 0.1, after the reverb): 0.12
here, the smallest 0.01 step inside the level bar, 0.46 dB off the take at matched peak (0.15 would be 1.0 dB off).

**Level:** the bar is the buffered engines' median, -16.5 LUFS +-2 with Normalize on. The crowds come out loud (their
crest is low), so each version's `gain` brings it to -16.5 (0.58-0.87; the chant's base and the gasp land inside at
gain 1, -17.2 and -16.6) and the applause sits at -18.4 with its Peak control. Every base and its alts within 0.7 dB.
Peaks 0.52-0.90, |DC| under 3e-7, every value inside its PARAMS row (Duration past 2 s, as the stretch engines'):
Duration stretches for wave 37 (`DUR_STRETCH`); not in VARY_STRETCH (the crowd is laid out over the buffer).

**Open:** small close groups (a few friends clapping, a dinner table) are the weak spot to come back to; Chant Loop (one
formant voice) could become a chant on this engine; Goblin Chatter and the Murmurs are creature voices, not crowds, and
stay as they are.

## Nature, Magic and Cartoon redo (2026-11-13; the last three before SFX 1.3.0)

Three proposal rounds in parallel (`tools/proto/{nature,magic,cartoon}-redo.mjs`, `soundtests/*-redo/`), applied with
`tools/replace-presets.mjs`. AJ: Nature "literally everything is a massive improvement"; Magic "Everything is better.
Wow."; Cartoon "better for sure, but less of a dramatic improvement. Fart made me laugh though".

- **Nature:** 22 bases replaced (Water Ambient, Rustling Leaves, and the 20 bred names, which were random breeds whose
  sounds did not match their names), 8 kept bases gain alts, 14 kept as is.
- **Magic:** 43 replaced (elements on their physical engines; the 26 bred names as voice x gesture), today's sound kept
  as an alt on 24; 7 kept bases gain one alt; Fireball Cast unchanged. Healing Aura and Radiant Aura had been note-for-
  note copies of two pads, so their originals were dropped.
- **Cartoon / Misc:** 33 replaced (the real objects on friction / glass / flow / particle, slide whistles on the flute
  engine, the 16 bred names as object x performance), most with today's sound as an alt; 3 kept bases gain alts; 8 kept.
  **Seagull Squabble** appended: the crowd round's creature-engine control take, verbatim, plus a gull-sized alt.

**Open:** four spring picks (Springy Boing, Cartoon Boing, Doorstop Spring, Spring Tank Crash) sit ~11 dB under the
Cartoon median; a handful of thunder takes land 2-4 dB short rather than being limited (low end, DC).

## The gun engine (2026-11-13): gunshots designed for games, wave 38

**Why it exists.** AJ built the Crunchy suite in the first place for crunchy gunshots in a game, and the guns were the
weakest thing it had: every Gun preset sat on the impact engine (one hit's envelope, a burst being Repeat re-gating that
one envelope on a grid), and the blast engine (31) is the physical model, which gives what a microphone down the street
hears rather than what a game wants under the trigger. The prototype, "gun" (`tools/proto/gun.mjs`, rounds in
`soundtests/proto-gun/`), is a gunshot as a game sound designer builds one, layer by layer: a hard-clipped SNAP, a
pitch-dropping BODY under the muzzle pop, the GAS roar, a saturated CRACK (a short barrel's boxy bark, a long barrel's
supersonic N-wave), the ACTION's own metal (slide, hammer, a rifle's carrier every round, a belt-fed's open bolt), an
optional SUPPRESSOR, the PLACE as a geometry-built impulse response, then its own crunch stage (saturation, a compressor
on the shot, a soft clip, optional bits and rate cut). A burst (Fire rate, Rounds) re-fires the WHOLE shot every round,
each with its own noise, pitch, level and timing, the mechanism cycling and the tails building, so gun presets keep
Repeat at 1. The port (`dsp.js` `makeGun` / `gunCfg` / `gunLevel`) is sample-identical to the prototype on all 21
takes; 21 rows in a Gun group, drawn only by wave 38 (`DRAWN_IF_USED`), in the Foley family beside Blast, Duration
stretching to the bursts (`DUR_STRETCH`), not in VARY_STRETCH (a take keeps the preset's length).

**The blind result: 8 of 8.** Every round put the model's takes against today's preset (and a blast take where it had
one), unlabeled, and AJ picked a model take every time; no pick was today's preset or a blast take
(`soundtests/PICKS.md`, "Gun engine"). The pattern in the picks is the design brief from here on: **crunchy-arcade for
handguns** (Gunshot, Magnum Shot, Suppressed, and the Shotgun's alt), **hyper-real for long guns** (Rifle Crack, the
Shotgun's base), and **the middle point for automatic fire** (Full Auto running dry indoors, 3-Round Burst on a street,
Machine Gun the heavy belt-fed).

**The no-after-sound rule.** The shotgun round's takes sounded good "BUT… almost a drum sound afterwards": the pump
rack and the hull landing. AJ's rule: **no after-sound is layered on a shot** ("if the user wants something like that
they can add it themselves"). So Casings default to 0 and every gun preset keeps them at 0, and a pump or a bolt (which
racks AFTER the shot) carries Mechanism 0; a mechanism sounding WITH the shot (a slide, a hammer, a carrier) is fine.
The one exception is Full Auto's run-dry click (Empty click 0.8), which AJ picked. The web suite holds the rule.

**The redo picks** (`soundtests/guns-redo/`, labeled now/new): ten of the twelve other guns moved onto the engine —
Compact Fire, Gunshot 2, Heavy Discharge, Heavy Round, Magnum Fire, Shotgun 2, Snub Discharge, Snub Report, Suppressed
Crack, Suppressed Fire. AJ kept today's Burst Round and Rifle Crack 2, so those two stay on the impact engine
(`tools/new-presets/guns-redo-picked.json` is the ten that were applied).

**Levels.** The JSONs came out of the prototype at -18.5 to -14.5 LUFS (Normalize on, as the app plays them), while
today's guns on the impact engine played at -9.3 to -11.8 (the singles) and -6.1 to -9.0 (the bursts), measured from
the last commit's presets. AJ agreed to raise the new guns to about that, handguns and the suppressed a little under,
the heavy guns and the autos at the top, with the engine's Peak control (`gunPeak`, the app's limiter on the gun alone)
and `gain`, never the master Limiter. Two limits held it short: `gain` tops out at 1 (its row, and Normalize already
puts every peak at 0.90), and Peak control stops at 1.2, past which the squeeze is audible. A shot is almost all
spike, so most of these sit at the 1.2 ceiling and still land under the old guns:

| Preset | LUFS (was) | Peak control | Today's |
|---|---|---|---|
| Full Auto | -9.9 (-14.6) | 0.4 | -6.1 |
| Machine Gun | -10.8 (-14.7) | 1.1 | -6.4 |
| Suppressed Fire | -11.5 (-15.6) | 0.3 | -8.2 |
| Shotgun (alt) | -12.1 (-18.4), alt -11.5 (-18.0) | 1.2 | -11.6 |
| Rifle Crack | -11.6 (-18.2) | 1.2 | -11.5 |
| 3-Round Burst | -11.6 (-17.5) | 1.05 | -9.0 |
| Magnum Fire | -11.9 (-17.7) | 1.2 | -14.5 |
| Magnum Shot | -12.1 (-18.3) | 1.2 | -10.8 |
| Heavy Discharge | -12.1 (-17.6) | 1.2 | -11.8 |
| Snub Report | -12.1 (-18.4) | 0.95 | -10.5 |
| Gunshot 2 | -12.3 (-17.8) | 1.2 | -9.3 |
| Shotgun 2 | -12.6 (-18.0) | 1.1 | -9.7 |
| Snub Discharge | -13.7 (-18.4) | 1.2 | -10.3 |
| Suppressed Crack | -14.2 (-18.4) | 1.2 | -10.3 |
| Heavy Round | -14.7 (-18.3) | 1.1 | -11.8 |
| Compact Fire | -14.8 (-17.7) | 1.2 | -9.7 |
| Gunshot | -14.9 (-18.3) | 1.1 | -9.8 |
| Suppressed | -18.3 (-18.4) | 0.4 | -11.5 |

Every one at gain 1, peak 0.90, no clipping, |DC| under 4e-7; the Peak control is the loudest point on a 0.05 grid up to
1.2 (where Peak control is not monotonic, the smaller value within 0.2 dB), or the smallest that reaches the target
within 0.5 dB. **Short of today's:** the autos by 2.6-4.4 dB, the crunchy handguns (Gunshot, Compact Fire) by about 5,
Heavy Round by 3, and **Suppressed by 7**: its peak sits 12 ms in, in the "pfft", and Peak control barely moves it
(-19.5 LUFS at 0, -18.1 at 1.2; 0.4 is within 0.2 dB of that). Getting the rest of the way needs a lower crest in the
shot itself (more body under the spike, or a harder squeeze in the crunch stage), which is a sound change for AJ's ear,
not a level change.
Variations of a gun level like any other (a pack within 1 dB, peaks under -2.9 dBFS; held by the web suite).

## The energy engine (2026-11-13): plasma, rail, pulse and ion, wave 39

**Why it exists.** The sci-fi guns had no model of what an energy weapon does: Plasma Rifle was a falling saw with a ring
mod, Plasma Shot a noise-and-boom patch, Plasma Discharge a bred patch with a 75 ms fade-in (no front at all), Rail Fire
the impact engine with a ring mod. The prototype, "energy" (`tools/proto/energy.mjs`, rounds in
`soundtests/proto-energy/`), builds one the way it happens: an optional CHARGE (a capacitor whine climbing its charge
curve over a coil hum), the DISCHARGE with a hard transient (plasma a dense FM burst dropping in pitch; rail a slam, the
slug's supersonic crack and the rails ringing with an electric zap, or a coilgun's coils firing in turn; pulse a clean
band-limited packet; ion an arc of crackle and buzz), the BOLT leaving (a whine whose doppler is real geometry, or a
railgun's air tear), the RECOIL's kick, the AFTERGLOW (sizzle, coils cooling, a vent), and its own crunch: the shot and
the kick through one 4x oversampled saturator together, the snap, crack, charge, bolt and afterglow outside it. Rate and
Rounds re-fire the whole shot every round, with Heat sagging the pitch through a burst, so energy presets keep Repeat at
1. The port (`dsp.js` `makeEnergy` / `energyCfg` / `energyLevel`) is sample-identical to the prototype on all five picked
takes (the take's seed is `enSeed`); 15 rows in an Energy group, drawn only by wave 39 (`DRAWN_IF_USED`), in the Foley
family beside Gun, Duration stretching to the charged and automatic ones (`DUR_STRETCH`), not in VARY_STRETCH. The crunch
stage is the cost: 28-34 ms of CPU per second of audio, the same as the prototype.

**The blind result: 5 of 5.** Every round put three model takes (heavy military, chunky arcade, sleek clean) against
today's preset, or for the full-auto gap the best build of today's engines, and AJ picked a model take every time
(`soundtests/PICKS.md`, "Energy engine"): Plasma Rifle the heavy military rifle, Plasma Shot the snappy pistol, Plasma
Discharge the arc discharge (an ion arc after a 0.5 s charge), Rail Fire the heavy railgun (a 0.9 s charge, the slam, the
crack), and a NEW preset, **Pulse Rifle** (Guns, after Rail Round): the military pulse rifle, 14 rounds at 10 a second,
heating through the burst. Each preset carries its round's room as the app's own Reverb, as the takes were heard.

**Levels.** The takes came out at -9 to -20 LUFS with Normalize on (the charged ones lowest: the charge is in the
measurement), against today's at -11.8 to -16.6. Matched to the guns (about -10 to -12; the auto at the top, the
pistol a little under) with Peak control (`enPeak`) and `gain`, never the master Limiter; the rule is the gun port's (the
smallest Peak on a 0.05 grid within 0.5 dB of -11, else the loudest up to 1.2, taking the smaller value within 0.2 dB):

| Preset | LUFS (Peak 0, gain 1) | Peak control | gain | Today's |
|---|---|---|---|---|
| Pulse Rifle (new) | -10.0 (-9.1) | 0 | 0.9 | (none) |
| Plasma Rifle | -11.3 (-15.3) | 1.1 | 1 | -13.5 |
| Plasma Shot | -11.5 (-9.3) | 0 | 0.78 | -16.6 |
| Rail Fire | -12.4 (-20.1) | 1.15 | 1 | -11.8 |
| Plasma Discharge | -15.2 (-17.8) | 1.2 | 1 | -14.2 |

Peaks 0.70-0.90, no clipping, |DC| under 2e-5. **Short:** Plasma Discharge by about 4 dB: the arc's crackle is a field of
spikes over a long sizzle, and at Peak control 1.2 it is still -15.2 (it was -14.2 today); closing it needs a lower crest
in the sound itself (more body under the arc, or a harder crunch), which is a sound change for AJ's ear, not a level
change. Rail Fire sits 0.4 under the band (1.2 buys 0.1 dB more). Variations of an energy sound level like any other (a
pack within 1 dB, peaks under -2.9 dBFS; held by the web suite).

## The chip gun engine (2026-11-13): retro console gunshots on three machines, wave 40

**Why it exists.** AJ built the suite because a generic retro generator "couldn't make satisfying gunshot sounds": it
draws white noise and a square wave and crushes them, and that is exactly what the console guns were (Woodgrain Shot a
square under 70 % noise crushed to 3 bits, Mega Shot an FM tone under noise with a ring mod, 8-Bit Laser a swept pulse).
What made a console gunshot crunchy was the HARDWARE, played by the game's sound driver once a video frame. The
prototype, "chipgun" (`tools/proto/chipgun.mjs`, rounds in `soundtests/proto-chipgun/`), builds three machines and
describes them by their sound: an **8-bit console** (two pulse channels, a triangle and a 4-bit noise channel: the hiss
stepped darker every frame at a volume that stairs down, a triangle kick rewritten per frame that halts on a step, the
chip's own nonlinear mixer), an **FM console** (operators fed back on themselves into grit, a square-wave noise chip swept
beside them in 2 dB steps, a 9-bit DAC) and a **16-bit sampler** (a clean shot "recorded" by the engine, stored small as
4-bit ADPCM and played back at the wrong pitch, with the hardware echo). Rounds fire ON FRAMES and re-trigger the same
channels, so full auto is machine-tight and cuts its own tail every round, and chip gun presets keep Repeat at 1. The
port (`dsp.js` `makeChipgun` / `chipgunCfg` / `chipgunLevel`) is sample-identical to the prototype on all five picked
takes (the take's seed is `cgSeed`; the prototype's second seed was 0 in every take and is written in as 0); 16 rows in a
Chip gun group, drawn only by wave 40 (`DRAWN_IF_USED`), in the Foley family beside Gun, Duration stretching to long
bursts (`DUR_STRETCH`), not in VARY_STRETCH. Mono, as the machines were: every preset is centered. AJ keeps both kinds
of gun ("I'm happy to have both types in there"): the Guns section is the gun engine's, the console guns are this one's.

**The blind result: 4 of 4.** Every round put three model takes (the same gun on each machine) against today's closest
preset, and AJ picked a model take every time (`soundtests/PICKS.md`, "Chip gun engine"). **Three of the five picks are
the FM machine**: the pistol (now **Woodgrain Shot**), the shotgun (now **Mega Shot**) and the second full auto. The laser
went to the 16-bit sampler's crunched blaster (now **8-Bit Laser**), and the full auto to two archetypes, a NEW preset
**Chip Machine Gun** (Consoles / Chiptune, right after Woodgrain Shot): the 8-bit chip at 15 rounds a second as its base,
the FM chip at 12 a second as its alt. Each replaced preset keeps today's sound as its alt, so a repeated click still
finds the synth'd version. The machine-gun round's control (the Guns section's Machine Gun) is a gun-engine preset now
and stays as it is.

**Levels.** Matched to today's own presets (Normalize on, as the app plays them, measured from the last commit's
presets) with Peak control (`cgPeak`) at gain 1, never the master Limiter; the rule is the gun port's (the smallest
Peak on a 0.05 grid within 0.5 dB of the target). Chip Machine Gun is matched to Woodgrain Shot beside it, the loudest
console gun (the section runs -16.3 to -3.7, median -9.2):

| Preset | LUFS (Peak 0, gain 1) | Peak control | Its alt (today's) |
|---|---|---|---|
| Woodgrain Shot | -8.2 (-13.2) | 1.15 | -8.0 |
| Chip Machine Gun (new) | -8.5 (-9.5) | 0.4 | -8.2 (the FM take, Peak 0.1) |
| 8-Bit Laser | -12.3 (-15.7) | 0.95 | -11.8 |
| Mega Shot | -12.4 (-18.6) | 0.7 | -12.0 |

Every base within 0.5 dB of its alt, so a click does not jump; peaks 0.90, no clipping, |DC| under 4e-6, L and R
identical. **Nothing short.** Variations of a chip gun level like any other (a pack within 1 dB, peaks under
-2.9 dBFS; held by the web suite, with the rule that no chip gun label, enum or help line names a console or a chip).

## The gun foley engine (2026-11-13), wave 41

**Why it exists.** The gun engine makes the shot, and AJ's rule is that a gun preset carries no after-sound, so
everything a game puts AROUND the shot is what a user layers on afterward: the reload, the bolt, the rack, the cylinder,
the dry click, the casing hitting the floor, the ricochet, the bullet going past. Those were the weakest guns left:
Shell Casing was the modal engine's 2.6 kHz ping repeated three times, Ricochet Zing a sawtooth sweeping down through
an echo, Bullet Whiz the blast engine downrange, Bolt-Action Reload layered impact clicks with a casing ping, and
nothing at all owned a revolver or an empty gun. The prototype, "gun foley" (`tools/proto/gunfoley.mjs`, rounds in
`soundtests/proto-gunfoley/`), models a gun's mechanism as small steel and polymer PARTS meeting inside a BODY: every
contact a half-sine force pulse whose length is the contact time (steel on steel ~40 us, a palm on a baseplate ~2.5 ms)
driving the part's own resonator bank and, through the joint, the polymer, steel or wood-and-steel body and the weapon's
thump in the hand; slides as friction along a rail, springs as a coil's dispersive "ting", hands on the grip; a script
with human timing per Action. Casings are brass tubes (or a plastic hull) bouncing with shrinking, physical gaps on
concrete, wood, dirt or steel; a ricochet is the hit and then the tumbling slug's whistle through the exact Doppler of
its path; a bullet pass is a supersonic N-wave with its ground reflection, or a subsonic whiz.

**The port** (`dsp.js` `makeGunfoley` / `gunfoleyCfg` / `gunfoleyLevel`) is sample-identical to the prototype on all
six picked takes, through the shipped presets' own values (the take's seed is `gfSeed`; the prototype's second seed was
0 in every take and is written in as `GF_SEED_MIX`): 21 rows in a Gun foley group, drawn only by wave 41
(`DRAWN_IF_USED`), in the Foley family beside Energy, Duration stretching past 2 s (`DUR_STRETCH`), not in VARY_STRETCH.
The ten actions are all in the Action row, the bolt RELOAD (with Load and Rounds) included. **The Doppler solve is
bounded**: the prototype solved the emission time for every sample of its 3.5 s buffer although the ricochet stops
reading at the whistle's end and the subsonic pass at 40 m past; the port stops the (sequential) solve at that sample,
so every sample it does solve is the same and nothing after it is read. Best of 8, the subsonic whiz goes from **38.8 to
7.6 ms of CPU per second of audio** and the ricochet from 24.5 to 13.1; the mechanisms are 3-9 ms/s, as before.

**The blind result: a model take in six of nine rounds, and two controls kept.** Every round put three model takes
against today's preset or, for the three gaps, today's closest stand-in (`soundtests/PICKS.md`, "Gun foley engine").
Picked: Shell Casing C (a pistol case on concrete), Ricochet Zing B (a ricochet off stone passing ~15 m off), Bullet Whiz
C (a subsonic pass at 1.5 m), Revolver Spin C (spun and flicked shut) and Dry Fire A (a striker-fired polymer pistol), and
in the bolt's second round **Bolt-Action Reload** B, the single round ("a bolt action is a single shot rifle and the
others imply that multiple bullets are being loaded"): the bolt snapped back, the case pinging out of the port, one round
dropped in, the heavy ka-CHUNK close. The first bolt round had no pick (its takes cycled the bolt; nothing was loaded).
**The two controls kept are a valid result**: AJ picked today's Quick Reload in its own round and again as the stand-in
for the pump-shotgun rack ("I know it's the control, but it just sounds better"), so Quick Reload stays exactly as it
was and is the pump rack too: no duplicate preset, and `pump` and `rack` find it in the search. `empty` and `click` find
Dry Fire, `revolver` and `cylinder` Revolver Spin (click keeps its UI meanings first). Revolver Spin and Dry Fire are new,
in Guns right after the reloads. Each preset carries its round's room as the app's own Reverb (a small bench room, or a
little outdoor air for the ricochet and the pass). Shell Casing and Revolver Spin vary without a new seed: another seed
can bounce the case or spin the cylinder past the Duration, so their `_vary` moves only the drop, weight, crispness
and tempo.

**Levels.** Today's presets play (Normalize on) at -12.3 (Quick Reload) and -12.9 (Bolt-Action Reload); Ricochet Zing
at -10.2, Bullet Whiz at -20.1 and Shell Casing at **-1.5**, a held modal ring nothing that bounces can match, so the
casing is aimed at the reloads beside it instead. Peak control (`gfPeak`) and gain at most 1, never the master Limiter;
the rule is the gun port's (the smallest Peak on a 0.05 grid within 0.5 dB of the target, else the loudest up to 1.2,
taking the smaller value within 0.2 dB), with one exception: the ricochet takes **1.4**, which is exactly the squeeze
it was heard and picked with (the round gave it the app's Limiter at 1, then 0.4).

| Preset | LUFS (Peak 0, gain 1) | Peak control | Target |
|---|---|---|---|
| Revolver Spin (new) | -12.7 (-21.9) | 1.15 | -12.6, the reloads |
| Bolt-Action Reload | -13.0 (-18.6) | 1.1 | -12.9, today's |
| Dry Fire (new) | -14.7 (-18.6) | 1.2 | -12.6, the reloads |
| Ricochet Zing | -16.6 (-27.9) | 1.4 | -10.2, today's |
| Shell Casing | -17.0 (-21.4) | 1.15 | -12.5, the reloads |
| Bullet Whiz | -20.1 (-20.1) | 0 | -20.1, today's |

Every one at gain 1, peak 0.90, no clipping, |DC| under 1e-6. **Short:** Ricochet Zing by 6.3 dB (a far stone hit and
a thin whine; Peak 2 would still only reach -13.9), Shell Casing by 4.5 (a case is a few tiny ticks; -14.0 at Peak 2),
Dry Fire by 2.1 (1.5 would close it to -13.0, past what the grid allows). Closing them is the same call as the gun
port's: a squeeze past 1.2 is a sound change for AJ's ear, not a level change. Variations of a gun foley sound level like
any other (a pack within 1 dB, peaks under -2.9 dBFS; held by the web suite, with the rule that no label, enum or help
line names a real firearm).

## The voice engine (2026-11-13), wave 42

**Why it exists.** The app had no human character sounds. The creature engine holds one call shape with no consonants,
the formant engine one vowel, and speech reads words in a level voice; a game cry is none of those. "Hyaaat", "uraaagh",
"toriya!", "hup" are a consonant, a vowel path, a pitch gesture made with EFFORT, and an ending (a glottal stop, a breath
out, a creaky "gh"), and the bar is the 16-bit era's voice clip: compressed, crunchy, a little synthetic, with character
rather than realism. The prototype (`tools/proto/voice.mjs`, rounds in `soundtests/proto-voice/`) plans a short SCRIPT
(an onset, vowels and consonants with lengths, a coda, a pitch contour, effort / roughness / breath curves) into
Klatt-style control tracks and renders them through a glottal source (open quotient and tilt by effort, period doubling
into chaos for roughness, vocal fry for hard attacks and "gh" tails), a formant cascade with a parallel frication branch,
and a character stage: clean, a hot close mic, or the 16-bit sampler (the chip gun's model: decimated with no filter,
4-bit ADPCM, drop-sample playback, the hardware echo).

**The rounds, and how they converged.** Thirteen rounds (`soundtests/PICKS.md`, "Voice engine"). Five were picked at
once: the battle cry ("fantastic, it's totally toriya!", all three model takes), the sword cry and the jump "hup" (all
three each; the hup "reads as a young action-adventure hero, not problematically so"), the falling scream (the model's
three, with today's Distant Scream kept as it is because the control holds up) and the woman's hurt cry ("the only one
that sounds right"). Two took longer:
- **Hurt, from sung to strained.** Round 1's "ugh" rose ~3 st and fell on a deep, rounded, held vowel, which AJ heard as
  sung ("the Count's laugh if it were one syllable"). Round 2 went the other way: no rise, short, tense, breathy, cut off by
  a glottal stop; the pick was the closed-mouth "NNGH" (a hard attack into a held, nasal strain), "should be a little
  longer: uuuugh". Round 3 was a labeled length ladder of that one sound, and the longest rung (the `n` held 3x, `n:9`,
  sagging 5 st) is the hurt. Its script needed the planner to size the buffer from the planned phones: sized from the
  script's own length alone, the longer rungs were cut at 0.41 s.
- **The death yell over five rounds, where SIZE mattered more than pitch.** Round 1: the new voice was better but
  today's preset had the right GESTURE (it hits at once, only falls, is short, has a body thud). Round 2 put the voice in
  that gesture and was "very calm. Oh no, I died, aaah": a relaxed performance. Round 3 pushed it into a shouting register
  with a voice crack and was "either 90 years old, or a bird": too high (340-470 Hz), and the 30-150 Hz roughness flutter
  read as a quaver. Round 4 went to chest voice, loud by brightness rather than pitch (the effort shelf raised to +19 dB),
  with a STEADY source (no tremor, no flutter, no random cracks); its "uwaaagh" was the closest, "just needs to be lower
  pitched perhaps?". Round 5 was a labeled pitch ladder (0, -3, -5, -7 st) plus -5 st with a bigger throat, and AJ picked
  the bigger throat: "the size actually might be the better factor". Steady, flutter, randomBreaks and presence are the
  script fields those rounds added.

**The 16-bit sampler damages higher voices.** The sampler stores every voice at the same low rate (~8.3 kHz at Lo-fi
0.85), which a man's cry survives and a woman's does not: round 1's woman's cry through it lost the cry, and the clean one
was picked. Hence **Store follows pitch**: the storage rate scales with sqrt(peak f0 / 150 Hz), up to 1.8x and never past
16 kHz. It is a row (default 0, the setting every picked take was rendered with) because no 16-bit pick is a high voice;
a woman's or a kid's cry through the sampler should turn it up.

**The port** (`dsp.js` `makeVoice` / `voiceCfg` / `voiceLevel`) is **sample-identical to the prototype on all thirteen
picked takes**, raw and levelled (the take's seed is `voSeed`; the prototype's variation seed was 0 in every take and is
written in as `VO_SEED_MIX`), and today's prototype matches every WAV AJ heard to 16-bit quantization (-69 to -78 dB
residual). 21 rows in a **Vocal** group ("Voice" is the engine picker's family, which wave 42 joins beside formant,
speech and crowd), drawn only by wave 42 (`DRAWN_IF_USED`), Duration stretching past 2 s (`DUR_STRETCH`), and in
`VARY_STRETCH` (a cry has its own length, so a longer buffer only gives it room). The cry is built at its own length and
the Duration holds it. Two Cry types are AJ's picks rather than the prototype's first scripts: **hurt** is hurt-3's
`' n:9 !` and **death cry** is death-yell-4's chest "uwaaagh" (the prototype's own versions were the rejected "sung" hurt
and round 1's death cry), each exactly the script its round built, so a patch naming it renders the picked take. Grunt,
fear scream and laugh ship as the prototype wrote them; no round auditioned them. **The custom cry's typed Body is
`voBody`, an SFX_EXTRAS field** (like `speechText`), so it travels through share links, history, undo, Breed and
Variations by the table's own loop, with a Body box in the Vocal panel (typing makes the Cry type Custom and lengthens
the Duration if the cry runs past it). A typed script is untrusted: it is read to 160 characters, a ":n" weight is held
to 0.05-16, and no plan runs past 8 s. One local was renamed for the export (`SIG` to `sigma`: the bundle reads
SCREAMING_CASE as a module constant) and `Math.SQRT2` is written as its literal.

**One take was heard with more than its notes said.** `16bit-man-falls` was described as the hardware echo INSTEAD of
the round's room, but the prototype's `room: null` never overrode the round's room (`t.room || round.room`), so the file
AJ picked had both. The preset carries the room, as heard.

**Presets.** In Voice / Vocal, each a base and its alts (the button's click-again versions): **Battle Cry** (clean
"toriya", the same cry 16-bit, a big barbarian), **Sword Cry** (clean "hyaat", 16-bit, the exaggerated "hi-YAAH" as a
custom cry, `voBody` `ih y AH:4`), **Jump Hup** (clean, 16-bit, a cartoon kid), **Falling Scream** (a man, clean in the
pit; the same scream 16-bit with its echo and the pit; a woman, warm, in the pit; the pit is the round's room as the app's
own Reverb), **Hurt Grunt** (the "nngh", Cry type hurt) and **Woman Hurt Cry** (big hurt, a woman). **Enemy Death**
stays in Hits / Melee and is replaced in place: the base is death-yell-5's `uwaaagh-minus5st-size1.3`, and the old
preset's thud is carried as a layer, placed where the round placed it (0.392 s: the cry's 12 ms lead-in plus the old
0.38) at the round's balance against the voice (layer gain 0.9564, computed through the layer mix's per-layer peak
normalization). Today's formant Enemy Death is its alt, unchanged: AJ liked its gesture, and a second click gets it.

**Levels.** Measured as the app plays them (Normalize on), BS.1770 gated, against the Voice / Vocal section at HEAD
(median **-8.3 LUFS** over its 16 sustained voices) and today's Enemy Death (**-8.83**). Peak control (`voPeak`) and gain
at most 1, never the master Limiter; the gun port's rule (the smallest Peak on a 0.05 grid within 0.5 dB of the target,
else the loudest up to 1.2, taking the smaller value within 0.2 dB), then a base and its alts held within **1.5 dB** of
the quietest by gain. Every take peaks at 0.90 or less (Hurt Grunt 0.61), no clipping, |DC| at most 7e-6.

| Preset | Take | LUFS (Peak 0, gain 1) | Peak control | Gain |
|---|---|---|---|---|
| Battle Cry | clean-toriya (base) | -8.58 (-8.58) | 0 | 1 |
| | 16bit-toriya | -8.30 (-5.57) | 0 | 0.73 |
| | big-barbarian | -8.29 (-4.84) | 0 | 0.672 |
| Sword Cry | clean-hyaat (base) | -8.46 (-8.46) | 0 | 1 |
| | 16bit-hyaat | -8.30 (-7.24) | 0 | 0.885 |
| | hi-yah-exaggerated | -8.29 (-1.92) | 0 | 0.48 |
| Jump Hup | clean-hup (base) | -10.40 (-14.37) | 0.7 | 1 |
| | 16bit-hup | -10.43 (-11.48) | 0.25 | 1 |
| | cartoon-kid-hup | -8.93 (-6.00) | 0 | 0.714 |
| Falling Scream | clean-man-falls (base) | -10.55 (-13.63) | 0.95 | 1 |
| | 16bit-man-falls | -9.05 (-9.39) | 0.1 | 0.941 |
| | woman-falls | -9.05 (-7.73) | 0 | 0.859 |
| Hurt Grunt | nngh-3x | -8.30 (-4.91) | 0 | 0.677 |
| Woman Hurt Cry | clean-aagh | -8.98 (-12.18) | 1.15 | 1 |
| Enemy Death | uwaaagh-minus5st-size1.3 + thud (base) | -9.92 (-9.92) | 0 | 1 |
| | today's formant yell (alt) | -8.83 | | |

**Short:** Falling Scream's base by 2.3 dB and Jump Hup's base by 1.9 (a short hup and a long scream that falls away 20
dB both have a high crest; Peak 1.2 does no better), Woman Hurt Cry by 0.7, and **Enemy Death by 1.1 against today's**:
its thud is a separate layer normalized to its own peak, so the thud sets the mix's peak and Peak control on the voice
moves it by under 0.15 dB at any setting. Closing those is a sound change (a harder squeeze, a quieter thud) for AJ's
ear, not a level change. The base and its alts sit within 1.5 dB everywhere (Enemy Death and its alt 1.1). Variations
of a voice level like any other (a pack within 1 dB, peaks under -2.9 dBFS; held by the web suite, with the rule that
no label, enum or help line names a game, a character or a company). Search: toriya, kiai, yell and shout find Battle
Cry; hyah, hiyah and slash Sword Cry; hup and jump Jump Hup; hurt, pain, ugh, ouch and oof Hurt Grunt and Woman Hurt Cry;
scream and fall Falling Scream.

## The melee engine (2026-11-14), wave 43

**Why it exists.** Hits / Melee was "pretty weak and almost everything sounds the same" (AJ), and measured, 32 of its 52
presets were the whoosh engine alone: every Chop, Slice, Cleave and Thrust was air moving and no blade ever LANDED in
anything. The rest were the impact engine (one filtered noise hit and a boom) or the modal bank (one resonator set). A
melee hit is two or three events, and the prototype (`tools/proto/melee.mjs`, rounds in `soundtests/proto-melee/`) builds
them in order: the SWING (air past the weapon, six stations along it each shedding at its own Strouhal frequency, so a
katana's 3.5 mm edge whistles and a hammer's head whumps; it stops on steel, stone or plate and follows through, slowing,
in flesh), the CONTACT (the target times the hit, each pair a recipe of physical components set to energies: a wet,
tearing cut, the skin's slap and the body's thup, mail's links bursting, plate's beating shell modes, a shield's plank
disc and iron rim, two blades' beam modes and their scrape), the BODY's weight, and a designed THUMP, BONE crunch, SNAP
and EXAGGERATE on top, through the gun's crunch stage.

**The blind result: a model take in seven of eight rounds, and the eighth rebuilt and kept whole.** Each round bracketed
the range with one weapon and target (crunchy / arcade, hyper-real, exaggerated fighting-game) against today's preset
(`soundtests/PICKS.md`, "Melee engine"). AJ picked a model take every time today's preset was in the round except the
punch, where nothing won: "none of them sound good. They lack any sort of gravity or power." **AJ's style pattern** is
consistent enough to be a rule (the redo uses it as one): the quick blades are **fighting-game** (Katana Slice C, Sword
Clash D, Dagger Stab A), the hard hits on armor and shields are **crunchy-arcade** (Hammer Smash D on plate, Shield
Block C, Critical Slash C through mail), and the heavy axe is **hyper-real** (Axe Chop A).

**The punch, from physics to design.** Round 1's punch was physical: a ~12 ms force pulse and a body thump scaled DOWN by
how much flesh gives, which is what flesh does to a real blow and exactly why it had no gravity or power. Round 2
(`punch-kick-2`, no control: today's was heard in round 1) designed it as a game does: a long, low THUMP that dominates
(a kick-drum sub dropping ~90 to 44 Hz, never reduced by the target, routed AROUND the compressor so the hit's gain
reduction can neither duck nor squash it), a mid whump, a clipped slap crack, optional bone crunch, a 55-115 ms swing.
Flesh would absorb a thump like that; a game's punch does not ask it to. AJ: "all of those are good improvements": all
four takes ship, the cinematic heavy punch as the base and the crunchy beat-'em-up punch, the fighting-game heavy hit and
the KICK (a new weapon: a leg, 1.4x a fist's mass, deeper and slower) as its alts.

**The port** (`dsp.js` `makeMelee` / `meleeCfg` / `meleeLevel`) is **sample-identical to the prototype** (a snapshot of
`tools/proto/melee.mjs`, md5 3c296c1b..., taken at the start and unchanged since) **on every take of every round** (28,
the eleven picked included), **on 150 random patches** (every weapon, target, hit and place, Thump, Bone, Spins, Peak up
to 1.2, Crunch 0, bits, rate cut, with and without a Duration; sign of zero included), and every picked preset, with Peak
0 and before gain, renders its take exactly. 23 rows in a **Melee** group, drawn only by wave 43 (`DRAWN_IF_USED`), in
the engine picker's **Foley** family beside the gun, Duration stretching past 2 s (`DUR_STRETCH`), in `VARY_STRETCH`. The
model reads the patch's Duration as the prototype did (`st.duration`): the blow ends there with a 40 ms fade and is
levelled over what is kept. A picked take was rendered with none (trimmed where it fell 60 dB under its peak), so its
preset's Duration IS that length, to the microsecond (`round(duration x SR)` lands on the take's last sample). The test
hooks `__detHP` and `__thumpPost` are gone, at their defaults (150 Hz, on); `mlFFT`, the room convolution and the
limiter are dsp.js's own `fftInPlace`, `blastConvolve` and `limiterProcess`; `Math.SQRT2` is written as its literal.

**CPU.** The prototype ran every stage over a buffer sized for the longest room (2.6 s past the hit, 4-5 s with a place)
for a blow of 0.7-2.2 s, and its saturator (four tanh per sample per channel per group) was half the time. The port skips,
EXACTLY, what only multiplied silence: the saturator runs only the span holding sound and skips the tanh of any sub-sample
too small to move its bias (the result is exactly 0 either way; a filtered knock's tail decays to the smallest doubles and
sits there for the rest of the buffer, so this is most samples); the compressor, the limiter (Peak control) and the
detector stop at the last sound; a knock's low-pass stops at its fixed point; an unfiltered knock is only as long as its
pulse. **Best of 5, the eleven picks: 89.5 to 36.6 ms of CPU per second of audio (median), 144.7 to 68.0 worst**; all 28
takes 92.6 to 45.8, worst 198 to 122. The room's FFT convolution is NOT trimmed: its rounding depends on its size, so a
smaller one is a different sample, and it is now the largest share of what is left.

**Presets.** Replaced IN PLACE in Hits / Melee (names, section and order kept): Katana Slice (C fighting-game), Axe Chop
(A hyper-real), Sword Clash (D fighting-game), Hammer Smash (D crunchy-arcade), Dagger Stab (A fighting-game), Shield
Block (C crunchy-arcade), Critical Slash (C crunchy-arcade), and Punch / Kick (base B cinematic-heavy; alts D
beat-'em-up, C fighting-game-heavy, A the kick). Enemy Death (the voice engine's since 2026-11-13) and every other Hits /
Melee preset are untouched. `_vary` moves the seed (another take) and Weight and Speed by 5%.

**Levels.** Measured as the app plays them (Normalize on), BS.1770 gated, against today's level for these eight (median
**-8.1 LUFS** at HEAD: -4.2 for Sword Clash's held modal ring to -13.2 for Hammer Smash). Peak control (`meleePeak`, 0-1.2
in 0.05 steps) and gain at most 1, never the master Limiter; the gun port's rule (the smallest Peak within 0.5 dB of the
target, else the loudest up to 1.2, taking the smaller value within 0.2 dB), then Punch / Kick and its alts held within 2
dB of the quietest by gain. Every take peaks at 0.90 or less, no clipping, |DC| at most 1e-6.

| Preset | Take | Today (HEAD) | LUFS (Peak 0, gain 1) | Peak control | Gain | LUFS |
|---|---|---|---|---|---|---|
| Katana Slice | C fighting-game | -7.97 | -15.12 | 0 | 1 | -15.12 |
| Axe Chop | A hyper-real | -5.54 | -17.09 | 1.2 | 1 | -13.23 |
| Sword Clash | D fighting-game | -4.17 | -18.06 | 1.2 | 1 | -10.77 |
| Hammer Smash | D crunchy-arcade | -13.17 | -20.95 | 1.2 | 1 | -12.60 |
| Dagger Stab | A fighting-game | -8.23 | -19.64 | 1.2 | 1 | -16.50 |
| Shield Block | C crunchy-arcade | -8.39 | -21.50 | 1.2 | 1 | -14.81 |
| Critical Slash | C crunchy-arcade | -7.83 | -19.65 | 1.2 | 1 | -14.47 |
| Punch / Kick | B cinematic-heavy (base) | -9.95 | -19.33 | 1.1 | 0.928 | -15.60 |
| | D beat-'em-up | | -17.14 | 0.8 | 0.938 | -15.60 |
| | C fighting-game-heavy | | -18.88 | 1.2 | 1 | -17.64 |
| | A kick | | -18.38 | 1.1 | 1 | -15.77 |

**Short, every one, by 2.7 to 9.5 dB** (Hammer Smash 4.5, Sword Clash 2.7, Axe Chop 5.1, Critical Slash 6.4, Shield
Block 6.7, Katana Slice 7.0, Dagger Stab 8.4, Punch / Kick 7.5-9.5). Today's presets are mostly the whoosh engine and
held rings, steady sounds with a low crest that BS.1770 reads as loud; a melee take is a quiet swing and then a HIT, and
the integrated loudness under-reads a transient. Peak control limits the hit ALONE (before the swing joins, so the swing
keeps its balance under it), and that mostly lifts the low body, which K-weighting discounts: 1.2 buys 0-8.4 dB, Katana
Slice's fighting-game take nothing at all (its swing swells to within 3.6 dB of the hit, so the swing sets the level).
Closing the rest is a sound change (a second limiter pass past 1.2, or the master Limiter the gun rule keeps off) for
AJ's ear, not a level change. The app's chain adds its 18 Hz DC blocker and 20 kHz low-pass to every engine, these
included. Variations of a melee sound level like any other (a pack within 1 dB, peaks under -2.9 dBFS; held by the web
suite, with the rule that no label, enum or help line names a game, a film or a company). Duration on a Peak-controlled
take is the take's own (Peak 0) length, so the squeezed tail ends where AJ heard it end.

## Melee redo (2026-11-14): the rest of Hits / Melee onto the melee engine

AJ heard the labeled before/after round (`tools/proto/melee-redo.mjs`, `soundtests/melee-redo/`, PICKS.md "melee-redo"):
"all of the melee redos are actually very good", so all 38 were applied with `tools/replace-presets.mjs
tools/new-presets/melee-redo-wave43.json` (the redo JSON with its wave placeholder set to 43), every one in place in Hits
/ Melee, names, section and order kept. **34 replaced** (Sword Swing, Heavy Cleave, War Hammer Crush, Ground Slam, Spear
Thrust, Whip Crack, Rapier Lunge, Flail Swing, Sword Clash 2, Hammer Smash 2, Katana Slice 2 and the 23 bred names, now
an adjective x a verb: Reckless / Heavy / Whirling / Iron / Grim / Swift / Keen / Razor / Brutal x Chop / Cleave / Slice /
Thrust / Riposte / Clash / Swing / Bash) and **four joined today's base as an alt** (Visor Clank, Sword Ting, Hit, Crossbow
Bolt: today's stays the base on its own engine, the redesign is the click-again take). Not touched: Enemy Death (the voice
engine's), the eight blind-round picks above, and the five kept (Knockout, Triumphant Clank, Gauntlet Creak, Blade
Sheathe, Anvil Strike). The style rule is AJ's from the picks: plate, mail, a shield or stone is crunchy-arcade; else a
heavy weapon is hyper-real; else fighting-game; a Swing is a deliberate whiff.

Proved before it went in: every take sample-identical to the prototype snapshot through the port (38 of 38, Peak control
included, none cut), the four ALT bases byte-identical to today's, and presets.js changed in exactly those 38 entries
(PRESET_CATEGORIES untouched). The web suite's melee row holds them as it holds the picks: each a melee take in Hits /
Melee, audible, whole, finite, stereo, under 0.98, without DC, Repeat, the master Limiter or a gain over 1, and a
Variations pack (Sword Swing, Rapier Lunge, Iron Clash) levelled like any other. Their levels are the pass below: the
redo came in at Peak 1.2 or less, 32 of 38 short of the section, and "meet in between" lifted them.

## Loudness: meeting in between (2026-11-14)

**Why.** The new engines (gun 38, energy 39, gun foley 41, voice 42, melee 43) are high-crest: a shot, a hit or a hard
attack is nearly all spike, and the presets they replaced were mostly steady sounds (the whoosh and impact engines, held
modal rings) that BS.1770 integrated loudness reads as loud. So a new preset at the same peak measures (and plays) quieter
than the one it replaced, often by 5-10 dB, and every port reported its presets short. AJ was asked whether to accept the
sharp hits as they are, squeeze them toward the old loudness, or meet in between: **"Meet in between I think is a good
choice".** Chip gun (40) is out: it had no shortfall.

**The rule.** Every take (base and each alt) whose wave is one of those five, measured as the app plays it (Normalize on,
BS.1770 gated). Its target is the level of the preset it replaced at HEAD, rendered the same way; a new one takes the
target its port used (Pulse Rifle -11, the guns; Revolver Spin and Dry Fire -12.6, the reloads; the six new cries -8.3,
the Voice / Vocal median), and Shell Casing keeps its port's -12.5 (the reloads; its HEAD was a held ring at -1.5). These
are the same targets the ports' sections list. A take SHORT of its target by G dB is raised to close HALF the gap
(target - G/2); one at or over it, or within the ports' own 0.5 dB, is untouched. The means are the engine's Peak control
(`gunPeak`, `enPeak`, `gfPeak`, `voPeak`, `meleePeak`) and `gain` at most 1, never the master Limiter: gain first where it
was held under 1, then the smallest Peak on a 0.05 grid up to **2.0** (the second full pass) that reaches the aim, gain
trimming any overshoot; where nothing reaches it, the loudest point (the smallest within 0.2 dB of it), and a squeeze that
buys under 0.3 dB is not taken. A base and its alts stay within 2 dB (Punch / Kick's base and first alt are held there).
`meleePeak`'s row went from 0-1.2 to 0-2 like the other four (widening a range is safe: nothing stores it as an index).
Proved per preset: presets.js before and after differ in 61 presets, 66 takes, and in each only the engine's Peak control
and `gain` moved (same seed, same everything else). Every take peaks at 0.90 or less, no clipping, no DC.
Changes: `tools/new-presets/level-between-{gun,energy,gunfoley,voice,melee}.json`.

**The result.** 94 takes in scope: 11 over their target, 7 within 0.5 dB, 76 short. 66 moved (61 presets), by a median
of **+1.0 dB** (mean +1.4, from +0.3 to +5.2; gun +0.9, energy +0.5, gun foley +2.2, voice +0.4, melee +1.3); 20 reach
halfway exactly. Seven needed the full second pass, Peak 1.95-2.0: Suppressed, Whip Crack, Rapier Lunge, Swift
Riposte, Razor Cleave and the alts of Crossbow Bolt and Sword Ting. Before -> after, LUFS (bold: moved):

| Preset | Engine | Target | Before | After | Peak control | Gain | Still short |
|---|---|---|---|---|---|---|---|
| 3-Round Burst | Gun | -9.0 | -11.6 | **-10.7** | 1.05 → **1.45** | 1 | 0.4 under halfway |
| Compact Fire | Gun | -9.7 | -14.8 | **-12.8** | 1.2 → **1.9** | 1 | 0.6 under halfway |
| Full Auto | Gun | -6.1 | -9.9 | **-9.5** | 0.4 → **1.1** | 1 | 1.5 under halfway |
| Gunshot | Gun | -9.8 | -14.9 | **-14.1** | 1.1 → **1.85** | 1 | 1.7 under halfway |
| Gunshot 2 | Gun | -9.3 | -12.3 | **-11.7** | 1.2 → **1.7** | 1 | 0.9 under halfway |
| Heavy Discharge | Gun | -11.8 | -12.1 | -12.1 | 1.2 | 1 | at (within 0.5) |
| Heavy Round | Gun | -11.8 | -14.7 | **-13.3** | 1.1 → **1.65** | 1 → 0.999 | halfway |
| Machine Gun | Gun | -6.4 | -10.8 | -10.8 | 1.1 | 1 | 2.2 under halfway, Peak does not reach |
| Magnum Fire | Gun | -14.5 | -11.9 | -11.9 | 1.2 | 1 | over |
| Magnum Shot | Gun | -10.8 | -12.1 | **-11.6** | 1.2 → **1.75** | 1 | 0.2 under halfway |
| Rifle Crack | Gun | -11.5 | -11.6 | -11.6 | 1.2 | 1 | at (within 0.5) |
| Shotgun | Gun | -11.6 | -12.1 | **-11.9** | 1.2 → **1.3** | 1 → 0.983 | halfway |
| Shotgun (alt 1) | Gun | -11.6 | -11.5 | -11.5 | 1.2 | 1 | over |
| Shotgun 2 | Gun | -9.7 | -12.6 | **-11.7** | 1.1 → **1.6** | 1 | 0.6 under halfway |
| Snub Discharge | Gun | -10.3 | -13.7 | **-12.0** | 1.2 → **1.4** | 1 → 0.973 | halfway |
| Snub Report | Gun | -10.5 | -12.1 | **-11.8** | 0.95 → **1.55** | 1 | 0.5 under halfway |
| Suppressed | Gun | -11.5 | -18.3 | **-14.9** | 0.4 → **2** | 1 → 0.988 | halfway |
| Suppressed Crack | Gun | -10.3 | -14.2 | **-12.3** | 1.2 → **1.7** | 1 → 0.995 | halfway |
| Suppressed Fire | Gun | -8.2 | -11.5 | **-9.9** | 0.3 → **1.35** | 1 → 0.999 | halfway |
| Plasma Discharge | Energy | -14.2 | -15.2 | **-14.7** | 1.2 → **1.35** | 1 → 0.998 | halfway |
| Plasma Rifle | Energy | -13.5 | -11.3 | -11.3 | 1.1 | 1 | over |
| Plasma Shot | Energy | -16.6 | -11.5 | -11.5 | 0 | 0.78 | over |
| Pulse Rifle | Energy | -11.0 (port's) | -10.0 | -10.0 | 0 | 0.9 | over |
| Rail Fire | Energy | -11.8 | -12.4 | **-12.1** | 1.15 → **1.25** | 1 → 0.977 | halfway |
| Bolt-Action Reload | Gun foley | -12.9 | -13.0 | -13.0 | 1.1 | 1 | at (within 0.5) |
| Bullet Whiz | Gun foley | -20.1 | -20.1 | -20.1 | 0 | 1 | over |
| Dry Fire | Gun foley | -12.6 (port's) | -14.7 | **-13.7** | 1.2 → **1.35** | 1 → 0.985 | halfway |
| Revolver Spin | Gun foley | -12.6 (port's) | -12.7 | -12.7 | 1.15 | 1 | at (within 0.5) |
| Ricochet Zing | Gun foley | -10.2 | -16.6 | **-14.1** | 1.4 → **1.85** | 1 | 0.7 under halfway |
| Shell Casing | Gun foley | -12.5 (port's) | -16.9 | **-14.7** | 1.15 → **1.75** | 1 → 0.984 | halfway |
| Battle Cry | Voice | -8.3 (port's) | -8.6 | -8.6 | 0 | 1 | at (within 0.5) |
| Battle Cry (alt 1) | Voice | -8.3 (port's) | -8.3 | -8.3 | 0 | 0.73 | over |
| Battle Cry (alt 2) | Voice | -8.3 (port's) | -8.3 | -8.3 | 0 | 0.672 | over |
| Enemy Death | Voice | -8.8 | -9.9 | -9.9 | 0 | 1 | 0.5 under halfway, Peak does not reach |
| Falling Scream | Voice | -8.3 (port's) | -10.5 | **-10.0** | 0.95 → **1.65** | 1 | 0.6 under halfway |
| Falling Scream (alt 1) | Voice | -8.3 (port's) | -9.0 | **-8.7** | 0.1 | 0.941 → 0.983 | halfway |
| Falling Scream (alt 2) | Voice | -8.3 (port's) | -9.0 | **-8.7** | 0 | 0.859 → 0.897 | halfway |
| Hurt Grunt | Voice | -8.3 (port's) | -8.3 | -8.3 | 0 | 0.677 | over |
| Jump Hup | Voice | -8.3 (port's) | -10.4 | -10.4 | 0.7 | 1 | 1.1 under halfway, Peak does not reach |
| Jump Hup (alt 1) | Voice | -8.3 (port's) | -10.4 | -10.4 | 0.25 | 1 | 1.1 under halfway, Peak does not reach |
| Jump Hup (alt 2) | Voice | -8.3 (port's) | -8.9 | **-8.6** | 0 | 0.714 → 0.74 | halfway |
| Sword Cry | Voice | -8.3 (port's) | -8.5 | -8.5 | 0 | 1 | at (within 0.5) |
| Sword Cry (alt 1) | Voice | -8.3 (port's) | -8.3 | -8.3 | 0 | 0.885 | at (within 0.5) |
| Sword Cry (alt 2) | Voice | -8.3 (port's) | -8.3 | -8.3 | 0 | 0.48 | over |
| Woman Hurt Cry | Voice | -8.3 (port's) | -9.0 | **-8.6** | 1.15 → **1.55** | 1 | halfway |
| Axe Chop | Melee | -5.5 | -13.2 | **-11.9** | 1.2 → **1.9** | 1 | 2.5 under halfway |
| Brutal Bash | Melee | -12.2 | -13.1 | **-12.7** | 1.2 → **1.35** | 1 → 0.987 | halfway |
| Critical Slash | Melee | -7.8 | -14.5 | **-13.6** | 1.2 → **1.9** | 1 | 2.4 under halfway |
| Crossbow Bolt (alt 1) | Melee | -6.7 | -18.8 | **-13.7** | 1.2 → **2** | 1 | 0.9 under halfway |
| Dagger Stab | Melee | -8.2 | -16.5 | **-13.0** | 1.2 → **1.75** | 1 | 0.6 under halfway |
| Flail Swing | Melee | -6.2 | -8.9 | **-7.6** | 0.05 → **1.05** | 1 → 0.996 | halfway |
| Grim Chop | Melee | -6.2 | -16.2 | **-15.7** | 1.2 → **1.75** | 1 | 4.5 under halfway |
| Grim Cleave | Melee | -6.4 | -13.1 | **-12.6** | 1.15 → **1.4** | 1 | 2.8 under halfway |
| Ground Slam | Melee | -12.1 | -14.4 | -14.4 | 1.2 | 1 | 1.2 under halfway, Peak does not reach |
| Hammer Smash | Melee | -13.2 | -12.6 | -12.6 | 1.2 | 1 | over |
| Hammer Smash 2 | Melee | -12.6 | -17.7 | **-16.1** | 1.2 → **1.8** | 1 | 1.0 under halfway |
| Heavy Chop | Melee | -5.0 | -15.0 | **-14.3** | 1.2 → **1.65** | 1 | 4.3 under halfway |
| Heavy Cleave | Melee | -5.2 | -12.5 | **-12.2** | 0.1 → **0.35** | 1 | 3.3 under halfway |
| Heavy Slice | Melee | -7.6 | -13.7 | -13.7 | 0.45 | 1 | 3.0 under halfway, Peak does not reach |
| Heavy Thrust | Melee | -5.8 | -15.4 | **-15.0** | 1.2 → **1.6** | 1 | 4.4 under halfway |
| Hit (alt 1) | Melee | -8.5 | -14.3 | **-13.9** | 1.2 → **1.65** | 1 | 2.4 under halfway |
| Iron Clash | Melee | -3.8 | -8.9 | **-6.7** | 1.2 → **1.9** | 1 | 0.4 under halfway |
| Iron Cleave | Melee | -5.9 | -10.7 | **-9.6** | 1.2 → **1.7** | 1 | 1.2 under halfway |
| Iron Slice | Melee | -7.6 | -13.7 | **-10.9** | 1.2 → **1.85** | 1 | 0.2 under halfway |
| Katana Slice | Melee | -8.0 | -15.1 | **-13.4** | 0 → **1.9** | 1 | 1.9 under halfway |
| Katana Slice 2 | Melee | -8.8 | -14.6 | **-11.9** | 1.2 → **1.6** | 1 | 0.2 under halfway |
| Keen Cleave | Melee | -7.4 | -13.3 | -13.3 | 0.15 | 1 | 2.9 under halfway, Peak does not reach |
| Keen Swing | Melee | -8.2 | -10.0 | **-9.1** | 0.4 → **1.25** | 1 → 0.987 | halfway |
| Punch / Kick | Melee | -10.0 | -15.6 | **-14.7** | 1.1 → **1.25** | 0.928 → 0.997 | held: base/alts within 2 dB |
| Punch / Kick (alt 1) | Melee | -10.0 | -15.6 | **-14.7** | 0.8 → **1.55** | 0.938 → 1 | held: base/alts within 2 dB |
| Punch / Kick (alt 2) | Melee | -10.0 | -17.6 | **-16.7** | 1.2 → **1.5** | 1 | 3.0 under halfway |
| Punch / Kick (alt 3) | Melee | -10.0 | -15.8 | **-15.4** | 1.1 → **1.55** | 1 | 2.6 under halfway |
| Rapier Lunge | Melee | -9.0 | -15.1 | **-12.4** | 0.7 → **2** | 1 | 0.4 under halfway |
| Razor Cleave | Melee | -7.3 | -17.7 | **-15.3** | 0.5 → **1.95** | 1 | 2.8 under halfway |
| Reckless Chop | Melee | -5.9 | -13.6 | -13.6 | 1.2 | 1 | 3.8 under halfway, Peak does not reach |
| Reckless Clash | Melee | -3.8 | -10.7 | **-8.1** | 1.2 → **1.7** | 1 | 0.8 under halfway |
| Reckless Slice | Melee | -8.5 | -13.0 | -13.0 | 0 | 1 | 2.2 under halfway, Peak does not reach |
| Reckless Thrust | Melee | -7.9 | -15.0 | **-13.7** | 1.2 → **1.9** | 1 | 2.2 under halfway |
| Shield Block | Melee | -8.4 | -14.8 | **-12.1** | 1.2 → **1.65** | 1 | 0.5 under halfway |
| Spear Thrust | Melee | -6.8 | -12.0 | **-11.3** | 1.2 → **1.3** | 1 | 1.9 under halfway |
| Swift Chop | Melee | -6.6 | -12.7 | **-12.2** | 1.2 → **1.45** | 1 | 2.5 under halfway |
| Swift Cleave | Melee | -6.9 | -14.8 | **-12.4** | 1.2 → **1.75** | 1 | 1.5 under halfway |
| Swift Riposte | Melee | -8.0 | -17.5 | **-15.9** | 0.55 → **1.95** | 1 | 3.2 under halfway |
| Swift Thrust | Melee | -8.0 | -16.0 | **-13.9** | 1.15 → **1.55** | 1 | 1.9 under halfway |
| Sword Clash | Melee | -4.2 | -10.8 | **-8.1** | 1.2 → **1.55** | 1 | 0.6 under halfway |
| Sword Clash 2 | Melee | -3.7 | -11.0 | **-7.3** | 1.2 → **1.6** | 1 → 0.983 | halfway |
| Sword Swing | Melee | -6.8 | -10.1 | **-9.2** | 0.95 → **1.55** | 1 | 0.7 under halfway |
| Sword Ting (alt 1) | Melee | -3.4 | -10.9 | **-7.8** | 1.2 → **1.95** | 1 | 0.6 under halfway |
| Visor Clank (alt 1) | Melee | -4.8 | -11.6 | **-8.2** | 1.2 → **1.6** | 1 → 0.989 | halfway |
| War Hammer Crush | Melee | -12.1 | -13.4 | -13.4 | 1.1 | 1 | 0.6 under halfway, Peak does not reach |
| Whip Crack | Melee | -6.8 | -8.6 | **-8.1** | 1.15 → **2** | 1 | 0.4 under halfway |
| Whirling Chop | Melee | -5.8 | -15.9 | **-14.9** | 1.2 → **1.8** | 1 | 4.0 under halfway |
| Whirling Riposte | Melee | -7.4 | -13.6 | **-12.5** | 1.05 → **1.75** | 1 | 2.0 under halfway |
| Whirling Swing | Melee | -6.4 | -8.4 | **-7.4** | 0 → **0.2** | 1 → 0.994 | halfway |

**Still short.** 54 takes sit under halfway, and that is where Peak control stops, not a choice: a blow whose level is
the hit's spike gains 0-5 dB from two passes of the limiter (it mostly lifts the low body, which K-weighting discounts).
The furthest, 3-4.5 dB under halfway: Grim Chop, Heavy Thrust, Heavy Chop, Whirling Chop, Reckless Chop, Heavy Cleave,
Swift Riposte, Heavy Slice, Punch / Kick's fighting-game alt. **Peak control does not reach at all** (under 0.3 dB at any
setting, left as they were): Reckless Slice and Keen Cleave (the swing sets the level, as with Katana Slice's take, which
gains only 1.7 dB at 1.9), Heavy Slice, Reckless Chop, War Hammer Crush, Ground Slam, Machine Gun, Jump Hup and its first alt, and Enemy Death (its thud is a separate layer
normalized to its own peak and sets the mix's peak, so the voice's Peak control moves it by 0.2 dB at most). **Alts on another engine's base** keep a gap
the rule cannot close without touching today's base: Hit 5.4 dB under its base, Crossbow Bolt 6.9, Sword Ting 4.3, Visor
Clank 3.4 (each was wider before). Closing the rest is a sound change (a lower crest in the sound itself: more body under
the spike, a harder crunch) or the master Limiter, for AJ's ear, not a level change.

## Jingle alternates (2026-11-14)

**The finding** (soundtests/audit-untouched/REPORT.md, "The jingle family"): no jingle had a melody. Two-thirds were one
continuous `sweep`, a slide rather than notes, and `arpStep` is ONE constant interval, so a single voice cannot play a
major or minor triad. **Layers can**: up to four per sound, each with its own delay, gain and patch. So every design in
`tools/proto/jingles.mjs` is written as NOTES and compiled into layers, one run (a constant spacing, a constant
interval) per layer: [C5 E5] and [G5 C6] are two layers and make a major arpeggio. The yardstick is CrunchyBGM's stings
(item get rises to the tonic an octave up, level up is V-I, victory I-IV-V-I with an octave leap, defeat falls and ends
low and unresolved); every figure is an original one inside those conventions.

**AJ's variety rule:** "stuff like Game Over and Level Up are still a bit odd … Instead of wholesale replacing them it
might be good to come up with alternatives that user can keep clicking through to get more." After listening to
`soundtests/jingles/`: **"I think every single one of them is an improvement. I don't think we need to choose between any
of the new ones either, they should all go in as alts."** So every existing jingle keeps today's sound as its base,
byte-identical, and the button plays the base or one alt at random per click.

**What landed:** **70 alts on 30 existing presets** (Game Over 5; Level Up 4; the four fanfares and Boot-Up Chime 3 each;
the rest 2), and **5 new presets**, each with alts: **Victory** (3 alts) and **Defeat** (2) in Retro / Arcade,
**Achievement**, **Success** and **Fail** (2 each) in UI. The Super, Turbo, Ascend, Heavenly and Boot-Up Chime alts
include retunes of today's sound (Super Chime's was 1200 Hz, 37 cents sharp of D6); their bases are unchanged. An alt's
`gain` lands its BS.1770 loudness on its preset's base, so a click does not jump; a new preset sits on its section's
median. Searching "trophy", "unlock", "win" or "lose" finds the new ones too (SEARCH_ALIASES).

**Tuning:** pitches are exact equal temperament (A4 = 440); a layer's `freq` is its first note, `arpStep` moves it in
whole semitones, `sweep` is 0. `node tools/proto/jingles.mjs tune` renders every note of every design SOLO and reads its
fundamental by FFT against the note it should be: **each note is within 4.2 cents**. The physical models needed it: the
blown brass came in 10-28 cents flat on short notes until it was tongued (a 6 ms attack, a little more breath, tighter
lips; the breath's fall held to 70 ms).

**Two settings sound out of tune though the fundamental is exact**, so the new voices avoid them (one alt keeps one on
purpose: Boot-Up Chime's "sus-resolves" is today's ratio-3.5 voice, given notes):
- **Modal `modalInharm` 0.1-0.25** stretches the upper partials (0.25 puts the 2nd at 2.19x), and the periodicity pitch
  reads **55-145 cents sharp** (0.4 cents at inharm 0). The modal bells here sit at inharm 0.
- **FM ratio 3.5** (the FM Bell preset's) makes the wave repeat at HALF its note (autocorrelation -0.1 at one period,
  0.98 at two), so the note can be heard **an octave down**. The new FM bells use ratios 4 : 5 : 7. FM Bell and
  Boot-Up Chime's own bases still sit at 3.5.

Those are engine and preset matters for a separate round; nothing in the engine changed here.

## Mechanical fixes from the audit (2026-11-14)

**The finding** (soundtests/audit-untouched/REPORT.md): corrections rather than taste calls, AJ's brief being "you'd
still hear before and after". The proposal, with every number and before/after WAVs, is `soundtests/fixes/KEY.md`. AJ:
**"I think this is good, let's go ahead and apply them."** What landed is `tools/new-presets/mechanical-fixes.json`
(33 presets, written in place by `node tools/replace-presets.mjs`) and the engine fix in item 5. Measured on the
exported engine, Normalize on, loudness BS.1770.

**1. The siren copies (UI).** Quick Beep, Crisp Blip and Quick Chirp were all Alarm Siren under another name: a 700 Hz
square with ±0.6 vibrato (Quick Beep 0.17 from it on the separation meter, the closest pair in the audit; Crisp Blip the
same patch at 1.4 s; Quick Chirp the siren cut to 0.14 s). They are redesigned with **no `_alts`**, because keeping
today's sound would keep a third and a fourth Alarm Siren: a flat-topped square beep at A5, a quarter-pulse blip at E6
with a 6-bit edge, and a sine chirp rising two octaves. Each is under 0.15 s, ends silent and sits on the UI median
(-6.6 LUFS). Alarm Siren itself is untouched.

**2. Fifteen endings that clicked.** In every one, the patch declares a release that the render never played (the
audit's flag: from 30% of the peak to the end in 5 ms or less). Two causes:
- **The release ran past Duration** (Silky Chirp, Quick Tone, Sharp Tone, Hydraulic Piston, Retro Ding, Hydraulic
  Motor, Deep Pad). Duration now reaches where the declared release ends, plus the reverb or echo tail where there is
  one, so each render is **sample-identical up to the old ending** and only adds what the preset already asked for.
  Silky Chirp also goes `repeat` 2 → 1: its second shot was due 0.2 ms after the old buffer ended, so it was never
  heard. Deep Pad at 2.55 s is past the Duration slider's 2 s, as Struck Piano and Struck Glockenspiel already are.
  Retro Ding's two jingle-round alts end cleanly as they are and were not touched.
- **Drive hid the release** (Dist Guitar, Power Chords, Dist Bass, Pick Bass, Growl Bass, FM Growl Bass, FM Shred,
  Woodgrain Buzz). Drive is `tanh((1 + 40·drive)·x)` after the amp envelope, so a straight-line release stays near full
  level until its last few ms. `envCurve` (0.5 to 1, the smallest that passes) lets the release fall into the saturator
  gradually. It also bends the decay segment, measured at 40-56 dB under the sound.

**3. The DC was the cut.** Silky Chirp (5.9e-3 → 9.2e-5) and Hydraulic Motor (1.3e-3 → 4.6e-5) carried DC over the
audit's 1e-3 flag, and it came from where the buffer stopped, not from an offset in the sound. Every render runs an
18 Hz DC blocker; a high-pass's output only sums to zero once its input has gone quiet, so a buffer stopped mid-note
throws away the part of the blocker's recovery that would have cancelled the note's low end. The proof is in the fixed
renders: they are sample-identical to today's up to the old ending, and the added tail is what cancels the sum. So the
fix in item 2 is the DC fix too.

**4. Level outliers, through `gain`.** With Normalize on, every sound is brought to the same peak before `gain`, so
`gain` IS the level and a trim is exact (today's render times the ratio).
- **Trims to the section median:** Thunderous Wallop to the Explosions median (-2.6 → -17.0 LUFS, plus `release`
  0.443 → 0.2 for its 3 ms cut), and Triangle Ting, Glass Ping and Wind Chime to the Bells / Mallets median (-8.1).
- **Metal Grate Step** (to -11.4): its "held ring" was the amp envelope, `sustain` 1 holding the modal ring at full
  level for 0.35 s. It now decays over 0.25 s with `envCurve` 0.6; the clank's modes are untouched.
- **The kicks, +3.1 dB** (`gain` 1, the ceiling): Analog, Punch and Classic Kick. K-weighting discounts a kick twice:
  its 38 Hz high-pass takes a few dB off the 50-70 Hz body, and its +4 dB shelf above 1.5 kHz adds to the snare. By K
  they stay 8-9.5 dB under the Snare; by **C-weighting** (the ear at loud playback, near flat down to 50 Hz) Analog
  Kick is within 1.4 dB of it and the others within 3.0 and 4.5. A kick at game volume lies between the two. Going
  further is a sound change (the limiter, or Punch Kick's transient, which is its punch), so it was not done.
- **The keys, +3.1 dB** (`gain` 1): Struck Piano, Glockenspiel, Piano, Jazz Piano, Grand Piano, Honky-tonk and Struck
  Glockenspiel, which sit 14-17 dB under their sections. That closes **about a fifth of the gap, and it is all that is
  clean**: `gain` tops out at 1, and there is no engine gain to turn, because Normalize divides out whatever level an
  engine produces. Their level is set by a peak in the first 2-20 ms (the hammer, the mallet click), and the newer
  engines handle that with a **Peak control** (`blastPeak`, `gunPeak`, …) that the piano and bar engines do not have.
  The master Limiter reaches halfway, but it squeezes the hammer and pins the peak at its ceiling after `gain`, which
  stops Variations' loudness matching on that preset. A `pianoPeak` / `barPeak` is the clean route, and is separate.

**5. The engine bug: NaN from a burst with an envelope curve** (`synth.js`, both copies of the amp envelope's release:
`ampEnvAt`, the breath of the modelled engines, and the gain stage). With `repeat` > 1 the LAST shot runs to the end of
the buffer, so when Duration outlasts its release the release fraction `r` passes 1, `Math.pow(1 - r, 1 + 3·envCurve)`
takes a negative base, and a non-integer exponent gives NaN. The `env < 0` guard does not catch NaN, so it ran into the
filter state and the rest of the sound was NaN (in a layer, the rest of the whole mix). At `envCurve` exactly 1/3 or 1
the exponent is even and the note **swelled back to full level** after its release instead. Now `r >= 1` gives 0;
where `r < 1` the expression is unchanged. **It changes no existing sound**: the proposal rendered 1316 presets, alts
and jingle takes on both engines and all were byte-identical, and the audio hash with the fix and the old presets
matched the expected file on all 1372 lines. `tests/synth-bundle.test.mjs` 6c holds it: a square burst, a blown-brass
burst and a burst layer, at `envCurve` 1/3, 0.5, 2/3 and 1 (9 of its 11 rows fail on the old bundle; 2/3 is the
control, since an odd exponent went negative and was clamped).

**Pending AJ, not applied:** the **blown brass attack** (`mechanical-fixes-brass.json`: `attack` → 0.01 on six brass
presets, which brings short notes from 9-19 cents flat to within a few cents but makes the start a tongued one rather
than a swell; a taste call), and the **options** (`mechanical-fixes-options.json`: Thunderous Wallop redesigned on the
blast engine, and the keys pushed to halfway with the master Limiter).

## The gap list (game sounds with no preset, 2026-10-29; a name check, so it overstates coverage)

- Shooter: ~~reload, shell casing~~ (round 3); dry fire, scope, hit marker skipped (conventions).
- Platformer: ~~double jump, checkpoint, dash~~ (round 2).
- Combat: ~~knockout, enemy death~~ (round 3).
- Objects / movement: ~~swim, crawl~~ (round 3), ~~wood break~~ (round 4).
- UI / puzzle: ~~slider / scroll, line clear, rotate~~ (round 3).
- Electric: covered by Transformer Buzz now; more (mains hum, neon) only if AJ wants them.
- One preset only (may or may not be good): stomp, ladder, bow, potion drink, chest, equip, summon, ricochet, rocket,
  crit, generator hum, helicopter, train, typing, achievement, grab / throw, barrel.
