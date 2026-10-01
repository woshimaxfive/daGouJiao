(function (root, factory) {
  const motion = factory();
  if (typeof module === 'object' && module.exports) module.exports = motion;
  else root.DagouMotion = motion;
})(globalThis, function () {
  'use strict';

  const COOLDOWN_MS = 3000;
  const SIGNAL_TIMEOUT_MS = 5000;

  function vector(value) {
    if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
    return { x: value.x, y: value.y, z: value.z };
  }

  function createDetector() {
    let gravity = null;
    let lastSampleAt = null;
    let mode = null;
    let peak = null;

    function reset() {
      gravity = null;
      lastSampleAt = null;
      mode = null;
      peak = null;
    }

    function sample(event, now) {
      const linear = vector(event.acceleration);
      const includingGravity = vector(event.accelerationIncludingGravity);
      if (!linear && !includingGravity) return { valid: false, direction: 0 };
      const nextMode = linear ? 'linear' : 'gravity';
      if (mode !== nextMode || lastSampleAt === null || now - lastSampleAt > 600) {
        reset();
        mode = nextMode;
        lastSampleAt = now;
        gravity = includingGravity;
        return { valid: true, direction: 0 };
      }

      const delta = Math.max(1, now - lastSampleAt);
      lastSampleAt = now;
      let acceleration = linear;
      if (!linear) {
        // 含重力的数据先去掉缓慢变化的重力分量，平稳握持不会触发。
        const smoothing = Math.exp(-delta / 250);
        gravity = {
          x: smoothing * gravity.x + (1 - smoothing) * includingGravity.x,
          y: smoothing * gravity.y + (1 - smoothing) * includingGravity.y,
          z: smoothing * gravity.z + (1 - smoothing) * includingGravity.z,
        };
        acceleration = {
          x: includingGravity.x - gravity.x,
          y: includingGravity.y - gravity.y,
          z: includingGravity.z - gravity.z,
        };
      }
      const magnitude = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
      if (peak && now - peak.at > 600) peak = null;
      if (magnitude < 8) return { valid: true, direction: 0 };
      if (peak) {
        const dot = acceleration.x * peak.vector.x + acceleration.y * peak.vector.y
          + acceleration.z * peak.vector.z;
        if (now - peak.at >= 70 && dot < -0.25 * magnitude * peak.magnitude) {
          peak = null;
          return { valid: true, direction: acceleration.x >= 0 ? 1 : -1 };
        }
      } else {
        peak = { at: now, vector: acceleration, magnitude };
      }
      return { valid: true, direction: 0 };
    }

    return Object.freeze({ sample, reset });
  }

  function create({ target, canShake, onShake, onState }) {
    const detector = createDetector();
    const eligible = target.navigator.maxTouchPoints > 0
      && target.matchMedia('(pointer: coarse)').matches;
    const supported = eligible && target.isSecureContext && !!target.DeviceMotionEvent;
    let phase = supported ? 'off' : 'unsupported';
    let generation = 0;
    let listenerAttached = false;
    let timer = null;
    let lastSignalAt = 0;
    let nextShakeAt = 0;
    let stateKey = '';

    const now = () => target.performance.now();
    function getState() {
      const cooldown = Math.ceil(Math.max(0, nextShakeAt - now()) / 1000);
      return {
        eligible, supported, phase,
        enabled: phase === 'checking' || phase === 'active' || phase === 'requesting',
        cooldown: phase === 'active' ? cooldown : 0,
      };
    }

    function refresh(force = false) {
      const state = getState();
      const key = `${state.phase}:${state.cooldown}`;
      if (force || key !== stateKey) {
        stateKey = key;
        onState(state);
      }
    }

    function detach() {
      if (listenerAttached) {
        target.removeEventListener('devicemotion', handleMotion);
        listenerAttached = false;
      }
      if (timer !== null) target.clearInterval(timer);
      timer = null;
      detector.reset();
    }

    function disable(nextPhase = 'off') {
      generation += 1;
      detach();
      phase = nextPhase;
      refresh(true);
    }

    function handleMotion(event) {
      if (target.document.hidden || (phase !== 'checking' && phase !== 'active')) return;
      const time = now();
      const result = detector.sample(event, time);
      if (!result.valid) return;
      lastSignalAt = time;
      phase = 'active';
      if (result.direction && time >= nextShakeAt && canShake()) {
        if (onShake(result.direction)) {
          nextShakeAt = time + COOLDOWN_MS;
          detector.reset();
        }
      }
      refresh();
    }

    async function enable() {
      if (!supported) { refresh(true); return; }
      const request = ++generation;
      phase = 'requesting';
      refresh(true);
      try {
        const Motion = target.DeviceMotionEvent;
        // 直接在按钮点击中请求权限，保留浏览器所需的用户操作上下文。
        if (typeof Motion.requestPermission === 'function') {
          const permission = await Motion.requestPermission();
          if (request !== generation) return;
          if (permission !== 'granted') { disable('denied'); return; }
        }
        if (request !== generation) return;
        detector.reset();
        lastSignalAt = now();
        phase = 'checking';
        target.addEventListener('devicemotion', handleMotion);
        listenerAttached = true;
        timer = target.setInterval(() => {
          if (target.document.hidden) return;
          if (now() - lastSignalAt >= SIGNAL_TIMEOUT_MS) { disable('unavailable'); return; }
          refresh();
        }, 250);
        refresh(true);
      } catch {
        if (request === generation) disable('denied');
      }
    }

    function resetRound() {
      detector.reset();
      nextShakeAt = 0;
      refresh(true);
    }

    target.document.addEventListener('visibilitychange', () => {
      detector.reset();
      if (!target.document.hidden && listenerAttached) {
        lastSignalAt = now();
        phase = 'checking';
        refresh(true);
      }
    });
    target.addEventListener('pagehide', () => disable());

    return Object.freeze({
      toggle: () => getState().enabled ? disable() : enable(),
      resetRound, refresh, getState,
    });
  }

  return Object.freeze({ create, createDetector });
});
