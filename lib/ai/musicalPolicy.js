// Musical policy for the AI composer — the "how to make it sound intentional"
// layer that sits above the capability contract in planContract.js. Distilled
// from docs/composer-musical-guide.md (research, 2026-09-24); the tempo ranges,
// density budgets and drum seeds are proposed defaults to audition, not rules.
//
// Pure (no Tone, React or Zod), because the in-app prompt (browser), and the MCP
// composer guide (lib/server/) both read it — one source of musical policy for
// both clients. Only the *selected* recipe is ever put in a prompt; appending
// every genre chapter to every request is exactly what the research warns
// against.

export const COMPOSE_MODES = ['new', 'edit']

const POLICY_CORE = `MUSICAL POLICY (how to make the loop sound intentional — the capability facts below still decide what is possible):
- Aim for a small musical idea that sounds intentional, survives repetition and invites the listener to touch a control. A valid plan is only the first requirement. Honour the user's explicit direction over every default here.
- Give each lane a job. Default: about three pitched lanes plus drums; fewer for sparse requests, more only when asked for density. Roles: Bass (tonal centre and weight — simpler and lower than everything else, few deliberate attacks), Hook (one short recognizable repeating figure), Support (colour, softer and slower than the hook), optional Answer (fills the hook's gaps in another register/timbre), Texture (quiet atmosphere). Label lanes by that role.
- Density budget: one busy pitched part at a time. If the hook is active, simplify bass and support. Register follows the sounding notes, not the label — an octave offset alone does not make a bass.
- Seek one recognizable repeating gesture: low variety, a limited range and a moderate density help. A route contour is not an authored melody — never claim specific notes, chords, riffs or progressions. Same scale does not guarantee consonance; a "Chords" label or PolySynth does not make a progression. Use a shared tonal centre and simple support when precise harmony is unavailable.
- Groove: preserve drum anchors (kick and backbeat reliable, lighter subdivisions quieter). Chance is for ornaments, never for structural parts, and chance is not swing. There is no swing, microtiming, fill or section control — do not change BPM alone and claim a different groove.
- Effects need a job: depth (reverb, more on support than bass), rhythmic answer (synced delay on one sparse upper part), motion (gentle chorus on sustained support), grit (distortion on one role). One or two purposeful treatments beat three decorative ones.
- Hybrids: keep the primary style's groove and borrow one or two traits from the secondary one. For a style you do not recognize, approximate honestly instead of attaching the label to generic minor-key arpeggios.
- summary: describe the intended focal relationship in one or two sentences, then name three concrete edits with audible purposes using controls this plan actually set (e.g. "open the keys filter for brightness", "raise the lead's delay send slightly", "slow the upper lane for more space"). Never say "adjust to taste". Never claim the result was heard, measured or proven — it has only been planned.`

const MODE_TEXT = {
  new: `REQUEST MODE: NEW COMPOSITION. Build a fresh idea. tracks is the complete arrangement and every lane starts from a clean baseline: any lane setting you leave null is reset to its default (arp, granular, drone and sidechain off; noteChance 1; no rest pattern; full loop window; speed 1; octave 0; no FX sends), and drums: null means NO drums. Set every setting the idea needs explicitly — synthType on every lane, and an enabled drums block whenever the style wants a beat.`,
  edit: `REQUEST MODE: EDIT THE CURRENT SONG. The current song (the CURRENT SONG section, or get_song's result over MCP) describes what is playing now. Change only what the user asked for and preserve everything else — key, tempo, groove, the lanes and sounds they did not mention. tracks is still the complete audible arrangement, so list every lane that should keep playing (by its routeId), and leave a setting null to keep its current value. Use null for drums and harmony when they should not change. If the request conflicts with the current song, follow the request.`,
}

/**
 * @param {'new'|'edit'|'both'} [mode]  'both' is for the MCP guide, where one
 *   guide serves new songs and edits alike.
 * @returns {string} the universal policy plus the mode paragraph(s)
 */
export function musicalPolicyText(mode = 'new') {
  const modes = mode === 'both' ? COMPOSE_MODES : [MODE_TEXT[mode] ? mode : 'new']
  return [POLICY_CORE, ...modes.map(m => MODE_TEXT[m])].join('\n\n')
}

// ---------------------------------------------------------------------------
// Genre recipes. `aliases` are lowercase phrases matched as whole words;
// `borrow` is what a hybrid takes from this style when it is the secondary one;
// selection is longest-alias-first so "deep house" beats "house" and "dub
// techno" beats "techno". Drum seeds are 16 sixteenth steps (guide §3), as
// step indexes; they are seeds to vary, not transcriptions.
// ---------------------------------------------------------------------------

export const GENRE_RECIPES = [
  {
    id: 'house', label: 'House',
    aliases: ['house', 'four on the floor', 'four-on-the-floor', 'disco house', 'funky house'],
    borrow: 'a quarter-note kick with offbeat hats',
    bpm: { min: 120, max: 130, default: 124 },
    text: `Drums + compact bass + one short hook. Quarter-note kick (steps 0,4,8,12), clap on 4 and 12, offbeat hats on 2,6,10,14 quieter than the kick. Make the bass rhythm converse with the kick; duck it or the support off drums:kick for breathing. Bright, short envelope on the hook, light reverb, a quiet synced delay response. Support softer than the hook. Reject: an incessant high arpeggio hiding the bass groove. Suggested edits: open the hook filter a little, raise its delay send, lower support volume.`,
  },
  {
    id: 'deep-house', label: 'Deep house',
    aliases: ['deep house', 'deep-house', 'deephouse', 'soulful house'],
    borrow: 'warm keys-like colour and restrained brightness',
    bpm: { min: 118, max: 125, default: 122 },
    text: `House pulse with warm, restrained colour. Warm keys-like Sampler (piano, electric piano, organ) as the foreground, simple low bass, optional quiet upper answer. Minor or dorian, modest variety, restrained brightness (lowpass keys). Stable quarter-note kick, clap backbeat, lighter offbeat hats. Short reverb for depth, a quiet dotted-eighth (8n.) echo; optional gentle chorus on support. True swing and authored chord changes are unavailable: describe it as a route-based sketch on a straight grid. Suggested edits: darken the keys, raise their delay send, slow the upper lane.`,
  },
  {
    id: 'hypnotic-techno', label: 'Techno',
    aliases: ['techno', 'hypnotic techno', 'minimal techno', 'warehouse techno', 'berlin techno'],
    borrow: 'a repeated narrow-range rhythmic cell over a firm kick',
    bpm: { min: 125, max: 140, default: 132 },
    text: `Hypnotic, drum-led techno: rhythm and sound colour are the hook. Firm four-on-the-floor kick, offbeat hats, sparse clap; a short, dry low part (MonoSynth, low filter, ducked by drums:kick); one narrow-range synth cell (randomWalk, variety ≤ 0.15, 16n grid); optional quiet metallic answer on a rest pattern. Phrygian or minor. Controlled distortion or an autofilter on the cell, a small delay send; keep the bass dry. One drifting upper loop may run against the stable drums. Reject: every lane moving across two octaves under long reverb tails. Suggested edits: cell filter cutoff, distortion send, the answer's rest pattern.`,
  },
  {
    id: 'dub-techno', label: 'Dub techno',
    aliases: ['dub techno', 'dub-techno', 'dubtechno', 'dub', 'basic channel', 'echo chamber'],
    borrow: 'sparse stabs answered by a synced delay, with negative space',
    bpm: { min: 110, max: 125, default: 118 },
    text: `Sparse stab-like upper material, a quiet low anchor, and lots of negative space for echo. A synced delay (8n. or 4n., feedback 0.45–0.65) is the audible answer to the stabs, with a synthetic reverb behind it; the bass stays nearly dry. Short-envelope stab lane on a coarse grid with low density (noteChance allowed only on the stab); steady soft kick, rim or hat accents. Avoid competing busy melodies. Exact chord stabs and a feedback-effects chain are unavailable — the stab is one note per stop. Suggested edits: vary the stab's delay send, then its filter, then the delay feedback.`,
  },
  {
    id: 'melodic-techno', label: 'Melodic techno',
    aliases: ['melodic techno', 'melodic-techno', 'afterlife', 'progressive techno', 'progressive house'],
    borrow: 'one dominant melodic figure over restrained support',
    bpm: { min: 120, max: 130, default: 124 },
    text: `One upper figure dominates; slower bass underneath; one restrained sustained support. Minor or dorian colour chosen deliberately. At most one arpeggiated role. Sparse, steady beat. Reverb and delay on the lead, support darker. A tension/build/drop arc needs section control that does not exist — deliver a loop, not a track. Do not describe independent scale melodies as a composed progression. Suggested edits: shorten the hook release for definition, raise it an octave for lift, add delay send.`,
  },
  {
    id: 'lofi', label: 'Lo-fi',
    aliases: ['lo-fi', 'lofi', 'lo fi', 'chillhop', 'study beats', 'lo-fi hip-hop', 'lofi hip hop', 'hip-hop', 'hip hop', 'boom bap'],
    borrow: 'soft attacks, lowpassed keys and a relaxed backbeat',
    bpm: { min: 65, max: 90, default: 78 },
    text: `Relaxed backbeat, soft attacks, economical melodic loop. Warm keys-like Sampler lead (piano/electric piano), lowpassed around 2.5–4 kHz; optional sparse bass; little high-frequency competition. Kick on 0,7,10, snare on 4 and 12, even hats quieter with unequal accents. Softer envelopes, small chorus and a short synthetic reverb; bitcrusher lightly on the drums if wanted. There is no tape/crackle model and no swing: low BPM plus low-pass alone is not a groove — lean on the accents. Suggested edits: lower melodic variety, a slightly brighter filter, the chorus send.`,
  },
  {
    id: 'ambient', label: 'Ambient',
    aliases: ['ambient', 'generative', 'soundscape', 'atmospheric', 'meditative'],
    borrow: 'spaciousness — slower support layers, a longer synthetic reverb and fewer onsets',
    bpm: { min: 60, max: 90, default: 72 },
    text: `Two or three complementary layers, no drums unless asked, slow perceived events, and one relatively clear foreground detail. Use speed 0.25–0.5, 4n/8n grids and low-stop lines; long releases need fewer onsets. Choose compatible tonal material (lydian, major, pentatonic) before adding space. Synthetic reverb 3–6 s mostly on support, a slow synced delay on the detail, an optional quiet granular halo on one pad. Tempo is only a scheduling convenience here. Reject: dense notes hidden under huge reverb — slow music still needs an intentional distribution of events. Suggested edits: lower a support layer, shorten the detail's release, change the upper contour.`,
  },
  {
    id: 'synthwave', label: 'Synthwave',
    aliases: ['synthwave', 'retrowave', 'outrun', '80s', 'eighties', 'darksynth'],
    borrow: 'an even synth-bass pulse and a broad lead/pad contrast',
    bpm: { min: 85, max: 115, default: 100 },
    text: `Even synth-bass pulse (MonoSynth or DuoSynth, 8n grid), a clear backbeat (kick 0 and 8, snare 4 and 12), one legible lead (DuoSynth/Synth, brighter), softer pad-like support (AMSynth/PolySynth). Minor or dorian. Gentle chorus on support, restrained delay on the lead, reverb behind the melody. Gated-reverb snares and detailed analogue patches are unavailable — chorus and detune only approximate the palette. Suggested edits: darken the bass against a brighter lead, the lead's delay send, the pad's chorus send.`,
  },
  {
    id: 'ukg', label: 'UK garage',
    aliases: ['uk garage', 'ukg', '2-step', '2 step', 'two-step', 'two step', 'garage', 'speed garage'],
    borrow: 'a broken kick and short, syncopated bass',
    bpm: { min: 128, max: 138, default: 132 },
    text: `Broken kick (0 and 10), backbeat on 4 and 12, hats on 2,6,9,14 at mixed levels; short, syncopated bass notes (staccato envelope); sparse pluck-like responses (PluckSynth or short Sampler). Keep reverb short so the rhythmic gaps stay audible. The composer has no swing/microtiming or vocal-chop control: call the result a garage-inspired straight-grid sketch — authentic shuffle is a capability gap, not something tempo fixes. Suggested edits: reduce overlapping melodic activity, shorten the bass release, the pluck's delay send.`,
  },
  {
    id: 'dnb', label: 'Drum & bass',
    aliases: ['drum and bass', 'drum & bass', 'drum n bass', "drum'n'bass", 'dnb', 'd&b', 'liquid dnb', 'jungle'],
    borrow: 'fast broken drums under slow harmony',
    bpm: { min: 168, max: 176, default: 174 },
    text: `Fast broken drums (kick 0 and 10, snare 4 and 12, running hats on even steps quieter), a slower sparse bass and harmony, and one clear melodic detail. Do not make pitched lanes play at drum speed: use speed 0.25–0.5 and coarse grids for bass and pads. Leave the bass mostly dry; add space to upper material. One 16-step kit pattern cannot reproduce sliced breaks or ghost-note detail. Suggested edits: simplify the lead, darken the support, the pad's reverb send.`,
  },
  {
    id: 'trance', label: 'Trance',
    aliases: ['trance', 'uplifting trance', 'psytrance', 'progressive trance'],
    borrow: 'one arpeggiated focal lane with delay for lift',
    bpm: { min: 134, max: 142, default: 138 },
    text: `One arpeggiated focal lane (arp enabled, 16n, up/upDown), rhythmically clear low support, restrained pad-like material, steady four-on-the-floor drums with offbeat hats. Minor. Delay for lift and reverb behind the lead. This is a trance-inspired loop: exact chord sequences, supersaw programming, risers and a composed breakdown/drop are unavailable. Suggested edits: the focal arp's rate or its filter (one at a time), the pad level, the lead's delay send.`,
  },
]

export const RECIPE_IDS = GENRE_RECIPES.map(r => r.id)
const RECIPE_BY_ID = new Map(GENRE_RECIPES.map(r => [r.id, r]))

export function recipeById(id) {
  return RECIPE_BY_ID.get(id) ?? null
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Every alias, longest first. The earliest-mentioned style is the primary and
// the next distinct one the secondary (see the modifier rule in selectRecipe).
const ALIASES = GENRE_RECIPES
  .flatMap(recipe => recipe.aliases.map(alias => ({
    recipe,
    alias,
    re: new RegExp(`(^|[^a-z0-9])${escapeRe(alias)}(?=$|[^a-z0-9])`, 'i'),
  })))
  .sort((a, b) => b.alias.length - a.alias.length)

/**
 * Pick the genre recipe for a request.
 * @param {string} prompt           the user's request text
 * @param {string|null} [overrideId] an explicit recipe id (UI chip / MCP genre) — always wins
 * @returns {{ recipe: object, secondary: object|null, source: 'override'|'auto' } | null}
 */
export function selectRecipe(prompt, overrideId = null) {
  const override = overrideId ? recipeById(overrideId) : null
  if (override) return { recipe: override, secondary: null, source: 'override' }

  const text = String(prompt ?? '').toLowerCase()
  if (!text.trim()) return null
  // Longest alias first; a span already claimed by a longer alias ("deep house")
  // can't also count as a shorter one ("house").
  const claimed = []
  const hits = new Map()
  for (const { recipe, alias, re } of ALIASES) {
    const m = re.exec(text)
    if (!m) continue
    const start = m.index + m[1].length
    const end = start + alias.length
    if (claimed.some(([s, e]) => start < e && end > s)) continue
    claimed.push([start, end])
    const prev = hits.get(recipe.id)
    if (prev == null || start < prev.start) hits.set(recipe.id, { start, end })
  }
  if (!hits.size) return null
  const ordered = [...hits.entries()].sort((a, b) => a[1].start - b[1].start)
  // "ambient techno", "lo-fi house": a style named directly before another is a
  // modifier, so the noun keeps the groove. "techno with ambient pads" is not.
  if (ordered.length > 1 && /^[\s-]*$/.test(text.slice(ordered[0][1].end, ordered[1][1].start))) {
    ordered.splice(0, 2, ordered[1], ordered[0])
  }
  const [primary, secondary] = ordered.map(([id]) => recipeById(id))
  return { recipe: primary, secondary: secondary ?? null, source: 'auto' }
}

/** The prompt block for a selection (empty string for none). */
export function recipeContextText(selection) {
  if (!selection?.recipe) return ''
  const { recipe, secondary } = selection
  const lines = [
    `GENRE RECIPE — ${recipe.label} (start around ${recipe.bpm.default} BPM; ${recipe.bpm.min}–${recipe.bpm.max} is a starting region, not a rule — a tempo the user names wins):`,
    recipe.text,
  ]
  if (secondary) {
    lines.push(`HYBRID: keep the ${recipe.label} groove as the primary identity and borrow one or two traits from ${secondary.label} (e.g. ${secondary.borrow}). Say which traits you borrowed in the summary.`)
  }
  return lines.join('\n')
}

/** A compact recipe list for MCP clients to choose from. */
export function recipeCatalog() {
  return GENRE_RECIPES.map(({ id, label, bpm }) => ({ id, label, bpm: { ...bpm } }))
}
