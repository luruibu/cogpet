// src/scanner.js - 页面内容扫描器
export class PageScanner {
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
