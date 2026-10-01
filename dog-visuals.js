(() => {
  'use strict';

  // 表情与透明轮廓提前保存，手机无需生成、编码和再次解码贴图。
  const sources = Object.freeze(Array.from({ length: 8 }, (_, index) =>
    `assets/dog-tier-${index + 1}.png?v=4`));
  window.DagouVisuals = Object.freeze({ sources });
})();
