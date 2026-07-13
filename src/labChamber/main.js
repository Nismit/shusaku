import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import sceneWGSL from './shaders/scene.wgsl?raw';

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  const gpu = await chottoGPU(canvas);

  const uniformData = new Float32Array(4);
  const uniformBuffer = gpu.buffer(uniformData, { uniform: true });

  const scenePipe = gpu.pipeline({
    vertex: gpu.FULLSCREEN_VERT,
    fragment: sceneWGSL,
  });

  const sceneBG = gpu.device.createBindGroup({
    layout: scenePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer.buffer } },
    ],
  });

  gpu.fitWindow();

  const timer = new Timer();
  timer.start();

  const render = () => {
    const elapsed = timer.getElapsedTime();

    uniformData[0] = canvas.width;
    uniformData[1] = canvas.height;
    uniformData[2] = elapsed;
    uniformData[3] = 0;
    uniformBuffer.write(uniformData);

    gpu.frame(() => {
      gpu.pass((p) => {
        p.setPipeline(scenePipe);
        p.setBindGroup(0, sceneBG);
        p.draw(3);
      });
    });

    requestAnimationFrame(render);
  };

  render();
};
