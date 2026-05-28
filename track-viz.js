/**
 * @schema 2.10
 * @input color: color = #c8f040
 * @input seed: number = 1
 * @input notes: number = 28
 */
const W = pencil.width;
const H = pencil.height;
const color = pencil.input.color;
const seed = pencil.input.seed;
const noteCount = Math.max(8, Math.floor(pencil.input.notes));

// deterministic-ish pseudo-random from seed
let s = seed * 9301 + 49297;
function rand() {
  s = (s * 9301 + 49297) % 233280;
  return s / 233280;
}
// burn a few
for (let i = 0; i < 5; i++) rand();

const nodes = [];

// 4 bar markers
const bars = 4;
for (let b = 0; b < bars; b++) {
  const x = (b / bars) * W + 6;
  nodes.push({
    type: "rectangle",
    x: x,
    y: 0,
    width: 1,
    height: H,
    fill: { type: "color", color: "#3a3a1f", enabled: true },
    opacity: 0.5,
  });
  nodes.push({
    type: "text",
    x: x + 4,
    y: 2,
    content: String(b + 1),
    fill: "#888888",
    fontSize: 9,
    fontFamily: "Courier New",
  });
}

// tick marks at the bottom
const ticks = noteCount;
for (let t = 0; t < ticks; t++) {
  const x = (t / ticks) * W + (W / ticks) / 2;
  nodes.push({
    type: "rectangle",
    x: x,
    y: H - 6,
    width: 1,
    height: 4,
    fill: "#2a2a2a",
  });
}

// Generate notes
const notes = [];
for (let i = 0; i < noteCount; i++) {
  const x = (i / noteCount) * W + (W / noteCount) / 2;
  const y = 14 + rand() * (H - 36);
  notes.push({ x, y });
}

// Polyline connecting notes
let path = "";
for (let i = 0; i < notes.length; i++) {
  path += (i === 0 ? "M" : "L") + notes[i].x.toFixed(2) + " " + notes[i].y.toFixed(2) + " ";
}
nodes.push({
  type: "path",
  x: 0,
  y: 0,
  width: W,
  height: H,
  viewBox: [0, 0, W, H],
  geometry: path.trim(),
  stroke: { align: "center", thickness: 1.2, fill: { type: "color", color: color } },
  fill: { type: "color", color: "#000000", enabled: false },
  opacity: 0.85,
});

// Note dots
for (let i = 0; i < notes.length; i++) {
  const n = notes[i];
  nodes.push({
    type: "ellipse",
    x: n.x - 3,
    y: n.y - 3,
    width: 6,
    height: 6,
    fill: { type: "color", color: color },
  });
  // Tiny note label
  if (i % 2 === 0 && rand() > 0.3) {
    const noteNames = ["A3", "C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5"];
    const name = noteNames[Math.floor(rand() * noteNames.length)];
    nodes.push({
      type: "text",
      x: n.x - 8,
      y: n.y + 6,
      content: name,
      fill: "#666666",
      fontSize: 7,
      fontFamily: "Courier New",
    });
  }
}

// First-note highlight ring
if (notes.length > 0) {
  nodes.push({
    type: "ellipse",
    x: notes[0].x - 7,
    y: notes[0].y - 7,
    width: 14,
    height: 14,
    fill: { type: "color", color: color, enabled: false },
    stroke: { align: "center", thickness: 1.5, fill: { type: "color", color: color } },
    opacity: 0.6,
  });
}

return nodes;
