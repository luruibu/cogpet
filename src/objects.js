// src/objects.js - 世界物品系统
export const OBJ_CATALOG = {
  food:    { emoji: ['🍎','🍊','🍌','🍇','🍓','🥕','🍰','🧁','🍩','🐟','🍖'], label: '食物', interact: 'eat' },
  toy:     { emoji: ['⚽','🎾','🎈','🪁','🎯','🧶','🪀','🎮'], label: '玩具', interact: 'play' },
  nature:  { emoji: ['🌸','🌺','🌻','🌹','🌷','🍀','🌿','🌳','⭐','🌙','☁️','🦋','🐝','🐞'], label: '自然', interact: 'observe' },
  decor:   { emoji: ['✨','💫','💖','🌟','🎀','🔮','💎','🏆','🎵'], label: '装饰', interact: 'observe' },
  furniture:{ emoji: ['📚','💡','🧸','🪴','🛋️'], label: '家具', interact: 'use' },
};

export class WorldObjects {
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
