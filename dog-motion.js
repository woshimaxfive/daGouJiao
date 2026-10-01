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
      if (magnitude < 6) return { valid: true, direction: 0 };
      if (peak) {
        const dot = acceleration.x * peak.vector.x + acceleration.y * peak.vector.y
          + acceleration.z * peak.vector.z;
        if (now - peak.at >= 60 && dot < -0.25 * magnitude * peak.magnitude) {
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

  function createTilt() {
    let gravity = null;
    let lastAt = null;
    let strength = 0;
    function reset() { gravity = null; lastAt = null; strength = 0; }
    function sample(event, now, angle = 0) {
      const total = vector(event.accelerationIncludingGravity);
      if (!total) return;
      const linear = vector(event.acceleration);
      // 摇动时不把瞬时加速度当成倾斜，避免重力方向突然跳变。
      if (linear && Math.hypot(linear.x, linear.y, linear.z) > 4) return;
      const reading = linear ? {
        x: total.x - linear.x, y: total.y - linear.y, z: total.z - linear.z,
      } : total;
      const length = Math.hypot(reading.x, reading.y, reading.z);
      if (length < 6 || length > 13) return;
      const alpha = lastAt === null || now - lastAt > 600 ? 1
        : 1 - Math.exp(-Math.max(1, now - lastAt) / 120);
      gravity = gravity ? {
        x: gravity.x + (reading.x - gravity.x) * alpha,
        y: gravity.y + (reading.y - gravity.y) * alpha,
        z: gravity.z + (reading.z - gravity.z) * alpha,
      } : reading;
      lastAt = now;
      const radians = angle * Math.PI / 180;
      const screenX = gravity.x * Math.cos(radians) - gravity.y * Math.sin(radians);
      const screenY = gravity.x * Math.sin(radians) + gravity.y * Math.cos(radians);
      // 各浏览器可能提供相反符号，以朝上的分量统一方向。
      const polarity = Math.sign(Math.abs(screenY) > 3 ? screenY : gravity.z) || 1;
      const side = -screenX * polarity / Math.hypot(gravity.x, gravity.y, gravity.z);
      const magnitude = Math.max(0, Math.abs(side) - 0.08) / 0.47;
      strength = magnitude > 0 ? Math.sign(side) * Math.min(1, magnitude) : 0;
    }
    function get(now) {
      const ready = lastAt !== null && now - lastAt < 600;
      return { ready, strength: ready ? strength : 0 };
    }
    return Object.freeze({ sample, reset, get });
  }

  function create({ target, canShake, onShake, onState }) {
    const detector = createDetector();
    const tilt = createTilt();
    const sensorInput = target.navigator.maxTouchPoints > 0
      && target.matchMedia('(pointer: coarse)').matches;
    const input = sensorInput ? 'sensor' : 'keyboard';
    const eligible = true;
    const supported = !sensorInput || (target.isSecureContext && !!target.DeviceMotionEvent);
    const keys = new Set();
    let shakeDirection = 1;
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
      const reading = sensorInput ? tilt.get(now())
        : { ready: true, strength: Number(keys.has('KeyD')) - Number(keys.has('KeyA')) };
      return {
        eligible, supported, input, phase,
        enabled: phase === 'checking' || phase === 'active' || phase === 'requesting',
        cooldown: phase === 'active' ? cooldown : 0,
        tilt: phase === 'active' && !target.document.hidden ? reading.strength : 0,
        tiltReady: reading.ready,
      };
    }

    function refresh(force = false) {
      const state = getState();
      const key = `${state.phase}:${state.cooldown}:${state.tiltReady}:${Math.round(state.tilt * 4)}`;
      if (force || key !== stateKey) {
        stateKey = key;
        onState(state);
      }
    }

    function detach() {
      if (listenerAttached) {
        if (sensorInput) target.removeEventListener('devicemotion', handleMotion);
        else {
          target.document.removeEventListener('keydown', handleKeyDown);
          target.document.removeEventListener('keyup', handleKeyUp);
        }
        listenerAttached = false;
      }
      if (timer !== null) target.clearInterval(timer);
      timer = null;
      detector.reset();
      tilt.reset();
      keys.clear();
    }

    function disable(nextPhase = 'off') {
      generation += 1;
      detach();
      phase = nextPhase;
      refresh(true);
    }

    function tryShake(direction) {
      const time = now();
      if (time < nextShakeAt || !canShake()) return;
      if (onShake(direction)) {
        nextShakeAt = time + COOLDOWN_MS;
        shakeDirection = -direction;
        detector.reset();
      }
    }

    function handleKeyDown(event) {
      if (phase !== 'active' || target.document.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
      const element = event.target;
      if (element?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element?.tagName || '')) return;
      if (!['KeyA', 'KeyD', 'KeyW'].includes(event.code)) return;
      event.preventDefault();
      const held = keys.has(event.code);
      keys.add(event.code);
      if (event.code === 'KeyW' && !held && !event.repeat) {
        const direction = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
        tryShake(direction || shakeDirection);
      }
      refresh();
    }

    function handleKeyUp(event) {
      if (keys.delete(event.code)) refresh();
    }

    function clearKeys() { keys.clear(); refresh(); }

    function handleMotion(event) {
      if (target.document.hidden || (phase !== 'checking' && phase !== 'active')) return;
      const time = now();
      const result = detector.sample(event, time);
      if (!result.valid) return;
      lastSignalAt = time;
      phase = 'active';
      tilt.sample(event, time, target.screen?.orientation?.angle ?? target.orientation ?? 0);
      if (result.direction) tryShake(result.direction);
      refresh();
    }

    async function enable() {
      if (!supported) { refresh(true); return; }
      if (!sensorInput) {
        keys.clear();
        phase = 'active';
        target.document.addEventListener('keydown', handleKeyDown);
        target.document.addEventListener('keyup', handleKeyUp);
        listenerAttached = true;
        timer = target.setInterval(() => refresh(), 250);
        refresh(true);
        return;
      }
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
        tilt.reset();
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
      tilt.reset();
      nextShakeAt = 0;
      shakeDirection = 1;
      keys.clear();
      refresh(true);
    }

    target.document.addEventListener('visibilitychange', () => {
      detector.reset();
      tilt.reset();
      keys.clear();
      if (sensorInput && !target.document.hidden && listenerAttached) {
        lastSignalAt = now();
        phase = 'checking';
      }
      refresh(true);
    });
    target.addEventListener('blur', clearKeys);
    target.addEventListener('pagehide', () => disable());

    return Object.freeze({
      toggle: () => getState().enabled ? disable() : enable(),
      resetRound, refresh, getState,
    });
  }

  return Object.freeze({ create, createDetector, createTilt });
});
