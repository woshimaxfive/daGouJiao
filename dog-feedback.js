(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DagouFeedback = factory();
})(globalThis, function () {
  'use strict';

  const IMPACT_MS = 350;
  const POP_MS = 350;

  function impact(age, strength) {
    if (age < 0 || age >= IMPACT_MS) return 0;
    return strength * 1.5 * Math.sin(Math.PI * age / 100)
      * Math.exp(-age / 135) * (1 - age / IMPACT_MS);
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

  return Object.freeze({ impact, pop, tagAnchor, IMPACT_MS, POP_MS });
});
