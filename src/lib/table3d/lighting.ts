import * as THREE from 'three';

export function lightTableRoom(scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadows = false) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  scene.background = new THREE.Color(0x182327);

  const night = new THREE.HemisphereLight(0xbcdbeb, 0x956e52, 1.18);
  const pendant = new THREE.SpotLight(0xffe6c2, 6.6, 4.5, Math.PI * 0.45, 0.32);
  pendant.position.set(0, 1.89, 0);
  // Soft reflected light from the tabletop opens up eye sockets and hands.
  // Keep its origin under the baize so the top itself receives only the lamp.
  const bounce = new THREE.PointLight(0xffdec0, 1.7, 2.6);
  bounce.position.set(0, 0.72, 0);

  if (shadows) {
    renderer.shadowMap.enabled = true;
    pendant.castShadow = true;
    pendant.shadow.mapSize.set(768, 768);
    pendant.shadow.focus = 0.84;
    pendant.shadow.camera.near = 0.28;
    pendant.shadow.bias = -0.00075;
    pendant.shadow.normalBias = 0.013;
    pendant.shadow.intensity = 0.62;
  }
  scene.add(night, pendant, bounce);
}
