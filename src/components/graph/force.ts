/**
 * Deterministic force layout for small graphs (< 200 nodes). Springs on links,
 * repulsion between nodes, optional rings (radial targets per node) and gentle
 * centering. Same input → same picture, so layouts don't jump between renders.
 */

export type ForceNode = { id: string; r: number; ring?: number; group?: string; x?: number; y?: number; fixed?: boolean };
export type ForceLink = { source: string; target: string; length: number; strength?: number };
export type Positioned = Record<string, { x: number; y: number }>;

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

export function forceLayout(nodes: ForceNode[], links: ForceLink[], opts: { iterations?: number; ringStrength?: number; charge?: number; groupStrength?: number } = {}): Positioned {
  const iterations = opts.iterations ?? 320;
  const charge = opts.charge ?? 2600;
  const ringK = opts.ringStrength ?? 0.12;
  const groupK = opts.groupStrength ?? 0;
  const N = nodes.length;
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const x = new Float64Array(N);
  const y = new Float64Array(N);
  const vx = new Float64Array(N);
  const vy = new Float64Array(N);
  // Seed positions: on the node's ring (or a spiral) at a hashed angle, so output is stable.
  nodes.forEach((n, i) => {
    if (n.x != null && n.y != null) { x[i] = n.x; y[i] = n.y; return; }
    const a = hash(n.group ? `${n.group}` : n.id) * Math.PI * 2 + hash(n.id) * 0.9;
    const rad = n.ring ?? 60 + Math.sqrt(i + 1) * 46;
    x[i] = Math.cos(a) * rad;
    y[i] = Math.sin(a) * rad;
  });
  const L = links.map((l) => ({ s: idx.get(l.source)!, t: idx.get(l.target)!, len: l.length, k: l.strength ?? 0.06 })).filter((l) => l.s != null && l.t != null);
  // Group centroids pull members together (e.g. services of one cluster).
  const groups = new Map<string, number[]>();
  nodes.forEach((n, i) => { if (n.group) { const g = groups.get(n.group) ?? []; g.push(i); groups.set(n.group, g); } });

  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations;
    // Repulsion.
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = x[j] - x[i];
        let dy = y[j] - y[i];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (hash(`${i}-${j}`) - 0.5) * 2; dy = (hash(`${j}-${i}`) - 0.5) * 2; d2 = dx * dx + dy * dy + 1; }
        const minD = nodes[i].r + nodes[j].r + 18;
        const f = (charge * alpha) / d2 + (d2 < minD * minD ? (minD - Math.sqrt(d2)) * 0.5 : 0);
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        vx[i] -= fx; vy[i] -= fy; vx[j] += fx; vy[j] += fy;
      }
    }
    // Springs.
    for (const l of L) {
      const dx = x[l.t] - x[l.s];
      const dy = y[l.t] - y[l.s];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - l.len) * l.k * alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      vx[l.s] += fx; vy[l.s] += fy; vx[l.t] -= fx; vy[l.t] -= fy;
    }
    // Rings.
    nodes.forEach((n, i) => {
      if (n.ring == null) { vx[i] -= x[i] * 0.004 * alpha; vy[i] -= y[i] * 0.004 * alpha; return; }
      const d = Math.sqrt(x[i] * x[i] + y[i] * y[i]) || 1;
      const f = (n.ring - d) * ringK * alpha;
      vx[i] += (x[i] / d) * f;
      vy[i] += (y[i] / d) * f;
    });
    if (groupK) for (const members of groups.values()) {
      let cx = 0; let cy = 0;
      for (const i of members) { cx += x[i]; cy += y[i]; }
      cx /= members.length; cy /= members.length;
      for (const i of members) { vx[i] += (cx - x[i]) * groupK * alpha; vy[i] += (cy - y[i]) * groupK * alpha; }
    }
    for (let i = 0; i < N; i++) {
      if (nodes[i].fixed) { vx[i] = 0; vy[i] = 0; continue; }
      vx[i] *= 0.55; vy[i] *= 0.55;
      x[i] += Math.max(-40, Math.min(40, vx[i]));
      y[i] += Math.max(-40, Math.min(40, vy[i]));
    }
  }
  const out: Positioned = {};
  nodes.forEach((n, i) => { out[n.id] = { x: x[i], y: y[i] }; });
  return out;
}

export function bounds(pos: Positioned, pad = 60, padY = pad) {
  const xs = Object.values(pos).map((p) => p.x);
  const ys = Object.values(pos).map((p) => p.y);
  if (!xs.length) return { x: -100, y: -100, w: 200, h: 200 };
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - padY;
  return { x: minX, y: minY, w: Math.max(...xs) + pad - minX, h: Math.max(...ys) + padY - minY };
}

/* ---------- radial tree ---------- */

export type TreeNode = { id: string; r: number; level: number; parent?: string };
export type RadialLayout = { pos: Positioned; angle: Record<string, number>; outer: number };

/**
 * Deterministic radial tree: roots share the circle in proportion to how many leaves
 * they carry, children sit inside their parent's slice, and each ring's radius grows
 * until neighbours on it no longer touch. Crowded outer rings alternate between two
 * radii so labels have room.
 */
export function radialTree(nodes: TreeNode[], opts: { gap?: number; step?: number; minRadius?: number } = {}): RadialLayout {
  const gap = opts.gap ?? 18;
  const step = opts.step ?? 120;
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    if (n.parent && ids.has(n.parent) && n.parent !== n.id) {
      const k = kids.get(n.parent) ?? [];
      k.push(n);
      kids.set(n.parent, k);
    } else roots.push(n);
  }
  const leaves = new Map<string, number>();
  const count = (n: TreeNode, seen = new Set<string>()): number => {
    if (seen.has(n.id)) return 1;
    seen.add(n.id);
    const c = kids.get(n.id) ?? [];
    const v = c.length ? c.reduce((s, k) => s + count(k, seen), 0) : 1;
    leaves.set(n.id, v);
    return v;
  };
  roots.forEach((r) => count(r));

  const angle: Record<string, number> = {};
  const assign = (list: TreeNode[], a0: number, a1: number) => {
    const total = list.reduce((s, n) => s + (leaves.get(n.id) ?? 1), 0) || 1;
    let a = a0;
    for (const n of list) {
      const span = ((a1 - a0) * (leaves.get(n.id) ?? 1)) / total;
      angle[n.id] = a + span / 2;
      const c = kids.get(n.id);
      if (c?.length) assign(c, a, a + span);
      a += span;
    }
  };
  const single = roots.length === 1;
  if (single) { angle[roots[0].id] = -Math.PI / 2; assign(kids.get(roots[0].id) ?? [], -Math.PI / 2, (3 * Math.PI) / 2); }
  else assign(roots, -Math.PI / 2, (3 * Math.PI) / 2);

  // Levels: the root of a single tree sits in the middle; everything else gets a ring.
  const levelOf = new Map<string, number>();
  const walk = (n: TreeNode, l: number) => { levelOf.set(n.id, l); for (const k of kids.get(n.id) ?? []) if (!levelOf.has(k.id)) walk(k, l + 1); };
  roots.forEach((r) => walk(r, single ? 0 : 1));
  const byLevel = new Map<number, TreeNode[]>();
  for (const n of nodes) { const l = levelOf.get(n.id) ?? 1; byLevel.set(l, [...(byLevel.get(l) ?? []), n]); }
  const maxLevel = Math.max(0, ...byLevel.keys());

  const radius = new Map<number, number>();
  let prev = 0;
  for (let l = 0; l <= maxLevel; l++) {
    const ring = byLevel.get(l) ?? [];
    if (l === 0) { radius.set(0, 0); prev = 0; continue; }
    const sorted = [...ring].sort((a, b) => angle[a.id] - angle[b.id]);
    let need = opts.minRadius ?? 70;
    for (let i = 0; i < sorted.length && sorted.length > 1; i++) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      let d = angle[b.id] - angle[a.id];
      if (i === sorted.length - 1) d += Math.PI * 2;
      if (d <= 1e-6) continue;
      need = Math.max(need, (a.r + b.r + gap) / d);
    }
    const R = Math.max(need, prev + step);
    radius.set(l, R);
    prev = R;
  }

  const pos: Positioned = {};
  for (const [l, ring] of byLevel) {
    const R = radius.get(l) ?? 0;
    const sorted = [...ring].sort((a, b) => angle[a.id] - angle[b.id]);
    // Stagger a crowded outer ring.
    const crowded = l === maxLevel && sorted.length > 1 && (R * Math.PI * 2) / sorted.length < 120;
    sorted.forEach((n, i) => {
      const rr = R + (crowded && i % 2 ? 46 : 0);
      const a = angle[n.id];
      pos[n.id] = l === 0 ? { x: 0, y: 0 } : { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
    });
  }
  return { pos, angle, outer: maxLevel };
}

export function levelsOf(nodes: TreeNode[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const parent = new Map(nodes.map((n) => [n.id, n.parent && ids.has(n.parent) ? n.parent : undefined]));
  const out = new Map<string, number>();
  const depth = (id: string, guard = 0): number => {
    if (out.has(id)) return out.get(id)!;
    const p = parent.get(id);
    const d = p && guard < 32 ? depth(p, guard + 1) + 1 : 0;
    out.set(id, d);
    return d;
  };
  nodes.forEach((n) => depth(n.id));
  return out;
}
