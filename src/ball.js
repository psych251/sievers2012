// Port of bouncing_ball.pde (Processing, OpenGL renderer) from the original
// Bouncing Ball software. The scene is built in Processing's coordinate system
// (x right, y DOWN, z toward the default viewer) with every transform applied on
// the CPU exactly as the sketch's matrix stack does, and lit with the same
// fixed-function equation the sketch used:
//   lights()  -> ambient 128 + directional 128 along (0,0,-1)
//   spotLight(255,255,255, -40,-375,-150, 0,1,0, PI, 0) -> 180° cutoff = point light
// three.js is used only to rasterise the resulting coloured triangles. The final
// vertical flip reproduces Processing's y-down screen convention.

import * as THREE from '../lib/three.module.min.js';

const W = 500, H = 600, FPS = 60;
const RES = 25;              // Creature.res
const RADIUS = 50;           // Creature r
const BALL_X = 0, BALL_Y = -35, BALL_Z = 0;
const SCALE_VALUE = 1.5;     // /setSize 1.5 at load
const AMBIENT = 128 / 255;
const DIR_COLOR = 128 / 255;
const DIR_TO_LIGHT = [0, 0, 1];        // directionalLight(.., 0,0,-1) -> vector toward light
const SPOT_POS = [-40, -375, -150];
const RED = [1, 0, 0], WHITE = [1, 1, 1], FLOOR = [100 / 255, 100 / 255, 100 / 255];
const BG = 200 / 255;

function secondsToFrames(s) { return Math.round(s * FPS); }

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// Processing fixed-function lighting for one vertex with normal n.
function shade(fill, p, n) {
  let k = AMBIENT + DIR_COLOR * Math.max(0, dot(n, DIR_TO_LIGHT));
  k += Math.max(0, dot(n, norm(sub(SPOT_POS, p))));
  return [Math.min(1, fill[0] * k), Math.min(1, fill[1] * k), Math.min(1, fill[2] * k)];
}

export class BallView {
  constructor(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.canvas.className = 'ball-canvas';
    container.appendChild(this.canvas);

    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.setClearColor(new THREE.Color(BG, BG, BG), 1);

    this.scene = new THREE.Scene();
    // OCD Camera(this, -300, -200, -500); aim(0, -180, 0); default FOV 60°
    this.camera = new THREE.PerspectiveCamera(60, W / H, 10, 5000);
    this.camera.position.set(-300, -200, -500);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, -180, 0);
    this.camera.updateMatrixWorld();
    this.camera.projectionMatrix.premultiply(new THREE.Matrix4().makeScale(1, -1, 1));
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.geom = new THREE.BufferGeometry();
    this.maxVerts = (RES + (RES - 1) * RES * 2 + RES + 12 * 2 + 2) * 3;
    this.pos = new Float32Array(this.maxVerts * 3);
    this.col = new Float32Array(this.maxVerts * 3);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.Mesh(this.geom, mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    // Creature state
    this.rotation = 0; this.rotFrom = 0; this.rotTo = 0; this.rotT0 = 0; this.rotDur = 0;
    const n = RES * RES;
    this.spikes = new Float32Array(n * 3);
    this.spikesFrom = new Float32Array(n * 3);
    this.spikesTo = new Float32Array(n * 3);
    this.spT0 = 0; this.spDur = 0;
    this.bouncing = false; this.bT0 = 0; this.bDur = 1; this.bHeight = 0;
    this.transformDur = 30 / FPS;
    this.queue = [];
    this.clock = () => performance.now() / 1000;
    this.running = false;
  }

  setClock(fn) { this.clock = fn; }

  // Engine events arrive ahead of time; apply them when their time comes.
  schedule(evt) { this.queue.push(evt); }

  _apply(evt, t) {
    // Order follows the [t i i b b b i] fan-out: bounce, then spikes, then rotation.
    this.bounce(evt.bounceLength, evt.bounceHeight, t);
    this.setSpikes(evt.spikes, t);
    this.setRotation(evt.rotation, t);
  }

  bounce(bLength, height, t) {
    if (this.bouncing) return; // original prints "bounce overlap!" and ignores it
    this.bHeight = height;
    const frames = secondsToFrames(bLength * 0.93);
    this.transformDur = frames / FPS;
    this.bDur = Math.max(this.transformDur, 1e-6);
    this.bT0 = t;
    this.bouncing = true;
  }

  setSpikes(dissonance, t) {
    this._updateSpikes(t);
    for (let i = 0; i < this.spikes.length; i++) {
      this.spikesFrom[i] = this.spikes[i];
      // Processing random(-d, d): uniform between the two bounds
      this.spikesTo[i] = -dissonance + Math.random() * 2 * dissonance;
    }
    this.spT0 = t; this.spDur = this.transformDur;
  }

  setRotation(deg, t) {
    this._updateRotation(t);
    this.rotFrom = this.rotation; this.rotTo = deg; this.rotT0 = t; this.rotDur = this.transformDur;
  }

  _frac(t, t0, dur) {
    if (dur <= 0) return 1;
    // Processing advances one increment per frame; quantise to frames for fidelity
    return Math.min(1, Math.floor((t - t0) * FPS + 1e-6) / Math.round(dur * FPS));
  }

  _updateRotation(t) {
    const f = this._frac(t, this.rotT0, this.rotDur);
    this.rotation = this.rotFrom + (this.rotTo - this.rotFrom) * f;
  }

  _updateSpikes(t) {
    const f = this._frac(t, this.spT0, this.spDur);
    for (let i = 0; i < this.spikes.length; i++) this.spikes[i] = this.spikesFrom[i] + (this.spikesTo[i] - this.spikesFrom[i]) * f;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const frame = () => {
      if (!this.running) return;
      this.render(this.clock());
      this._raf = requestAnimationFrame(frame);
    };
    frame();
  }

  stop() { this.running = false; cancelAnimationFrame(this._raf); }

  render(t) {
    while (this.queue.length && this.queue[0].time <= t) this._apply(this.queue.shift(), this.queue.length ? t : t);
    this._updateRotation(t);
    this._updateSpikes(t);

    let yOff = 0;
    if (this.bouncing) {
      const prog = Math.min(1, (t - this.bT0) / this.bDur);
      yOff = Math.sin(Math.PI * prog) * this.bHeight;
      if (prog >= 1) { this.bouncing = false; yOff = 0; }
    }

    // Creature transform: scale(1.5) * translate(x, y - bounce, z) * rotateX(rot) * scale(1, 1.3)
    const a = this.rotation * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const ty = BALL_Y - yOff;
    const xf = (x, y, z) => {
      y *= 1.3;
      const y2 = y * ca - z * sa, z2 = y * sa + z * ca;
      return [(x + BALL_X) * SCALE_VALUE, (y2 + ty) * SCALE_VALUE, (z2 + BALL_Z) * SCALE_VALUE];
    };
    const center = xf(0, 0, 0);

    // UV sphere vertices exactly as defSphere()
    const dPhi = 2 * Math.PI / RES, dTheta = Math.PI / RES;
    const verts = new Array(RES * RES);
    let theta = 0, phi = 0, k = 0;
    for (let i = 0; i < RES; i++) {
      theta += dTheta;
      for (let j = 0; j < RES; j++) {
        phi += dPhi;
        const sx = Math.sin(theta) * Math.cos(phi) + this.spikes[k * 3];
        const sy = Math.cos(theta) + this.spikes[k * 3 + 1];
        const sz = Math.sin(theta) * Math.sin(phi) + this.spikes[k * 3 + 2];
        verts[k] = xf(sx * RADIUS, sy * RADIUS, sz * RADIUS);
        k++;
      }
    }
    const bottom = xf(0, RADIUS, 0), top = xf(0, -RADIUS, 0);

    let v = 0;
    const pos = this.pos, col = this.col;
    const tri = (p1, p2, p3, fill, outwardFrom) => {
      let n = norm(cross(sub(p2, p1), sub(p3, p1)));
      if (outwardFrom) {
        const c = [(p1[0] + p2[0] + p3[0]) / 3, (p1[1] + p2[1] + p3[1]) / 3, (p1[2] + p2[2] + p3[2]) / 3];
        if (dot(n, sub(c, outwardFrom)) < 0) n = [-n[0], -n[1], -n[2]];
      }
      for (const p of [p1, p2, p3]) {
        const c = shade(fill, p, n);
        pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2];
        col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
        v++;
      }
    };

    // floor(150): drawn unscaled at y = 20, normal facing up (-y)
    const r = 150;
    const f1 = [-r, 20, -r], f2 = [r, 20, -r], f3 = [r, 20, r], f4 = [-r, 20, r];
    const up = [0, -1, 0];
    for (const [p1, p2, p3] of [[f1, f2, f3], [f1, f3, f4]]) {
      for (const p of [p1, p2, p3]) {
        const c = shade(FLOOR, p, up);
        pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2];
        col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
        v++;
      }
    }

    // bottom cap
    for (let i = 0; i < RES; i++) tri(bottom, verts[i % RES], verts[(i + 1) % RES], RED, center);
    // strips
    for (let s = 1; s < RES; s++) {
      for (let q = 0; q < RES; q++) {
        const i1 = (s - 1) * RES + q, i2 = s * RES + q, i3 = s * RES + ((q + 1) % RES), i4 = (s - 1) * RES + ((q + 1) % RES);
        tri(verts[i1], verts[i2], verts[i3], RED, center);
        tri(verts[i1], verts[i3], verts[i4], RED, center);
      }
    }
    // top cap
    for (let i = 0; i < RES; i++) tri(top, verts[RES * (RES - 1) + (i % RES)], verts[RES * (RES - 1) + ((i + 1) % RES)], RED, center);

    // drawEyes(): in the scale(1, 1.3) frame, translate(-12,-33,-40) box(4); translate(24,0,0) box(4)
    for (const ex of [-12, 12]) {
      const c0 = [ex, -33, -40];
      const ecenter = xf(c0[0], c0[1], c0[2]);
      const cn = (dx, dy, dz) => xf(c0[0] + dx, c0[1] + dy, c0[2] + dz);
      const s = 2;
      const P = [cn(-s, -s, -s), cn(s, -s, -s), cn(s, s, -s), cn(-s, s, -s), cn(-s, -s, s), cn(s, -s, s), cn(s, s, s), cn(-s, s, s)];
      const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]];
      for (const [a1, b1, c1, d1] of faces) {
        tri(P[a1], P[b1], P[c1], WHITE, ecenter);
        tri(P[a1], P[c1], P[d1], WHITE, ecenter);
      }
    }

    this.geom.setDrawRange(0, v);
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}
