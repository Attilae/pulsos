// Native reference renderer for the Resonator bridge. Compiled by
// `node scripts/build-resonator.js --reference` with the host C++ compiler and
// the same sources and flags (minus the wasm target) as the shipped module, so
// test/resonator-dsp.test.js — or scripts/resonator-compare.js — can compare
// its output against public/wasm/resonator-*.wasm sample by sample.
//
// Usage: resonator-reference <scenario.txt> <out.f32>
//
// Scenario file, one command per line:
//   seed <u32>
//   voices <n>
//   model <m>
//   patch <structure> <brightness> <damping> <position>
//   at <block> trigger <midi> <velocity>
//   at <block> model <m>
//   at <block> patch <s> <b> <d> <p>
//   at <block> panic
//   blocks <n>                  (render length; must come last)
// Output: interleaved little-endian float32 L/R, 24 frames per block.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>

extern "C" {
void rs_init(unsigned seed);
void rs_set_voices(int n);
void rs_set_model(int m, int immediate);
void rs_set_patch(float s, float b, float d, float p, int immediate);
int rs_trigger(float note, float velocity);
void rs_panic();
void rs_render();
float* rs_out_l();
float* rs_out_r();
}

struct Event {
  long block;
  char kind;   // t=trigger m=model p=patch x=panic
  float a, b, c, d;
};

int main(int argc, char** argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: %s <scenario.txt> <out.f32>\n", argv[0]);
    return 2;
  }
  FILE* in = fopen(argv[1], "r");
  if (!in) { perror(argv[1]); return 1; }

  unsigned seed = 1;
  int voices = 2, model = 0;
  float patch[4] = { 0.4f, 0.5f, 0.6f, 0.4f };
  long blocks = 0;
  std::vector<Event> events;

  char line[256];
  while (fgets(line, sizeof(line), in)) {
    long at = -1;
    char cmd[32] = { 0 };
    const char* rest = line;
    int consumed = 0;
    if (sscanf(line, " at %ld %31s %n", &at, cmd, &consumed) >= 2) {
      rest = line + consumed;
      Event e = { at, 0, 0, 0, 0, 0 };
      if (!strcmp(cmd, "trigger")) { e.kind = 't'; sscanf(rest, "%f %f", &e.a, &e.b); }
      else if (!strcmp(cmd, "model")) { e.kind = 'm'; sscanf(rest, "%f", &e.a); }
      else if (!strcmp(cmd, "patch")) { e.kind = 'p'; sscanf(rest, "%f %f %f %f", &e.a, &e.b, &e.c, &e.d); }
      else if (!strcmp(cmd, "panic")) { e.kind = 'x'; }
      else continue;
      events.push_back(e);
    } else if (sscanf(line, " seed %u", &seed) == 1) {
    } else if (sscanf(line, " voices %d", &voices) == 1) {
    } else if (sscanf(line, " model %d", &model) == 1) {
    } else if (sscanf(line, " patch %f %f %f %f", &patch[0], &patch[1], &patch[2], &patch[3]) == 4) {
    } else if (sscanf(line, " blocks %ld", &blocks) == 1) {
    }
  }
  fclose(in);

  rs_init(seed);
  rs_set_voices(voices);
  rs_set_model(model, 1);
  rs_set_patch(patch[0], patch[1], patch[2], patch[3], 1);

  FILE* out = fopen(argv[2], "wb");
  if (!out) { perror(argv[2]); return 1; }
  size_t next = 0;
  float frame[48];
  for (long b = 0; b < blocks; ++b) {
    while (next < events.size() && events[next].block == b) {
      const Event& e = events[next++];
      if (e.kind == 't') rs_trigger(e.a, e.b);
      else if (e.kind == 'm') rs_set_model(static_cast<int>(e.a), 0);
      else if (e.kind == 'p') rs_set_patch(e.a, e.b, e.c, e.d, 0);
      else if (e.kind == 'x') rs_panic();
    }
    rs_render();
    const float* l = rs_out_l();
    const float* r = rs_out_r();
    for (int i = 0; i < 24; ++i) { frame[2 * i] = l[i]; frame[2 * i + 1] = r[i]; }
    fwrite(frame, sizeof(float), 48, out);
  }
  fclose(out);
  return 0;
}
