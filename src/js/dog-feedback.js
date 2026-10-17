(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DagouFeedback = factory();
})(globalThis, function () {
  'use strict';

  const IMPACT_MS = 480;
  const POP_MS = 350;
  const FINALE_HOLD_MS = 100;
  const FINALE_RING_MS = 850;

  // 跨过停顿结束的那一帧只推进剩余时间，不补算被暂停的物理时间。
  function advanceFinaleHold(remaining, delta) {
    const held = Math.min(remaining, delta);
    return { remaining: remaining - held, simulationDelta: delta - held };
  }

  function impact(age, strength) {
    if (age < 0 || age >= IMPACT_MS) return 0;
    return strength * Math.cos(2 * Math.PI * Math.max(0, age - 20) / 280)
      * Math.exp(-age / 180) * (1 - age / IMPACT_MS);
  }

  function recordImpact(body, speed, angle, now) {
    if (speed < 90) return false;
    const strength = Math.min(0.3, speed / 1500);
    // 复合碰撞体的多个子圆可能同时接触，只保留这一瞬间更强的撞击。
    if (now - body.gameSquashAt < 100 && strength <= body.gameSquash + 0.025) return false;
    body.gameSquash = strength;
    body.gameSquashAt = now;
    body.gameSquashAngle = angle;
    return true;
  }

  function pop(age) {
    if (age < 0 || age >= POP_MS) return 1;
    const t = age / POP_MS;
    return 1 + 0.3 * (1 - t) * Math.exp(-3 * t) * Math.cos(3 * Math.PI * t);
  }

  // 胸牌位置跟随贴图的旋转、合成缩放与沿接触方向的挤压；文字保持正向。
  function tagAnchor(x, y, sprite, angle, scale = 1, squash = 0, axis = 0) {
    const dx = (sprite.offsetX + 8 * sprite.size / 1024) * scale;
    const dy = (sprite.offsetY + 218 * sprite.size / 1024) * scale;
    const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
    const normal = rx * Math.cos(axis) + ry * Math.sin(axis);
    const tangent = -rx * Math.sin(axis) + ry * Math.cos(axis);
    const compression = 1 - squash;
    return {
      x: x + normal * compression * Math.cos(axis) - tangent / compression * Math.sin(axis),
      y: y + normal * compression * Math.sin(axis) + tangent / compression * Math.cos(axis),
    };
  }

  return Object.freeze({ impact, recordImpact, pop, tagAnchor, advanceFinaleHold,
    IMPACT_MS, POP_MS, FINALE_HOLD_MS, FINALE_RING_MS });
});
