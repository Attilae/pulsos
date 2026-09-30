// Native reference renderer for the Texture (Clouds granular) bridge. Compiled
// by `node scripts/build_clouds.js --reference` with the host C++ compiler and
// the same sources and flags (minus the wasm target) as the shipped module, so
// scripts/clouds_compare.js can compare it with public/wasm/clouds-granular-*.wasm
// sample by sample.
//
// Usage: clouds-reference <scenario.txt> <input.f32> <out.f32>
//
// input.f32: little-endian float32 mono at 32 kHz, fed to both input channels
// (silence after it ends).
// Scenario file, one command per line:
//   seed <u32>
//   params <position> <size> <pitch_knob> <density> <texture> <dry_wet> <spread> <feedback> <reverb> <in_gain> <freeze>
//   at <block> params <11 values as above>
//   at <block> trig
//   at <block> reset
//   blocks <n>                         (render length; must come last)
// Output: interleaved little-endian float32 wetL, wetR, dryGain; 32 frames per block.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>

extern "C" {
void cg_init(unsigned seed);
void cg_set_params(float, float, float, float, float, float, float, float, float, float, int);
void cg_trigger();
void cg_reset();
void cg_render();
float* cg_in_l();
float* cg_in_r();
float* cg_out_l();
float* cg_out_r();
float cg_dry_gain();
int cg_block_size();
}

struct Event {
  long block;
  char kind;   // P=params t=trig r=reset
  float v[11];
};

static int ReadParams(const char* s, float* v) {
  return sscanf(s, "%f %f %f %f %f %f %f %f %f %f %f",
                &v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6], &v[7], &v[8], &v[9], &v[10]);
}

static void ApplyParams(const float* v) {
  cg_set_params(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], static_cast<int>(v[10]));
}

int main(int argc, char** argv) {
  if (argc != 4) {
    fprintf(stderr, "usage: %s <scenario.txt> <input.f32> <out.f32>\n", argv[0]);
    return 2;
  }
  FILE* in = fopen(argv[1], "r");
  if (!in) { perror(argv[1]); return 1; }

  unsigned seed = 1;
  float params[11] = { 0, 0.5f, 0.5f, 0.5f, 0.5f, 0, 0, 0, 0, 1, 0 };
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
      if (!strcmp(cmd, "params")) { e.kind = 'P'; ReadParams(rest, e.v); }
      else if (!strcmp(cmd, "trig")) e.kind = 't';
      else if (!strcmp(cmd, "reset")) e.kind = 'r';
      else { fprintf(stderr, "unknown event: %s", line); return 2; }
      events.push_back(e);
    } else if (sscanf(line, "seed %u", &seed) == 1) {
    } else if (!strncmp(line, "params ", 7)) {
      ReadParams(line + 7, params);
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

  cg_init(seed);
  ApplyParams(params);

  FILE* out = fopen(argv[3], "wb");
  if (!out) { perror(argv[3]); return 1; }
  const int n = cg_block_size();
  std::vector<float> frame(n * 3);
  size_t next = 0;
  for (long b = 0; b < blocks; ++b) {
    while (next < events.size() && events[next].block == b) {
      const Event& e = events[next++];
      if (e.kind == 'P') ApplyParams(e.v);
      else if (e.kind == 't') cg_trigger();
      else if (e.kind == 'r') cg_reset();
    }
    float* il = cg_in_l();
    float* ir = cg_in_r();
    for (int i = 0; i < n; ++i) {
      size_t k = static_cast<size_t>(b) * n + i;
      il[i] = ir[i] = k < input.size() ? input[k] : 0.0f;
    }
    cg_render();
    const float* l = cg_out_l();
    const float* r = cg_out_r();
    const float dry = cg_dry_gain();
    for (int i = 0; i < n; ++i) { frame[3 * i] = l[i]; frame[3 * i + 1] = r[i]; frame[3 * i + 2] = dry; }
    fwrite(frame.data(), sizeof(float), frame.size(), out);
  }
  fclose(out);
  return 0;
}
