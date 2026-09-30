import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import HERO_MODELS from './heroModels.json';
import { poseHeroAssembly } from './wearableRig';
import { applyCrimsonMaterials, prepareCrimsonMaterials, updateCrimsonTime } from './crimsonMaterials';

const loader = new GLTFLoader();
const modelCache = new Map<string, Promise<GLTF>>();
const stillCache = new Map<number, Promise<string>>();
let stillQueue: Promise<unknown> = Promise.resolve();
let stillRenderer: THREE.WebGLRenderer | undefined;
const TURN_FRAMES = 32;
const TURN_WIDTH = 200;
const TURN_HEIGHT = 274;
function loadModel(path: string) {
  let request = modelCache.get(path);
  if (!request) {
    request = (async () => {
      const response = await fetch(`${path}.gz`);
      if (!response.ok || !response.body) throw Error(`Could not load model: ${path}`);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const data = bytes[0] === 0x1f && bytes[1] === 0x8b
        ? await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
        : buffer;
      return loader.parseAsync(data, path.slice(0, path.lastIndexOf('/') + 1));
    })().catch(error => { modelCache.delete(path); throw error; });
    modelCache.set(path, request);
  }
  return request;
}

type Definition = typeof HERO_MODELS[keyof typeof HERO_MODELS];

function goldPile() {
  const group = new THREE.Group();
  const nugget = new THREE.IcosahedronGeometry(1, 0);
  const gold = new THREE.MeshStandardMaterial({ color: 0xf8b91c, metalness: 0.55, roughness: 0.28,
    emissive: 0xb45e00, emissiveIntensity: 0.24, flatShading: true });
  // A compact, repeatable heap matching Dota's low-poly battle-point pile.
  for (let i = 0; i < 35; i++) {
    const ring = Math.sqrt(i / 35);
    const angle = i * 2.3999632297;
    const radius = 1.18 * ring;
    const size = 0.19 + ((i * 17) % 9) / 100;
    const mesh = new THREE.Mesh(nugget, gold);
    mesh.position.set(Math.cos(angle) * radius, 0.13 + (1 - ring) * 0.72 + (i % 4) * 0.045,
      Math.sin(angle) * radius * 0.58);
    mesh.scale.set(size * (1 + i % 3 * 0.1), size * (0.85 + i % 2 * 0.2), size);
    mesh.rotation.set(i * 0.71, i * 0.37, i * 0.23);
    group.add(mesh);
  }
  return group;
}

async function battlePass2022Emblem() {
  const group = new THREE.Group();
  const art = await new THREE.TextureLoader().loadAsync('/treasures/assets/23238.png');
  art.colorSpace = THREE.SRGBColorSpace;
  // Use the round emblem from Dota's own item art as a material on a solid
  // medallion. The exported event mesh is only an abstract red effect volume.
  art.repeat.set(0.53, 0.76);
  art.offset.set(0.235, 0.18);
  const metal = new THREE.MeshStandardMaterial({ color: 0x352b31, metalness: 0.65, roughness: 0.44 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.31, 0.14, 12, 64),
    new THREE.MeshStandardMaterial({ color: 0x704341, metalness: 0.7, roughness: 0.32,
      emissive: 0x4f1008, emissiveIntensity: 0.25 }));
  rim.position.z = 0.19;
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.24, 64), metal));
  group.children[0].rotation.x = Math.PI / 2;
  const face = new THREE.Mesh(new THREE.CircleGeometry(1.25, 64),
    new THREE.MeshBasicMaterial({ map: art, color: 0xffd3bf, side: THREE.DoubleSide }));
  face.position.z = 0.14;
  group.add(face, rim);
  const ember = new THREE.MeshBasicMaterial({ color: 0xff521c });
  for (const side of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), metal);
    socket.position.set(side * 1.45, -1.04, 0.12);
    group.add(socket);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), ember);
    core.position.set(side * 1.45, -1.04, 0.34);
    group.add(core);
  }
  const base = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.15, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x73342a, metalness: 0.55, roughness: 0.5,
      emissive: 0xa0230a, emissiveIntensity: 0.25 }));
  base.rotation.x = Math.PI / 2;
  base.position.y = -1.57;
  group.add(base);
  return group;
}

function invokerKidOrbs() {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const glow = new THREE.CanvasTexture(canvas);
  const sphere = new THREE.SphereGeometry(0.24, 20, 16);
  const eye = new THREE.SphereGeometry(0.052, 10, 8);
  const colors = [0xff731b, 0xa536e8, 0x40c6ff];
  const bodyColors = [0xbc4a14, 0x71359e, 0x1879aa];
  const positions = [[-1.12, 2.78, 0.55], [0, 3.38, 0.43], [1.12, 2.78, 0.55]];
  positions.forEach(([x, y, z], index) => {
    const orb = new THREE.Group();
    orb.position.set(x, y, z);
    const color = colors[index];
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(1.1, 1.1, 1);
    orb.add(halo);
    const body = new THREE.Mesh(sphere, new THREE.MeshPhysicalMaterial({ color: bodyColors[index],
      emissive: color, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.08, clearcoat: 0.6 }));
    orb.add(body);
    for (const side of [-1, 1]) {
      const pupil = new THREE.Mesh(eye, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      pupil.position.set(side * 0.105, 0.06, 0.23);
      orb.add(pupil);
    }
    if (index === 0) {
      const flame = new THREE.ConeGeometry(0.16, 0.37, 5);
      for (let i = 0; i < 5; i++) {
        const tongue = new THREE.Mesh(flame, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb32d : 0xff5216 }));
        const angle = i * Math.PI * 2 / 5;
        tongue.position.set(Math.sin(angle) * 0.17, 0.22 + (i % 2) * 0.08, Math.cos(angle) * 0.1);
        tongue.rotation.z = Math.sin(angle) * -0.45;
        orb.add(tongue);
      }
    } else if (index === 1) {
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2;
        const points = [new THREE.Vector3(0.17, 0, 0), new THREE.Vector3(0.35, 0.11, 0),
          new THREE.Vector3(0.30, 0.25, 0), new THREE.Vector3(0.47, 0.38, 0)];
        const bolt = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 7, 0.018, 4, false),
          new THREE.MeshBasicMaterial({ color: 0xf4a5ff }));
        bolt.rotation.z = angle;
        orb.add(bolt);
      }
    } else {
      const crystal = new THREE.ConeGeometry(0.045, 0.26, 5);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        const spike = new THREE.Mesh(crystal, new THREE.MeshBasicMaterial({ color: 0x9cecff }));
        spike.position.set(Math.cos(angle) * 0.34, Math.sin(angle) * 0.34, 0);
        spike.rotation.z = angle - Math.PI / 2;
        orb.add(spike);
      }
    }
    group.add(orb);
  });
  return group;
}

function razorSilverRevenantLightning(hero: THREE.Object3D) {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const glow = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  glow.addColorStop(0, 'rgba(255,255,255,.9)');
  glow.addColorStop(0.2, 'rgba(130,220,255,.55)');
  glow.addColorStop(1, 'rgba(65,150,255,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const haze = new THREE.SpriteMaterial({ map: texture, color: 0x42aaff,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const [x, y, scale] of [[0, 2.5, 2.2], [-0.68, 2.13, 1.15], [0.68, 2.13, 1.15]] as const) {
    const sprite = new THREE.Sprite(haze);
    sprite.position.set(x, y, 0.34);
    sprite.scale.set(scale, scale * 1.2, 1);
    group.add(sprite);
  }
  // The belt mesh contains Razor's hanging lower plates. In Dota, electricity
  // fills the space between those plates; glTF alone leaves two false "legs".
  for (const side of [-1, 1]) {
    for (let strand = 0; strand < 3; strand++) {
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 8; step++) {
        const t = step / 8;
        const jitter = Math.sin((step + strand * 3) * 2.7) * 0.12 * Math.sin(Math.PI * t);
        points.push(new THREE.Vector3(
          side * (0.28 + 0.58 * t) + jitter,
          3.58 - 2.20 * t,
          0.39 + strand * 0.085 + Math.sin((step + strand) * 3.1) * 0.06,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const core = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.018, 5, false),
        new THREE.MeshBasicMaterial({ color: strand === 0 ? 0xc7faff : 0x60c8ff,
          transparent: true, opacity: strand === 0 ? 0.93 : 0.67,
          blending: THREE.AdditiveBlending, depthWrite: false }));
      group.add(core);
    }
  }
  // The weapon's rigid pieces follow these native whip joints, while the
  // lightning ribbon between them is a Source particle absent from the GLB.
  const whip = Array.from({ length: 7 }, (_, index) => hero.getObjectByName(`whip_${index + 1}`)
    ?.getWorldPosition(new THREE.Vector3())).filter((point): point is THREE.Vector3 => !!point);
  if (whip.length === 7) {
    for (let strand = 0; strand < 3; strand++) {
      const points = whip.map((point, index) => point.clone().add(new THREE.Vector3(
        strand === 0 ? 0 : Math.sin(index * 2.8 + strand) * 0.055,
        strand === 0 ? 0 : Math.cos(index * 2.1 + strand) * 0.055,
        0.08 + strand * 0.035,
      )));
      group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48,
        strand === 0 ? 0.034 : 0.017, 5, false), new THREE.MeshBasicMaterial({
        color: strand === 0 ? 0x5bc6ff : 0xd4faff, transparent: true,
        opacity: strand === 0 ? 0.78 : 0.88, blending: THREE.AdditiveBlending,
        depthWrite: false,
      })));
    }
  }
  return group;
}

export function preloadHero(itemId: number) {
  const definition = HERO_MODELS[String(itemId) as keyof typeof HERO_MODELS];
  return Promise.all([...definition.models.map(loadModel), prepareCrimsonMaterials(itemId)]);
}

async function buildHero(itemId: number, definition: Definition) {
  if (itemId === 17665) return { group: goldPile(), models: [] as GLTF[] };
  if (itemId === 23238) return { group: await battlePass2022Emblem(), models: [] as GLTF[] };
  if (!definition.models.length) throw new Error('This reward is represented by its item artwork.');
  const loaded = await Promise.all(definition.models.map(loadModel));
  const models = loaded.map(model => ({ ...model, scene: cloneSkeleton(model.scene) }));
  const group = new THREE.Group();
  models.forEach(model => group.add(model.scene));
  group.updateMatrixWorld(true);
  poseHeroAssembly(models, definition.animation);
  if (itemId === 24119) {
    // Dota shows this reward as an Ancient with the dragon curled around it.
    // The inventory model exports only the dragon, aligned lengthwise on Z.
    const ancient = models[0].scene;
    ancient.rotation.y = Math.PI;
    ancient.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const tint = (material: THREE.Material) => {
          const tinted = material.clone();
          if ('color' in tinted && tinted.color instanceof THREE.Color) tinted.color.multiply(new THREE.Color(0x87948a));
          return tinted;
        };
      object.material = Array.isArray(object.material) ? object.material.map(tint) : tint(object.material);
    });
    ancient.updateMatrixWorld(true);
    const dragon = models[1].scene;
    // The exported inventory mesh is a straight dragon. In Dota it curls
    // around the Ancient, so bend its long Z axis around the front of the base.
    dragon.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry = object.geometry.clone();
      const position = object.geometry.getAttribute('position');
      for (let vertex = 0; vertex < position.count; vertex++) {
        const sourceX = position.getX(vertex);
        const sourceY = position.getY(vertex);
        const progress = THREE.MathUtils.clamp(-position.getZ(vertex) / 26.7, 0, 1);
        const angle = Math.PI * progress;
        const radius = 5.7 + sourceY * 0.72;
        position.setXYZ(vertex,
          radius * Math.cos(angle),
          9 - progress * 5 - 2.5 * Math.sin(angle) + sourceX * 0.72,
          4 + radius * Math.sin(angle));
      }
      position.needsUpdate = true;
      object.geometry.computeVertexNormals();
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
    });
    dragon.updateMatrixWorld(true);
  }
  if (itemId === 21605) group.add(razorSilverRevenantLightning(models[0].scene));
  if (itemId === 30721) group.add(invokerKidOrbs());
  if (itemId === 23257) {
      // Dota places these particle-owned meshes in portrait space. Their exported
      // animation clips carry particle coordinates and displace the preview.
      const book = models[models.length - 1].scene;
      book.position.set(0, 1.42, 1.08);
      book.rotation.x = -1.05;
      book.scale.setScalar(0.72);
      book.updateMatrixWorld(true);
      // The loadout particle draws three element orbs; its exported mesh alone
      // is invisible without Source's particle material and control points.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d')!;
      const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.16, 'rgba(255,255,255,0.9)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.34)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      const glow = new THREE.CanvasTexture(canvas);
      for (const [color, x, y] of [[0xff792d, -0.89, 2.62], [0xc45bff, 0, 3.16], [0x6bdaff, 0.88, 2.62]] as const) {
        const orb = new THREE.Group();
        orb.position.set(x, y, 0.9);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        halo.scale.set(0.83, 0.83, 1);
        orb.add(halo);
        const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        core.scale.set(0.24, 0.24, 1);
        orb.add(core);
        group.add(orb);
      }
  }
  await applyCrimsonMaterials(itemId, models);
  if (itemId === 34398) {
    group.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const corrected = materials.map(material => {
        if (!material.name.includes('dark_carnival_io_glass')) return material;
        // Source's refractive glass cannot be represented by the opaque glTF
        // fallback. Keep the shell transparent so the fortune-teller is visible.
        const glass = (material as THREE.MeshStandardMaterial).clone();
        glass.transparent = true; glass.opacity = 0.12; glass.depthWrite = false;
        glass.emissive.set(0); glass.emissiveIntensity = 0;
        glass.metalness = 0; glass.roughness = 0.15;
        return glass;
      });
      mesh.material = Array.isArray(mesh.material) ? corrected : corrected[0];
    });
  }
  return { group, models };
}

function lightScene(group: THREE.Group) {
  const scene = new THREE.Scene();
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xd9edff, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 3.3);
  key.position.set(4, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fd7ff, 2.4);
  rim.position.set(-5, 4, -4);
  scene.add(rim);
  return scene;
}

function frameCamera(camera: THREE.PerspectiveCamera, group: THREE.Group, width: number, height: number, zoom = 1, fitBounds = false) {
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const viewDirection = new THREE.Vector3(0, 0.18, 1).normalize();
  camera.near = Math.max(0.01, radius / 100);
  camera.far = Math.max(100, radius * 30);
  camera.aspect = width / height;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  let distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 0.8 * zoom;
  if (fitBounds) {
    // Fit the projected box rather than its circumscribed sphere: wide wings
    // should fill the reveal without cutting the heads off taller heroes.
    const right = new THREE.Vector3().crossVectors(camera.up, viewDirection).normalize();
    const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
    const point = new THREE.Vector3();
    const verticalTan = Math.tan(verticalFov / 2);
    const horizontalTan = Math.tan(horizontalFov / 2);
    distance = 0;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      point.set(x, y, z).sub(center);
      const depth = point.dot(viewDirection);
      distance = Math.max(distance,
        depth + Math.abs(point.dot(up)) / verticalTan * 1.1,
        depth + Math.abs(point.dot(right)) / horizontalTan * 1.1);
    }
    distance *= zoom;
  }
  camera.position.copy(center).addScaledVector(viewDirection, distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return { center, distance };
}

function exportRenderer() {
  if (!stillRenderer) {
    stillRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    stillRenderer.setPixelRatio(1);
    stillRenderer.outputColorSpace = THREE.SRGBColorSpace;
    stillRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    stillRenderer.toneMappingExposure = 1.45;
  }
  return stillRenderer;
}

function iconPreview(itemId: number, frameWidth: number, height: number, frames = 1) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = frameWidth * frames;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('Reward artwork canvas is unavailable.'));
      const scale = Math.min(frameWidth / image.width, height / image.height);
      const width = image.width * scale;
      const imageHeight = image.height * scale;
      for (let frame = 0; frame < frames; frame++) {
        context.drawImage(image, frame * frameWidth + (frameWidth - width) / 2,
          (height - imageHeight) / 2, width, imageHeight);
      }
      resolve(canvas.toDataURL('image/webp', 0.88));
    };
    image.onerror = () => reject(new Error(`Reward artwork is missing for ${itemId}.`));
    image.src = `/treasures/assets/${itemId}.png`;
  });
}

function stillFor(itemId: number, definition: Definition) {
  let request = stillCache.get(itemId);
  if (!request) {
    request = stillQueue.then(async () => {
      if (!definition.models.length && itemId !== 17665) return iconPreview(itemId, 320, 400);
      const { group } = await buildHero(itemId, definition);
      const scene = lightScene(group);
      const camera = new THREE.PerspectiveCamera(32, 320 / 400, 0.01, 10000);
      frameCamera(camera, group, 320, 400, itemId === 24119 ? 0.78 : 1);
      const renderer = exportRenderer();
      renderer.setSize(320, 400, false);
      updateCrimsonTime(1.2);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/webp', 0.88);
    }).catch(error => { stillCache.delete(itemId); throw error; });
    stillCache.set(itemId, request);
    stillQueue = request.catch(() => {});
  }
  return request;
}

export async function generateHeroStills(ids: number[], progress?: (done: number, total: number) => void) {
  const result: { id: number; dataUrl: string }[] = [];
  for (const id of ids) {
    const definition = HERO_MODELS[String(id) as keyof typeof HERO_MODELS];
    result.push({ id, dataUrl: await stillFor(id, definition) });
    await releaseExportModels();
    progress?.(result.length, ids.length);
  }
  return result;
}

async function releaseExportModels() {
  for (const request of modelCache.values()) {
    const model = await request;
    model.scene.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
  }
  modelCache.clear();
  stillRenderer?.renderLists.dispose();
}

export async function generateHeroTurntables(ids: number[], progress?: (done: number, total: number) => void) {
  const renderer = exportRenderer();
  renderer.setSize(TURN_WIDTH, TURN_HEIGHT, false);
  const sheet = document.createElement('canvas');
  sheet.width = TURN_WIDTH * TURN_FRAMES;
  sheet.height = TURN_HEIGHT;
  const context = sheet.getContext('2d');
  if (!context) throw new Error('Turntable canvas is unavailable.');
  const result: { id: number; dataUrl: string }[] = [];
  for (const id of ids) {
    const definition = HERO_MODELS[String(id) as keyof typeof HERO_MODELS];
    if (!definition.models.length && id !== 17665) {
      result.push({ id, dataUrl: await iconPreview(id, TURN_WIDTH, TURN_HEIGHT, TURN_FRAMES) });
      progress?.(result.length, ids.length);
      continue;
    }
    const { group } = await buildHero(id, definition);
    const center = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(center);
    group.position.sub(center);
    pivot.add(group);
    const scene = lightScene(pivot);
    const camera = new THREE.PerspectiveCamera(32, TURN_WIDTH / TURN_HEIGHT, 0.01, 10000);
    frameCamera(camera, pivot, TURN_WIDTH, TURN_HEIGHT, 1.18);
    context.clearRect(0, 0, sheet.width, sheet.height);
    for (let frame = 0; frame < TURN_FRAMES; frame++) {
      pivot.rotation.y = frame * Math.PI * 2 / TURN_FRAMES;
      updateCrimsonTime(1.2 + frame / 24);
      renderer.render(scene, camera);
      context.drawImage(renderer.domElement, frame * TURN_WIDTH, 0);
    }
    result.push({ id, dataUrl: sheet.toDataURL('image/webp', 0.86) });
    await releaseExportModels();
    progress?.(result.length, ids.length);
  }
  return result;
}

type Motion = 'focus' | 'side' | 'spin' | 'reveal';

export function HeroPreview({ itemId, motion = 'focus', large = false }: { itemId: number; motion?: Motion; large?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [stillMissing, setStillMissing] = useState(false);
  const definition = HERO_MODELS[String(itemId) as keyof typeof HERO_MODELS];
  const motionRef = useRef(motion);
  const invalidate = useRef(true);
  motionRef.current = motion;
  useEffect(() => { invalidate.current = true; }, [motion]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let frame = 0;
    let controls: OrbitControls | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let resize: ResizeObserver | undefined;
    let intersection: IntersectionObserver | undefined;
    let visible = true;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10000);
    buildHero(itemId, definition).then(({ group }) => {
      if (disposed) return;
      const scene = lightScene(group);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.45;
      element.append(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      const initialFrame = frameCamera(camera, group, Math.max(1, element.clientWidth), Math.max(1, element.clientHeight), 1, large);
      controls.target.copy(initialFrame.center);
      controls.enableDamping = true;
      controls.autoRotateSpeed = 0.55;
      controls.enablePan = false;
      controls.update();
      intersection = new IntersectionObserver(entries => {
        visible = entries[0]?.isIntersecting ?? false;
        if (visible) invalidate.current = true;
      });
      intersection.observe(element);
      resize = new ResizeObserver(() => {
        if (!renderer) return;
        const width = Math.max(1, element.clientWidth);
        const height = Math.max(1, element.clientHeight);
        renderer.setSize(width, height, false);
        const { distance } = frameCamera(camera, group, width, height, 1, large);
        if (controls) {
          controls.minDistance = distance * 0.65;
          controls.maxDistance = distance * 3;
        }
        controls?.update();
        invalidate.current = true;
      });
      resize.observe(element);
      let lastRender = 0;
      const tick = (now: number) => {
        if (disposed || !renderer || !controls) return;
        const currentMotion = motionRef.current;
        const active = currentMotion === 'focus' || currentMotion === 'reveal';
        const interval = currentMotion === 'side' ? Infinity : active ? 42 : 83;
        if (visible && document.visibilityState === 'visible' &&
            (invalidate.current || now - lastRender >= interval)) {
          // Keep the sampled outfit pose together while rotating the assembly.
          group.position.y = Math.sin(now * 0.0014) * 0.035;
          controls.enabled = active;
          controls.autoRotate = active;
          controls.enableZoom = currentMotion === 'reveal';
          controls.update();
          updateCrimsonTime(now / 1000);
          renderer.render(scene, camera);
          lastRender = now;
          invalidate.current = false;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      setStatus('ready');
    }).catch(() => { if (!disposed) setStatus('error'); });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      intersection?.disconnect();
      controls?.dispose();
      renderer?.forceContextLoss();
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [definition, large]);

  return <div className={`hero-3d ${large ? 'hero-3d-large' : ''}`}>
    <div className="hero-3d-canvas" ref={host} role="img" aria-label={`Interactive 3D ${definition.hero} model`} />
    {status === 'loading' && <img className="hero-3d-fallback" src={stillMissing ? `/treasures/assets/${itemId}.png` : `/treasures/assets/hero-stills/${itemId}.webp?v=orbs3`}
      onError={() => setStillMissing(true)} alt="" />}
    {status === 'error' && <img className="hero-3d-fallback" src={`/treasures/assets/${itemId}.png`} alt={`${definition.hero} reward`} />}
  </div>;
}
