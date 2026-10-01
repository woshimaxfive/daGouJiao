(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dog-shape.js'));
  else root.DagouPhysics = factory(root.DagouShape);
})(globalThis, function (shape) {
  'use strict';

  function withMatter(Matter) {
    const { Bodies, Body } = Matter;

    function createDog(x, y, radius, tier) {
      const longest = Math.max(shape.visibleBounds[2] - shape.visibleBounds[0],
        shape.visibleBounds[3] - shape.visibleBounds[1]);
      const scale = radius * 2 / longest;
      const options = {
        restitution: 0.32 - Math.max(0, Math.min(7, tier)) * 0.012,
        friction: 0.42, frictionStatic: 0.65,
        frictionAir: 0.008, density: 0.00085, slop: 0.025,
      };
      const parts = shape.parts.map(([px, py, pr]) => Bodies.circle(
        (px - shape.canvasSize / 2) * scale,
        (py - shape.canvasSize / 2) * scale, pr * scale, options));
      const body = Body.create({ ...options, parts, label: `dog-${tier}` });
      // Matter 将父体位置设为复合质心，贴图中心需要保留这一偏移。
      body.gameSprite = {
        size: shape.canvasSize * scale,
        offsetX: -body.position.x,
        offsetY: -body.position.y,
      };
      Body.setMass(body, Math.PI * radius * radius * options.density);
      Body.setPosition(body, { x, y });
      body.gameTier = tier;
      return body;
    }

    function measure(radius) {
      const body = createDog(0, 0, radius, -1);
      return {
        sprite: body.gameSprite,
        left: -body.bounds.min.x, right: body.bounds.max.x,
        top: -body.bounds.min.y, bottom: body.bounds.max.y,
      };
    }

    function keepInside(body, width, height) {
      const dx = body.bounds.min.x < 2 ? 2 - body.bounds.min.x
        : body.bounds.max.x > width - 2 ? width - 2 - body.bounds.max.x : 0;
      const dy = body.bounds.max.y > height - 2 ? height - 2 - body.bounds.max.y
        : body.bounds.min.y < 22 ? 22 - body.bounds.min.y : 0;
      if (dx || dy) Body.translate(body, { x: dx, y: dy });
    }

    // 同一只狗可能由多个子圆同时接触，等级、去重和警戒计时只记在父体。
    function parentBody(part) { return part.parent || part; }

    return Object.freeze({ createDog, measure, keepInside, parentBody });
  }

  return Object.freeze({ withMatter });
});
