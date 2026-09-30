import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitWearableRig, poseHeroAssembly } from './wearableRig.ts';

test('wearable private joints receive their native pose before shared bones attach', () => {
  const hero = new THREE.Group(), wearable = new THREE.Group();
  const target = new THREE.Bone(); target.name = 'clavicle'; hero.add(target);
  const source = new THREE.Bone(); source.name = 'clavicle'; wearable.add(source);
  const privateJoint = new THREE.Bone(); privateJoint.name = 'weapon_shoulder'; source.add(privateJoint);
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  mesh.bind(new THREE.Skeleton([source, privateJoint])); wearable.add(mesh);
  const clip = (name: string, values: number[]) => new THREE.AnimationClip('loadout', 1, [
    new THREE.VectorKeyframeTrack(name + '.position', [0, 1], [...values, ...values]),
  ]);
  poseHeroAssembly([
    { scene: hero, animations: [clip('clavicle', [0, 4, 0])] },
    { scene: wearable, animations: [clip('weapon_shoulder', [1, 0, 0])] },
  ], 'loadout');
  assert.deepEqual(source.getWorldPosition(new THREE.Vector3()).toArray(), [0, 4, 0]);
  assert.deepEqual(privateJoint.getWorldPosition(new THREE.Vector3()).toArray(), [1, 4, 0]);
});

test('wearable bones match across casing and parent transforms', () => {
  const hero = new THREE.Group(), wearable = new THREE.Group();
  hero.position.set(5, 2, 1); wearable.position.set(-3, 4, 2);
  const target = new THREE.Bone(); target.name = 'Wrist_R'; target.position.set(2, 3, 4); hero.add(target);
  const source = new THREE.Bone(); source.name = 'wrist_r'; wearable.add(source);
  const inverse = new THREE.Matrix4().makeTranslation(0, -1, 0);
  const skeleton = new THREE.Skeleton([source], [inverse]);
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  mesh.bind(skeleton, new THREE.Matrix4()); wearable.add(mesh);
  const accessory = new THREE.Bone(); accessory.name = 'tassel'; accessory.position.set(0, 2, 0); source.add(accessory);
  assert.equal(fitWearableRig(hero, wearable), 1);
  assert.ok(target.getWorldPosition(new THREE.Vector3()).distanceTo(source.getWorldPosition(new THREE.Vector3())) < 1e-6);
  assert.deepEqual(accessory.position.toArray(), [0, 2, 0]);
  assert.deepEqual(skeleton.boneInverses[0].elements, inverse.elements);
});

test('rigid mesh uses its exported attachment node without requiring a skin', () => {
  const hero = new THREE.Group(), wearable = new THREE.Group();
  const target = new THREE.Bone(); target.name = 'bow'; target.position.set(2, 3, 1); target.rotation.z = Math.PI / 2; hero.add(target);
  const source = new THREE.Object3D(); source.name = 'bow'; source.position.x = 1; wearable.add(source);
  wearable.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  assert.equal(fitWearableRig(hero, wearable), 1);
  assert.ok(source.getWorldPosition(new THREE.Vector3()).distanceTo(target.getWorldPosition(new THREE.Vector3())) < 1e-6);
  assert.ok(source.getWorldQuaternion(new THREE.Quaternion()).angleTo(target.getWorldQuaternion(new THREE.Quaternion())) < 1e-6);
});
