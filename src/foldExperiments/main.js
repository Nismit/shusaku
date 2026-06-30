import { chottoGL } from '../libs/esChottoGL.js';
import GUI from '../libs/lil-gui.esm.min.js';

import kaleidSingleSource from './shaders/kaleidoscopicSingle.frag?raw';

const DEFAULTS = {
  foldCount: 5,
  foldScale: 1.5,
  initRotXY: 0.0,
  initRotXZ: 0.0,
  iterRotXY: -0.785,
  iterRotYZ: 0.0,
  cameraDistance: 7.5,
  focalLength: 2.1,
  lightHeight: 2.2,
  ambient: 0.12,
  specular: 0.90,
  exposure: 1.1,
};

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const chotto = chottoGL(canvas, { antialias: false });
  chotto.fitWindow();

  const gl = chotto.gl;
  gl.disable(gl.DEPTH_TEST);

  const params = { ...DEFAULTS };
  const shader = chotto.createShader({ fragment: kaleidSingleSource });

  const orbit = {
    yaw: 0.2,
    pitch: 0.24,
    targetYaw: 0.2,
    targetPitch: 0.24,
    dragging: false,
    prevX: 0,
    prevY: 0,
  };

  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (event) => {
    orbit.dragging = true;
    canvas.setPointerCapture(event.pointerId);
    orbit.prevX = event.clientX;
    orbit.prevY = event.clientY;
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!orbit.dragging) return;
    const dx = event.clientX - orbit.prevX;
    const dy = event.clientY - orbit.prevY;
    orbit.targetYaw += dx * 0.005;
    orbit.targetPitch = Math.max(-1.2, Math.min(1.2, orbit.targetPitch + dy * 0.005));
    orbit.prevX = event.clientX;
    orbit.prevY = event.clientY;
  });

  canvas.addEventListener('pointerup', () => {
    orbit.dragging = false;
  });

  canvas.addEventListener('pointercancel', () => {
    orbit.dragging = false;
  });

  const gui = new GUI({ title: 'Fold Experiments' });

  gui.add(params, 'foldCount', 1, 8, 1).name('Fold Count');
  gui.add(params, 'foldScale', 0.5, 3.0, 0.01).name('Fold Scale');

  const rotation = gui.addFolder('Rotation');
  rotation.add(params, 'initRotXY', -3.14, 3.14, 0.01).name('Init XY');
  rotation.add(params, 'initRotXZ', -3.14, 3.14, 0.01).name('Init XZ');
  rotation.add(params, 'iterRotXY', -3.14, 3.14, 0.01).name('Iter XY');
  rotation.add(params, 'iterRotYZ', -3.14, 3.14, 0.01).name('Iter YZ');
  rotation.close();

  const cameraFolder = gui.addFolder('Camera');
  cameraFolder.add(params, 'cameraDistance', 3.2, 12.0, 0.05).name('Distance');
  cameraFolder.add(params, 'focalLength', 1.6, 3.6, 0.01).name('Focal Length');
  cameraFolder.close();

  const lighting = gui.addFolder('Lighting');
  lighting.add(params, 'lightHeight', 0.6, 4.0, 0.05).name('Light Height');
  lighting.add(params, 'ambient', 0.02, 0.55, 0.01).name('Ambient');
  lighting.add(params, 'specular', 0.0, 1.2, 0.01).name('Specular');
  lighting.add(params, 'exposure', 0.5, 1.8, 0.01).name('Exposure');
  lighting.close();

  const render = () => {
    orbit.yaw += (orbit.targetYaw - orbit.yaw) * 0.1;
    orbit.pitch += (orbit.targetPitch - orbit.pitch) * 0.1;

    shader.use();
    shader.setUniform('iResolution', [canvas.width, canvas.height]);
    shader.setUniform('iFoldCount', Math.round(Number(params.foldCount)));
    shader.setUniform('iFoldScale', params.foldScale);
    shader.setUniform('iInitRotXY', params.initRotXY);
    shader.setUniform('iInitRotXZ', params.initRotXZ);
    shader.setUniform('iIterRotXY', params.iterRotXY);
    shader.setUniform('iIterRotYZ', params.iterRotYZ);
    shader.setUniform('iCameraYaw', orbit.yaw);
    shader.setUniform('iCameraPitch', orbit.pitch);
    shader.setUniform('iCameraDistance', params.cameraDistance);
    shader.setUniform('iFocalLength', params.focalLength);
    shader.setUniform('iLightHeight', params.lightHeight);
    shader.setUniform('iAmbient', params.ambient);
    shader.setUniform('iSpecular', params.specular);
    shader.setUniform('iExposure', params.exposure);
    shader.draw();

    requestAnimationFrame(render);
  };

  render();
};
