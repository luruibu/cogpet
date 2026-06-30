// src/memory.js - 记忆系统
export class MemoryStore {
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
