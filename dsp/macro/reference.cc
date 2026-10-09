// Native reference renderer for the Macro bridge. Compiled by
// `node scripts/build_macro.js --reference` with the host C++ compiler and the
// same sources and flags (minus the wasm target) as the shipped module, so
// scripts/macro_compare.js can compare its output against
// public/wasm/macro-*.wasm sample by sample.
//
// Usage: macro-reference <scenario.txt> <out.f32>
//
// Scenario file, one command per line:
//   seed <u32>
//   voices <n>
//   engine <e>
//   patch <harm> <timbre> <morph> <fmAmt> <timbreAmt> <morphAmt> <decay> <colour> <transpose>
//   aux <mix>
//   at <block> trigger <midi> <velocity>
//   at <block> held <midi> <velocity> <hold_samples>
//   at <block> release <midi>        (negative midi: release all)
//   at <block> engine <e>
//   at <block> patch <9 values as above>
//   at <block> aux <mix>
//   at <block> voices <n>
//   at <block> panic
//   blocks <n>                  (render length; must come last)
// Output: little-endian mono float32, 12 frames per block.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>

extern "C" {
void mc_init(unsigned seed);
void mc_set_voices(int n);
void mc_set_engine(int e, int immediate);
void mc_set_patch(float h, float t, float m, float fa, float ta, float ma, float d, float c, float tr, int immediate);
void mc_set_aux(float mix);
int mc_trigger(float note, float velocity);
int mc_trigger_held(float note, float velocity, int hold);
void mc_release(float note);
void mc_panic();
void mc_render();
int mc_block_size();
float* mc_out();
}

struct Event {
  long block;
  char kind;   // t=trigger h=held r=release e=engine p=patch a=aux v=voices x=panic
  float v[9];
};

int main(int argc, char** argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: %s <scenario.txt> <out.f32>\n", argv[0]);
    return 2;
  }
  FILE* in = fopen(argv[1], "r");
  if (!in) { perror(argv[1]); return 1; }

  unsigned seed = 1;
  int voices = 2, engine = 8;
  float patch[9] = { 0.5f, 0.5f, 0.5f, 0, 0, 0, 0.5f, 0.5f, 0 };
  float aux = 0;
  long blocks = 0;
  std::vector<Event> events;

  char line[512];
  while (fgets(line, sizeof(line), in)) {
    long at = -1;
    char cmd[32] = { 0 };
    int consumed = 0;
    if (sscanf(line, " at %ld %31s %n", &at, cmd, &consumed) >= 2) {
      const char* rest = line + consumed;
      Event e;
      memset(&e, 0, sizeof(e));
      e.block = at;
      float* v = e.v;
      if (!strcmp(cmd, "trigger")) { e.kind = 't'; sscanf(rest, "%f %f", &v[0], &v[1]); }
      else if (!strcmp(cmd, "held")) { e.kind = 'h'; sscanf(rest, "%f %f %f", &v[0], &v[1], &v[2]); }
      else if (!strcmp(cmd, "release")) { e.kind = 'r'; sscanf(rest, "%f", &v[0]); }
      else if (!strcmp(cmd, "engine")) { e.kind = 'e'; sscanf(rest, "%f", &v[0]); }
      else if (!strcmp(cmd, "patch")) {
        e.kind = 'p';
        sscanf(rest, "%f %f %f %f %f %f %f %f %f", &v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6], &v[7], &v[8]);
      }
      else if (!strcmp(cmd, "aux")) { e.kind = 'a'; sscanf(rest, "%f", &v[0]); }
      else if (!strcmp(cmd, "voices")) { e.kind = 'v'; sscanf(rest, "%f", &v[0]); }
      else if (!strcmp(cmd, "panic")) { e.kind = 'x'; }
      else continue;
      events.push_back(e);
    } else if (sscanf(line, " seed %u", &seed) == 1) {
    } else if (sscanf(line, " voices %d", &voices) == 1) {
    } else if (sscanf(line, " engine %d", &engine) == 1) {
    } else if (sscanf(line, " patch %f %f %f %f %f %f %f %f %f", &patch[0], &patch[1], &patch[2], &patch[3],
                      &patch[4], &patch[5], &patch[6], &patch[7], &patch[8]) == 9) {
    } else if (sscanf(line, " aux %f", &aux) == 1) {
    } else if (sscanf(line, " blocks %ld", &blocks) == 1) {
    }
  }
  fclose(in);

  mc_init(seed);
  mc_set_voices(voices);
  mc_set_engine(engine, 1);
  mc_set_patch(patch[0], patch[1], patch[2], patch[3], patch[4], patch[5], patch[6], patch[7], patch[8], 1);
  mc_set_aux(aux);

  FILE* out = fopen(argv[2], "wb");
  if (!out) { perror(argv[2]); return 1; }
  const int block = mc_block_size();
  size_t next = 0;
  for (long b = 0; b < blocks; ++b) {
    while (next < events.size() && events[next].block == b) {
      const Event& e = events[next++];
      const float* v = e.v;
      if (e.kind == 't') mc_trigger(v[0], v[1]);
      else if (e.kind == 'h') mc_trigger_held(v[0], v[1], static_cast<int>(v[2]));
      else if (e.kind == 'r') mc_release(v[0]);
      else if (e.kind == 'e') mc_set_engine(static_cast<int>(v[0]), 0);
      else if (e.kind == 'p') mc_set_patch(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], 0);
      else if (e.kind == 'a') mc_set_aux(v[0]);
      else if (e.kind == 'v') mc_set_voices(static_cast<int>(v[0]));
      else if (e.kind == 'x') mc_panic();
    }
    mc_render();
    fwrite(mc_out(), sizeof(float), block, out);
  }
  fclose(out);
  return 0;
}
