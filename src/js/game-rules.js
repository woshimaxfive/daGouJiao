(function (root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.DagouRules = rules;
})(globalThis, function () {
  function chooseSpawnTier(weights, random = Math.random, excludedTier = -1) {
    const availableWeight = weights.reduce((sum, weight, tier) =>
      sum + (tier === excludedTier ? 0 : weight), 0);
    let roll = random() * availableWeight;

    for (let tier = 0; tier < weights.length; tier += 1) {
      if (tier === excludedTier) continue;
      roll -= weights[tier];
      if (roll < 0) return tier;
    }
    return weights.findIndex((weight, tier) => weight > 0 && tier !== excludedTier);
  }

  function advanceDanger(body, deltaSeconds, dangerY, dangerSeconds, restSpeedPerSecond) {
    const aboveLine = body.bounds.min.y < dangerY;
    const resting = body.speed * 60 < restSpeedPerSecond;
    const gameOverTime = aboveLine && resting
      ? body.gameOverTime + deltaSeconds
      : Math.max(0, body.gameOverTime - deltaSeconds * 2);

    return {
      counting: aboveLine && resting,
      gameOverTime,
      progress: gameOverTime / dangerSeconds,
      gameOver: gameOverTime > dangerSeconds,
    };
  }

  function dangerNotice(progress, counting, seconds) {
    if (progress <= 0) return { phase: 'hidden', remaining: 0 };
    if (!counting) return { phase: 'recovering', remaining: 0 };
    const remaining = Math.max(0, Math.ceil(seconds * (1 - Math.min(1, progress)) * 10 - 1e-9) / 10);
    return { phase: 'countdown', remaining };
  }

  function roundResult(score, bestAtStart, maxTier) {
    return { score, maxTier, maxLevel: maxTier + 1, isNewRecord: score > 0 && score > bestAtStart };
  }

  return Object.freeze({ chooseSpawnTier, advanceDanger, dangerNotice, roundResult });
});
