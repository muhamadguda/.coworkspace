"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// A small 3D model of dot: a cement-tile floor, the rooms standing on it, tables and the counter.
// `progress` (0 = morning, 1 = 3 AM) drives the sun/moon, light, sky and the rooms' lights.
// Tiles lift under the pointer and ripple on tap.

export type DioramaInput = { progress: number; busy: boolean[] };

const C = {
  teal: new THREE.Color("#173a39"),
  deep: new THREE.Color("#0f2a29"),
  sage: new THREE.Color("#eaf0ea"),
  wall: new THREE.Color("#dfe8e1"),
  mustard: new THREE.Color("#d9a21b"),
  busy: new THREE.Color("#ff6a4d"),
};

const SKY = [
  { at: 0.0, sky: "#dfe9e1", sun: "#ffd56b", light: 2.6, amb: 1.1 },
  { at: 0.2, sky: "#f4e6b8", sun: "#ffcf4a", light: 3.0, amb: 1.2 },
  { at: 0.4, sky: "#e3a92a", sun: "#fff0c8", light: 2.3, amb: 0.95 },
  { at: 0.6, sky: "#173a39", sun: "#d9a21b", light: 0.7, amb: 0.45 },
  { at: 0.8, sky: "#0f2a29", sun: "#eaf0ea", light: 0.35, amb: 0.3 },
  { at: 1.0, sky: "#081716", sun: "#d9a21b", light: 0.25, amb: 0.25 },
];

function sample(p: number) {
  const i = Math.min(SKY.length - 2, Math.max(0, Math.floor(p * (SKY.length - 1))));
  const a = SKY[i], b = SKY[i + 1];
  const t = Math.min(1, Math.max(0, (p - a.at) / (b.at - a.at)));
  return {
    sky: new THREE.Color(a.sky).lerp(new THREE.Color(b.sky), t),
    sun: new THREE.Color(a.sun).lerp(new THREE.Color(b.sun), t),
    light: a.light + (b.light - a.light) * t,
    amb: a.amb + (b.amb - a.amb) * t,
  };
}

function tileTexture() {
  const s = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#173a39";
  g.fillRect(0, 0, s, s);
  g.fillStyle = "#2b5250";
  for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) {
    g.beginPath();
    g.arc(x, y, s * 0.24, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#d9a21b";
  g.beginPath();
  g.arc(s / 2, s / 2, s * 0.13, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function Diorama({ input, className }: { input: React.RefObject<DioramaInput>; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Quality tiers: 2 = full, 1 = lighter shadows and pixels, 0 = no shadows, 1x pixels, 30 fps.
    // Weak devices start lower; the governor below steps down further if frames run slow.
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const cores = nav.hardwareConcurrency ?? 8;
    const mem = nav.deviceMemory ?? 8;
    let tier = nav.connection?.saveData || cores <= 2 || mem <= 2 ? 0 : cores <= 4 || mem <= 4 ? 1 : 2;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: tier === 2, powerPreference: tier === 0 ? "default" : "high-performance" });
    } catch {
      return; // no WebGL: the page still reads fine without the model
    }
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 26, 58);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

    // --- floor
    const COLS = 26, ROWS = 16, SIZE = 1;
    const tex = tileTexture();
    const side = new THREE.MeshStandardMaterial({ color: C.deep, roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0 });
    const tileGeo = new THREE.BoxGeometry(SIZE * 0.94, 0.3, SIZE * 0.94);
    const floor = new THREE.InstancedMesh(tileGeo, [side, side, top, side, side, side], COLS * ROWS);
    floor.receiveShadow = true;
    floor.castShadow = true;
    const base: { x: number; z: number }[] = [];
    const lift = new Float32Array(COLS * ROWS);
    const dummy = new THREE.Object3D();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        base[i] = { x: (c - (COLS - 1) / 2) * SIZE, z: (r - (ROWS - 1) / 2) * SIZE };
        dummy.position.set(base[i].x, 0, base[i].z);
        dummy.updateMatrix();
        floor.setMatrixAt(i, dummy.matrix);
      }
    scene.add(floor);
    // a base under the tiles so the gaps read as grout, not sky
    const grout = new THREE.Mesh(new THREE.PlaneGeometry(COLS * SIZE + 0.4, ROWS * SIZE + 0.4), new THREE.MeshStandardMaterial({ color: C.deep, roughness: 1 }));
    grout.rotation.x = -Math.PI / 2;
    grout.position.y = -0.12;
    grout.receiveShadow = true;
    scene.add(grout);

    // --- rooms along the back wall
    const rooms: { group: THREE.Group; window: THREE.MeshStandardMaterial; light: THREE.PointLight }[] = [];
    const wallMat = new THREE.MeshStandardMaterial({ color: C.wall, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: C.teal, roughness: 0.8 });
    const ROOMS = 3;
    for (let k = 0; k < ROOMS; k++) {
      const g = new THREE.Group();
      const w = 4.4, h = 2.1, d = 3.4;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      body.position.y = h / 2 + 0.15;
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.18, d + 0.2), roofMat);
      roof.position.y = h + 0.24;
      roof.castShadow = true;
      g.add(roof);
      const win = new THREE.MeshStandardMaterial({ color: C.deep, emissive: C.mustard, emissiveIntensity: 0, roughness: 0.4 });
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, h * 0.5), win);
      glass.position.set(0, h * 0.55 + 0.15, d / 2 + 0.01);
      g.add(glass);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.2), new THREE.MeshStandardMaterial({ color: C.teal }));
      door.position.set(w * 0.32, 0.75, d / 2 + 0.012);
      g.add(door);
      const pl = new THREE.PointLight(C.mustard, 0, 7, 1.6);
      pl.position.set(0, 1.2, d / 2 + 1.2);
      g.add(pl);
      g.position.set((k - (ROOMS - 1) / 2) * 6.4, 0, -4.6);
      scene.add(g);
      rooms.push({ group: g, window: win, light: pl });
    }

    // --- tables in the middle, the counter in front
    const tableMat = new THREE.MeshStandardMaterial({ color: C.sage, roughness: 0.6 });
    const legMat = new THREE.MeshStandardMaterial({ color: C.deep });
    for (let k = 0; k < 6; k++) {
      const t = new THREE.Group();
      const topM = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 32), tableMat);
      topM.position.y = 0.95;
      topM.castShadow = true;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.8, 12), legMat);
      leg.position.y = 0.55;
      leg.castShadow = true;
      t.add(topM, leg);
      t.position.set(-7.5 + (k % 3) * 3.2 + (k > 2 ? 1.6 : 0), 0, 1 + Math.floor(k / 3) * 2.4);
      scene.add(t);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.1, 1.1), new THREE.MeshStandardMaterial({ color: C.mustard, roughness: 0.55 }));
    counter.position.set(5.6, 0.7, 3.2);
    counter.castShadow = counter.receiveShadow = true;
    scene.add(counter);

    // --- sun / moon and light
    const sunMat = new THREE.MeshBasicMaterial({ color: C.mustard });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.15, 48, 48), sunMat);
    scene.add(sun);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.9, 32, 32), new THREE.MeshBasicMaterial({ color: C.mustard, transparent: true, opacity: 0.18 }));
    scene.add(halo);
    const dir = new THREE.DirectionalLight(0xffffff, 2);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const sc = dir.shadow.camera as THREE.OrthographicCamera;
    sc.left = -18; sc.right = 18; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 70;
    dir.shadow.bias = -0.0006;
    dir.shadow.radius = 4;
    scene.add(dir, dir.target);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x0f2a29, 1);
    scene.add(hemi);

    const applyTier = () => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === 2 ? 2 : tier === 1 ? 1.5 : 1));
      renderer.shadowMap.enabled = tier > 0;
      renderer.shadowMap.type = tier === 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      const size = tier === 2 ? 2048 : 1024;
      if (dir.shadow.mapSize.x !== size) {
        dir.shadow.mapSize.set(size, size);
        dir.shadow.map?.dispose();
        (dir.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
      }
      rooms.forEach((rm) => (rm.light.visible = tier > 0));
      scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => (m.needsUpdate = true));
      });
      if (el.clientWidth) renderer.setSize(el.clientWidth, el.clientHeight, false);
      (window as unknown as { __dotDiorama?: object }).__dotDiorama = { tier };
    };
    applyTier();

    // --- size
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const narrow = w / h < 0.9;
      camera.fov = narrow ? 46 : 30;
      camera.position.set(narrow ? 0 : 3, narrow ? 22 : 15.5, narrow ? 27 : 23);
      camera.lookAt(0, -1.5, 0);
      // Push the model down the frame so the top of the screen is open sky for the words.
      camera.setViewOffset(w, h, 0, -h * (narrow ? 0.34 : 0.33), w, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // --- pointer: lift tiles, ripple on tap
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const ripples: { x: number; z: number; t0: number }[] = [];
    const pick = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(floor, false)[0];
      return hit?.instanceId;
    };
    const onMove = (e: PointerEvent) => {
      const id = pick(e.clientX, e.clientY);
      if (id === undefined) return;
      const c0 = id % COLS, r0 = Math.floor(id / COLS);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const c = c0 + dc, r = r0 + dr;
          if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
          const j = r * COLS + c;
          lift[j] = Math.max(lift[j], dr === 0 && dc === 0 ? 0.55 : 0.22);
        }
    };
    const onDown = (e: PointerEvent) => {
      const id = pick(e.clientX, e.clientY);
      if (id === undefined) return;
      ripples.push({ x: base[id].x, z: base[id].z, t0: performance.now() });
      if (ripples.length > 4) ripples.shift();
    };
    const target = el.parentElement ?? el;
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerdown", onDown);

    // --- loop (paused when off screen)
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    let raf = 0;
    const clock = new THREE.Clock();
    let last = 0, frames = 0, windowStart = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      const now = performance.now();
      if (tier === 0 && now - last < 30) return; // ~30 fps on the lowest tier
      last = now;
      // Governor: every 1.5 s, if the average frame took longer than ~28 ms (under ~35 fps), step down a tier.
      frames++;
      if (now - windowStart > 1500) {
        const avg = (now - windowStart) / frames;
        if (avg > 28 && tier > 0) {
          tier--;
          applyTier();
        }
        frames = 0;
        windowStart = performance.now();
      }
      const time = clock.getElapsedTime();
      const { progress: p, busy } = input.current ?? { progress: 0, busy: [] };
      const s = sample(p);
      const night = Math.min(1, Math.max(0, (p - 0.5) / 0.3));

      scene.background = s.sky;
      (scene.fog as THREE.Fog).color.copy(s.sky);

      const sx = -13 + p * 24, sy = 1.6 + Math.sin(Math.PI * p) * 5, sz = -14;
      sun.position.set(sx, sy, sz);
      halo.position.copy(sun.position);
      sunMat.color.copy(s.sun);
      (halo.material as THREE.MeshBasicMaterial).color.copy(s.sun);
      halo.scale.setScalar(1 + Math.sin(time * 1.4) * (reduced ? 0 : 0.06));
      dir.position.set(sx * 0.9, Math.max(3, sy), 10);
      dir.color.copy(s.sun).lerp(new THREE.Color(0xffffff), 0.4);
      dir.intensity = s.light;
      hemi.intensity = s.amb;
      hemi.color.copy(s.sky).lerp(new THREE.Color(0xffffff), 0.5);

      rooms.forEach((rm, k) => {
        const isBusy = !!busy[k];
        rm.window.emissive.copy(isBusy ? C.busy : C.mustard);
        rm.window.emissiveIntensity = 0.15 + night * (isBusy ? 2.6 : 1.6) + (isBusy ? 0.5 : 0);
        rm.light.color.copy(isBusy ? C.busy : C.mustard);
        rm.light.intensity = night * (isBusy ? 14 : 8);
      });

      for (let i = 0; i < COLS * ROWS; i++) {
        let y = lift[i];
        if (!reduced) {
          y += Math.sin(time * 0.8 + base[i].x * 0.35 + base[i].z * 0.25) * 0.025;
          for (const rp of ripples) {
            const age = (now - rp.t0) / 1000;
            const dist = Math.hypot(base[i].x - rp.x, base[i].z - rp.z);
            const front = age * 9;
            const k = Math.exp(-Math.pow(dist - front, 2) * 0.6) * Math.max(0, 1 - age / 1.6);
            y += k * 0.6;
          }
        }
        lift[i] *= reduced ? 0 : 0.9;
        dummy.position.set(base[i].x, y, base[i].z);
        dummy.updateMatrix();
        floor.setMatrixAt(i, dummy.matrix);
      }
      floor.instanceMatrix.needsUpdate = true;
      while (ripples.length && now - ripples[0].t0 > 1800) ripples.shift();

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerdown", onDown);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      tex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [input]);

  return <div ref={host} aria-hidden className={className} />;
}
