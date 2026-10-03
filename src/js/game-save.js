(function (root, factory) {
  const save = factory();
  if (typeof module === 'object' && module.exports) module.exports = save;
  else root.DagouSave = save;
})(globalThis, function () {
  'use strict';

  const KEY = 'dagou.round';
  // 棋盘、等级和碰撞轮廓改变时调整此标记，避免旧局面套用新规则。
  const RULES = '420x680:136:21,28,36,44,53,64,77,92,109,128:shape1';
  const between = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const tier = value => Number.isInteger(value) && between(value, 0, 9);

  function valid(round) {
    if (!round || round.version !== 1 || round.rules !== RULES
      || !count(round.score) || !count(round.bestAtStart)
      || !count(round.dropCount) || round.dropCount === 0
      || !between(round.durationMs, 0, Number.MAX_SAFE_INTEGER)
      || !between(round.dropCooldown, 0, 380)
      || !between(round.shakeCooldown, 0, 3000)
      || !between(round.aimX, 0, 420)
      || !tier(round.currentTier) || round.currentTier > 3
      || !tier(round.nextTier) || round.nextTier > 3
      || !tier(round.maxReached) || !Array.isArray(round.pieces)
      || round.pieces.length > 512) return false;
    return round.pieces.every(piece => piece && tier(piece.tier)
      && piece.tier <= round.maxReached
      && between(piece.x, -256, 676) && between(piece.y, -256, 936)
      && between(piece.angle, -1e8, 1e8)
      && between(piece.vx, -1000, 1000) && between(piece.vy, -1000, 1000)
      && between(piece.angularVelocity, -100, 100)
      && typeof piece.landed === 'boolean'
      && between(piece.dangerTime, 0, 1.5));
  }

  function read(storage) {
    try {
      const round = JSON.parse(storage.getItem(KEY));
      if (valid(round)) return round;
      clear(storage);
    } catch { clear(storage); }
    return null;
  }

  function write(storage, state) {
    const round = { ...state, version: 1, rules: RULES };
    if (!valid(round)) return false;
    try { storage.setItem(KEY, JSON.stringify(round)); return true; } catch { return false; }
  }

  function clear(storage) {
    try { storage.removeItem(KEY); } catch { /* 存储不可用时仍可正常游玩 */ }
  }

  return Object.freeze({ read, write, clear });
});
