(() => {
  'use strict';

  const QR_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACUAAAAlAQAAAADt5R2uAAAA0ElEQVR42mP8z8DA8JOJgYGBgQGZZC7U4Pw6h/H77Ql/JZn+tv8pYmBiYEljYGBi+O7FwMDE3CLEx8D4QdXhtQXj/98z31QyfUvt/87A+Oe9T8pdxo93+cVbWHgvfboyieWn6rsOIRbmja8ZGZgYJsbxMzB8X8+Z9YPxh+el8ndMrA8e9DMwfX9kt5WB4ccPpk8/mP4tOCfKwPj/K1MdC9NHzSP3GBi/P5vG0MrwJfgx+w/GL6mqz0SYGH7Z7Wdg+H7vgtgPxg8KQgpmjDh8AQAjJU3OjFf/owAAAABJRU5ErkJggg==';
  const FONT = '"Trebuchet MS", "Microsoft YaHei UI", "PingFang SC", sans-serif';
  const colors = { paper: '#e9f4fc', board: '#f9fcff', ink: '#293c50', muted: '#667d93', line: '#c7dae9', red: '#e65742', white: '#fffef9' };
  let qrPromise;

  function loadQr() {
    if (!qrPromise) qrPromise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = async () => {
        try { if (image.decode) await image.decode(); resolve(image); }
        catch { qrPromise = null; reject(new Error('二维码图片未准备成功')); }
      };
      image.onerror = () => { qrPromise = null; reject(new Error('二维码图片未准备成功')); };
      image.src = QR_IMAGE;
    });
    return qrPromise;
  }

  function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function text(ctx, value, x, y, size, color = colors.ink, weight = 800, maxWidth = 460) {
    let fontSize = size;
    do { ctx.font = `${weight} ${fontSize}px ${FONT}`; fontSize -= 1; }
    while (ctx.measureText(value).width > maxWidth && fontSize >= 12);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  function cloud(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = colors.white;
    ctx.beginPath();
    ctx.ellipse(0, 0, 66, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(-15, -9, 25, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(15, -6, 23, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  async function render({ score, duration, drops, tierName, tierLevel, tierColor, isNewRecord, dogImage }) {
    const qr = await loadQr();
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1500;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    const sky = ctx.createLinearGradient(0, 0, 0, 750);
    sky.addColorStop(0, '#d8edfb');
    sky.addColorStop(1, colors.board);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 540, 750);
    cloud(ctx, 485, 83, 1.4);
    cloud(ctx, 58, 385, 1.1);
    cloud(ctx, 463, 449, .85);

    ctx.textAlign = 'left';
    text(ctx, '合成大狗叫', 36, 65, 38, colors.ink, 900);
    text(ctx, isNewRecord ? '这局，刷新纪录！' : '这局，叫得有点响', 38, 94, 16, isNewRecord ? colors.red : colors.muted);

    roundRect(ctx, 32, 118, 476, 130, 20, colors.white, colors.line);
    ctx.textAlign = 'center';
    text(ctx, '本局得分', 270, 151, 15, colors.muted);
    text(ctx, score.toLocaleString('zh-CN'), 270, 222, 78, colors.red, 900, 416);

    ctx.fillStyle = colors.paper;
    ctx.beginPath();
    ctx.arc(270, 373, 108, 0, Math.PI * 2);
    ctx.fill();
    if (!dogImage?.naturalWidth) throw new Error('狗图未准备成功');
    ctx.drawImage(dogImage, 146, 250, 248, 248);
    const label = `最高合成 · ${tierLevel} 级 ${tierName}`;
    ctx.font = `900 20px ${FONT}`;
    const labelWidth = Math.min(440, ctx.measureText(label).width + 32);
    roundRect(ctx, 270 - labelWidth / 2, 479, labelWidth, 40, 12, colors.white, tierColor);
    text(ctx, label, 270, 506, 20, tierColor, 900, labelWidth - 24);

    roundRect(ctx, 32, 536, 476, 62, 14, colors.white, colors.line);
    ctx.strokeStyle = colors.line;
    ctx.beginPath(); ctx.moveTo(270, 548); ctx.lineTo(270, 586); ctx.stroke();
    text(ctx, '本局时长', 151, 558, 12, colors.muted);
    text(ctx, duration, 151, 583, 23, colors.ink, 900, 204);
    text(ctx, '投放次数', 389, 558, 12, colors.muted);
    text(ctx, drops.toLocaleString('zh-CN'), 389, 583, 23, colors.ink, 900, 204);

    ctx.textAlign = 'left';
    text(ctx, '你能合到第几级？', 38, 647, 23);
    text(ctx, '扫码来一局', 38, 679, 16, colors.muted);
    text(ctx, 'woshimaxfive.github.io/daGouJiao', 38, 718, 12, colors.muted, 600, 290);
    const qrSize = qr.naturalWidth * 3;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qr, 502 - qrSize, 728 - qrSize, qrSize, qrSize);
    return canvas.toDataURL('image/png');
  }

  window.DagouShare = Object.freeze({ render });
})();
