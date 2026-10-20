import * as THREE from 'three';

// The checkpoint beacon: a relay core floating over a plinth. Dim while dormant; when the player
// walks in it flares, the rings spin up and a column of light runs to the ceiling.
// Uses unlit materials only (no extra scene lights, so no shader recompiles).

const DORMANT = new THREE.Color(0x3a6a60);
const LIT = new THREE.Color(0x7fe0b8);

export function buildBeacon(room, d) {
  const H = room.spec.H;
  const group = new THREE.Group();
  group.position.set(d.x, 0, d.z);
  const dis = room.disposables;
  const add = (geo, mat, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    group.add(m);
    dis.push(geo);
    return m;
  };
  const coreMat = new THREE.MeshBasicMaterial({ color: DORMANT.clone() });
  const ringMat = new THREE.MeshBasicMaterial({ color: DORMANT.clone(), transparent: true, opacity: 0.9 });
  const beamMat = new THREE.MeshBasicMaterial({ color: LIT.clone(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const floorMat = new THREE.MeshBasicMaterial({ color: DORMANT.clone(), transparent: true, opacity: 0.55, depthWrite: false });
  dis.push(coreMat, ringMat, beamMat, floorMat);

  const core = add(new THREE.OctahedronGeometry(0.42, 0), coreMat, 2.2);
  const inner = add(new THREE.OctahedronGeometry(0.22, 0), beamMat, 2.2);
  const rings = [0, 1, 2].map((i) => {
    const r = add(new THREE.TorusGeometry(0.75 + i * 0.22, 0.04, 4, 18), ringMat, 2.2);
    r.rotation.set(Math.PI / 2 + i * 0.6, i * 0.9, 0);
    return r;
  });
  const beam = add(new THREE.CylinderGeometry(0.32, 0.5, H - 2.2, 8, 1, true), beamMat, 2.2 + (H - 2.2) / 2);
  const floor = add(new THREE.RingGeometry(1.9, 2.25, 24), floorMat, 0.03);
  floor.rotation.x = -Math.PI / 2;
  // four floor ticks that point at the ring
  for (let i = 0; i < 4; i++) {
    const t = add(new THREE.PlaneGeometry(0.18, 0.9), floorMat, 0.031);
    const a = i * Math.PI / 2;
    t.rotation.set(-Math.PI / 2, 0, a);
    t.position.x = Math.cos(a) * 2.8; t.position.z = Math.sin(a) * 2.8;
  }
  room.group.add(group);

  const b = {
    group, core, inner, rings, beam, lit: false, flare: 0, t: Math.random() * 10,
    pos: new THREE.Vector3(room.wx(d.x), 2.2, room.wz(d.z)),
    activate() {
      if (this.lit) return;
      this.lit = true;
      this.flare = 1;
    },
    update(dt) {
      this.t += dt;
      this.flare = Math.max(0, this.flare - dt * 0.7);
      const lit = this.lit ? 1 : 0;
      const spin = 0.5 + lit * 1.6 + this.flare * 6;
      core.rotation.y += dt * spin;
      core.rotation.x = Math.sin(this.t * 0.7) * 0.3;
      const bob = Math.sin(this.t * 2) * 0.12;
      core.position.y = inner.position.y = 2.2 + bob;
      rings.forEach((r, i) => { r.rotation.z += dt * spin * (i % 2 ? -0.8 : 1); r.position.y = 2.2 + bob; });
      const pulse = 0.5 + 0.5 * Math.sin(this.t * (this.lit ? 4 : 1.5));
      const target = this.lit ? LIT : DORMANT;
      coreMat.color.lerp(target, Math.min(1, dt * 3));
      ringMat.color.copy(coreMat.color);
      floorMat.color.copy(coreMat.color);
      floorMat.opacity = 0.35 + 0.25 * pulse + this.flare * 0.4;
      beamMat.opacity = lit * (0.12 + 0.06 * pulse) + this.flare * 0.5;
      const s = 1 + this.flare * 0.9;
      for (const r of rings) r.scale.setScalar(s);
      beam.scale.set(1 + this.flare * 1.5, 1, 1 + this.flare * 1.5);
      inner.scale.setScalar(0.8 + pulse * 0.4 + this.flare * 2);
    },
  };
  return b;
}
