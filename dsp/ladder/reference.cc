// Native reference renderer for the Analog filter bridge. Compiled by
// `node scripts/build_ladder.js --reference` with the host C++ compiler and the
// same sources and flags (minus the wasm target) as the shipped module, so
// scripts/ladder_compare.js can compare it with public/wasm/ladder-*.wasm sample
// by sample.
//
// Usage: ladder-reference <scenario.txt> <frames.f32> <out.f32>
//
// frames.f32: little-endian float32, five values per sample:
//   inL, inR, cutoff Hz, resonance, drive
// Scenario file, one command per line:
//   rate <hz>
//   flags <ld_process flags>
//   mode <0..5>
//   at <block> mode <0..5> <fade samples>
//   at <block> reset
//   blocks <n>             (render length in 128-frame blocks; must come last)
// Output: interleaved little-endian float32 outL, outR.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>

extern "C" {
void ld_init(float rate);
void ld_reset();
void ld_set_mode(int mode, int fade);
void ld_process(int frames, int flags);
int ld_max_frames();
float* ld_in_l();
float* ld_in_r();
float* ld_out_l();
float* ld_out_r();
float* ld_freq();
float* ld_res();
float* ld_drive();
}

struct Event {
  long block;
  char kind;   // m=mode r=reset
  int a, b;
};

int main(int argc, char** argv) {
  if (argc != 4) {
    fprintf(stderr, "usage: %s <scenario.txt> <frames.f32> <out.f32>\n", argv[0]);
    return 2;
  }
  FILE* in = fopen(argv[1], "r");
  if (!in) { perror(argv[1]); return 1; }

  float rate = 48000.0f;
  int flags = 0, mode = 0;
  long blocks = 0;
  std::vector<Event> events;
  char line[256];
  while (fgets(line, sizeof(line), in)) {
    long at = -1;
    int consumed = 0;
    char cmd[32];
    if (sscanf(line, "at %ld %31s %n", &at, cmd, &consumed) >= 2) {
      Event e = { at, 0, 0, 0 };
      if (!strcmp(cmd, "mode")) { e.kind = 'm'; sscanf(line + consumed, "%d %d", &e.a, &e.b); }
      else if (!strcmp(cmd, "reset")) e.kind = 'r';
      else { fprintf(stderr, "unknown event: %s", line); return 2; }
      events.push_back(e);
    } else if (sscanf(line, "rate %f", &rate) == 1) {
    } else if (sscanf(line, "flags %d", &flags) == 1) {
    } else if (sscanf(line, "mode %d", &mode) == 1) {
    } else if (sscanf(line, "blocks %ld", &blocks) == 1) {
    }
  }
  fclose(in);

  FILE* src = fopen(argv[2], "rb");
  if (!src) { perror(argv[2]); return 1; }
  std::vector<float> frames;
  float chunk[4096];
  size_t got;
  while ((got = fread(chunk, sizeof(float), 4096, src)) > 0) frames.insert(frames.end(), chunk, chunk + got);
  fclose(src);

  ld_init(rate);
  ld_set_mode(mode, 0);

  FILE* out = fopen(argv[3], "wb");
  if (!out) { perror(argv[3]); return 1; }
  const int n = ld_max_frames();
  std::vector<float> buf(n * 2);
  size_t next = 0;
  for (long b = 0; b < blocks; ++b) {
    while (next < events.size() && events[next].block == b) {
      const Event& e = events[next++];
      if (e.kind == 'm') ld_set_mode(e.a, e.b);
      else if (e.kind == 'r') ld_reset();
    }
    for (int i = 0; i < n; ++i) {
      size_t k = (static_cast<size_t>(b) * n + i) * 5;
      const bool ok = k + 4 < frames.size();
      ld_in_l()[i] = ok ? frames[k] : 0.0f;
      ld_in_r()[i] = ok ? frames[k + 1] : 0.0f;
      ld_freq()[i] = ok ? frames[k + 2] : 20000.0f;
      ld_res()[i] = ok ? frames[k + 3] : 0.0f;
      ld_drive()[i] = ok ? frames[k + 4] : 1.0f;
    }
    ld_process(n, flags);
    for (int i = 0; i < n; ++i) { buf[2 * i] = ld_out_l()[i]; buf[2 * i + 1] = ld_out_r()[i]; }
    fwrite(buf.data(), sizeof(float), buf.size(), out);
  }
  fclose(out);
  return 0;
}
