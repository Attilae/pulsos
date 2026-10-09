# Instrument lane filter: open source DSP research

Research date: 2026-10-09. Scope: the shared lane insert, available across instrument types. This is a source/documentation review, not an audio audition or browser benchmark. Effort and CPU comparisons below are engineering estimates.

## Recommendation

Prototype **DaisySP `LadderFilter` as an optional Analog model**, alongside the existing Tone filter. It adds nonlinear drive, resonance into self-oscillation, and selectable responses in a small C++ component. Compile the selected sources to WASM and run a stereo instance in an AudioWorklet. Its source has a permissive MIT-style grant. [Source/API](https://github.com/daisyaudio/DaisySP/blob/master/Source/Filters/ladder.h).

If we also want a flexible clean model, evaluate **Mutable Instruments `stmlib::Svf`**. It fits the Mutable DSP already used by this project and includes multimode processing. It is a linear filter core; saturation would be an additional design decision. [Source](https://github.com/pichenettes/stmlib/blob/master/dsp/filter.h).

Keep existing songs on the current filter unless explicitly changed. A new topology will change their sound even at apparently identical cutoff/resonance settings.

## Current Leið implementation

The insert is `Tone.Filter`, with four UI responses: lowpass, highpass, bandpass and notch. Controls are cutoff 20–20,000 Hz and Q 0.1–20. There are no displayed model, drive, slope, mix or bypass controls.

The graph is:

```text
instrument / optional Texture → laneIn → routeGain → filter
  → weq8 EQ → sidechain duckGain → pan → output and FX sends
```

Relevant code:

- `lib/engine.js`: `_createSingleRouteEntry`, `setRouteFilter`, `_applyAutomation`, `_restoreParamToManual`, disposal, and `_ensureDrumInsert`.
- `components/DawView.jsx`: `FilterPanel`.
- `components/tabs/MixerTab.jsx`: `trackFilters` and `handleFilter`.
- `lib/fxTrack.js`: `filter.frequency` and `filter.Q` automation targets.
- `lib/songState.js`: snapshot save/load and engine application.
- `lib/snapshotPlayer.js`: Song Chainer uses the same engine and snapshots.
- `lib/ai/planContract.js`, plan application paths and `lib/ai/planSnapshot.js`: accepted filter fields and AI summaries.

Manual cutoff/Q changes ramp over 50 ms. Automation calls Tone-like parameter `rampTo` methods, using lane glide with a 10 ms minimum. The default is `{ type: 'lowpass', frequency: 20000, Q: 4 }`.

The MonoSynth filter envelope is a separate, instrument-internal stage. Upgrading this shared insert does not replace that per-voice envelope.

## Candidate comparison

| Candidate | What it offers | Browser integration estimate | Assessment |
| --- | --- | --- | --- |
| DaisySP `LadderFilter` | Nonlinear ladder, drive, resonance, several responses | Moderate: selected C++ sources → WASM + stereo worklet | First prototype for audible character |
| Mutable `stmlib::Svf` | Zero-delay-feedback SVF and multimode processing | Low–moderate: small wrapper around existing DSP conventions | Best complementary clean core |
| Faust `vaeffects` | Multiple analog filter topologies and generated WebAudio support | Moderate–high: new DSP build toolchain and model adapters | Best if model variety is the priority |
| Airwindows `ZLowpass2` | Sampler-inspired nonlinear lowpass with interpolated coefficients | Moderate–high: extract DSP from plugin class | Interesting later character option |
| Signalsmith DSP | Flexible biquad design utilities | Moderate: portable C++ wrapper | Useful utility, smaller instrument-filter upgrade |
| ChowDSP WDF | Components for building circuit models | High: design and validate a circuit as well as its host | Future custom-model toolkit |
| Surge `sst-filters` | Broad synth filter collection | Higher: library dependencies, SIMD and licensing decisions | Conditional on GPL-compatible distribution |

### DaisySP ladder: first choice for character

The API exposes LP/BP/HP variants labelled 12/24 dB, input drive, passband gain compensation, and resonance up to 1.8. Its implementation uses four internal oversampling steps with linear interpolation and a fast tanh nonlinearity. [Implementation](https://github.com/daisyaudio/DaisySP/blob/master/Source/Filters/ladder.cpp).

Expected cost is higher than a simple linear SVF; no browser timings were measured. Internal oversampling does not establish alias-free behavior. Audition strong drive, high cutoff and extreme resonance before choosing production bounds.

Use the actual `Source/Filters/ladder.*` files. DaisySP also contains a separate LGPL component collection; the older `moogladder` name must not be treated as interchangeable with this source. Preserve the selected files' license notices and review transitive dependencies. [Repository and license structure](https://github.com/daisyaudio/DaisySP).

### Mutable stmlib: clean, compact alternative

`Svf` provides LP/HP/BP, normalized BP, and multimode routines. It supports exact and approximate frequency coefficient calculations. Its file carries an MIT grant. The same header also contains naive filters; select `Svf`, not `NaiveSvf`. [Source](https://github.com/pichenettes/stmlib/blob/master/dsp/filter.h).

Estimated DSP cost is relatively low, but worklet overhead and coefficient update rate still need measurement. Notch/output combinations and any nonlinear drive require deliberate adapter design. A different linear topology alone is not evidence of better sound than the current native filter.

### Faust: strongest route to a model collection

`vaeffects` includes Moog, diode ladder, Korg 35, Oberheim and Sallen-Key implementations. Model names do not guarantee circuit-faithful nonlinear behavior: `moogLadder` explicitly excludes nonlinearities. [Model documentation](https://faustlibraries.grame.fr/libs/vaeffects/).

The library source declares STK-4.3 for several of these models and contains an LGPL-with-Faust-exception section. Inspect the chosen function, its dependencies, and host code individually. [Library license declarations](https://github.com/grame-cncm/faustlibraries/blob/master/vaeffects.lib).

`faustwasm` supports AudioWorklet nodes and precompiled WASM. Our proposed deployment would compile DSP at build time and ship the processor assets, avoiding an in-browser compiler requirement. [WebAudio integration](https://github.com/grame-cncm/faustwasm).

### Airwindows: useful sampler flavor

The author describes `ZLowpass2` as inspired by the Emu e6400 Ultra lowpass, with coefficient interpolation and substantial input gain. It is MIT licensed. This is a character candidate, not a complete multimode replacement. [Author description](https://www.airwindows.com/zlowpass2/), [DSP source](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ZLowpass2/ZLowpass2Proc.cpp).

Extract the DSP rather than importing an AU/VST wrapper. Review parameter mapping, denormal handling and dither for our floating-point graph. Treat the claimed sound as something to audition, not an independently verified match to the hardware.

### Other candidates

**Signalsmith DSP:** MIT, C++11, header-only. Its filter tools include biquads and alternative frequency-response design methods. Good for utilities and response matching; it does not by itself provide the desired nonlinear ladder character. [Repository](https://github.com/Signalsmith-Audio/dsp), [Filter source](https://github.com/Signalsmith-Audio/dsp/blob/main/filters.h).

**ChowDSP WDF:** BSD-3-Clause, header-only C++14 circuit-modeling components. Valuable if we later design a particular circuit, but substantially more work than adopting a finished musical filter. [Repository/API](https://github.com/Chowdhury-DSP/chowdsp_wdf).

**Surge `sst-filters`:** a strong synth-oriented collection, distributed as GPL3. Do not assume all Surge libraries use MIT. Consider it if we choose compatible distribution terms; otherwise prefer the permissive shortlist. Its dependencies and SIMD strategy also need a WASM portability check. [Repository](https://github.com/surge-synthesizer/sst-filters).

## Proposed first integration

1. **Add a model choice:** Existing and Analog initially; Clean SVF only if listening tests justify it. Missing model fields select Existing. Keep response type separate from model.
2. **Reuse the current insert position.** Stereo state must be independent per channel. Use one stereo processor per lane, not one filter per synth voice. Account for drum inserts sharing the contract.
3. **Follow `lib/resonatorLoader.js` and `lib/resonatorVoice.js`.** Reuse per-context registration, readiness/error handling and WASM-byte transfer patterns, with an input added for the insert. Share assets across instances, allocate buffers before processing, and avoid allocations in the callback.
4. **Preserve automation timing.** Put cutoff, resonance and drive on scheduled AudioParams or an equivalent timestamped mechanism. Smooth in the audio processor; do not depend on React updates or unordered parameter messages for musical timing.
5. **Define resonance mappings explicitly.** Existing Q, stmlib Q and Daisy resonance are different contracts. Add normalized resonance for new models while preserving old Q semantics. Switching models needs an intentional mapping and a short crossfade.
6. **Make drive predictable.** `routeGain` currently precedes the filter, so lane volume would alter nonlinear saturation. Decide whether that is intended or move musical volume after the new filter while providing explicit input drive. Audition and preserve legacy ordering for Existing.
7. **Extend all state paths together:** snapshots, duplicate/change-line behavior, manual-value restoration, automation targets, AI/MCP schema and both plan application paths. Confirm Song Chainer and WAV export use the same result.
8. **Handle failures visibly.** Keep Existing available; if Analog cannot load, report the fallback instead of silently implying the selected sound is playing.

Proposed first controls: response, cutoff, resonance, drive, slope and bypass. Add output trim if drive/resonance make level matching difficult. LFO, envelope follower and morphing can follow after the core is validated.

## Evaluation before shipping

- Compare level-matched saw bass, sustained chords, sample transients and Texture through Existing and Analog. Audition static settings, slow sweeps and fast automation.
- Measure output bounds, DC, resonance peaks, aliasing under drive, and behavior near Nyquist at 44.1/48/96 kHz. Confirm silence and extreme input do not produce NaN/Inf.
- Check stereo isolation, mono input behavior, bypass/model-switch clicks and self-oscillation when a lane is disabled. Disabled lanes currently stop new notes; a self-oscillating insert may need additional gating.
- Benchmark 1/8/16/32 stereo instances on desktop Chrome and phone Safari with the real instrument/FX graph. Measure processing deadlines/dropouts and startup cost, not just average CPU. Compare native and WASM renders against the selected upstream reference.
- Validate snapshot round-trips, existing songs, automation ownership, duplication, Song Chainer and WAV capture. Run the relevant pure-logic tests and `npm run build` after implementation; listen in the app separately.

Decision gate: ship Analog only if it offers a worthwhile musical difference and acceptable phone performance. Preserve Existing for compatibility regardless of the result.
