import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { Solid } from "./data";

export type ViewPreset = "front" | "back" | "left" | "right" | "top" | "iso";

export interface Highlight {
  /** Geometry that is the component itself. */
  primary: string[];
  /** Geometry that only approximates where the component is. */
  secondary: string[];
}

export interface Marker {
  key: string;
  label: string;
  ids: string[];
  tone: "primary" | "secondary";
}

interface SolidEntry {
  solid: Solid;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
  basePosition: THREE.Vector3;
  /** Center in model space at explode = 0. */
  center: THREE.Vector3;
}

interface AssemblyEntry {
  node: THREE.Object3D;
  center: THREE.Vector3;
  basePosition: THREE.Vector3;
  solids: SolidEntry[];
}

/** Assemblies that enclose the interior; hidden with the "covers" toggle. */
const COVER_PNS = new Set(["HYD1012", "HYD1066", "HYD0983", "HYD0984"]);

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 10, 60000);
  readonly controls: OrbitControls;

  private root = new THREE.Group();
  private solids = new Map<string, SolidEntry>();
  private assemblies: AssemblyEntry[] = [];
  private modelBox = new THREE.Box3();
  private modelCenter = new THREE.Vector3();
  private front = new THREE.Vector3(0, 0, 1);
  private dirty = true;
  private raycaster = new THREE.Raycaster();
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private hoverId: string | null = null;
  private hoverQueued: PointerEvent | null = null;
  private highlight: Highlight = { primary: [], secondary: [] };
  private xray = false;
  private coversHidden = false;
  private explode = 0;
  private markers: Marker[] = [];
  private markerEls = new Map<string, HTMLElement>();
  private tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; start: number; ms: number } | null = null;
  private colors = { primary: new THREE.Color("#0a72ef"), secondary: new THREE.Color("#f5a524") };
  private resizeObserver: ResizeObserver;
  private frame = 0;

  onPick: (id: string | null) => void = () => {};
  onHover: (id: string | null, x: number, y: number) => void = () => {};

  constructor(
    private container: HTMLElement,
    private overlay: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.78;
    this.renderer.domElement.setAttribute("aria-label", "3D model of the Hydraloop H600. Drag to rotate, pinch or scroll to zoom, two fingers or right-drag to pan.");
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    // Key light from upper front-left, fill from the right: gives the white plastics readable form.
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-2000, 3000, 2500);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(2500, 800, -1000);
    this.scene.add(key, fill, this.root);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 150;
    this.controls.maxDistance = 12000;
    this.controls.zoomToCursor = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.keyPanSpeed = 40;
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.controls.addEventListener("change", () => (this.dirty = true));
    this.controls.addEventListener("start", () => (this.tween = null));

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => (this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() }));
    el.addEventListener("pointerup", (e) => this.handlePointerUp(e));
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      this.hoverQueued = e;
    });
    el.addEventListener("pointerleave", () => this.setHover(null, 0, 0));
    el.addEventListener("dblclick", (e) => {
      const id = this.pick(e);
      if (id) this.focus([id]);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  async load(url: string, onProgress?: (fraction: number) => void): Promise<Solid[]> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
    const top = gltf.scene.getObjectByName("H600_Assembly_V21") ?? gltf.scene.children[0];
    this.root.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);

    const out: Solid[] = [];
    for (const node of [...top.children]) {
      const a = node.userData as { id: string; pn: string | null; name: string };
      const entry: AssemblyEntry = { node, center: new THREE.Vector3(), basePosition: node.position.clone(), solids: [] };
      node.traverse((obj) => {
        if (!(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        // GLTFLoader puts extras on the node; for single-primitive meshes the node is the mesh.
        const d = mesh.userData.id ? mesh.userData : mesh.parent!.userData;
        const solid: Solid = {
          id: d.id,
          pn: d.pn ?? null,
          name: d.name,
          sub: d.sub ?? null,
          assemblyId: a.id,
          assemblyPn: a.pn,
          assemblyName: a.name,
        };
        const src = mesh.material as THREE.MeshStandardMaterial;
        const material = src.clone();
        material.side = THREE.DoubleSide;
        mesh.material = material;
        mesh.userData.solidId = solid.id;
        const holder = mesh.userData.id ? mesh : mesh.parent!;
        const se: SolidEntry = {
          solid,
          mesh,
          material,
          baseColor: src.color.clone(),
          basePosition: holder.position.clone(),
          center: new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()),
        };
        this.solids.set(solid.id, se);
        entry.solids.push(se);
        out.push(solid);
      });
      new THREE.Box3().setFromObject(node).getCenter(entry.center);
      this.assemblies.push(entry);
    }

    this.modelBox.setFromObject(this.root);
    this.modelBox.getCenter(this.modelCenter);
    const frontPlate = this.assemblies.find((a) => a.solids[0]?.solid.assemblyPn === "HYD1012");
    if (frontPlate) {
      this.front.copy(frontPlate.center).sub(this.modelCenter).setY(0);
      // Snap to the dominant axis so presets are square to the cabinet.
      const ax = Math.abs(this.front.x) > Math.abs(this.front.z);
      this.front.set(ax ? Math.sign(this.front.x) : 0, 0, ax ? 0 : Math.sign(this.front.z));
    }
    this.view("iso", false);
    this.applyMaterials();
    return out;
  }

  // -------------------------------------------------------------------------
  // State

  setThemeColors(primary: string, secondary: string) {
    this.colors.primary.set(primary);
    this.colors.secondary.set(secondary);
    this.applyMaterials();
  }

  setHighlight(h: Highlight) {
    this.highlight = h;
    this.applyMaterials();
  }

  setXray(on: boolean) {
    this.xray = on;
    this.applyMaterials();
  }

  setCoversHidden(hidden: boolean) {
    this.coversHidden = hidden;
    for (const a of this.assemblies) {
      if (COVER_PNS.has(a.solids[0]?.solid.assemblyPn ?? "")) a.node.visible = !hidden;
    }
    this.dirty = true;
  }

  setExplode(t: number) {
    this.explode = t;
    const height = this.modelBox.max.y - this.modelBox.min.y;
    for (const a of this.assemblies) {
      const d = a.center.clone().sub(this.modelCenter);
      const isCover = COVER_PNS.has(a.solids[0]?.solid.assemblyPn ?? "");
      // Spread horizontally more than vertically; covers fly further to clear the view.
      const offset = new THREE.Vector3(d.x * 1.6, d.y * 0.9 + (a.center.y > height * 0.85 ? 250 : 0), d.z * 1.6).multiplyScalar(t);
      if (isCover) offset.multiplyScalar(1.6);
      a.node.position.copy(a.basePosition).add(offset);
      for (const s of a.solids) {
        const holder = s.mesh.userData.id ? s.mesh : s.mesh.parent!;
        if (holder === a.node) continue;
        const local = s.center.clone().sub(a.center).multiplyScalar(t * 0.9);
        holder.position.copy(s.basePosition).add(local);
      }
    }
    this.dirty = true;
  }

  setMarkers(markers: Marker[]) {
    this.markers = markers;
    for (const [key, el] of this.markerEls) {
      if (!markers.some((m) => m.key === key)) {
        el.remove();
        this.markerEls.delete(key);
      }
    }
    for (const m of markers) {
      let el = this.markerEls.get(m.key);
      if (!el) {
        el = document.createElement("div");
        el.className = "h6-marker";
        this.overlay.appendChild(el);
        this.markerEls.set(m.key, el);
      }
      el.dataset.tone = m.tone;
      el.textContent = m.label;
    }
    this.dirty = true;
  }

  private applyMaterials() {
    const primary = new Set(this.highlight.primary);
    const secondary = new Set(this.highlight.secondary);
    const focused = primary.size + secondary.size > 0;
    for (const [id, s] of this.solids) {
      const m = s.material;
      const isP = primary.has(id);
      const isS = !isP && secondary.has(id);
      const ghost = this.xray && !isP && !isS;
      m.color.copy(isP ? this.colors.primary : isS ? this.colors.secondary : s.baseColor);
      m.emissive.copy(isP ? this.colors.primary : isS ? this.colors.secondary : new THREE.Color(0));
      m.emissiveIntensity = isP || isS ? 0.35 : 0;
      m.transparent = ghost;
      m.opacity = ghost ? (focused ? 0.1 : 0.18) : 1;
      m.depthWrite = !ghost;
      s.mesh.renderOrder = ghost ? 1 : 0;
      if (id === this.hoverId && !ghost) m.emissive.addScalar(0.12), (m.emissiveIntensity = Math.max(m.emissiveIntensity, 1));
      m.needsUpdate = true;
    }
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Camera

  boxOf(ids: string[]) {
    const box = new THREE.Box3();
    for (const id of ids) {
      const s = this.solids.get(id);
      if (s && s.mesh.visible && this.isVisible(s.mesh)) box.expandByObject(s.mesh);
    }
    return box;
  }

  private isVisible(obj: THREE.Object3D) {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  focus(ids?: string[], animate = true) {
    const box = ids?.length ? this.boxOf(ids) : new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 120);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const dist = (radius / Math.sin(fit / 2)) * 1.08;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.moveCamera(sphere.center, sphere.center.clone().add(dir.multiplyScalar(dist)), animate);
  }

  view(preset: ViewPreset, animate = true) {
    const f = this.front;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f).negate();
    const dirs: Record<ViewPreset, THREE.Vector3> = {
      front: f.clone(),
      back: f.clone().negate(),
      left: right.clone().negate(),
      right: right.clone(),
      top: new THREE.Vector3(0, 1, 0).addScaledVector(f, 0.0001),
      iso: f.clone().add(right.clone().multiplyScalar(0.75)).add(new THREE.Vector3(0, 0.55, 0)),
    };
    const box = new THREE.Box3().setFromObject(this.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const dist = (sphere.radius / Math.sin(fit / 2)) * 0.95;
    this.moveCamera(sphere.center, sphere.center.clone().add(dirs[preset].normalize().multiplyScalar(dist)), animate);
  }

  private moveCamera(target: THREE.Vector3, position: THREE.Vector3, animate: boolean) {
    if (!animate || reducedMotion()) {
      this.tween = null;
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.tween = {
      from: [this.controls.target.clone(), this.camera.position.clone()],
      to: [target.clone(), position.clone()],
      start: performance.now(),
      ms: 650,
    };
  }

  zoom(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    const len = THREE.MathUtils.clamp(offset.length(), this.controls.minDistance, this.controls.maxDistance);
    this.moveCamera(this.controls.target, this.controls.target.clone().add(offset.setLength(len)), true);
  }

  // -------------------------------------------------------------------------
  // Picking

  private ndc(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pick(e: { clientX: number; clientY: number }): string | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObject(this.root, true).filter((h) => this.isVisible(h.object));
    // Prefer solid geometry over ghosted geometry in front of it.
    const solidHit = hits.find((h) => !((h.object as THREE.Mesh).material as THREE.Material).transparent);
    const hit = solidHit ?? hits[0];
    return (hit?.object.userData.solidId as string) ?? null;
  }

  private handlePointerUp(e: PointerEvent) {
    const d = this.pointerDown;
    this.pointerDown = null;
    if (!d || e.button > 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    this.onPick(this.pick(e));
  }

  private setHover(id: string | null, x: number, y: number) {
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.applyMaterials();
      this.renderer.domElement.style.cursor = id ? "pointer" : "";
    }
    this.onHover(id, x, y);
  }

  // -------------------------------------------------------------------------
  // Loop

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    if (this.tween) {
      const k = Math.min(1, (performance.now() - this.tween.start) / this.tween.ms);
      const ease = 1 - Math.pow(1 - k, 3);
      this.controls.target.lerpVectors(this.tween.from[0], this.tween.to[0], ease);
      this.camera.position.lerpVectors(this.tween.from[1], this.tween.to[1], ease);
      if (k >= 1) this.tween = null;
      this.dirty = true;
    }
    if (this.controls.update()) this.dirty = true;
    if (this.hoverQueued) {
      const e = this.hoverQueued;
      this.hoverQueued = null;
      const r = this.renderer.domElement.getBoundingClientRect();
      this.setHover(this.pick(e), e.clientX - r.left, e.clientY - r.top);
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.positionMarkers();
  };

  private positionMarkers() {
    const { clientWidth: w, clientHeight: h } = this.container;
    for (const m of this.markers) {
      const el = this.markerEls.get(m.key);
      if (!el) continue;
      const box = this.boxOf(m.ids);
      if (box.isEmpty()) {
        el.hidden = true;
        continue;
      }
      const p = box.getCenter(new THREE.Vector3()).project(this.camera);
      const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      el.hidden = !visible;
      el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
    }
  }
}
