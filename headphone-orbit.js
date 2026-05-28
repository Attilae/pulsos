/**
 * @schema 2.10
 */
const W = pencil.width;
const H = pencil.height;
const cx = W / 2;
const cy = H / 2;
const rMax = Math.min(W, H) / 2 - 10;

const nodes = [];

// Background concentric rings
for (let i = 1; i <= 5; i++) {
  const r = (i / 5) * rMax;
  nodes.push({
    type: "ellipse",
    x: cx - r,
    y: cy - r,
    width: r * 2,
    height: r * 2,
    fill: { type: "color", color: "#000", enabled: false },
    stroke: { align: "center", thickness: 1, fill: { type: "color", color: "#222" } },
    opacity: 0.7,
  });
}

// Radial spokes (compass-ish)
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  const x2 = cx + Math.cos(a) * rMax;
  const y2 = cy + Math.sin(a) * rMax;
  nodes.push({
    type: "path",
    x: 0,
    y: 0,
    width: W,
    height: H,
    viewBox: [0, 0, W, H],
    geometry: `M ${cx} ${cy} L ${x2.toFixed(1)} ${y2.toFixed(1)}`,
    stroke: { align: "center", thickness: 1, fill: { type: "color", color: "#1a1a1a" } },
    fill: { type: "color", color: "#000", enabled: false },
  });
}

// Vehicle dots placed along orbits with color
const vehicles = [
  { r: 0.42, a: 0.15, color: "#f0d040", label: "M1" },
  { r: 0.62, a: 0.55, color: "#e84848", label: "M2" },
  { r: 0.34, a: 1.10, color: "#3c8dd8", label: "M3" },
  { r: 0.78, a: 1.78, color: "#46c060", label: "M4" },
  { r: 0.55, a: 2.20, color: "#e8c020", label: "T4" },
  { r: 0.50, a: 2.85, color: "#e8c020", label: "T6" },
  { r: 0.70, a: 3.50, color: "#9070d0", label: "B7" },
  { r: 0.45, a: 4.10, color: "#4ec3a8", label: "H5" },
  { r: 0.86, a: 4.65, color: "#e84848", label: "M2" },
  { r: 0.30, a: 5.20, color: "#f0d040", label: "M1" },
];
for (const v of vehicles) {
  const r = v.r * rMax;
  const x = cx + Math.cos(v.a) * r;
  const y = cy + Math.sin(v.a) * r;
  // glow halo
  nodes.push({
    type: "ellipse",
    x: x - 10,
    y: y - 10,
    width: 20,
    height: 20,
    fill: { type: "color", color: v.color },
    opacity: 0.18,
  });
  nodes.push({
    type: "ellipse",
    x: x - 4,
    y: y - 4,
    width: 8,
    height: 8,
    fill: { type: "color", color: v.color },
  });
  nodes.push({
    type: "text",
    x: x + 8,
    y: y - 5,
    content: v.label,
    fill: "#888",
    fontSize: 8,
    fontFamily: "Courier New",
  });
}

// Listener (center) — animated waveform dot
nodes.push({
  type: "ellipse",
  x: cx - 22,
  y: cy - 22,
  width: 44,
  height: 44,
  fill: { type: "color", color: "#c8f040" },
  opacity: 0.08,
});
nodes.push({
  type: "ellipse",
  x: cx - 12,
  y: cy - 12,
  width: 24,
  height: 24,
  fill: { type: "color", color: "#c8f040" },
  opacity: 0.18,
});
nodes.push({
  type: "ellipse",
  x: cx - 5,
  y: cy - 5,
  width: 10,
  height: 10,
  fill: { type: "color", color: "#c8f040" },
});
// "YOU" label
nodes.push({
  type: "text",
  x: cx - 12,
  y: cy + 14,
  content: "YOU",
  fill: "#c8f040",
  fontSize: 9,
  fontFamily: "Courier New",
});

return nodes;
