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
  const DANGER_Y = 136;
  const DOG_SIZE_SCALE = 1;
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
    { name: '小汪', radius: 44, color: '#8053b6' },
    { name: '汪汪', radius: 53, color: '#258fac' },
    { name: '大汪', radius: 64, color: '#b44378' },
    { name: '狂汪', radius: 77, color: '#af5418' },
    { name: '怒吼', radius: 92, color: '#c13c32' },
    { name: '咆哮', radius: 109, color: '#df7831' },
    { name: '大狗叫', radius: 128, color: '#896210' },
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
  const motionControls = document.getElementById('motion-controls');
  const motionButton = document.getElementById('motion-button');
  const motionStatus = document.getElementById('motion-status');
  const overElement = document.getElementById('game-over');
  const finalScore = document.getElementById('final-score');
  const finalDuration = document.getElementById('final-duration');
  const finalDrops = document.getElementById('final-drops');
  const finalTier = document.getElementById('final-tier');
  const finalTierImage = document.getElementById('final-tier-image');
  const finalTierNumber = document.getElementById('final-tier-number');
  const recordStatus = document.getElementById('record-status');
  const dangerElement = document.getElementById('danger-notice');
  const dangerLabel = document.getElementById('danger-label');
  const dangerTime = document.getElementById('danger-time');
  const liveStatus = document.getElementById('live-status');
  const pauseOverlay = document.getElementById('pause-overlay');
  const pauseTitle = document.getElementById('pause-title');
  const pauseMessage = document.getElementById('pause-message');
  const pauseSummary = document.getElementById('pause-summary');
  const resumeButton = document.getElementById('resume-button');
  const newRoundButton = document.getElementById('new-round-button');
  const roundSave = window.DagouSave;
  // localStorage 的属性本身也可能被浏览器隐私设置禁止访问。
  let roundStorage;
  try { roundStorage = window.localStorage; } catch { roundStorage = null; }

  const imageLoading = document.getElementById('image-loading');
  const imageLoadingMessage = document.getElementById('image-loading-message');
  const retryImagesButton = document.getElementById('retry-images-button');
  const imageStatus = document.getElementById('image-status');
  const imageStatusMessage = document.getElementById('image-status-message');
  const refreshImagesButton = document.getElementById('refresh-images-button');
  const tierImages = TIERS.map(() => new Image());
  const fullImages = TIERS.map(() => null);
  const previewImages = TIERS.map(() => null);
  const loadedImages = new WeakSet();
  const STARTER_COUNT = SPAWN_WEIGHTS.length;
  const START_WAIT_MS = 2500;
  let visualsReady = false;
  let visualsLoading = false;
  let previewsLoading = null;
  let starterFallbackAllowed = false;

  function readyImage(image) {
    return !!image && image.naturalWidth > 0 && loadedImages.has(image);
  }

  function tierImage(tier) {
    return readyImage(fullImages[tier]) ? fullImages[tier] : previewImages[tier];
  }

  function syncTierImage(tier) {
    const image = tierImage(tier);
    if (!readyImage(image)) return;
    if (tierImages[tier].src !== image.src) tierImages[tier].src = image.src;
    if (tier === nextTier) nextImage.src = image.src;
    if (gameOver && result?.maxTier === tier) finalTierImage.src = image.src;
  }

  function updateImageProgress() {
    const count = fullImages.filter(readyImage).length;
    const starters = fullImages.slice(0, STARTER_COUNT).filter(readyImage).length;
    imageLoadingMessage.textContent = `正在准备狗图（${starters}/${STARTER_COUNT}）`;
    const starterReady = fullImages.slice(0, STARTER_COUNT).every(readyImage)
      || (starterFallbackAllowed && Array.from({ length: STARTER_COUNT }, (_, tier) =>
        readyImage(tierImage(tier))).every(Boolean));
    if (!visualsReady && starterReady) {
      visualsReady = true;
      resumeButton.disabled = false;
      imageLoading.hidden = true;
      updateNext();
      liveStatus.textContent = '狗图准备好了，可以开始投放。';
    }
    imageStatus.hidden = !visualsReady || count === TIERS.length;
    imageStatusMessage.textContent = visualsLoading
      ? `清晰狗图加载中（${count}/${TIERS.length}）`
      : '部分狗图暂用缩略图';
    refreshImagesButton.hidden = visualsLoading || count === TIERS.length;
  }

  async function loadDogImage(src, attempts = 3) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const image = new Image();
      try {
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            image.removeEventListener('load', loaded);
            image.removeEventListener('error', failed);
            if (error) {
              image.removeAttribute('src');
              reject(error);
            } else resolve();
          };
          const loaded = async () => {
            try {
              if (!image.naturalWidth) throw new Error('狗图加载失败');
              if (typeof image.decode === 'function') await image.decode();
              loadedImages.add(image);
              finish();
            } catch (error) { finish(error); }
          };
          const failed = () => finish(new Error('狗图加载失败'));
          const timer = setTimeout(() => finish(new Error('狗图加载超时')), 8000);
          image.addEventListener('load', loaded);
          image.addEventListener('error', failed);
          image.src = attempt === 0 ? src
            : `${src}${src.includes('?') ? '&' : '?'}retry=${Date.now()}-${attempt}`;
        });
        return image;
      } catch (error) {
        if (attempt === attempts - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
  }

  function loadPreviews() {
    if (!previewsLoading) {
      previewsLoading = Promise.allSettled(TIERS.map(async (_, tier) => {
        previewImages[tier] = await loadDogImage(window.DagouVisuals.previews[tier], 1);
        syncTierImage(tier);
        updateImageProgress();
      }));
    }
    return previewsLoading;
  }

  async function loadTier(tier) {
    if (readyImage(fullImages[tier])) return;
    fullImages[tier] = await loadDogImage(window.DagouVisuals.sources[tier]);
    syncTierImage(tier);
    updateImageProgress();
  }

  async function loadVisuals() {
    if (visualsLoading || fullImages.every(readyImage)) return;
    visualsLoading = true;
    imageLoading.hidden = visualsReady;
    retryImagesButton.hidden = true;
    updateImageProgress();
    try {
      const previews = loadPreviews();
      const starters = Promise.allSettled(Array.from({ length: STARTER_COUNT }, (_, tier) => loadTier(tier)));
      let timer;
      await Promise.race([starters, new Promise(resolve => { timer = setTimeout(resolve, START_WAIT_MS); })]);
      clearTimeout(timer);
      // 慢网下最多等一小会儿，缩略图解码完成后即可投放；高清图继续加载。
      starterFallbackAllowed = true;
      await previews;
      updateImageProgress();
      await Promise.allSettled([starters, ...TIERS.slice(STARTER_COUNT).map((_, index) =>
        loadTier(index + STARTER_COUNT))]);
    } finally {
      visualsLoading = false;
      updateImageProgress();
      if (!visualsReady) {
        imageLoadingMessage.textContent = '狗图没有准备成功，请重试。';
        retryImagesButton.hidden = false;
      }
    }
  }

  let engine;
  let pieces = [];
  let pendingMerges = [];
  let pendingIds = new Set();
  let particles = [];
  let floatingTexts = [];
  let score = 0;
  let dropCount = 0;
  let roundDurationMs = 0;
  let roundStartedAt = null;
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
  let paused = false;
  let pausedShakeCooldown = 0;
  let touchAiming = false;
  let audioContext;
  let finaleAudioLoad;
  let finaleSource;
  let finaleGain;
  let finalePlaybackId = 0;
  let celebrationUntil = 0;
  let shakeUntil = 0;
  let warningProgress = 0;
  let motion;

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
        dogPhysics.applyMergePulse(pieces, upgraded, elapsed);
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

  function recordRoundTime() {
    if (roundStartedAt === null) return;
    roundDurationMs += performance.now() - roundStartedAt;
    roundStartedAt = null;
  }

  function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function snapshotRound() {
    return {
      score, dropCount, bestAtStart, currentTier, nextTier, maxReached, aimX,
      durationMs: roundDurationMs + (roundStartedAt === null ? 0 : performance.now() - roundStartedAt),
      dropCooldown: Math.max(0, DROP_COOLDOWN - (elapsed - lastDropAt)),
      shakeCooldown: paused ? pausedShakeCooldown : motion?.remainingCooldown() || 0,
      pieces: pieces.map(body => {
        const velocity = Body.getVelocity(body);
        return {
          tier: body.gameTier, x: body.position.x, y: body.position.y, angle: body.angle,
          vx: velocity.x, vy: velocity.y, angularVelocity: Body.getAngularVelocity(body),
          landed: body.gameLanded, dangerTime: body.gameOverTime,
        };
      }),
    };
  }

  function saveRound() {
    if (gameOver || dropCount === 0) return false;
    return roundSave.write(roundStorage, snapshotRound());
  }

  function showPause(restoring = false, focus = true) {
    pauseTitle.textContent = restoring ? '继续上次？' : '休息一下';
    pauseMessage.textContent = restoring ? '上次的狗狗还在，接着合成吧。' : '狗狗等你回来，继续后再动。';
    pauseSummary.textContent = `${score.toLocaleString('zh-CN')} 分 · ${formatDuration(roundDurationMs)} · 已投 ${dropCount} 次`;
    resumeButton.textContent = restoring ? '继续上次' : '继续游戏';
    resumeButton.disabled = !visualsReady;
    pauseOverlay.hidden = false;
    canvas.setAttribute('aria-disabled', 'true');
    motionButton.disabled = true;
    if (focus) resumeButton.focus({ preventScroll: true });
  }

  function pauseRound(focus = true) {
    if (gameOver || paused) return;
    recordRoundTime();
    pausedShakeCooldown = motion?.remainingCooldown() || 0;
    paused = true;
    touchAiming = false;
    physicsAccumulator = 0;
    previousFrame = 0;
    stopFinaleAudio();
    motion?.clearInput();
    showPause(false, focus);
    const saved = saveRound();
    if (dropCount > 0 && !saved) pauseMessage.textContent = '已暂停。当前浏览器未能保存，关闭页面后可能无法续局。';
    liveStatus.textContent = '游戏已暂停。';
  }

  function resumeRound() {
    if (!paused || document.hidden || !visualsReady) return;
    paused = false;
    pauseOverlay.hidden = true;
    canvas.removeAttribute('aria-disabled');
    physicsAccumulator = 0;
    previousFrame = 0;
    motion?.clearInput();
    motion?.restoreCooldown(pausedShakeCooldown);
    if (dropCount > 0) roundStartedAt = performance.now();
    canvas.focus({ preventScroll: true });
    liveStatus.textContent = '继续游戏。';
  }

  function restoreRound(round) {
    score = round.score;
    dropCount = round.dropCount;
    bestAtStart = round.bestAtStart;
    roundDurationMs = round.durationMs;
    currentTier = round.currentTier;
    nextTier = round.nextTier;
    maxReached = round.maxReached;
    aimX = clampAim(round.aimX);
    lastDropAt = elapsed - DROP_COOLDOWN + round.dropCooldown;
    for (const piece of round.pieces) {
      const body = makePiece(piece.x, piece.y, piece.tier, piece.landed);
      Body.setAngle(body, piece.angle);
      Body.setVelocity(body, { x: piece.vx, y: piece.vy });
      Body.setAngularVelocity(body, piece.angularVelocity);
      body.gameOverTime = piece.dangerTime;
    }
    best = Math.max(best, score);
    saveString('dagou.best', String(best));
    displayScore(scoreElement, score);
    displayScore(bestElement, best);
    updateNext();
    updateTierList();
    paused = true;
    pausedShakeCooldown = round.shakeCooldown;
    // 只重建局面，不推进物理或警戒倒计时，直到玩家选择继续。
    showPause(true);
  }

  function endGame() {
    if (gameOver) return;
    recordRoundTime();
    gameOver = true;
    roundSave.clear(roundStorage);
    motion?.refresh(true);
    touchAiming = false;
    result = roundResult(score, bestAtStart, maxReached);
    displayScore(finalScore, result.score);
    finalDuration.textContent = formatDuration(roundDurationMs);
    displayScore(finalDrops, dropCount);
    finalTier.textContent = `${result.maxLevel} 级 · ${TIERS[result.maxTier].name}`;
    const resultImage = tierImage(result.maxTier);
    if (readyImage(resultImage)) finalTierImage.src = resultImage.src;
    finalTierImage.alt = '';
    finalTierNumber.textContent = result.maxLevel;
    recordStatus.textContent = result.isNewRecord ? '刷新最高纪录！' : '下一局继续挑战';
    recordStatus.dataset.record = String(result.isNewRecord);
    overElement.style.setProperty('--tier-color', TIERS[result.maxTier].color);
    updateDangerNotice({ phase: 'hidden', remaining: 0 }, false);
    overElement.hidden = false;
    document.getElementById('play-again-button').focus({ preventScroll: true });
    liveStatus.textContent = `游戏结束，本局 ${score} 分，时长 ${finalDuration.textContent}，投放 ${dropCount} 次，最高 ${result.maxLevel} 级${TIERS[result.maxTier].name}。${result.isNewRecord ? '刷新最高纪录！' : ''}`;
  }

  function reset(clearSave = true) {
    if (clearSave) roundSave.clear(roundStorage);
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
    dropCount = 0;
    roundDurationMs = 0;
    roundStartedAt = null;
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
    paused = false;
    pausedShakeCooldown = 0;
    previousFrame = 0;
    pauseOverlay.hidden = true;
    canvas.removeAttribute('aria-disabled');
    touchAiming = false;
    updateDangerNotice({ phase: 'hidden', remaining: 0 }, false);
    overElement.hidden = true;
    displayScore(finalScore, 0);
    finalDuration.textContent = '00:00';
    displayScore(finalDrops, 0);
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
    motion?.resetRound();
  }

  function updateMotionUI(state) {
    motionControls.hidden = !state.eligible;
    motionButton.disabled = !state.supported || paused || gameOver;
    motionButton.setAttribute('aria-pressed', String(state.enabled));
    motionButton.textContent = state.enabled ? '重力：开' : '重力：关';
    const messages = {
      off: state.input === 'keyboard' ? '开启后按住 A/D 倾斜，W 晃动' : '开启后左右倾斜，也可摇一摇',
      unsupported: '当前浏览器不支持重力感应',
      requesting: '请允许手机运动感应',
      checking: '连接感应中，轻动一下手机',
      denied: '未获感应权限，点击可重试',
      unavailable: '未收到感应数据，点击可重试',
    };
    if (state.phase === 'active') {
      const tiltLabel = !state.tiltReady ? '倾斜数据不可用'
        : state.tilt < -0.15 ? '重力向左' : state.tilt > 0.15 ? '重力向右'
          : state.input === 'keyboard' ? '按住 A/D 左右倾斜' : '左右倾斜，移动狗堆';
      motionStatus.textContent = gameOver ? '本局已结束，重开后可用' : paused ? '已暂停，继续后可用'
        : `${tiltLabel} · ${state.cooldown > 0 ? `摇动冷却 ${state.cooldown} 秒` : state.input === 'keyboard' ? 'W 晃动' : '可摇一摇'}`;
    } else {
      motionStatus.textContent = messages[state.phase];
    }
  }

  function shakeDogs(direction) {
    if (!dogPhysics.shakeDogs(pieces, direction)) return false;
    shakeUntil = Math.max(shakeUntil, elapsed + 160);
    liveStatus.textContent = '摇一摇！狗堆晃动了。';
    return true;
  }

  function updateNext() {
    nextLabel.textContent = TIERS[nextTier].name;
    nextNumber.textContent = String(nextTier + 1);
    const image = tierImage(nextTier);
    if (readyImage(image)) nextImage.src = image.src;
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
    if (!visualsReady || gameOver || paused || document.hidden || elapsed - lastDropAt < DROP_COOLDOWN) return false;
    const piece = makePiece(clampAim(aimX), 65, currentTier);
    Body.setVelocity(piece, { x: 0, y: 0.5 });
    // 从首次成功投放开始计时，合成生成的狗不计入投放次数。
    if (dropCount === 0 && !document.hidden) roundStartedAt = performance.now();
    dropCount += 1;
    lastDropAt = elapsed;
    playDrop();
    currentTier = nextTier;
    nextTier = pickTier(SPAWN_WEIGHTS, Math.random, currentTier);
    aimX = clampAim(aimX);
    updateNext();
    saveRound();
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
    if (!readyImage(image)) return;
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
    if (!paused && !document.hidden && !reducedMotion.matches && elapsed < shakeUntil) context.translate((Math.random() - .5) * 7, (Math.random() - .5) * 7);
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
    const active = !paused && !document.hidden;
    const frameDelta = active ? (previousFrame ? Math.min(50, now - previousFrame) : STEP) : 0;
    previousFrame = now;
    elapsed += frameDelta;
    const motionState = motion?.getState();
    dogPhysics.updateMotion(engine, pieces,
      !gameOver && active && motionState?.phase === 'active', motionState?.tilt || 0, frameDelta);
    if (!gameOver && active) {
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
    if (gameOver || paused || document.hidden) return;
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
    if (gameOver || paused || document.hidden) return;
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
    if (paused || gameOver || document.hidden) return;
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
  resumeButton.addEventListener('click', resumeRound);
  newRoundButton.addEventListener('click', () => reset());
  soundButton.addEventListener('click', toggleSound);
  motion = window.DagouMotion.create({
    target: window,
    canShake: () => !gameOver && !paused && !document.hidden && visualsReady && !touchAiming,
    onShake: shakeDogs,
    onState: updateMotionUI,
  });
  motionButton.addEventListener('click', () => { if (!paused && !gameOver) motion.toggle(); });
  motion.refresh(true);
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('online', loadVisuals);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseRound(false); saveRound(); }
    else {
      previousFrame = 0;
      if (paused) resumeButton.focus({ preventScroll: true });
    }
  });
  window.addEventListener('pagehide', () => { pauseRound(false); saveRound(); });
  // 移动端可能直接回收页面，定期保存以减少这种情况下丢失的进度。
  window.setInterval(() => { if (!paused && !document.hidden) saveRound(); }, 1000);
  retryImagesButton.addEventListener('click', loadVisuals);
  refreshImagesButton.addEventListener('click', loadVisuals);
  function syncEvolutionLayout() { evolutionPanel.open = !mobileLayout.matches; }
  mobileLayout.addEventListener('change', syncEvolutionLayout);
  syncEvolutionLayout();

  soundButton.textContent = muted ? '音效：关' : '音效：开';
  soundButton.setAttribute('aria-pressed', String(muted));
  resizeCanvas();
  const savedRound = roundSave.read(roundStorage);
  reset(false);
  if (savedRound) restoreRound(savedRound);
  loadVisuals();
  requestAnimationFrame(frame);

})();
