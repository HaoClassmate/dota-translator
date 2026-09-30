import * as THREE from 'three';

export function poseHeroAssembly(models: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }[], animation: string | null, time = 0.1, extraClips: Record<number, string> = {}) {
  // Some immortals have private joints animated by the wearable's own clip.
  // Pose those joints before merging the bones shared with the hero.
  for (const [index, model] of models.entries()) {
    const clipName = extraClips[index] ?? animation;
    const clip = model.animations.find(value => value.name === clipName);
    if (!clip) continue;
    const mixer = new THREE.AnimationMixer(model.scene);
    mixer.clipAction(clip).play();
    mixer.setTime(time);
    model.scene.updateMatrixWorld(true);
  }
  models.slice(1).forEach(model => fitWearableRig(models[0].scene, model.scene));
}

// Exported wearables retain their own bind matrices. Move their named bones to
// the hero's bind pose; sharing skeletons would discard those inverse binds.
export function fitWearableRig(hero: THREE.Object3D, wearable: THREE.Object3D) {
  hero.updateMatrixWorld(true);
  wearable.updateMatrixWorld(true);
  const targets = new Map<string, THREE.Object3D>();
  hero.traverse(node => { if ((node as THREE.Bone).isBone) targets.set(node.name.toLowerCase(), node); });
  let skinned = false;
  wearable.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; });
  if (!skinned) {
    // Rigid exports still contain named attachment nodes (for example Mirana's
    // bow), but glTF does not tag them as bones when there is no skin accessor.
    let source: THREE.Object3D | undefined;
    wearable.traverse(node => {
      if (!source && targets.has(node.name.toLowerCase())) source = node;
    });
    if (source) {
      const target = targets.get(source.name.toLowerCase())!;
      const local = target.matrixWorld.clone().multiply(source.matrixWorld.clone().invert()).multiply(wearable.matrixWorld);
      if (wearable.parent) local.premultiply(wearable.parent.matrixWorld.clone().invert());
      local.decompose(wearable.position, wearable.quaternion, wearable.scale);
      wearable.updateMatrixWorld(true);
      return 1;
    }
  }
  let matched = 0;
  wearable.traverse(node => {
    if (!(node as THREE.Bone).isBone) return;
    const target = targets.get(node.name.toLowerCase());
    if (!target) return;
    const local = target.matrixWorld.clone();
    if (node.parent) local.premultiply(node.parent.matrixWorld.clone().invert());
    local.decompose(node.position, node.quaternion, node.scale);
    node.updateMatrix();
    node.updateMatrixWorld(true);
    matched++;
  });
  wearable.traverse(node => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  });
  return matched;
}
