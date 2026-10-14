// Axis-aligned box collision + ray queries. All level geometry is AABBs, which keeps
// collision cheap, exact and robust on phones.

export function makeBox(minX, minY, minZ, maxX, maxY, maxZ, opts = {}) {
  return {
    minX, minY, minZ, maxX, maxY, maxZ,
    surface: opts.surface || 'metal',
    active: opts.active !== undefined ? opts.active : true,
    solid: opts.solid !== undefined ? opts.solid : true, // false: blocks bullets? no -> see shootable
    shootable: opts.shootable !== undefined ? opts.shootable : true,
    nav: opts.nav !== undefined ? opts.nav : true, // participates in nav-grid blocking
    tag: opts.tag || null,
    ref: opts.ref || null,
  };
}

export function offsetBox(b, dx, dy, dz) {
  b.minX += dx; b.maxX += dx;
  b.minY += dy; b.maxY += dy;
  b.minZ += dz; b.maxZ += dz;
  return b;
}

const EPS = 0.001;

function overlaps(px, py, pz, r, h, b) {
  return px + r > b.minX && px - r < b.maxX &&
         pz + r > b.minZ && pz - r < b.maxZ &&
         py + h > b.minY && py < b.maxY;
}

/**
 * Move a body (feet position, half-width r, height h) through boxes with sliding.
 * body: { pos:{x,y,z}, vel:{x,y,z}, r, h, grounded, step }
 * Returns flags of what was hit (bitmask): 1 = wall X/Z, 2 = floor, 4 = ceiling.
 */
export function moveBody(body, dx, dy, dz, boxes) {
  let hit = 0;
  const maxStep = 0.3;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / maxStep));
  const sx = dx / steps, sy = dy / steps, sz = dz / steps;
  body.wallNormalX = 0; body.wallNormalZ = 0;
  let wasGrounded = body.grounded;
  body.grounded = false;
  for (let s = 0; s < steps; s++) {
    hit |= moveAxis(body, 0, sx, boxes, wasGrounded);
    hit |= moveAxis(body, 2, sz, boxes, wasGrounded);
    hit |= moveAxis(body, 1, sy, boxes, wasGrounded);
  }
  // ground probe (keeps grounded state stable when vy == 0)
  if (!body.grounded && dy <= 0) {
    const p = body.pos;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b.active || !b.solid) continue;
      if (p.x + body.r > b.minX && p.x - body.r < b.maxX && p.z + body.r > b.minZ && p.z - body.r < b.maxZ &&
          Math.abs(p.y - b.maxY) < 0.04) { body.grounded = true; body.groundBox = b; break; }
    }
  }
  return hit;
}

function moveAxis(body, axis, d, boxes, wasGrounded) {
  if (d === 0) return 0;
  const p = body.pos;
  if (axis === 0) p.x += d; else if (axis === 1) p.y += d; else p.z += d;
  let hit = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!b.active || !b.solid) continue;
    if (!overlaps(p.x, p.y, p.z, body.r, body.h, b)) continue;
    if (axis === 1) {
      if (d < 0) { p.y = b.maxY; body.grounded = true; body.groundBox = b; if (body.vel.y < 0) body.vel.y = 0; hit |= 2; }
      else { p.y = b.minY - body.h - EPS; if (body.vel.y > 0) body.vel.y = 0; hit |= 4; }
      continue;
    }
    // try stepping up small ledges
    const stepH = b.maxY - p.y;
    if (body.step > 0 && stepH > 0 && stepH <= body.step && (wasGrounded || body.grounded)) {
      const oy = p.y;
      p.y = b.maxY + EPS;
      let blocked = false;
      for (let j = 0; j < boxes.length; j++) {
        const c = boxes[j];
        if (!c.active || !c.solid) continue;
        if (overlaps(p.x, p.y, p.z, body.r, body.h, c)) { blocked = true; break; }
      }
      if (!blocked) { body.grounded = true; continue; }
      p.y = oy;
    }
    if (axis === 0) {
      if (d > 0) { p.x = b.minX - body.r - EPS; body.wallNormalX = -1; } else { p.x = b.maxX + body.r + EPS; body.wallNormalX = 1; }
      body.vel.x = 0;
    } else {
      if (d > 0) { p.z = b.minZ - body.r - EPS; body.wallNormalZ = -1; } else { p.z = b.maxZ + body.r + EPS; body.wallNormalZ = 1; }
      body.vel.z = 0;
    }
    hit |= 1;
  }
  return hit;
}

export function bodyOverlapsAny(body, boxes) {
  const p = body.pos;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.active && b.solid && overlaps(p.x, p.y, p.z, body.r, body.h, b)) return b;
  }
  return null;
}

/** Ray vs AABB. Returns t (distance along normalized dir) or -1. Writes normal to out. */
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT, out) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  // X
  if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return -1; }
  else {
    let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < b.minY || oy > b.maxY) return -1; }
  else {
    let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return -1; }
  else {
    let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (axis === -1) return -1; // origin inside box
  if (out) {
    out.nx = axis === 0 ? sign : 0;
    out.ny = axis === 1 ? sign : 0;
    out.nz = axis === 2 ? sign : 0;
  }
  return tmin;
}

/** Ray vs sphere; returns t or -1. Direction must be normalized. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  let t = tca - thc;
  if (t < 0) t = tca + thc;
  if (t < 0 || t > maxT) return -1;
  return t;
}

/** Ray vs vertical cylinder (center cx,cz, from y0 to y1). */
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1, maxT) {
  const px = ox - cx, pz = oz - cz;
  const a = dx * dx + dz * dz;
  let t = -1;
  if (a > 1e-9) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    let t0 = (-b - sq) / a;
    const t1 = (-b + sq) / a;
    if (t0 < 0) t0 = t1 < 0 ? -1 : 0; // inside cylinder: count as immediate
    if (t0 < 0) return -1;
    const y = oy + dy * t0;
    if (y >= y0 && y <= y1) t = t0;
    else {
      // check cap intersection approx: test hitting the top/bottom plane within radius
      const planeY = y > y1 ? y1 : y0;
      if (Math.abs(dy) < 1e-9) return -1;
      const tp = (planeY - oy) / dy;
      if (tp < 0) return -1;
      const hx = px + dx * tp, hz = pz + dz * tp;
      if (hx * hx + hz * hz <= r * r) t = tp; else return -1;
    }
  } else {
    if (px * px + pz * pz > r * r) return -1;
    t = dy > 0 ? (y0 - oy) / dy : (y1 - oy) / dy;
    if (t < 0) return -1;
  }
  return t <= maxT ? t : -1;
}

export function segPointDist2(ax, ay, az, bx, by, bz, px, py, pz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
