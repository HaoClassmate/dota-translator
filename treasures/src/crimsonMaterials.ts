import * as THREE from 'three';
import profiles from './crimsonPreviews.json';

type Detail = { map: string; scale: number[]; offset: number[]; speed: number[]; rotation: number; tint: number[]; factor: number };
type Variant = { color: string; emissive?: string; bloom: number[]; source: string; additive?: boolean; alphaTest?: number; details?: Detail[]; detailMask?: string };
type Profile = { materials: Record<string, Variant>; desaturateNonReward: boolean; rewardModelCount: number };
const definitions = profiles as Record<string, Profile>;
const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();
const effectTime = { value: 1.2 };
export function updateCrimsonTime(seconds: number) { effectTime.value = seconds; }
function texture(path: string, color: boolean) {
  let pending = cache.get(path);
  if (!pending) {
    pending = loader.loadAsync(path).then(value => {
      value.flipY = false;
      value.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return value;
    }).catch(error => { cache.delete(path); throw error; });
    cache.set(path, pending);
  }
  return pending;
}

export async function prepareCrimsonMaterials(id: number) {
  const definition = definitions[id];
  if (!definition) return;
  await Promise.all(Object.values(definition.materials).flatMap(value => [
    texture(value.color, true), ...(value.emissive ? [texture(value.emissive, false)] : []),
    ...(value.details ?? []).map(detail => texture(detail.map, true)),
    ...(value.detailMask ? [texture(value.detailMask, false)] : []),
  ]));
}

export async function applyCrimsonMaterials(id: number, models: { scene: THREE.Object3D }[]) {
  const definition = definitions[id];
  if (!definition) return;
  await prepareCrimsonMaterials(id);
  const variants = new Map<string, THREE.Material>();
  for (const [name, spec] of Object.entries(definition.materials)) {
    const material = spec.additive ? new THREE.MeshBasicMaterial({
      name, map: await texture(spec.color, true), color: 0xffffff,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    }) : new THREE.MeshStandardMaterial({
      name, map: await texture(spec.color, true), roughness: 0.65, metalness: 0,
      emissive: new THREE.Color(...spec.bloom as [number, number, number]),
      emissiveMap: spec.emissive ? await texture(spec.emissive, false) : null,
      emissiveIntensity: spec.emissive ? 0.7 : 0,
      alphaTest: spec.alphaTest ?? 0,
    });
    const details = await Promise.all((spec.details ?? []).map(async detail => {
      const map = (await texture(detail.map, true)).clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.needsUpdate = true;
      return { ...detail, texture: map };
    }));
    const mask = spec.detailMask ? await texture(spec.detailMask, false) : null;
    if (details.length) {
      material.onBeforeCompile = shader => {
        shader.uniforms.crimsonTime = effectTime;
        if (mask) shader.uniforms.crimsonDetailMask = { value: mask };
        let declarations = 'uniform float crimsonTime;\n' + (mask ? 'uniform sampler2D crimsonDetailMask;\n' : '');
        let fragment = 'vec3 crimsonDetail = vec3(0.0);\n';
        details.forEach((detail, index) => {
          const prefix = `crimsonD${index}`;
          declarations += `uniform sampler2D ${prefix};\n`;
          shader.uniforms[prefix] = { value: detail.texture };
          const n = (value: number) => Number(value).toFixed(6);
          const vec = (values: number[]) => `vec${values.length}(${values.map(n).join(',')})`;
          const angle = THREE.MathUtils.degToRad(detail.rotation);
          fragment += `vec2 ${prefix}Uv = vMapUv * ${vec(detail.scale)};\n`;
          fragment += `${prefix}Uv = mat2(${n(Math.cos(angle))},${n(-Math.sin(angle))},${n(Math.sin(angle))},${n(Math.cos(angle))}) * ${prefix}Uv + ${vec(detail.offset)} + crimsonTime * ${vec(detail.speed)};\n`;
          fragment += `crimsonDetail += texture2D(${prefix}, ${prefix}Uv).rgb * ${vec(detail.tint)} * ${n(detail.factor)};\n`;
        });
        if (mask) fragment += 'crimsonDetail *= texture2D(crimsonDetailMask, vMapUv).r;\n';
        // Source's scrolling detail layer adds light, rather than an opaque
        // pale sheet lit again by the scene's three hero lights.
        const target = spec.additive ? 'diffuseColor.rgb' : 'totalEmissiveRadiance';
        const include = spec.additive ? '#include <map_fragment>' : '#include <emissivemap_fragment>';
        shader.fragmentShader = declarations + shader.fragmentShader.replace(include, include + '\n' + fragment + `${target} += crimsonDetail;\n`);
      };
      material.customProgramCacheKey = () => `source-detail-${spec.source}-${spec.additive}-${details.length}-${!!mask}`;
    }
    variants.set(name, material);
  }
  models.forEach((model, index) => model.scene.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const update = (source: THREE.Material) => {
      if (index === 1 && Object.keys(definition.materials).length) {
        const variant = variants.get(source.name);
        if (!variant) throw Error(`Missing Crimson material ${id}/${source.name}`);
        if (variant instanceof THREE.MeshStandardMaterial && source instanceof THREE.MeshStandardMaterial) {
          variant.normalMap = source.normalMap;
          variant.normalScale.copy(source.normalScale);
        }
        return variant;
      }
      const material = source.clone() as THREE.MeshStandardMaterial;
      if ((index === 0 || index > definition.rewardModelCount) && definition.desaturateNonReward) {
        // Dota mutes the supporting hero so the individual reward is identifiable.
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
            '#include <map_fragment>\ndiffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))) * 0.6;');
        };
        material.customProgramCacheKey = () => 'crimson-supporting-hero-v1';
        material.emissiveIntensity = 0;
      }
      return material;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(update) : update(mesh.material);
  }));
}
