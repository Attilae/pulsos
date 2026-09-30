// Native reference renderer for the Clouds granular bridge. Compiled by
// `node scripts/build_clouds.js --reference` with the host C++ compiler and the
// same sources and flags (minus the wasm target) as the shipped module, so
// scripts/clouds_compare.js can compare it with public/wasm/clouds-granular-*.wasm
// sample by sample.
//
// Usage: clouds-reference <scenario.txt> <source.f32> <out.f32>
//
// source.f32: little-endian float32 mono samples at 32 kHz, loaded before block 0.
// Scenario file, one command per line:
//   seed <u32>
//   params <size> <density> <scan_rate> <win_start> <win_end> <jitter> <window_shape> <spread> <reverse>
//   at <block> note <semitones>        (set pitch + seed a grain)
//   at <block> pitch <semitones>       (set pitch only)
//   at <block> params <9 values as above>
//   at <block> reload                  (load the same source again, with fade)
//   at <block> panic
//   blocks <n>                         (render length; must come last)
// Output: interleaved little-endian float32 L/R, 32 frames per block.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>

extern "C" {
void cg_init(unsigned seed);
void cg_set_params(float, float, float, float, float, float, float, float, int);
void cg_set_pitch(float semitones);
void cg_trigger();
void cg_panic();
void cg_load(int len, int immediate);
void cg_render();
float* cg_staging();
float* cg_out_l();
float* cg_out_r();
int cg_block_size();
int cg_max_source();
}

struct Event {
  long block;
  char kind;   // n=note p=pitch P=params r=reload x=panic
  float v[9];
};

static int ReadParams(const char* s, float* v) {
  return sscanf(s, "%f %f %f %f %f %f %f %f %f",
                &v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6], &v[7], &v[8]);
}

static void ApplyParams(const float* v) {
  cg_set_params(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], static_cast<int>(v[8]));
}

int main(int argc, char** argv) {
  if (argc != 4) {
    fprintf(stderr, "usage: %s <scenario.txt> <source.f32> <out.f32>\n", argv[0]);
    return 2;
  }
  FILE* in = fopen(argv[1], "r");
  if (!in) { perror(argv[1]); return 1; }

  unsigned seed = 1;
  float params[9] = { 2880, 5, 1, 0, 1, 0, 0.75f, 0.5f, 0 };
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
      if (!strcmp(cmd, "note")) { e.kind = 'n'; sscanf(rest, "%f", &e.v[0]); }
      else if (!strcmp(cmd, "pitch")) { e.kind = 'p'; sscanf(rest, "%f", &e.v[0]); }
      else if (!strcmp(cmd, "params")) { e.kind = 'P'; ReadParams(rest, e.v); }
      else if (!strcmp(cmd, "reload")) e.kind = 'r';
      else if (!strcmp(cmd, "panic")) e.kind = 'x';
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
  std::vector<float> source(cg_max_source());
  size_t len = fread(source.data(), sizeof(float), source.size(), src);
  fclose(src);

  cg_init(seed);
  ApplyParams(params);
  memcpy(cg_staging(), source.data(), len * sizeof(float));
  cg_load(static_cast<int>(len), 1);

  FILE* out = fopen(argv[3], "wb");
  if (!out) { perror(argv[3]); return 1; }
  const int n = cg_block_size();
  std::vector<float> frame(n * 2);
  size_t next = 0;
  for (long b = 0; b < blocks; ++b) {
    while (next < events.size() && events[next].block == b) {
      const Event& e = events[next++];
      switch (e.kind) {
        case 'n': cg_set_pitch(e.v[0]); cg_trigger(); break;
        case 'p': cg_set_pitch(e.v[0]); break;
        case 'P': ApplyParams(e.v); break;
        case 'r':
          memcpy(cg_staging(), source.data(), len * sizeof(float));
          cg_load(static_cast<int>(len), 0);
          break;
        case 'x': cg_panic(); break;
      }
    }
    cg_render();
    const float* l = cg_out_l();
    const float* r = cg_out_r();
    for (int i = 0; i < n; ++i) { frame[2 * i] = l[i]; frame[2 * i + 1] = r[i]; }
    fwrite(frame.data(), sizeof(float), frame.size(), out);
  }
  fclose(out);
  return 0;
}
