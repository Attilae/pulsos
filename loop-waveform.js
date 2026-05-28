/**
 * @schema 2.10
 * @input seed: number = 1
 */
const W = pencil.width;
const H = pencil.height;
const seed = pencil.input.seed;
let s = seed * 9301 + 49297;
function rand() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
for (let i = 0; i < 5; i++) rand();

const nodes = [];
const lines = [
  { color: "#f0d040", y: H * 0.18 },
  { color: "#e84848", y: H * 0.36 },
  { color: "#3c8dd8", y: H * 0.54 },
  { color: "#46c060", y: H * 0.72 },
  { color: "#e8c020", y: H * 0.88 },
];

// 8 bar markers
for (let b = 0; b <= 8; b++) {
  const x = (b / 8) * W;
  nodes.push({
    type: "rectangle",
    x: x,
    y: 0,
    width: 1,
    height: H,
    fill: "#2a2a1a",
    opacity: 0.6,
  });
  nodes.push({
    type: "text",
    x: x + 4,
    y: 4,
    content: String(b + 1),
    fill: "#666666",
    fontSize: 9,
    fontFamily: "Courier New",
  });
}

// Notes per line
for (const line of lines) {
  const count = 12 + Math.floor(rand() * 16);
  for (let i = 0; i < count; i++) {
    const x = rand() * W;
    const w = 6 + rand() * 18;
    nodes.push({
      type: "rectangle",
      x: x,
      y: line.y - 4,
      width: w,
      height: 8,
      fill: line.color,
      cornerRadius: 2,
      opacity: 0.85,
    });
  }
}

// Playhead (recording position)
const playX = W * 0.62;
nodes.push({
  type: "rectangle",
  x: playX,
  y: 0,
  width: 2,
  height: H,
  fill: "#c8f040",
});
nodes.push({
  type: "rectangle",
  x: 0,
  y: 0,
  width: playX,
  height: H,
  fill: "#c8f040",
  opacity: 0.04,
});

return nodes;
