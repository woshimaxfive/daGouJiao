(() => {
  'use strict';

  // 两张原图的嘴部位置固定。中间等级只合成这一小块，保留原照片其余像素。
  const MOUTH = Object.freeze({ x: 365, y: 396, width: 270, height: 355 });
  const OPENNESS = Object.freeze([0, 0.035, 0.12, 0.26, 0.43, 0.62, 0.82, 1]);

  function createFrames(closed, open) {
    const frames = [closed.src];
    for (const openness of OPENNESS.slice(1, -1)) {
      const frame = document.createElement('canvas');
      frame.width = closed.naturalWidth;
      frame.height = closed.naturalHeight;
      const context = frame.getContext('2d');
      context.drawImage(closed, 0, 0);

      const patch = document.createElement('canvas');
      patch.width = frame.width;
      patch.height = frame.height;
      const patchContext = patch.getContext('2d');
      const top = 436 - 40 * openness;
      const height = 70 + 285 * openness;
      patchContext.drawImage(open, MOUTH.x, MOUTH.y, MOUTH.width, MOUTH.height,
        MOUTH.x, top, MOUTH.width, height);

      // 羽化局部边缘，避免把照片背景或矩形接缝带到闭嘴原图上。
      patchContext.globalCompositeOperation = 'destination-in';
      patchContext.translate(MOUTH.x + MOUTH.width / 2, top + height / 2);
      patchContext.scale(MOUTH.width / 2, height / 2);
      const mask = patchContext.createRadialGradient(0, 0, 0, 0, 0, 1);
      mask.addColorStop(0, '#fff');
      mask.addColorStop(0.78, '#fff');
      mask.addColorStop(1, 'rgba(255, 255, 255, 0)');
      patchContext.fillStyle = mask;
      patchContext.fillRect(-1, -1, 2, 2);
      context.drawImage(patch, 0, 0);
      frames.push(frame.toDataURL('image/png'));
    }
    frames.push(open.src);
    return frames;
  }

  window.DagouVisuals = Object.freeze({ createFrames });
})();
