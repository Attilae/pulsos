// Native reference renderer for the Texture Mk II (Beads) bridge. Compiled by
// `node scripts/build_beads.js --reference` with the host C++ compiler and the
// same sources and flags (minus the wasm target) as the shipped module, so
// scripts/beads_compare.js can compare it with public/wasm/beads-*.wasm sample
// by sample.
//
// Usage: beads-reference <scenario.txt> <input.f32> <out.f32>
//
// input.f32: little-endian float32 mono, fed to both input channels one DSP
// sample at a time whatever the quality's rate (silence after it ends).
// Scenario file, one command per line:
//   seed <u32>
//   quality <0..3>
//   seedmode <button 0..2> <patched 0|1>
//   params <time> <size> <shape> <pitch> <timeAmt> <sizeAmt> <shapeAmt> <pitchAmt>
//          <density> <feedback> <dryWet> <reverb> <inGain> <freeze>
//   at <block> params <14 values as above>
//   at <block> quality <0..3>
//   at <block> seedmode <button> <patched>
//   at <block> gate <offset> <0|1>
//   at <block> reset
//   blocks <n>                         (render length; must come last)
// Output: interleaved little-endian float32 L, R; bd_block_size() frames per
// block at that block's quality.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>

extern "C" {
void bd_init(unsigned seed);
void bd_set_params(float, float, float, float, float, float, float, float,
                   float, float, float, float, float, int);
void bd_set_seed(int, int);
void bd_set_quality(int);
void bd_gate(int, int);
void bd_reset();
void bd_render();
float* bd_in_l();
float* bd_in_r();
float* bd_out_l();
float* bd_out_r();
int bd_block_size();
}

const int kParams = 14;

struct Event {
  long block;
  char kind;   // P=params q=quality s=seedmode g=gate r=reset
  float v[kParams];
};

static int ReadFloats(const char* s, float* v, int n) {
  int count = 0, used = 0;
  while (count < n && sscanf(s, "%f%n", &v[count], &used) == 1) { s += used; ++count; }
  return count;
}

static void ApplyParams(const float* v) {
  bd_set_params(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7],
                v[8], v[9], v[10], v[11], v[12], static_cast<int>(v[13]));
}

int main(int argc, char** argv) {
  if (argc != 4) {
    fprintf(stderr, "usage: %s <scenario.txt> <input.f32> <out.f32>\n", argv[0]);
    return 2;
  }
  FILE* in = fopen(argv[1], "r");
  if (!in) { perror(argv[1]); return 1; }

  unsigned seed = 1;
  int quality = 3;
  int seed_button = 2, seed_patched = 0;
  float params[kParams] = { 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0, 0.5f, 0, 1, 0 };
  long blocks = 0;
  std::vector<Event> events;

  char line[512];
  while (fgets(line, sizeof(line), in)) {
    long at = -1;
    int consumed = 0;
    char cmd[32];
    if (sscanf(line, "at %ld %31s %n", &at, cmd, &consumed) >= 2) {
      Event e;
      memset(&e, 0, sizeof(e));
      e.block = at;
      const char* rest = line + consumed;
      if (!strcmp(cmd, "params")) { e.kind = 'P'; ReadFloats(rest, e.v, kParams); }
      else if (!strcmp(cmd, "quality")) { e.kind = 'q'; ReadFloats(rest, e.v, 1); }
      else if (!strcmp(cmd, "seedmode")) { e.kind = 's'; ReadFloats(rest, e.v, 2); }
      else if (!strcmp(cmd, "gate")) { e.kind = 'g'; ReadFloats(rest, e.v, 2); }
      else if (!strcmp(cmd, "reset")) e.kind = 'r';
      else { fprintf(stderr, "unknown event: %s", line); return 2; }
      events.push_back(e);
    } else if (sscanf(line, "seed %u", &seed) == 1) {
    } else if (sscanf(line, "quality %d", &quality) == 1) {
    } else if (sscanf(line, "seedmode %d %d", &seed_button, &seed_patched) == 2) {
    } else if (!strncmp(line, "params ", 7)) {
      ReadFloats(line + 7, params, kParams);
    } else if (sscanf(line, "blocks %ld", &blocks) == 1) {
    }
  }
  fclose(in);

  FILE* src = fopen(argv[2], "rb");
  if (!src) { perror(argv[2]); return 1; }
  std::vector<float> input;
  float chunk[4096];
  size_t got;
  while ((got = fread(chunk, sizeof(float), 4096, src)) > 0) input.insert(input.end(), chunk, chunk + got);
  fclose(src);

  bd_init(seed);
  bd_set_quality(quality);
  bd_set_seed(seed_button, seed_patched);
  ApplyParams(params);

  FILE* out = fopen(argv[3], "wb");
  if (!out) { perror(argv[3]); return 1; }
  std::vector<float> frame;
  size_t next = 0;
  size_t k = 0;
  for (long b = 0; b < blocks; ++b) {
    while (next < events.size() && events[next].block == b) {
      const Event& e = events[next++];
      if (e.kind == 'P') ApplyParams(e.v);
      else if (e.kind == 'q') bd_set_quality(static_cast<int>(e.v[0]));
      else if (e.kind == 's') bd_set_seed(static_cast<int>(e.v[0]), static_cast<int>(e.v[1]));
      else if (e.kind == 'g') bd_gate(static_cast<int>(e.v[0]), static_cast<int>(e.v[1]));
      else if (e.kind == 'r') bd_reset();
    }
    const int n = bd_block_size();
    float* il = bd_in_l();
    float* ir = bd_in_r();
    for (int i = 0; i < n; ++i, ++k) il[i] = ir[i] = k < input.size() ? input[k] : 0.0f;
    bd_render();
    const float* l = bd_out_l();
    const float* r = bd_out_r();
    frame.resize(n * 2);
    for (int i = 0; i < n; ++i) { frame[2 * i] = l[i]; frame[2 * i + 1] = r[i]; }
    fwrite(frame.data(), sizeof(float), frame.size(), out);
  }
  fclose(out);
  return 0;
}
