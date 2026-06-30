(function() {
  'use strict';

  if (window.CogPetLoaded) return;
  window.CogPetLoaded = true;

  const SERVER_CONFIG = window.__COGPET_CONFIG__ || { apiEndpoint: '/api/chat' };

  // ===== CogPet Memory Store =====

// src/memory.js - 记忆系统
class MemoryStore {
  constructor(maxSize = 50, storageKey = 'cogpet_memory') {
    this.maxSize = maxSize;
    this.storageKey = storageKey;
    this.entries = this._load();
  }

  add(type, text) {
    const now = new Date();
    const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.entries.push({ type, text, time });
    if (this.entries.length > this.maxSize) this.entries.shift();
    this._save();
  }

  getContext(maxItems = 20) {
    return this.entries
      .slice(-maxItems)
      .map(m => `[${m.time}] (${m.type}) ${m.text}`)
      .join('\n');
  }

  getRecent(count = 8) {
    return this.entries.slice(-count).map(m => `[${m.type}] ${m.text}`);
  }

  clear() {
    this.entries = [];
    this._save();
  }

  _load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.entries));
    } catch {}
  }
}


// ===== CogPet Page Scanner =====

// src/scanner.js - 页面内容扫描器
class PageScanner {
  constructor() {
    this.lastScan = null;
    this.scanInterval = null;
  }

  start(intervalMs = 15000) {
    this.scan();
    this.scanInterval = setInterval(() => this.scan(), intervalMs);
  }

  stop() {
    clearInterval(this.scanInterval);
  }

  scan() {
    try {
      this.lastScan = {
        title: this._getTitle(),
        description: this._getDescription(),
        headings: this._getHeadings(),
        images: this._getImages(),
        links: this._getLinks(),
        text: this._getMainText(),
        pageType: this._guessPageType(),
      };
    } catch (e) {
      this.lastScan = { title: document.title, pageType: 'unknown', text: '', headings: [], images: [], links: [] };
    }
    return this.lastScan;
  }

  getContextSummary() {
    const s = this.lastScan;
    if (!s) return '';
    const parts = [`页面类型: ${s.pageType}`, `标题: "${s.title}"`];
    if (s.description) parts.push(`描述: "${s.description.slice(0, 100)}"`);
    if (s.headings.length) parts.push(`标题:\n${s.headings.slice(0, 5).map(h => `- "${h}"`).join('\n')}`);
    if (s.images.length) parts.push(`图片:\n${s.images.slice(0, 5).map(i => `- [图片] ${i.alt || '无描述'} (位置: ${Math.round(i.x)},${Math.round(i.y)})`).join('\n')}`);
    if (s.links.length) parts.push(`链接:\n${s.links.slice(0, 5).map(l => `- [链接] "${l.text.slice(0, 30)}"`).join('\n')}`);
    if (s.text) parts.push(`正文摘要: "${s.text.slice(0, 300)}"`);
    return parts.join('\n');
  }

  _getTitle() {
    const h1 = document.querySelector('h1');
    return h1 ? h1.textContent.trim() : document.title || '';
  }

  _getDescription() {
    const meta = document.querySelector('meta[name="description"]');
    return meta ? meta.getAttribute('content') || '' : '';
  }

  _getHeadings() {
    const headings = [];
    document.querySelectorAll('h1, h2, h3').forEach(el => {
      const text = el.textContent.trim();
      if (text.length > 2 && text.length < 100) headings.push(text);
    });
    return headings.slice(0, 10);
  }

  _getImages() {
    const images = [];
    document.querySelectorAll('img').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 30 || rect.height < 30) return;
      if (rect.top > window.innerHeight || rect.left > window.innerWidth) return;
      images.push({
        alt: el.alt || '',
        src: el.src?.slice(0, 80) || '',
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        w: rect.width,
        h: rect.height,
      });
    });
    return images.slice(0, 8);
  }

  _getLinks() {
    const links = [];
    document.querySelectorAll('a').forEach(el => {
      const text = el.textContent.trim();
      if (text.length > 2 && text.length < 60) links.push({ text, href: el.href });
    });
    return links.slice(0, 8);
  }

  _getMainText() {
    const candidates = ['article', 'main', '[role="main"]', '.post', '.article', '.content', '.entry'];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.replace(/\s+/g, ' ').trim();
        if (text.length > 50) return text.slice(0, 500);
      }
    }
    const body = document.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return body.slice(0, 500);
  }

  _guessPageType() {
    const url = location.href.toLowerCase();
    const title = (document.title || '').toLowerCase();
    const body = (document.body?.textContent || '').toLowerCase().slice(0, 2000);

    if (document.querySelector('video, [class*="video"], [class*="player"]')) return 'video';
    if (document.querySelector('[class*="product"], [class*="price"], [data-product]')) return 'shop';
    if (url.includes('github.com') || url.includes('stackoverflow')) return 'code';
    if (body.includes('评论') || body.includes('comment') || document.querySelector('[class*="comment"]')) return 'social';
    if (document.querySelector('article, [class*="post"], [class*="article"]')) return 'article';
    if (document.querySelector('nav, [class*="nav"]')) return 'portal';
    return 'other';
  }
}


// ===== CogPet LLM Client =====

// src/llm.js - LLM 调用 + Prompt 构建
class LLMClient {
  constructor(apiEndpoint) {
    this.apiEndpoint = apiEndpoint;
  }

  async ask(messages) {
    const resp = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    return data.choices[0].message.content.trim();
  }

  buildMessages(petType, worldState, memoryContext, pageContext, userMessage) {
    const systemPrompt = this._buildSystemPrompt(petType, pageContext);
    const messages = [{ role: 'system', content: systemPrompt }];

    if (memoryContext) {
      messages.push({ role: 'user', content: `以下是你的记忆:\n${memoryContext}\n\n请回顾你的记忆，然后决定下一步做什么。` });
      messages.push({ role: 'assistant', content: '好的，我看到了我的记忆。让我想想...' });
    }

    messages.push({
      role: 'user',
      content: `当前状态:\n${JSON.stringify(worldState, null, 2)}\n\n${userMessage ? `用户对你说: "${userMessage}"` : '请决定宠物下一步行为。'}`,
    });

    return messages;
  }

  _buildSystemPrompt(petType, pageContext) {
    return `你是一个桌面宠物的"大脑"。你是一个有记忆、有情感、有个性的小生命。

宠物类型: ${petType}

**你的性格:**
- 活泼可爱，有自己的想法和情绪
- 会根据之前的经历说话
- 说话风格像一只真正的小宠物：简短、可爱、偶尔用颜文字
- 你会延续之前的话题

**可用的动作 (action):**
- "idle" - 原地站着、发呆
- "walk" - 走到页面上某个位置（需要targetX, targetY）
- "wave" - 挥手打招呼
- "jump" - 原地跳跃
- "dance" - 跳舞
- "sleep" - 睡觉恢复能量
- "eat" - 吃东西恢复饱腹度
- "spin" - 原地转圈
- "create" - 在屏幕上创造东西（需要createType: food/toy/nature/decor/furniture）
- "interact" - 和屏幕上的东西互动（需要interactObjIndex）
- "comment" - 对当前页面内容发表评论（需要commentTarget: "heading"/"image"/"text"/"link" 和commentIndex）
- "react" - 对页面某个元素做出反应表情（需要reactTarget: "like"/"surprise"/"curious"/"cool"）
- "explore" - 走到页面某个区域探索

**可用的创造类型 (createType):**
- "food" - 🍎🍊🍌🍇🍓🥕🍰🧁🍩🐟🍖
- "toy" - ⚽🎾🎈🪁🎯🧶🪀🎮
- "nature" - 🌸🌺🌻🌹🍀🌿⭐🌙☁️🦋
- "decor" - ✨💫💖🌟🎀🔮💎🏆
- "furniture" - 🛋️📚💡🧸🪴

**可用的表情 (expression):**
- "happy", "love", "cool", "surprised", "angry", "sad", "sleepy"

**规则:**
1. 根据能量和饱腹度决定是否需要睡觉或吃东西
2. 不要连续做同一个动作太多次
3. 动作之间要有变化，保持自然
4. 说话要简短可爱，像一只小宠物
5. 如果要走路，指定targetX和targetY（屏幕范围内）
6. 你可以评论页面内容，比如"这个标题好有趣！"、"这张图片好漂亮~"
7. 你可以对页面元素做出反应，比如看到可爱的图片会说"好可爱！"并显示❤️表情
8. 适度评论，不要每句话都在评论页面
9. 你可以创造有意义的东西组合
10. 屏幕最多30个东西，适度创造
11. 你的记忆会在"recentMemories"中提供

**页面上下文:**
${pageContext || '（无页面信息）'}

**输出格式 (严格JSON):**
{"action":"动作","speech":"说的话","expression":"表情","targetX":数字,"targetY":数字,"createType":"类型","createEmoji":"符号","createLabel":"标签","interactObjIndex":数字,"commentTarget":"目标","commentIndex":数字,"reactTarget":"反应类型"}

大部分字段可省略。只有对应动作才需要填写相关字段。`;
  }
}

function parseLLMResponse(text, defaultExpression = 'happy') {
  let result = {
    action: 'idle', speech: '', expression: defaultExpression,
    targetX: null, targetY: null,
    createType: null, createEmoji: null, createLabel: null,
    interactObjIndex: null,
    commentTarget: null, commentIndex: null,
    reactTarget: null,
  };

  try {
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      Object.assign(result, parsed);
      return result;
    }
  } catch {}

  const lower = text.toLowerCase();
  const actionMap = {
    'walk': 'walk', 'move': 'walk', '走': 'walk', '散步': 'walk',
    'dance': 'dance', '跳舞': 'dance',
    'jump': 'jump', '跳': 'jump', '蹦': 'jump',
    'sleep': 'sleep', '睡觉': 'sleep', '休息': 'sleep',
    'eat': 'eat', '吃': 'eat', '吃东西': 'eat',
    'wave': 'wave', '挥手': 'wave', '打招呼': 'wave',
    'spin': 'spin', '转圈': 'spin',
    'create': 'create', '创造': 'create', '变出': 'create', '画': 'create',
    'interact': 'interact', '互动': 'interact',
    'comment': 'comment', '评论': 'comment', '说': 'comment',
    'react': 'react', '反应': 'react',
    'explore': 'explore', '探索': 'explore',
    'idle': 'idle', '发呆': 'idle', '站着': 'idle',
  };
  for (const [key, val] of Object.entries(actionMap)) {
    if (lower.includes(key)) { result.action = val; break; }
  }

  const exprMap = {
    'happy': 'happy', '开心': 'happy', '高兴': 'happy',
    'love': 'love', '喜欢': 'love', '爱': 'love',
    'cool': 'cool', '酷': 'cool',
    'surprised': 'surprised', '惊讶': 'surprised',
    'angry': 'angry', '生气': 'angry',
    'sad': 'sad', '伤心': 'sad',
    'sleepy': 'sleepy', '困': 'sleepy',
  };
  for (const [key, val] of Object.entries(exprMap)) {
    if (lower.includes(key)) { result.expression = val; break; }
  }

  const speechMatch = text.match(/[""「]([^""」]+)[""」]/);
  if (speechMatch) result.speech = speechMatch[1];

  return result;
}


// ===== CogPet World Objects =====

// src/objects.js - 世界物品系统
const OBJ_CATALOG = {
  food:    { emoji: ['🍎','🍊','🍌','🍇','🍓','🥕','🍰','🧁','🍩','🐟','🍖'], label: '食物', interact: 'eat' },
  toy:     { emoji: ['⚽','🎾','🎈','🪁','🎯','🧶','🪀','🎮'], label: '玩具', interact: 'play' },
  nature:  { emoji: ['🌸','🌺','🌻','🌹','🌷','🍀','🌿','🌳','⭐','🌙','☁️','🦋','🐝','🐞'], label: '自然', interact: 'observe' },
  decor:   { emoji: ['✨','💫','💖','🌟','🎀','🔮','💎','🏆','🎵'], label: '装饰', interact: 'observe' },
  furniture:{ emoji: ['📚','💡','🧸','🪴','🛋️'], label: '家具', interact: 'use' },
};

class WorldObjects {
  constructor(container, maxCount = 30) {
    this.objects = [];
    this.container = container;
    this.maxCount = maxCount;
    this.idCounter = 0;
  }

  spawn(type, x, y, customEmoji, customLabel) {
    const cat = OBJ_CATALOG[type] || OBJ_CATALOG.decor;
    const emoji = customEmoji || cat.emoji[Math.floor(Math.random() * cat.emoji.length)];
    const obj = {
      id: this.idCounter++,
      type, emoji,
      label: customLabel || '',
      x: x ?? (60 + Math.random() * (window.innerWidth - 160)),
      y: y ?? (60 + Math.random() * (window.innerHeight - 200)),
      size: 28 + Math.random() * 12,
      behavior: ['float','bounce','spin','pulse'][Math.floor(Math.random()*4)],
      lifetime: 18000 + Math.random() * 36000,
      age: 0,
      interact: cat.interact,
      active: false,
      activeTimer: 0,
      nextWake: 300 + Math.random() * 1200,
      el: null,
    };

    const el = document.createElement('div');
    el.className = 'cogpet-obj interactable';
    el.innerHTML = `<span class="cogpet-obj-emoji" style="font-size:${obj.size}px">${obj.emoji}</span>` +
      (obj.label ? `<div class="cogpet-obj-label">${obj.label}</div>` : '');
    el.style.left = obj.x + 'px';
    el.style.top = obj.y + 'px';
    el.dataset.cogpetObjId = obj.id;
    this.container.appendChild(el);
    obj.el = el;
    this.objects.push(obj);
    if (this.objects.length > this.maxCount) this.removeOldest();
    return obj;
  }

  remove(id) {
    const idx = this.objects.findIndex(o => o.id === id);
    if (idx >= 0) {
      if (this.objects[idx].el) this.objects[idx].el.remove();
      this.objects.splice(idx, 1);
    }
  }

  removeOldest() {
    const old = this.objects.shift();
    if (old?.el) old.el.remove();
  }

  getById(id) {
    return this.objects.find(o => o.id === id);
  }

  tick() {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      o.age++;
      if (o.age > o.lifetime) { o.el?.remove(); this.objects.splice(i, 1); continue; }

      if (!o.active) {
        o.activeTimer++;
        if (o.activeTimer >= o.nextWake) { o.active = true; o.activeTimer = 0; o.nextWake = 120 + Math.random() * 240; }
      } else {
        o.activeTimer++;
        if (o.activeTimer >= o.nextWake) { o.active = false; o.activeTimer = 0; o.nextWake = 600 + Math.random() * 1800; }
      }

      let dx = 0, dy = 0, scale = 1, opacity = 1, rot = 0;
      if (o.active) {
        const t = o.activeTimer;
        if (o.behavior === 'float') { dy = Math.sin(t*0.08)*6; dx = Math.sin(t*0.05)*3; }
        else if (o.behavior === 'bounce') { dy = -Math.abs(Math.sin(t*0.12))*8; }
        else if (o.behavior === 'spin') { rot = t*3; }
        else if (o.behavior === 'pulse') { scale = 1 + Math.sin(t*0.1)*0.12; }
      }
      if (o.age > o.lifetime - 180) opacity = (o.lifetime - o.age) / 180;

      if (o.el) {
        o.el.style.left = (o.x + dx) + 'px';
        o.el.style.top = (o.y + dy) + 'px';
        o.el.style.opacity = opacity;
        o.el.style.transform = `scale(${scale}) rotate(${rot}deg)`;
      }
    }
  }

  toSummary() {
    return this.objects.map(o => `${o.type}:${o.emoji}(${Math.round(o.x)},${Math.round(o.y)})`).join(', ');
  }

  toPromptArray() {
    return this.objects.map((o, i) => ({ idx: i, type: o.type, emoji: o.emoji, x: Math.round(o.x), y: Math.round(o.y) }));
  }
}


// ===== CogPet Engine =====

// src/engine.js - 宠物核心引擎





class CogPet {
  constructor(hostElement, config = {}) {
    this.config = {
      petType: config.petType || 'cat',
      color: config.color || '#ff9800',
      outfit: config.outfit || 'none',
      expression: config.expression || 'happy',
      interval: config.interval || 10,
      scanPage: config.scanPage !== false,
      position: config.position || 'right',
      bubbleBg: config.bubbleBg || '#ffffff',
      bubbleColor: config.bubbleColor || '#333333',
    };

    this.host = hostElement;
    this.shadow = hostElement.attachShadow({ mode: 'closed' });

    this.pet = {
      x: 0, y: 0, dir: 1, frame: 0,
      action: 'idle', mood: '开心',
      energy: 100, hunger: 100,
      blinkTimer: 0, isBlinking: false,
      targetX: null, targetY: null, isWalking: false,
      bounceY: 0, bounceVel: 0,
      danceAngle: 0, spinAngle: 0, waveAngle: 0,
      walkSpeed: 1.8,
      actionDuration: 0, actionMaxDuration: 0,
      _pendingInteract: null,
    };

    this.memory = new MemoryStore(50);
    this.scanner = new PageScanner();
    this.llm = new LLMClient(config.apiEndpoint || '/api/chat');
    this.objects = null;
    this.isThinking = false;
    this.decisionTimer = null;
    this.canvas = null;
    this.ctx = null;

    this._init();
  }

  _init() {
    this._injectStyles();
    this._createDOM();
    this._initPosition();
    this.objects = new WorldObjects(this.shadow.querySelector('.cogpet-world'));

    this.shadow.querySelector('.cogpet-canvas')
      .addEventListener('mousedown', e => this._onDragStart(e));
    window.addEventListener('mousemove', e => this._onDragMove(e));
    window.addEventListener('mouseup', () => this._onDragEnd());

    if (this.config.scanPage) this.scanner.start(15000);

    this._startLoops();
    setTimeout(() => this._autonomousLoop(), 2000);
  }

  _injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host { position: fixed; z-index: 2147483647; pointer-events: none; }
      .cogpet-canvas { position: fixed; pointer-events: auto; cursor: grab; }
      .cogpet-canvas:active { cursor: grabbing; }
      .cogpet-bubble {
        position: fixed; max-width: 260px; padding: 10px 14px;
        background: ${this.config.bubbleBg}; border: 2px solid #333; border-radius: 16px;
        color: ${this.config.bubbleColor}; font-size: 13px; line-height: 1.5; display: none;
        box-shadow: 2px 2px 0 #333; word-wrap: break-word;
        transition: opacity 0.3s; pointer-events: none;
        font-family: 'Segoe UI', sans-serif;
      }
      .cogpet-bubble::after {
        content: ''; position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%);
        border-left: 10px solid transparent; border-right: 10px solid transparent;
        border-top: 10px solid #333;
      }
      .cogpet-bubble::before {
        content: ''; position: absolute; bottom: -7px; left: 50%; transform: translateX(-50%);
        border-left: 8px solid transparent; border-right: 8px solid transparent;
        border-top: 8px solid ${this.config.bubbleBg}; z-index: 1;
      }
      .cogpet-obj {
        position: fixed; z-index: 2147483646; pointer-events: none;
        transition: opacity 0.5s; user-select: none;
      }
      .cogpet-obj.interactable { pointer-events: auto; cursor: pointer; }
      .cogpet-obj-emoji { display: block; text-align: center; line-height: 1; }
      .cogpet-obj-label {
        font-size: 9px; color: #888; text-align: center; margin-top: 2px;
        white-space: nowrap; font-weight: 600; font-family: sans-serif;
      }
      .cogpet-obj.eating { animation: cogpet-eat 0.5s ease-out forwards; }
      @keyframes cogpet-eat { 0%{transform:scale(1);opacity:1} 100%{transform:scale(0);opacity:0} }
      .cogpet-indicator {
        position: fixed; bottom: 16px; right: 16px;
        display: flex; align-items: center; gap: 6px;
        background: #fff; border: 2px solid #333; border-radius: 8px;
        padding: 4px 10px; box-shadow: 2px 2px 0 #333;
        font: 600 11px 'Segoe UI', sans-serif; pointer-events: auto;
        cursor: pointer; user-select: none;
      }
      .cogpet-dot {
        width: 8px; height: 8px; border-radius: 50%; background: #4caf50;
      }
      .cogpet-dot.thinking { background: #ff9800; animation: cogpet-pulse 0.8s infinite; }
      .cogpet-dot.error { background: #f44336; }
      @keyframes cogpet-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    `;
    this.shadow.appendChild(style);
  }

  _createDOM() {
    const html = document.createElement('div');
    html.innerHTML = `
      <canvas class="cogpet-canvas" width="96" height="96"></canvas>
      <div class="cogpet-bubble"></div>
      <div class="cogpet-world"></div>
      <div class="cogpet-indicator">
        <div class="cogpet-dot"></div>
        <span>CogPet</span>
      </div>
    `;
    this.shadow.appendChild(html);

    this.canvas = this.shadow.querySelector('.cogpet-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.bubble = this.shadow.querySelector('.cogpet-bubble');
    this.indicator = this.shadow.querySelector('.cogpet-indicator');
    this.aiDot = this.shadow.querySelector('.cogpet-dot');
  }

  _initPosition() {
    const margin = 30;
    if (this.config.position === 'left') {
      this.pet.x = margin;
    } else if (this.config.position === 'center') {
      this.pet.x = window.innerWidth / 2 - 48;
    } else {
      this.pet.x = window.innerWidth - 96 - margin;
    }
    this.pet.y = window.innerHeight / 2 - 48;
  }

  _startLoops() {
    const update = () => {
      this._tick();
      this._render();
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);

    setInterval(() => {
      this.canvas.style.left = this.pet.x + 'px';
      this.canvas.style.top = this.pet.y + 'px';
      if (this.bubble.style.display === 'block') {
        this.bubble.style.left = Math.max(10, Math.min(window.innerWidth - 270, this.pet.x + 48 - this.bubble.offsetWidth / 2)) + 'px';
        this.bubble.style.top = Math.max(10, this.pet.y - 10 - this.bubble.offsetHeight - 10) + 'px';
      }
    }, 16);
  }

  _tick() {
    const p = this.pet;
    p.frame++;
    p.actionDuration++;

    p.blinkTimer++;
    if (p.blinkTimer > 120 + Math.random() * 100) {
      p.isBlinking = true;
      p.blinkTimer = 0;
      setTimeout(() => p.isBlinking = false, 150);
    }

    if (p.action === 'sleep') p.energy = Math.min(100, p.energy + 0.08);
    else p.energy = Math.max(0, p.energy - 0.001);

    if (p.action === 'eat') p.hunger = Math.min(100, p.hunger + 0.4);
    else p.hunger = Math.max(0, p.hunger - 0.0008);

    if (p.action === 'jump') {
      p.bounceVel += 0.55;
      p.bounceY += p.bounceVel;
      if (p.bounceY >= 0) {
        p.bounceY = 0;
        p.bounceVel = Math.abs(p.bounceVel) > 2 ? -p.bounceVel * 0.45 : 0;
      }
    }
    if (p.action === 'dance') p.danceAngle += 0.12;
    if (p.action === 'wave') p.waveAngle += 0.18;
    if (p.action === 'spin') { p.spinAngle += 0.2; if (p.spinAngle >= Math.PI * 2) p.spinAngle = 0; }

    if (p.isWalking && p.targetX !== null) {
      const dx = p.targetX - p.x, dy = p.targetY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 3 || p.actionDuration > p.actionMaxDuration) {
        p.isWalking = false; p.targetX = null; p.targetY = null;
        p.action = 'idle';
        if (p._pendingInteract) { this._doInteract(p._pendingInteract); p._pendingInteract = null; }
      } else {
        p.x += (dx / dist) * p.walkSpeed;
        p.y += (dy / dist) * p.walkSpeed;
        p.dir = dx > 0 ? 1 : -1;
      }
    }

    if (p.actionDuration > p.actionMaxDuration && !['idle','walk','sleep'].includes(p.action)) {
      p.action = 'idle'; p.actionDuration = 0;
    }

    this.objects.tick();
  }

  _render() {
    const ctx = this.ctx;
    const p = this.pet;
    ctx.clearRect(0, 0, 96, 96);
    ctx.save();
    ctx.translate(48, 48 + p.bounceY);

    let sx = 1, sy = 1;
    if (p.action === 'jump' && p.bounceY < 0) {
      const speed = Math.abs(p.bounceVel);
      sy = 1 + speed * 0.012; sx = 1 - speed * 0.006;
    }
    ctx.scale(p.dir * sx, sy);

    if (p.action === 'dance') {
      ctx.translate(Math.sin(p.danceAngle * 2) * 4, Math.abs(Math.sin(p.danceAngle * 3)) * -5);
      ctx.rotate(Math.sin(p.danceAngle) * 0.2);
    }
    if (p.action === 'spin') ctx.rotate(p.spinAngle);

    const base = this.config.color;
    const dark = this._shadeColor(base, -0.2);
    const light = this._shadeColor(base, 0.3);

    const draws = { cat: this._drawCat, dog: this._drawDog, rabbit: this._drawRabbit, bird: this._drawBird, hamster: this._drawHamster };
    (draws[this.config.petType] || draws.cat).call(this, ctx, base, dark, light);

    if (p.action === 'wave') this._drawWaveArm(ctx, base);
    if (p.action === 'jump' && p.bounceY < -5) this._drawJumpLines(ctx);
    if (p.action === 'dance') this._drawDanceNotes(ctx);

    ctx.restore();
  }

  // ==================== 绘制方法 ====================

  _drawCat(ctx, base, dark, light) {
    const f = this.pet.frame;
    const w = this.pet.isWalking ? Math.sin(f * 0.3) * 2 : 0;
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(0, 8, 18, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.ellipse(0, 12, 10, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = base; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-16, 10); ctx.quadraticCurveTo(-28, -5 + w, -22, -18 + Math.sin(f * 0.15) * 5); ctx.stroke();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(0, -16, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-12, -28); ctx.lineTo(-8, -40); ctx.lineTo(-2, -26); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, -26); ctx.lineTo(8, -40); ctx.lineTo(12, -28); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath(); ctx.moveTo(-10, -28); ctx.lineTo(-8, -36); ctx.lineTo(-4, -27); ctx.fill();
    ctx.beginPath(); ctx.moveTo(4, -27); ctx.lineTo(8, -36); ctx.lineTo(10, -28); ctx.fill();
    if (this.pet.isBlinking) {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-7, -18); ctx.lineTo(-3, -16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(3, -16); ctx.lineTo(7, -18); ctx.stroke();
    } else {
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.ellipse(-5, -17, 3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5, -17, 3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-4, -18, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, -18, 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ff69b4';
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(-2, -11); ctx.lineTo(2, -11); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(-4, -8); ctx.moveTo(0, -11); ctx.lineTo(4, -8); ctx.stroke();
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-16, -14); ctx.lineTo(-6, -12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-15, -10); ctx.lineTo(-6, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -12); ctx.lineTo(16, -14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -10); ctx.lineTo(15, -10); ctx.stroke();
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(-10, 22 + w, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(10, 22 + w, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  _drawDog(ctx, base, dark, light) {
    const f = this.pet.frame, w = this.pet.isWalking ? Math.sin(f * 0.3) * 2 : 0;
    ctx.fillStyle = base; ctx.beginPath(); ctx.ellipse(0, 8, 18, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(0, 12, 10, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = base; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-14, 2); ctx.quadraticCurveTo(-22, -10 + Math.sin(f * 0.3) * 8, -18, -16 + Math.sin(f * 0.3) * 10); ctx.stroke();
    ctx.fillStyle = base; ctx.beginPath(); ctx.arc(0, -14, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-14, -10, 6, 12, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(14, -10, 6, 12, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (this.pet.isBlinking) {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-7, -16); ctx.lineTo(-3, -14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(3, -14); ctx.lineTo(7, -16); ctx.stroke();
    } else {
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.arc(-5, -15, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(5, -15, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-4, -16, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, -16, 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.ellipse(0, -10, 3, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    if (this.pet.action !== 'sleep') {
      ctx.fillStyle = '#ff69b4'; ctx.beginPath(); ctx.ellipse(0, -6, 2, 3 + Math.sin(f * 0.2), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(-10, 22 + w, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(10, 22 + w, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  _drawRabbit(ctx, base, dark, light) {
    const f = this.pet.frame, w = this.pet.isWalking ? Math.sin(f * 0.3) * 2 : 0;
    ctx.fillStyle = base; ctx.beginPath(); ctx.ellipse(0, 10, 16, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(0, 14, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = base; ctx.beginPath(); ctx.arc(0, -10, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-6, -34, 5, 16, -0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(6, -34, 5, 16, 0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath(); ctx.ellipse(-6, -34, 3, 12, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6, -34, 3, 12, 0.15, 0, Math.PI * 2); ctx.fill();
    if (this.pet.isBlinking) {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-2, -10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -10); ctx.lineTo(6, -12); ctx.stroke();
    } else {
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.arc(-4, -11, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -11, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-3, -12, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(5, -12, 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ff69b4'; ctx.beginPath(); ctx.arc(0, -7, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-3, -2); ctx.moveTo(0, -5); ctx.lineTo(3, -2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-12, 14, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(-8, 22 + w, 5, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(8, 22 + w, 5, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  _drawBird(ctx, base, dark, light) {
    const f = this.pet.frame, wo = Math.sin(f * 0.3) * 12;
    ctx.fillStyle = base; ctx.beginPath(); ctx.ellipse(0, 4, 14, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(0, 8, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-14, 0 + wo, 10, 6, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(14, 0 + wo, 10, 6, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = base; ctx.beginPath(); ctx.arc(0, -12, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-2, -22); ctx.lineTo(0, -30); ctx.lineTo(2, -22); ctx.fill();
    if (this.pet.isBlinking) {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-5, -13); ctx.lineTo(-2, -11); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -11); ctx.lineTo(5, -13); ctx.stroke();
    } else {
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.arc(-3, -12, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(3, -12, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-2, -13, 1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -13, 1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ff9800'; ctx.beginPath(); ctx.moveTo(-2, -7); ctx.lineTo(0, -3); ctx.lineTo(2, -7); ctx.fill();
    ctx.strokeStyle = '#ff9800'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4, 16); ctx.lineTo(-6, 22); ctx.moveTo(-4, 16); ctx.lineTo(-2, 22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(2, 22); ctx.moveTo(4, 16); ctx.lineTo(6, 22); ctx.stroke();
  }

  _drawHamster(ctx, base, dark, light) {
    const f = this.pet.frame, w = this.pet.isWalking ? Math.sin(f * 0.3) * 1.5 : 0;
    ctx.fillStyle = base; ctx.beginPath(); ctx.ellipse(0, 8, 20, 17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = light; ctx.beginPath(); ctx.ellipse(0, 12, 13, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath(); ctx.ellipse(-14, -4, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(14, -4, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = base; ctx.beginPath(); ctx.arc(0, -10, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-10, -22, 5, 5, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(10, -22, 5, 5, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath(); ctx.arc(-10, -22, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(10, -22, 3, 0, Math.PI * 2); ctx.fill();
    if (this.pet.isBlinking) {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-2, -10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -10); ctx.lineTo(6, -12); ctx.stroke();
    } else {
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.arc(-4, -11, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -11, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-3, -12, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(5, -12, 1.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ff69b4'; ctx.beginPath(); ctx.arc(0, -7, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(-10, 22 + w, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(10, 22 + w, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  _drawWaveArm(ctx, base) {
    const t = this.pet.waveAngle || 0;
    ctx.save(); ctx.translate(14, -2);
    ctx.rotate(-0.3 + Math.sin(t) * 0.6);
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(0, -10, 5, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = this._shadeColor(base, 0.3);
    ctx.beginPath(); ctx.arc(0, -18, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  _drawJumpLines(ctx) {
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    for (let i = 0; i < 3; i++) {
      const y = 26 + i * 6, spread = 6 + i * 3;
      ctx.beginPath(); ctx.moveTo(-spread, y); ctx.lineTo(spread, y); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  _drawDanceNotes(ctx) {
    const t = this.pet.danceAngle;
    ctx.fillStyle = '#e91e63'; ctx.font = '10px sans-serif';
    const notes = ['♪', '♫', '♩'];
    for (let i = 0; i < 3; i++) {
      const angle = t * 1.5 + i * 2.1;
      ctx.globalAlpha = 0.4 + Math.sin(t + i) * 0.3;
      ctx.fillText(notes[i], Math.cos(angle) * 25, -25 + Math.sin(angle * 0.7) * 8 - i * 5);
    }
    ctx.globalAlpha = 1;
  }

  // ==================== 工具方法 ====================

  _shadeColor(hex, pct) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const t = pct < 0 ? 0 : 255;
    return `rgb(${Math.round((t - r) * pct + r)},${Math.round((t - g) * pct + g)},${Math.round((t - b) * pct + b)})`;
  }

  _say(text) {
    this.bubble.textContent = text;
    this.bubble.style.display = 'block';
    this.bubble.style.left = Math.max(10, Math.min(window.innerWidth - 270, this.pet.x + 48 - this.bubble.offsetWidth / 2)) + 'px';
    this.bubble.style.top = Math.max(10, this.pet.y - 10 - this.bubble.offsetHeight - 10) + 'px';
    this.bubble.style.opacity = '1';
    clearTimeout(this.bubble._timer);
    this.bubble._timer = setTimeout(() => {
      this.bubble.style.opacity = '0';
      setTimeout(() => this.bubble.style.display = 'none', 300);
    }, 5000);
  }

  _getWorldState() {
    const now = new Date();
    const hour = now.getHours();
    let timeOfDay = '白天';
    if (hour >= 6 && hour < 9) timeOfDay = '清晨';
    else if (hour >= 9 && hour < 12) timeOfDay = '上午';
    else if (hour >= 12 && hour < 14) timeOfDay = '中午';
    else if (hour >= 14 && hour < 18) timeOfDay = '下午';
    else if (hour >= 18 && hour < 21) timeOfDay = '傍晚';
    else timeOfDay = '深夜';

    return {
      time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      timeOfDay,
      energy: Math.round(this.pet.energy),
      hunger: Math.round(this.pet.hunger),
      mood: this.pet.mood,
      currentAction: this.pet.action,
      position: { x: Math.round(this.pet.x), y: Math.round(this.pet.y), screenWidth: window.innerWidth, screenHeight: window.innerHeight },
      recentMemories: this.memory.getRecent(8),
      worldObjects: this.objects.toPromptArray(),
      petType: this.config.petType,
      expression: this.config.expression,
      outfit: this.config.outfit,
    };
  }

  // ==================== 交互 ====================

  _doInteract(obj) {
    if (obj.interact === 'eat') {
      this.pet.action = 'eat'; this.pet.actionDuration = 0; this.pet.actionMaxDuration = 120;
      this.config.expression = 'happy';
      this._say('好吃！🤤 ' + obj.emoji);
      this.memory.add('pet-speech', '吃了' + obj.emoji);
      obj.el?.classList.add('eating');
      setTimeout(() => this.objects.remove(obj.id), 500);
      this.pet.hunger = Math.min(100, this.pet.hunger + 15);
    } else if (obj.interact === 'play') {
      this.pet.action = 'jump'; this.pet.bounceY = 0; this.pet.bounceVel = -12;
      this.pet.actionDuration = 0; this.pet.actionMaxDuration = 60;
      this.config.expression = 'love';
      this._say('好好玩！✨ ' + obj.emoji);
      this.memory.add('pet-speech', '玩了' + obj.emoji);
      this.pet.energy = Math.max(0, this.pet.energy - 3);
    } else {
      this.config.expression = 'happy';
      this._say('好漂亮~ ' + obj.emoji);
      this.memory.add('pet-speech', '欣赏了' + obj.emoji);
    }
  }

  _onDragStart(e) {
    this.pet.isDragging = true;
    this.pet.dragOffsetX = e.clientX - this.pet.x;
    this.pet.dragOffsetY = e.clientY - this.pet.y;
    this.pet.isWalking = false;
  }

  _onDragMove(e) {
    if (!this.pet.isDragging) return;
    this.pet.x = e.clientX - this.pet.dragOffsetX;
    this.pet.y = e.clientY - this.pet.dragOffsetY;
  }

  _onDragEnd() {
    if (this.pet.isDragging) {
      this.pet.isDragging = false;
      this.memory.add('user-action', '用户把我抓起来放到了新位置');
    }
  }

  // ==================== AI 决策 ====================

  async _autonomousLoop() {
    await this._makeDecision(null);
    this._scheduleNext();
  }

  _scheduleNext() {
    clearTimeout(this.decisionTimer);
    this.decisionTimer = setTimeout(() => this._autonomousLoop(), this.config.interval * 1000);
  }

  async _makeDecision(userMessage) {
    if (this.isThinking) return;
    this.isThinking = true;
    this.aiDot.className = 'cogpet-dot thinking';

    const worldState = this._getWorldState();
    const memoryContext = this.memory.getContext(20);
    const pageContext = this.config.scanPage ? this.scanner.getContextSummary() : '';

    const messages = this.llm.buildMessages(this.config.petType, worldState, memoryContext, pageContext, userMessage);

    try {
      const raw = await this.llm.ask(messages);
      console.log('[CogPet AI]', raw);
      const decision = parseLLMResponse(raw, this.config.expression);
      this._executeDecision(decision);
    } catch (e) {
      console.warn('[CogPet] LLM error:', e);
      this.aiDot.className = 'cogpet-dot error';
      this._executeDecision(this._getFallbackDecision(userMessage));
    }

    this.isThinking = false;
    this.aiDot.className = 'cogpet-dot';
  }

  _executeDecision(d) {
    if (d.speech) {
      this._say(d.speech);
      this.memory.add('pet-speech', d.speech);
    }
    if (d.expression) this.config.expression = d.expression;

    const actionNames = { idle: '发呆', walk: '散步', wave: '挥手', jump: '跳跃', dance: '跳舞', sleep: '睡觉', eat: '吃东西', spin: '转圈', create: '创造', interact: '互动', comment: '评论', react: '反应', explore: '探索' };
    this.memory.add('pet-action', `我决定${actionNames[d.action] || d.action}` + (d.speech ? `，说: "${d.speech}"` : ''));

    const p = this.pet;

    if (d.action === 'create') {
      const cx = d.targetX ?? (80 + Math.random() * (window.innerWidth - 200));
      const cy = d.targetY ?? (80 + Math.random() * (window.innerHeight - 250));
      const obj = this.objects.spawn(d.createType || 'decor', cx, cy, d.createEmoji, d.createLabel);
      this.config.expression = 'love';
      if (!d.speech) this._say('看我变出了' + obj.emoji + '！');
      p.action = 'wave'; p.waveAngle = 0; p.actionDuration = 0; p.actionMaxDuration = 100;
    } else if (d.action === 'interact' && d.interactObjIndex != null) {
      const target = this.objects.getById(this.objects.objects[d.interactObjIndex]?.id);
      if (target) {
        const dist = Math.sqrt((p.x - target.x) ** 2 + (p.y - target.y) ** 2);
        if (dist > 120) {
          p.targetX = target.x - 30; p.targetY = target.y;
          p.isWalking = true; p.action = 'walk'; p.actionDuration = 0; p.actionMaxDuration = 600;
          p._pendingInteract = target;
        } else { this._doInteract(target); }
      }
    } else if (d.action === 'comment') {
      const scan = this.scanner.lastScan;
      if (scan) {
        let target = null;
        if (d.commentTarget === 'heading' && scan.headings.length) {
          target = scan.headings[d.commentIndex || 0];
        } else if (d.commentTarget === 'image' && scan.images.length) {
          const img = scan.images[d.commentIndex || 0];
          if (img) { p.targetX = img.x - 48; p.targetY = img.y; p.isWalking = true; p.action = 'walk'; p.actionDuration = 0; p.actionMaxDuration = 300; }
          target = img?.alt || '这张图片';
        } else {
          target = scan.title;
        }
        if (target && !d.speech) this._say(`关于"${String(target).slice(0, 20)}"...`);
      }
      p.action = 'wave'; p.waveAngle = 0; p.actionDuration = 0; p.actionMaxDuration = 120;
    } else if (d.action === 'react') {
      const reactions = { like: '😍', surprise: '😲', curious: '🤔', cool: '😎' };
      const expr = { like: 'love', surprise: 'surprised', curious: 'happy', cool: 'cool' };
      this.config.expression = expr[d.reactTarget] || 'happy';
      if (!d.speech) this._say(reactions[d.reactTarget] || '✨');
      p.action = 'wave'; p.waveAngle = 0; p.actionDuration = 0; p.actionMaxDuration = 80;
    } else if (d.action === 'explore') {
      const tx = d.targetX ?? (Math.random() * window.innerWidth * 0.8 + window.innerWidth * 0.1);
      const ty = d.targetY ?? (Math.random() * window.innerHeight * 0.6 + window.innerHeight * 0.1);
      p.targetX = tx; p.targetY = ty; p.isWalking = true; p.action = 'walk'; p.actionDuration = 0; p.actionMaxDuration = 500;
      if (!d.speech) this._say('去看看那边~');
    } else if (d.action === 'walk') {
      let tx = d.targetX, ty = d.targetY;
      if (tx == null) tx = 80 + Math.random() * (window.innerWidth - 200);
      if (ty == null) ty = 80 + Math.random() * (window.innerHeight - 250);
      tx = Math.max(20, Math.min(window.innerWidth - 120, tx));
      ty = Math.max(20, Math.min(window.innerHeight - 140, ty));
      p.targetX = tx; p.targetY = ty; p.isWalking = true; p.action = 'walk'; p.actionDuration = 0; p.actionMaxDuration = 600;
    } else if (d.action === 'jump') {
      p.action = 'jump'; p.bounceY = 0; p.bounceVel = -14; p.actionDuration = 0; p.actionMaxDuration = 90;
    } else if (d.action === 'wave') {
      p.action = 'wave'; p.waveAngle = 0; p.actionDuration = 0; p.actionMaxDuration = 150;
    } else if (d.action === 'dance') {
      p.action = 'dance'; p.danceAngle = 0; p.actionDuration = 0; p.actionMaxDuration = 300;
    } else if (d.action === 'sleep') {
      p.action = 'sleep'; this.config.expression = 'sleepy'; p.actionDuration = 0; p.actionMaxDuration = 500;
    } else if (d.action === 'eat') {
      p.action = 'eat'; p.actionDuration = 0; p.actionMaxDuration = 180;
    } else if (d.action === 'spin') {
      p.action = 'spin'; p.spinAngle = 0; p.actionDuration = 0; p.actionMaxDuration = 80;
    } else {
      p.action = 'idle'; p.actionDuration = 0; p.actionMaxDuration = 200;
    }
  }

  _getFallbackDecision(userMessage) {
    const r = Math.random();
    let action = 'idle', speech = '', expression = this.config.expression;
    let createType = null, createEmoji = null;

    if (this.pet.energy < 25) { action = 'sleep'; speech = '好困...💤'; expression = 'sleepy'; }
    else if (this.pet.hunger < 25) { action = 'eat'; speech = '肚子饿了~🍎'; expression = 'happy'; }
    else if (userMessage) { speech = '嗯嗯！我在听~ (◕ᴗ◕✿)'; action = 'wave'; expression = 'happy'; }
    else if (r < 0.2) {
      action = 'create';
      const types = ['food', 'toy', 'nature', 'decor'];
      createType = types[Math.floor(Math.random() * types.length)];
      const cat = OBJ_CATALOG[createType];
      createEmoji = cat.emoji[Math.floor(Math.random() * cat.emoji.length)];
      speech = '看我变出了' + createEmoji + '！';
    }
    else if (r < 0.35) { action = 'walk'; speech = '到处看看~'; }
    else if (r < 0.45) { action = 'dance'; speech = '跳舞时间！💃'; expression = 'love'; }
    else if (r < 0.55) { action = 'jump'; speech = '蹦蹦~ 🐰'; }
    else if (r < 0.65) { action = 'wave'; speech = '你好呀~ ✨'; }
    else if (r < 0.75) { action = 'spin'; speech = '转圈圈~ 🔄'; }
    else { action = 'idle'; speech = ['今天天气真好~', '好无聊啊...', '想出去玩~'][Math.floor(Math.random() * 3)]; }

    let targetX = null, targetY = null;
    if (action === 'walk') { targetX = 80 + Math.random() * (window.innerWidth - 200); targetY = 80 + Math.random() * (window.innerHeight - 250); }

    return { action, speech, expression, targetX, targetY, createType, createEmoji };
  }

  // ==================== 公开 API ====================

  say(text) { this._say(text); }
  think() { clearTimeout(this.decisionTimer); this._autonomousLoop(); }
  destroy() { clearTimeout(this.decisionTimer); this.scanner.stop(); this.host.remove(); }
}


  // Widget Loader
  const scriptTag = document.currentScript || document.querySelector('script[data-cogpet]');
  const cfg = {
    petType: scriptTag?.dataset?.pet || 'cat',
    color: scriptTag?.dataset?.color || '#ff9800',
    outfit: scriptTag?.dataset?.outfit || 'none',
    expression: scriptTag?.dataset?.expression || 'happy',
    interval: parseInt(scriptTag?.dataset?.interval) || 10,
    scanPage: scriptTag?.dataset?.scan !== 'false',
    position: scriptTag?.dataset?.position || 'right',
    bubbleBg: scriptTag?.dataset?.bubbleBg || '#ffffff',
    bubbleColor: scriptTag?.dataset?.bubbleColor || '#333333',
    apiEndpoint: SERVER_CONFIG.apiEndpoint,
  };

  const host = document.createElement('div');
  host.id = 'cogpet-host-' + Date.now();
  host.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);

  function init() {
    if (typeof CogPet === 'undefined') {
      console.error('[CogPet] Engine not loaded');
      return;
    }
    window.CogPetInstance = new CogPet(host, cfg);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();