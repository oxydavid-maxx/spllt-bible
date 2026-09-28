// React Native's Animated / Easing / PanResponder for component tests of the app-owned bottom sheet
// (src/ui/sheet/bottomSheet.tsx). Timings do not finish on their own: the test finishes them with
// `finishAll()`, so it can see what is still running. Every timing config is recorded.
function createAnimatedDouble() {
  const state = { running: 0, configs: [], finishers: [] };
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
    interpolate(config) { return { interpolated: config, source: this }; }
  }
  const timing = (value, config) => {
    let done = false;
    let callback;
    const settle = (finished) => {
      if (done) return;
      done = true;
      state.running -= 1;
      if (finished) value.value = config.toValue;
      if (callback) callback({ finished });
    };
    return {
      start(cb) { callback = cb; state.running += 1; state.configs.push(config); state.finishers.push(() => settle(true)); },
      stop() { settle(false); },
    };
  };
  const parallel = (animations) => ({
    start(cb) {
      let left = animations.length;
      let allFinished = true;
      animations.forEach((animation) => animation.start(({ finished }) => {
        allFinished = allFinished && finished;
        left -= 1;
        if (left === 0 && cb) cb({ finished: allFinished });
      }));
    },
    stop() { animations.forEach((animation) => animation.stop()); },
  });
  return {
    state,
    reset() { state.running = 0; state.configs = []; state.finishers = []; },
    finishAll() { const pending = state.finishers.splice(0); pending.forEach((finish) => finish()); },
    modules: (primitive) => ({
      Animated: { View: primitive('AnimatedView'), Value, timing, parallel },
      Easing: { out: (f) => f, in: (f) => f, cubic: 'cubic', quad: 'quad' },
      PanResponder: { create: (config) => ({ panHandlers: { panConfig: config } }) },
    }),
  };
}
module.exports = { createAnimatedDouble };
