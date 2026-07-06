class ControllerStub {
  name() { return this; }
  step() { return this; }
  onChange() { return this; }
  onFinishChange() { return this; }
  min() { return this; }
  max() { return this; }
  listen() { return this; }
  disable() { return this; }
  enable() { return this; }
  setValue() { return this; }
  updateDisplay() { return this; }
  destroy() {}
}

class GUIStub {
  add() { return new ControllerStub(); }
  addColor() { return new ControllerStub(); }
  addFolder() { return new GUIStub(); }
  close() { return this; }
  hide() { return this; }
  open() { return this; }
  show() { return this; }
  destroy() {}
}

let GUI;

if (import.meta.env.DEV) {
  const mod = await import('./lil-gui.esm.min.js');
  GUI = mod.default;
} else {
  GUI = GUIStub;
}

export default GUI;
