import { chottoGPU } from 'chottogpu';
import { Timer } from '../libs/Timer.js';
import { FPSGraph } from '../libs/FPSGraph.js';

import contourWGSL from './shaders/contour.wgsl?raw';

export const main = async () => {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  document.body.appendChild(canvas);

  const chotto = await chottoGPU(canvas);
  const { device } = chotto;

  const pipeline = chotto.pipeline({ fragment: contourWGSL });

  const UBO_SIZE = 16;
  const uboData = new Float32Array(4);
  const ubo = chotto.buffer(UBO_SIZE, { uniform: true });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ubo.buffer } }],
  });

  const fpsGraph = new FPSGraph();
  const timer = new Timer();

  chotto.fitWindow();

  const render = () => {
    const time = timer.getElapsedTime();

    uboData[0] = canvas.width;
    uboData[1] = canvas.height;
    uboData[2] = time;
    uboData[3] = 0;
    ubo.write(uboData);

    chotto.frame(() => {
      chotto.pass((p) => {
        p.setPipeline(pipeline);
        p.setBindGroup(0, bindGroup);
        p.draw(3);
      });
    });

    fpsGraph.update();
    requestAnimationFrame(render);
  };

  timer.start();
  render();
};
