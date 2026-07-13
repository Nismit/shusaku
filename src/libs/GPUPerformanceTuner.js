const nextAnimationFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const percentile = (values, amount) => {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * amount))];
};

/**
 * Measures complete, real-world frames and selects the first quality profile
 * that can sustain the requested frame rate.
 *
 * Profiles must be ordered from highest to lowest quality. renderFrame() is
 * expected to submit one representative frame to the supplied GPUDevice.
 */
export async function tuneGPUPerformance({
  device,
  profiles,
  applyProfile,
  renderFrame,
  targetFPS = 60,
  minimumTargetRatio = 0.9,
  warmupFrames = 4,
  sampleFrames = 12,
  onProgress = () => {},
}) {
  if (!device?.queue?.onSubmittedWorkDone) {
    throw new TypeError('tuneGPUPerformance requires a WebGPU GPUDevice');
  }
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new TypeError('tuneGPUPerformance requires at least one quality profile');
  }

  const results = [];
  const totalFrames = profiles.length * (warmupFrames + sampleFrames);
  let completedFrames = 0;
  let selected = profiles.at(-1);

  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
    const profile = profiles[profileIndex];
    onProgress(completedFrames / totalFrames, profile, 'preparing');
    await applyProfile(profile);
    await nextAnimationFrame();

    for (let i = 0; i < warmupFrames; i++) {
      renderFrame();
      await device.queue.onSubmittedWorkDone();
      await nextAnimationFrame();
      completedFrames++;
      onProgress(completedFrames / totalFrames, profile, 'warming-up');
    }

    const frameTimes = [];
    let previousStart = performance.now();
    for (let i = 0; i < sampleFrames; i++) {
      renderFrame();
      await device.queue.onSubmittedWorkDone();
      await nextAnimationFrame();

      const now = performance.now();
      frameTimes.push(now - previousStart);
      previousStart = now;
      completedFrames++;
      onProgress(completedFrames / totalFrames, profile, 'measuring');
    }

    // The 75th percentile is resistant to one-off browser/GC spikes while
    // still rejecting profiles that stutter regularly.
    const frameTime = percentile(frameTimes, 0.75);
    const fps = 1000 / frameTime;
    const result = { profile, fps, frameTime, frameTimes };
    results.push(result);

    if (fps >= targetFPS * minimumTargetRatio) {
      selected = profile;
      break;
    }
  }

  await applyProfile(selected);
  onProgress(1, selected, 'complete');
  return { profile: selected, results, targetFPS };
}

export function createLoadingProgress({ label = 'Optimizing graphics' } = {}) {
  const root = document.createElement('div');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '10000',
    display: 'grid',
    placeItems: 'center',
    background: '#04080f',
    color: 'rgba(255,255,255,.78)',
    font: '500 12px/1.4 Inter, system-ui, sans-serif',
    letterSpacing: '.08em',
    transition: 'opacity 300ms ease',
  });

  const panel = document.createElement('div');
  panel.style.width = 'min(240px, 64vw)';
  const text = document.createElement('div');
  text.textContent = label;
  text.style.marginBottom = '12px';
  const track = document.createElement('div');
  Object.assign(track.style, {
    height: '2px',
    overflow: 'hidden',
    background: 'rgba(255,255,255,.16)',
  });
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    width: '0%',
    height: '100%',
    background: 'rgba(255,255,255,.82)',
    transition: 'width 100ms linear',
  });
  track.appendChild(bar);
  panel.append(text, track);
  root.appendChild(panel);
  document.body.appendChild(root);

  return {
    update(progress, nextLabel) {
      bar.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
      if (nextLabel) text.textContent = nextLabel;
    },
    async finish() {
      bar.style.width = '100%';
      await new Promise((resolve) => setTimeout(resolve, 120));
      root.style.opacity = '0';
      await new Promise((resolve) => setTimeout(resolve, 300));
      root.remove();
    },
    remove() {
      root.remove();
    },
  };
}
