import { chottoGL } from '../libs/esChottoGL.js';
import GUI from '../libs/lil-gui.esm.min.js';

import sortDescendingSource from './shaders/sortFoldTorus.frag?raw';
import sortAscendingSource from './shaders/sortFoldAscending.frag?raw';
import sortPartialSource from './shaders/sortFoldPartial.frag?raw';


const SORT_DEFAULTS = {
  foldCount: 2,
  foldScale: 1.5,
  initRotXY: 0.24,
  initRotXZ: 0.36,
  iterRotXY: 0.7,
  iterRotYZ: 0.7,
  cameraDistance: 7.0,
  focalLength: 2.3,
  lightHeight: 2.2,
  ambient: 0.23,
  specular: 0.55,
  exposure: 1.0,
};

const SHADERS = {
  'Sort Descending': { source: sortDescendingSource, defaults: SORT_DEFAULTS },
  'Sort Ascending': { source: sortAscendingSource, defaults: SORT_DEFAULTS },
  'Sort Partial': { source: sortPartialSource, defaults: SORT_DEFAULTS },
};

export const main = () => {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const chotto = chottoGL(canvas, { antialias: false });
  chotto.fitWindow();

  const gl = chotto.gl;
  gl.disable(gl.DEPTH_TEST);

  const techniqueNames = Object.keys(SHADERS);

  const params = {
    technique: techniqueNames[0],
    ...SHADERS[techniqueNames[0]].defaults,
  };

  let activeShader = null;

  function switchShader(name) {
    const entry = SHADERS[name];
    if (!entry) return;
    if (activeShader) activeShader.dispose();
    activeShader = chotto.createShader({ fragment: entry.source });
    Object.assign(params, entry.defaults);
    controllers.forEach((c) => c.updateDisplay());
  }

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

  const gui = new GUI({ title: 'Fold Raymarching' });
  const controllers = [];

  gui.add(params, 'technique', techniqueNames).name('Technique').onChange((name) => {
    switchShader(name);
  });

  controllers.push(gui.add(params, 'foldCount', 1, 8, 1).name('Fold Count'));
  controllers.push(gui.add(params, 'foldScale', 0.5, 3.0, 0.01).name('Fold Scale'));

  const rotation = gui.addFolder('Rotation');
  controllers.push(rotation.add(params, 'initRotXY', -3.14, 3.14, 0.01).name('Init XY'));
  controllers.push(rotation.add(params, 'initRotXZ', -3.14, 3.14, 0.01).name('Init XZ'));
  controllers.push(rotation.add(params, 'iterRotXY', -3.14, 3.14, 0.01).name('Iter XY'));
  controllers.push(rotation.add(params, 'iterRotYZ', -3.14, 3.14, 0.01).name('Iter YZ'));
  rotation.close();

  const cameraFolder = gui.addFolder('Camera');
  controllers.push(cameraFolder.add(params, 'cameraDistance', 3.2, 12.0, 0.05).name('Distance'));
  controllers.push(cameraFolder.add(params, 'focalLength', 1.6, 3.6, 0.01).name('Focal Length'));
  cameraFolder.close();

  const lighting = gui.addFolder('Lighting');
  controllers.push(lighting.add(params, 'lightHeight', 0.6, 4.0, 0.05).name('Light Height'));
  controllers.push(lighting.add(params, 'ambient', 0.02, 0.55, 0.01).name('Ambient'));
  controllers.push(lighting.add(params, 'specular', 0.0, 1.2, 0.01).name('Specular'));
  controllers.push(lighting.add(params, 'exposure', 0.5, 1.8, 0.01).name('Exposure'));
  lighting.close();

  switchShader(params.technique);

  const render = () => {
    orbit.yaw += (orbit.targetYaw - orbit.yaw) * 0.1;
    orbit.pitch += (orbit.targetPitch - orbit.pitch) * 0.1;

    activeShader.use();
    activeShader.setUniform('iResolution', [canvas.width, canvas.height]);
    activeShader.setUniform('iFoldCount', Math.round(Number(params.foldCount)));
    activeShader.setUniform('iFoldScale', params.foldScale);
    activeShader.setUniform('iInitRotXY', params.initRotXY);
    activeShader.setUniform('iInitRotXZ', params.initRotXZ);
    activeShader.setUniform('iIterRotXY', params.iterRotXY);
    activeShader.setUniform('iIterRotYZ', params.iterRotYZ);
    activeShader.setUniform('iCameraYaw', orbit.yaw);
    activeShader.setUniform('iCameraPitch', orbit.pitch);
    activeShader.setUniform('iCameraDistance', params.cameraDistance);
    activeShader.setUniform('iFocalLength', params.focalLength);
    activeShader.setUniform('iLightHeight', params.lightHeight);
    activeShader.setUniform('iAmbient', params.ambient);
    activeShader.setUniform('iSpecular', params.specular);
    activeShader.setUniform('iExposure', params.exposure);
    activeShader.draw();

    requestAnimationFrame(render);
  };

  render();
};
