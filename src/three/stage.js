/**
 * The sky, fog and lights every 3D view of the intersection shares: the
 * full 3D view and the CCTV view beside the video.
 */

import * as THREE from 'three';

export function createStage({ shadowSize = 4096 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe1f1');
  scene.fog = new THREE.Fog('#cfe1f1', 500, 1600);
  const hemi = new THREE.HemisphereLight('#f4f8ff', '#b7b29a', 1.1);
  const sun = new THREE.DirectionalLight('#fff6e8', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0004;
  scene.add(hemi, sun, sun.target);
  return { scene, sun };
}

/** Puts the sun up and to the south-west of the scene, its shadow box covering it. */
export function aimSun(sun, center, extent) {
  sun.position.set(center.x - extent * 0.45, extent * 0.9, center.z + extent * 0.55);
  sun.target.position.copy(center);
  const cam = sun.shadow.camera;
  cam.left = -extent * 0.7;
  cam.right = extent * 0.7;
  cam.top = extent * 0.7;
  cam.bottom = -extent * 0.7;
  cam.near = 1;
  cam.far = extent * 3;
  cam.updateProjectionMatrix();
}

/** A WebGL renderer set up the way both views draw. */
export function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  return renderer;
}
