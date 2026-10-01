(() => {
  'use strict';

  if (!window.Matter) {
    document.getElementById('live-status').textContent = '物理引擎加载失败，请刷新页面。';
    return;
  }

  const { Engine, Bodies, Body, Composite, Events } = Matter;
  const dogPhysics = window.DagouPhysics.withMatter(Matter);
  const feedback = window.DagouFeedback;
  const { chooseSpawnTier: pickTier, advanceDanger, dangerNotice, roundResult } = window.DagouRules;
  const WIDTH = 420;
  const HEIGHT = 680;
  const DANGER_Y = 160;
  const DOG_SIZE_SCALE = 1.1;
  const DANGER_SECONDS = 1.5;
  const REST_SPEED_PER_SECOND = 140;
  const DROP_COOLDOWN = 380;
  const STEP = 1000 / 60;
  const SUBSTEPS = 3;
  const FINALE_AUDIO_PATH = 'assets/dagou-bark.mp3';
  const FINALE_VOLUME = 0.5;
  const FINALE_FADE_IN = 0.15;
  const FINALE_FADE_OUT = 0.2;
  const TIERS = [
    { name: '闭麦', radius: 21, color: '#526879' },
    { name: '蓄力', radius: 28, color: '#167c80' },
    { name: '呜', radius: 36, color: '#3569bd' },
    { name: '小汪', radius: 45, color: '#8053b6' },
    { name: '汪汪', radius: 56, color: '#b44378' },
    { name: '大汪', radius: 69, color: '#af5418' },
    { name: '怒吼', radius: 84, color: '#c13c32' },
    { name: '大狗叫', radius: 102, color: '#896210' },
  ].map(tier => ({ ...tier, radius: tier.radius * DOG_SIZE_SCALE }));
  const SPAWN_WEIGHTS = [0.38, 0.30, 0.21, 0.11];
  const tierLayouts = TIERS.map(tier => dogPhysics.measure(tier.radius));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const canvas = document.getElementById('game-canvas');
  const context = canvas.getContext('2d');
  const stage = document.getElementById('board-stage');
  stage.style.setProperty('--danger-line', `${DANGER_Y / HEIGHT * 100}%`);
  const scoreElement = document.getElementById('score');
  const bestElement = document.getElementById('best-score');
  const nextLabel = document.getElementById('next-label');
  const nextNumber = document.getElementById('next-number');
  const nextImage = document.getElementById('next-image');
  const nextPiece = document.getElementById('next-piece');
  const tierList = document.getElementById('tier-list');
  const evolutionPanel = document.getElementById('evolution-panel');
  const mobileLayout = window.matchMedia('(max-width: 850px)');
  const soundButton = document.getElementById('sound-button');
  const overElement = document.getElementById('game-over');
  const finalScore = document.getElementById('final-score');
  const finalTier = document.getElementById('final-tier');
  const finalTierImage = document.getElementById('final-tier-image');
  const finalTierNumber = document.getElementById('final-tier-number');
  const recordStatus = document.getElementById('record-status');
  const dangerElement = document.getElementById('danger-notice');
  const dangerLabel = document.getElementById('danger-label');
  const dangerTime = document.getElementById('danger-time');
  const liveStatus = document.getElementById('live-status');

  const imageLoading = document.getElementById('image-loading');
  const imageLoadingMessage = document.getElementById('image-loading-message');
  const retryImagesButton = document.getElementById('retry-images-button');
  const tierImages = TIERS.map(() => new Image());
  const loadedImages = new WeakSet();
  let visualsReady = false;
  let visualsLoading = false;

  function readyImage(image) {
    return image.naturalWidth > 0 && (loadedImages.has(image) || image.complete);
  }

  function tierImage(tier) {
    return tierImages[tier];
  }

  function updateImageProgress() {
    const count = tierImages.filter(readyImage).length;
    imageLoadingMessage.textContent = `正在加载狗图（${count}/8）`;
  }

  async function loadDogImage(image, src) {
    if (readyImage(image)) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await new Promise((resolve, reject) => {
          const finish = error => {
            clearTimeout(timer);
            image.removeEventListener('load', loaded);
            image.removeEventListener('error', failed);
            if (error) reject(error);
            else resolve();
          };
          const loaded = () => {
            if (!image.naturalWidth) { failed(); return; }
            loadedImages.add(image);
            updateImageProgress();
            finish();
          };
          const failed = () => {
            loadedImages.delete(image);
            finish(new Error('狗图加载失败'));
          };
          const timer = setTimeout(() => finish(new Error('狗图加载超时')), 8000);
          image.addEventListener('load', loaded);
          image.addEventListener('error', failed);
          image.src = attempt === 0 ? src : `${src}&retry=${Date.now()}-${attempt}`;
          if (readyImage(image)) loaded();
        });
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
  }

  async function loadVisuals() {
    if (visualsLoading || visualsReady) return;
    visualsLoading = true;
    imageLoading.hidden = false;
    retryImagesButton.hidden = true;
    updateImageProgress();
    try {
      // 棋盘直接使用等级列表中的同一批图片，避免两条加载路径状态不一致。
      await Promise.allSettled(tierImages.map((image, index) =>
        loadDogImage(image, window.DagouVisuals.sources[index])));
      visualsReady = tierImages.every(readyImage);
      if (visualsReady) {
        updateNext();
        imageLoading.hidden = true;
        liveStatus.textContent = '狗图加载完成，可以开始投放。';
      } else {
        imageLoadingMessage.textContent = '有些狗图没有加载成功，请重试。';
        retryImagesButton.hidden = false;
      }
    } finally {
      visualsLoading = false;
    }
  }

  let engine;
  let pieces = [];
  let pendingMerges = [];
  let pendingIds = new Set();
  let particles = [];
  let floatingTexts = [];
  let score = 0;
  let best = readNumber('dagou.best');
  let bestAtStart = best;
  let result = null;
  let warning = { phase: 'hidden', remaining: 0 };
  let muted = readString('dagou.muted') === '1';
  let currentTier = 0;
  let nextTier = 0;
  let maxReached = 0;
  let aimX = WIDTH / 2;
  let lastDropAt = -DROP_COOLDOWN;
  let elapsed = 0;
  let physicsAccumulator = 0;
  let previousFrame = 0;
  let gameOver = false;
  let touchAiming = false;
  let audioContext;
  let finaleAudioLoad;
  let finaleSource;
  let finaleGain;
  let finalePlaybackId = 0;
  let celebrationUntil = 0;
  let shakeUntil = 0;
  let warningProgress = 0;

  function readString(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function readNumber(key) {
    const value = Number(readString(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function saveString(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 私密模式下仍可游玩 */ }
  }

  function clampAim(x) {
    const layout = tierLayouts[currentTier];
    return Math.max(layout.left + 5, Math.min(WIDTH - layout.right - 5, x));
  }

  function makePiece(x, y, tier, landed = false) {
    const body = dogPhysics.createDog(x, y, TIERS[tier].radius, tier);
    body.gameLanded = landed;
    body.gameOverTime = 0;
    body.gameSquash = 0;
    body.gameSquashAt = 0;
    body.gameSquashAngle = 0;
    body.gamePopAt = -1000;
    pieces.push(body);
    Composite.add(engine.world, body);
    if (tier > maxReached) {
      maxReached = tier;
      updateTierList();
    }
    return body;
  }

  function onCollision(event) {
    for (const pair of event.pairs) {
      const a = dogPhysics.parentBody(pair.bodyA);
      const b = dogPhysics.parentBody(pair.bodyB);
      if (a === b) continue;
      if (a.gameTier !== undefined) a.gameLanded = true;
      if (b.gameTier !== undefined) b.gameLanded = true;
      const normal = pair.collision.normal;
      const impact = Math.abs((a.velocity.x - b.velocity.x) * normal.x
        + (a.velocity.y - b.velocity.y) * normal.y);
      if (impact > 1.4) {
        for (const body of [a, b]) {
          if (body.gameTier === undefined) continue;
          const amount = Math.min(0.24, impact * 0.04);
          const age = elapsed - body.gameSquashAt;
          const remaining = body.gameSquash * Math.max(0, 1 - age / feedback.IMPACT_MS);
          if (age > 100 || amount > remaining + 0.025) {
            body.gameSquash = amount;
            body.gameSquashAt = elapsed;
            body.gameSquashAngle = Math.atan2(normal.y, normal.x);
          }
        }
      }
      if (a.gameTier === undefined || b.gameTier === undefined) continue;
      if (a.gameTier !== b.gameTier || pendingIds.has(a.id) || pendingIds.has(b.id)) continue;
      pendingIds.add(a.id);
      pendingIds.add(b.id);
      pendingMerges.push([a, b]);
    }
  }

  function burst(x, y, color, count = 14) {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i / count) + Math.random() * 0.35;
      const speed = 1.7 + Math.random() * 4;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5, life: 1, size: 2 + Math.random() * 4, color });
    }
    if (particles.length > 150) particles.splice(0, particles.length - 150);
  }

  function displayScore(element, value) {
    const text = value.toLocaleString('zh-CN');
    element.textContent = text;
    element.style.setProperty('--score-digits', String(text.length));
  }

  function addPoints(points, x, y) {
    score += points;
    displayScore(scoreElement, score);
    floatingTexts.push({ x, y, value: `+${points}`, life: 1 });
    if (score > best) {
      best = score;
      displayScore(bestElement, best);
      saveString('dagou.best', String(best));
    }
  }

  function mergePending() {
    for (const [a, b] of pendingMerges) {
      if (!pieces.includes(a) || !pieces.includes(b)) continue;
      const tier = a.gameTier;
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;
      const vx = (a.velocity.x + b.velocity.x) * 0.2;
      const vy = Math.min(-1.2, (a.velocity.y + b.velocity.y) * 0.1 - 1.4);
      Composite.remove(engine.world, [a, b]);
      pieces = pieces.filter(piece => piece !== a && piece !== b);
      burst(x, y, TIERS[tier].color, tier === TIERS.length - 1 ? 34 : 14);

      if (tier === TIERS.length - 1) {
        addPoints(200, x, y);
        celebrationUntil = elapsed + 2000;
        shakeUntil = elapsed + 400;
        bark(tier, true);
        liveStatus.textContent = '大狗叫！最高级合成，获得 200 分。';
      } else {
        const upgraded = makePiece(x, y, tier + 1, true);
        dogPhysics.keepInside(upgraded, WIDTH, HEIGHT);
        Body.setVelocity(upgraded, { x: vx, y: vy });
        Body.setAngularVelocity(upgraded, (a.angularVelocity + b.angularVelocity) * 0.25);
        upgraded.gamePopAt = elapsed;
        addPoints(((tier + 1) * (tier + 2)) / 2, x, y);
        bark(tier + 1, false);
        liveStatus.textContent = `合成${TIERS[tier + 1].name}，当前 ${score} 分。`;
      }
    }
    pendingMerges = [];
    pendingIds.clear();
  }

  function updateDanger(deltaSeconds) {
    warningProgress = 0;
    let counting = false;
    let activeProgress = 0;
    for (const body of pieces) {
      if (!body.gameLanded) continue;
      const danger = advanceDanger(body, deltaSeconds, DANGER_Y, DANGER_SECONDS, REST_SPEED_PER_SECOND);
      body.gameOverTime = danger.gameOverTime;
      warningProgress = Math.max(warningProgress, danger.progress);
      if (danger.counting) {
        counting = true;
        activeProgress = Math.max(activeProgress, danger.progress);
      }
      if (danger.gameOver) { endGame(); return; }
    }
    updateDangerNotice(dangerNotice(counting ? activeProgress : warningProgress, counting, DANGER_SECONDS));
  }

  function updateDangerNotice(nextWarning, announce = true) {
    const previousPhase = warning.phase;
    const changed = previousPhase !== nextWarning.phase || warning.remaining !== nextWarning.remaining;
    warning = nextWarning;
    if (!changed) return;
    dangerElement.hidden = warning.phase === 'hidden';
    dangerElement.dataset.phase = warning.phase;
    dangerLabel.textContent = warning.phase === 'recovering' ? '警戒缓解' : '即将结束';
    dangerTime.textContent = warning.phase === 'countdown' ? ` · ${warning.remaining.toFixed(1)} 秒` : '';
    if (announce && previousPhase !== warning.phase) {
      if (warning.phase === 'countdown') liveStatus.textContent = '越线停住，警戒倒计时开始。';
      if (warning.phase === 'hidden') liveStatus.textContent = '警戒倒计时已解除。';
    }
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    touchAiming = false;
    result = roundResult(score, bestAtStart, maxReached);
    displayScore(finalScore, result.score);
    finalTier.textContent = `${result.maxLevel} 级 · ${TIERS[result.maxTier].name}`;
    finalTierImage.src = tierImage(result.maxTier).src;
    finalTierImage.alt = '';
    finalTierNumber.textContent = result.maxLevel;
    recordStatus.textContent = result.isNewRecord ? '刷新最高纪录！' : '下一局继续挑战';
    recordStatus.dataset.record = String(result.isNewRecord);
    overElement.style.setProperty('--tier-color', TIERS[result.maxTier].color);
    updateDangerNotice({ phase: 'hidden', remaining: 0 }, false);
    overElement.hidden = false;
    document.getElementById('play-again-button').focus({ preventScroll: true });
    liveStatus.textContent = `游戏结束，本局 ${score} 分，最高 ${result.maxLevel} 级${TIERS[result.maxTier].name}。${result.isNewRecord ? '刷新最高纪录！' : ''}`;
  }

  function reset() {
    stopFinaleAudio();
    if (engine) {
      Events.off(engine, 'collisionStart', onCollision);
      Composite.clear(engine.world, false);
    }
    engine = Engine.create({ enableSleeping: false, positionIterations: 8, velocityIterations: 8 });
    engine.gravity.y = 1.55;
    engine.gravity.scale = 0.001;
    const wallOptions = { isStatic: true, friction: 0.6, restitution: 0.12, label: 'wall' };
    Composite.add(engine.world, [
      Bodies.rectangle(-40, HEIGHT / 2, 80, HEIGHT + 200, wallOptions),
      Bodies.rectangle(WIDTH + 40, HEIGHT / 2, 80, HEIGHT + 200, wallOptions),
      Bodies.rectangle(WIDTH / 2, HEIGHT + 40, WIDTH + 160, 80, wallOptions),
      Bodies.rectangle(WIDTH / 2, -40, WIDTH + 160, 80, wallOptions),
    ]);
    Events.on(engine, 'collisionStart', onCollision);
    pieces = [];
    pendingMerges = [];
    pendingIds = new Set();
    particles = [];
    floatingTexts = [];
    score = 0;
    bestAtStart = best;
    result = null;
    maxReached = 0;
    warningProgress = 0;
    physicsAccumulator = 0;
    aimX = WIDTH / 2;
    currentTier = pickTier(SPAWN_WEIGHTS);
    nextTier = pickTier(SPAWN_WEIGHTS, Math.random, currentTier);
    lastDropAt = elapsed - DROP_COOLDOWN;
    celebrationUntil = 0;
    shakeUntil = 0;
    gameOver = false;
    touchAiming = false;
    updateDangerNotice({ phase: 'hidden', remaining: 0 }, false);
    overElement.hidden = true;
    displayScore(finalScore, 0);
    finalTier.textContent = '';
    finalTierNumber.textContent = '';
    finalTierImage.removeAttribute('src');
    recordStatus.textContent = '';
    recordStatus.removeAttribute('data-record');
    overElement.style.removeProperty('--tier-color');
    displayScore(scoreElement, 0);
    displayScore(bestElement, best);
    updateNext();
    updateTierList();
    liveStatus.textContent = '新的一局开始了。';
    canvas.focus({ preventScroll: true });
  }

  function updateNext() {
    nextLabel.textContent = TIERS[nextTier].name;
    nextNumber.textContent = String(nextTier + 1);
    if (tierImage(nextTier).src) nextImage.src = tierImage(nextTier).src;
    nextImage.alt = `下一只：${nextTier + 1} 级${TIERS[nextTier].name}`;
    nextPiece.style.setProperty('--tier-color', TIERS[nextTier].color);
    canvas.setAttribute('aria-label', `大狗叫合成游戏棋盘。当前待投：${currentTier + 1} 级${TIERS[currentTier].name}；下一只：${nextTier + 1} 级${TIERS[nextTier].name}。鼠标点击或触屏松手投放；方向键移动，空格投放。`);
  }

  function updateTierList() {
    tierList.replaceChildren();
    TIERS.forEach((tier, index) => {
      const item = document.createElement('li');
      item.style.setProperty('--tier-color', tier.color);
      if (index <= maxReached) item.classList.add('reached');
      const dot = tierImages[index];
      dot.className = 'tier-dot';
      dot.alt = '';
      const portrait = document.createElement('span');
      portrait.className = 'tier-portrait';
      const tag = document.createElement('span');
      tag.className = 'tier-tag';
      tag.textContent = index + 1;
      tag.setAttribute('aria-hidden', 'true');
      portrait.append(dot, tag);
      const name = document.createElement('b');
      name.textContent = tier.name;
      const number = document.createElement('small');
      number.textContent = `LEVEL ${String(index + 1).padStart(2, '0')}`;
      item.append(portrait, name, number);
      tierList.append(item);
    });
  }

  function drop() {
    if (!visualsReady || gameOver || elapsed - lastDropAt < DROP_COOLDOWN) return false;
    const piece = makePiece(clampAim(aimX), 65, currentTier);
    Body.setVelocity(piece, { x: 0, y: 0.5 });
    lastDropAt = elapsed;
    playDrop();
    currentTier = nextTier;
    nextTier = pickTier(SPAWN_WEIGHTS, Math.random, currentTier);
    aimX = clampAim(aimX);
    updateNext();
    return true;
  }

  function setAimFromPointer(event) {
    const rect = canvas.getBoundingClientRect();
    aimX = clampAim((event.clientX - rect.left) * WIDTH / rect.width);
  }

  function getAudio() {
    if (muted) return null;
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      prepareFinaleAudio(audioContext);
      return audioContext;
    } catch { return null; }
  }

  function prepareFinaleAudio(audio) {
    if (!finaleAudioLoad) {
      finaleAudioLoad = fetch(FINALE_AUDIO_PATH)
        .then(response => {
          if (!response.ok) throw new Error('大狗叫录音加载失败');
          return response.arrayBuffer();
        })
        .then(data => audio.decodeAudioData(data))
        .catch(() => null);
    }
    return finaleAudioLoad;
  }

  function stopFinaleAudio() {
    // 同时取消尚在加载的播放请求，避免重开或静音后迟到的声音。
    finalePlaybackId += 1;
    if (finaleSource) {
      finaleSource.stop();
      finaleSource.disconnect();
      finaleSource = null;
    }
    if (finaleGain) {
      finaleGain.disconnect();
      finaleGain = null;
    }
  }

  async function playFinaleAudio(tier) {
    stopFinaleAudio();
    const playbackId = finalePlaybackId;
    const audio = getAudio();
    if (!audio) return;
    try {
      const buffer = await prepareFinaleAudio(audio);
      if (muted || playbackId !== finalePlaybackId) return;
      if (!buffer) throw new Error('大狗叫录音无法解码');
      if (audio.state === 'suspended') await audio.resume();
      if (muted || playbackId !== finalePlaybackId) return;
      const source = audio.createBufferSource();
      const gain = audio.createGain();
      const start = audio.currentTime;
      const end = start + buffer.duration;
      source.buffer = buffer;
      // 保留原录音，以较低音量平滑起落，避免突然响起。
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(FINALE_VOLUME,
        start + Math.min(FINALE_FADE_IN, buffer.duration / 2));
      gain.gain.setValueAtTime(FINALE_VOLUME,
        end - Math.min(FINALE_FADE_OUT, buffer.duration / 2));
      gain.gain.linearRampToValueAtTime(0, end);
      source.connect(gain).connect(audio.destination);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (finaleSource === source) finaleSource = null;
        if (finaleGain === gain) finaleGain = null;
      };
      finaleSource = source;
      finaleGain = gain;
      source.start(start);
    } catch {
      if (muted || playbackId !== finalePlaybackId) return;
      synthBark(tier, true);
      liveStatus.textContent = '大狗叫！录音未能播放，暂用合成音效；请通过本地 HTTP 服务打开。';
    }
  }

  function tone(frequency, duration, volume, type = 'sine', delay = 0) {
    const audio = getAudio();
    if (!audio) return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(42, frequency * 0.48), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playDrop() {
    // 气泡起音叠上中频软落声，兼顾手机扬声器的可听度。
    tone(600, 0.04, 0.025, 'sine');
    tone(320, 0.11, 0.055, 'triangle', 0.01);
  }

  function bark(tier, finale) {
    if (finale) {
      playFinaleAudio(tier);
      return;
    }
    synthBark(tier, false);
  }

  function synthBark(tier, finale) {
    const pitch = Math.max(105, 300 - tier * 23);
    tone(pitch, 0.14, 0.075, 'sawtooth');
    tone(pitch * 0.53, 0.19, 0.04, 'triangle', 0.035);
    if (finale) {
      tone(140, 0.19, 0.09, 'sawtooth', 0.22);
      tone(115, 0.28, 0.12, 'sawtooth', 0.5);
    }
  }

  function toggleSound() {
    muted = !muted;
    if (muted) stopFinaleAudio();
    saveString('dagou.muted', muted ? '1' : '0');
    soundButton.textContent = muted ? '音效：关' : '音效：开';
    soundButton.setAttribute('aria-pressed', String(muted));
    if (!muted) tone(330, 0.1, 0.04);
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawBoard() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.save();
    context.restore();

    context.save();
    context.strokeStyle = warningProgress > .35 ? '#df543e' : '#e69c82';
    context.lineWidth = warningProgress > .35 ? 3 : 2;
    context.setLineDash([9, 8]);
    context.beginPath(); context.moveTo(0, DANGER_Y); context.lineTo(WIDTH, DANGER_Y); context.stroke();
    context.setLineDash([]);
    context.fillStyle = warningProgress > .35 ? '#cf4c38' : '#ab755b';
    context.font = '800 11px "Microsoft YaHei UI", sans-serif';
    context.textAlign = 'right';
    context.fillText('警戒线', WIDTH - 12, DANGER_Y - 9);
    if (!gameOver && warningProgress > 0) {
      context.fillStyle = 'rgba(230, 87, 66, .1)';
      context.fillRect(0, 0, WIDTH * Math.min(1, warningProgress), DANGER_Y);
    }
    context.restore();
  }

  function drawPiece(body) {
    const tier = body.gameTier;
    const x = body.position.x;
    const y = body.position.y;
    context.save();
    context.globalAlpha = 0.12;
    context.fillStyle = '#735032';
    context.beginPath();
    context.ellipse(x, HEIGHT - 2, TIERS[tier].radius * 0.7, 4, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();

    const { pop, squash } = pieceMotion(body);
    drawDog(x, y, tier, body.angle, body.gameSprite, pop, squash, body.gameSquashAngle);
  }

  function pieceMotion(body) {
    return {
      pop: reducedMotion.matches ? 1 : feedback.pop(elapsed - body.gamePopAt),
      squash: reducedMotion.matches ? 0 : feedback.impact(elapsed - body.gameSquashAt, body.gameSquash),
    };
  }

  function drawLevelTag(x, y, tier, angle, sprite, pop = 1, squash = 0, axis = 0) {
    const point = feedback.tagAnchor(x, y, sprite, angle, pop, squash, axis);
    const size = Math.max(21, Math.min(29, TIERS[tier].radius * 0.35));
    const tx = Math.max(size / 2 + 2, Math.min(WIDTH - size / 2 - 2, point.x));
    const ty = Math.max(size / 2 + 2, Math.min(HEIGHT - size / 2 - 2, point.y));
    context.save();
    context.translate(tx, ty);
    context.fillStyle = TIERS[tier].color;
    context.strokeStyle = '#fffef9';
    context.lineWidth = 2;
    context.shadowColor = 'rgba(52, 41, 31, .22)';
    context.shadowBlur = 3;
    context.shadowOffsetY = 1;
    context.beginPath();
    context.roundRect(-size / 2, -size / 2, size, size, 5);
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = '#fffef9';
    context.font = `900 ${Math.round(size * 0.7)}px "Trebuchet MS", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(tier + 1, 0, 1);
    context.restore();
  }

  function drawDog(x, y, tier, angle, sprite, pop = 1, squash = 0, squashAngle = 0) {
    const image = tierImage(tier);
    context.save();
    context.translate(x, y);
    if (Math.abs(squash) > 0.0001) {
      context.rotate(squashAngle);
      context.scale(1 - squash, 1 / (1 - squash));
      context.rotate(-squashAngle);
    }
    context.rotate(angle);
    context.scale(pop, pop);
    context.drawImage(image, sprite.offsetX - sprite.size / 2,
      sprite.offsetY - sprite.size / 2, sprite.size, sprite.size);
    context.restore();
  }

  function drawAim() {
    if (gameOver || !visualsReady) return;
    context.save();
    context.strokeStyle = 'rgba(101, 72, 40, .42)';
    context.setLineDash([3, 6]);
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(aimX, 72 + tierLayouts[currentTier].bottom);
    context.lineTo(aimX, HEIGHT - 20);
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = elapsed - lastDropAt < DROP_COOLDOWN ? .42 : .95;
    drawDog(aimX, 65, currentTier, 0, tierLayouts[currentTier].sprite);
    drawLevelTag(aimX, 65, currentTier, 0, tierLayouts[currentTier].sprite);
    context.restore();

    // 标签跟随瞄准位置，靠墙时单独收进棋盘，避免文字被裁掉。
    context.save();
    context.font = '700 12px "Microsoft YaHei UI", sans-serif';
    const label = `待投 · ${String(currentTier + 1).padStart(2, '0')} ${TIERS[currentTier].name}`;
    const labelWidth = context.measureText(label).width + 16;
    const labelX = Math.max(labelWidth / 2 + 6, Math.min(WIDTH - labelWidth / 2 - 6, aimX));
    context.fillStyle = '#34291f';
    context.beginPath();
    context.roundRect(labelX - labelWidth / 2, 2, labelWidth, 18, 6);
    context.fill();
    context.fillStyle = '#fffdf5';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, labelX, 11);
    context.restore();
  }

  function drawEffects(deltaSeconds) {
    for (const particle of particles) {
      particle.x += particle.vx * deltaSeconds * 60;
      particle.y += particle.vy * deltaSeconds * 60;
      particle.vy += deltaSeconds * 12;
      particle.life -= deltaSeconds * 1.8;
      context.save();
      context.globalAlpha = Math.max(0, particle.life);
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size * Math.max(.25, particle.life), 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    particles = particles.filter(particle => particle.life > 0);

    for (const label of floatingTexts) {
      label.y -= deltaSeconds * 42;
      label.life -= deltaSeconds * 1.35;
      context.save();
      context.globalAlpha = Math.max(0, label.life);
      context.fillStyle = '#9d3827';
      context.font = '900 24px "Trebuchet MS", sans-serif';
      context.textAlign = 'center';
      context.fillText(label.value, label.x, label.y);
      context.restore();
    }
    floatingTexts = floatingTexts.filter(label => label.life > 0);
  }

  function drawCelebration() {
    if (elapsed >= celebrationUntil) return;
    const remaining = celebrationUntil - elapsed;
    context.save();
    context.globalAlpha = Math.min(1, remaining / 450);
    context.fillStyle = '#e65742';
    context.textAlign = 'center';
    context.font = '900 46px "Microsoft YaHei UI", sans-serif';
    context.shadowColor = '#fff3d1';
    context.shadowBlur = 18;
    context.fillText('大狗叫！！', WIDTH / 2, HEIGHT * .38);
    context.restore();
  }

  function draw(deltaSeconds) {
    context.save();
    if (!reducedMotion.matches && elapsed < shakeUntil) context.translate((Math.random() - .5) * 7, (Math.random() - .5) * 7);
    drawBoard();
    for (const body of pieces) drawPiece(body);
    // 牌子统一在狗图之后绘制，堆叠时也能读到等级。
    for (const body of pieces) {
      const { pop, squash } = pieceMotion(body);
      drawLevelTag(body.position.x, body.position.y, body.gameTier, body.angle,
        body.gameSprite, pop, squash, body.gameSquashAngle);
    }
    drawAim();
    drawEffects(deltaSeconds);
    drawCelebration();
    context.restore();
    stage.classList.toggle('danger', warningProgress > .6);
  }

  function frame(now) {
    const frameDelta = previousFrame ? Math.min(50, now - previousFrame) : STEP;
    previousFrame = now;
    elapsed += frameDelta;
    if (!gameOver) {
      let steps = 0;
      physicsAccumulator += frameDelta;
      while (physicsAccumulator >= STEP && steps < 4) {
        for (let substep = 0; substep < SUBSTEPS; substep += 1) {
          Engine.update(engine, STEP / SUBSTEPS);
          mergePending();
          updateDanger(STEP / SUBSTEPS / 1000);
          if (gameOver) break;
        }
        physicsAccumulator -= STEP;
        steps += 1;
        if (gameOver) break;
      }
      if (steps === 4 && physicsAccumulator >= STEP) physicsAccumulator = 0;
    }
    draw(frameDelta / 1000);
    requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointerdown', event => {
    if (gameOver) return;
    canvas.focus({ preventScroll: true });
    setAimFromPointer(event);
    if (event.pointerType === 'touch') {
      touchAiming = true;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    } else {
      drop();
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch' || touchAiming) setAimFromPointer(event);
  });
  canvas.addEventListener('pointerup', event => {
    if (event.pointerType === 'touch' && touchAiming) {
      setAimFromPointer(event);
      touchAiming = false;
      drop();
      event.preventDefault();
    }
  });
  canvas.addEventListener('pointercancel', () => { touchAiming = false; });

  document.addEventListener('keydown', event => {
    const target = document.activeElement;
    const controlFocused = target && (target.tagName === 'BUTTON' || target.tagName === 'SUMMARY');
    if (controlFocused && (event.code === 'Space' || event.code === 'Enter')) return;
    if (event.key === 'r' || event.key === 'R') { reset(); return; }
    if (event.key === 'm' || event.key === 'M') { toggleSound(); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      aimX = clampAim(aimX + (event.key === 'ArrowLeft' ? -18 : 18));
    }
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      drop();
    }
  });
  document.getElementById('restart-button').addEventListener('click', reset);
  document.getElementById('play-again-button').addEventListener('click', reset);
  soundButton.addEventListener('click', toggleSound);
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('online', loadVisuals);
  retryImagesButton.addEventListener('click', loadVisuals);
  function syncEvolutionLayout() { evolutionPanel.open = !mobileLayout.matches; }
  mobileLayout.addEventListener('change', syncEvolutionLayout);
  syncEvolutionLayout();

  soundButton.textContent = muted ? '音效：关' : '音效：开';
  soundButton.setAttribute('aria-pressed', String(muted));
  resizeCanvas();
  reset();
  loadVisuals();
  requestAnimationFrame(frame);

})();
