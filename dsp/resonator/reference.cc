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
//   envelope <on> <attack> <decay> <sustain> <release> <bow> <strike>
//   at <block> trigger <midi> <velocity>
//   at <block> held <midi> <velocity> <hold_samples>
//   at <block> release <midi>        (negative midi: release all)
//   at <block> envelope <on> <a> <d> <s> <r> <bow> <strike>
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
int rs_trigger_held(float note, float velocity, int hold);
void rs_release(float note);
void rs_set_envelope(int enabled, float a, float d, float s, float r, float bow, int strike);
void rs_panic();
void rs_render();
float* rs_out_l();
float* rs_out_r();
}

struct Event {
  long block;
  char kind;   // t=trigger h=held r=release e=envelope m=model p=patch x=panic
  float a, b, c, d, e, f, g;
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
  float env[7] = { 0, 0.005f, 0.3f, 0.7f, 1.5f, 0, 1 };
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
      Event e = { at, 0, 0, 0, 0, 0, 0, 0, 0 };
      if (!strcmp(cmd, "trigger")) { e.kind = 't'; sscanf(rest, "%f %f", &e.a, &e.b); }
      else if (!strcmp(cmd, "held")) { e.kind = 'h'; sscanf(rest, "%f %f %f", &e.a, &e.b, &e.c); }
      else if (!strcmp(cmd, "release")) { e.kind = 'r'; sscanf(rest, "%f", &e.a); }
      else if (!strcmp(cmd, "envelope")) { e.kind = 'e'; sscanf(rest, "%f %f %f %f %f %f %f", &e.a, &e.b, &e.c, &e.d, &e.e, &e.f, &e.g); }
      else if (!strcmp(cmd, "model")) { e.kind = 'm'; sscanf(rest, "%f", &e.a); }
      else if (!strcmp(cmd, "patch")) { e.kind = 'p'; sscanf(rest, "%f %f %f %f", &e.a, &e.b, &e.c, &e.d); }
      else if (!strcmp(cmd, "panic")) { e.kind = 'x'; }
      else continue;
      events.push_back(e);
    } else if (sscanf(line, " seed %u", &seed) == 1) {
    } else if (sscanf(line, " voices %d", &voices) == 1) {
    } else if (sscanf(line, " model %d", &model) == 1) {
    } else if (sscanf(line, " patch %f %f %f %f", &patch[0], &patch[1], &patch[2], &patch[3]) == 4) {
    } else if (sscanf(line, " envelope %f %f %f %f %f %f %f", &env[0], &env[1], &env[2], &env[3], &env[4], &env[5], &env[6]) == 7) {
    } else if (sscanf(line, " blocks %ld", &blocks) == 1) {
    }
  }
  fclose(in);

  rs_init(seed);
  rs_set_voices(voices);
  rs_set_model(model, 1);
  rs_set_patch(patch[0], patch[1], patch[2], patch[3], 1);
  rs_set_envelope(static_cast<int>(env[0]), env[1], env[2], env[3], env[4], env[5], static_cast<int>(env[6]));

  FILE* out = fopen(argv[2], "wb");
  if (!out) { perror(argv[2]); return 1; }
  size_t next = 0;
  float frame[48];
  for (long b = 0; b < blocks; ++b) {
    while (next < events.size() && events[next].block == b) {
      const Event& e = events[next++];
      if (e.kind == 't') rs_trigger(e.a, e.b);
      else if (e.kind == 'h') rs_trigger_held(e.a, e.b, static_cast<int>(e.c));
      else if (e.kind == 'r') rs_release(e.a);
      else if (e.kind == 'e') rs_set_envelope(static_cast<int>(e.a), e.b, e.c, e.d, e.e, e.f, static_cast<int>(e.g));
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
