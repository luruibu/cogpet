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
        paragraphs: this._getParagraphs(),
        links: this._getLinks(),
        text: this._getMainText(),
        pageType: this._guessPageType(),
        scrollY: window.scrollY || window.pageYOffset || 0,
      };
    } catch (e) {
      this.lastScan = { title: document.title, pageType: 'unknown', text: '', headings: [], images: [], paragraphs: [], links: [], scrollY: 0 };
    }
    return this.lastScan;
  }

  getContextSummary() {
    const s = this.lastScan;
    if (!s) return '';
    const parts = [`页面类型: ${s.pageType}`, `标题: "${s.title}"`];
    if (s.description) parts.push(`描述: "${s.description.slice(0, 100)}"`);
    if (s.headings.length) parts.push(`标题:\n${s.headings.slice(0, 5).map(h => `- "${h}"`).join('\n')}`);
    if (s.images.length) parts.push(`图片:\n${s.images.slice(0, 5).map(i => `- [图片] ${i.alt || '无描述'} (索引: ${i.idx}, 文档Y: ${Math.round(i.docY)}, 视口Y: ${Math.round(i.y)})`).join('\n')}`);
    if (s.paragraphs.length) parts.push(`段落:\n${s.paragraphs.slice(0, 5).map(p => `- [段落${p.idx}] "${p.text.slice(0, 60)}" (文档Y: ${Math.round(p.docY)})`).join('\n')}`);
    if (s.links.length) parts.push(`链接:\n${s.links.slice(0, 5).map(l => `- [链接${l.idx}] "${l.text.slice(0, 30)}" (文档Y: ${Math.round(l.docY)})`).join('\n')}`);
    if (s.text) parts.push(`正文摘要: "${s.text.slice(0, 300)}"`);
    if (s.scrollY !== undefined) parts.push(`页面已滚动: ${Math.round(s.scrollY)}px`);
    return parts.join('\n');
  }

  // 将指定图片滚动到视口内
  scrollToImage(index) {
    const imgs = this.lastScan?.images;
    if (!imgs || !imgs[index]) return false;
    const img = imgs[index];
    if (!img.el) return false;
    const rect = img.el.getBoundingClientRect();
    // 如果图片大部分在视口外，滚动使其居中
    if (rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth) {
      img.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    return false;
  }

  // 滚动到页面指定Y位置
  scrollToY(y) {
    const target = y - window.innerHeight / 2;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const clamped = Math.max(0, Math.min(maxScroll, target));
    if (Math.abs((window.scrollY || window.pageYOffset || 0) - clamped) > 50) {
      window.scrollTo({ top: clamped, behavior: 'smooth' });
      return true;
    }
    return false;
  }

  // 获取元素当前视口坐标 (如果还在DOM中)
  getCurrentViewportPos(index) {
    const imgs = this.lastScan?.images;
    if (!imgs || !imgs[index] || !imgs[index].el) return null;
    const rect = imgs[index].el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
  }

  scrollToParagraph(index) {
    const ps = this.lastScan?.paragraphs;
    if (!ps || !ps[index]) return false;
    const p = ps[index];
    if (!p.el) return false;
    const rect = p.el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      p.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    return false;
  }

  getCurrentParagraphPos(index) {
    const ps = this.lastScan?.paragraphs;
    if (!ps || !ps[index] || !ps[index].el) return null;
    const rect = ps[index].el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  scrollToLink(index) {
    const ls = this.lastScan?.links;
    if (!ls || !ls[index]) return false;
    const l = ls[index];
    if (!l.el) return false;
    const rect = l.el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      l.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    return false;
  }

  getCurrentLinkPos(index) {
    const ls = this.lastScan?.links;
    if (!ls || !ls[index] || !ls[index].el) return null;
    const rect = ls[index].el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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
    let idx = 0;
    document.querySelectorAll('img').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 30 || rect.height < 30) return;
      images.push({
        el, idx: idx++,
        alt: el.alt || '',
        src: el.src?.slice(0, 80) || '',
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        docY: (window.scrollY || window.pageYOffset || 0) + rect.top + rect.height / 2,
        w: rect.width,
        h: rect.height,
        inViewport: !(rect.top > window.innerHeight || rect.left > window.innerWidth || rect.bottom < 0 || rect.right < 0),
      });
    });
    return images.slice(0, 8);
  }

  _getParagraphs() {
    const paragraphs = [];
    let idx = 0;
    document.querySelectorAll('p').forEach(el => {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (text.length < 10 || text.length > 500) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      paragraphs.push({
        el, idx: idx++,
        text: text.slice(0, 200),
        docY: (window.scrollY || window.pageYOffset || 0) + rect.top + rect.height / 2,
        inViewport: !(rect.top > window.innerHeight || rect.bottom < 0),
      });
    });
    return paragraphs.slice(0, 8);
  }

  _getLinks() {
    const links = [];
    let idx = 0;
    document.querySelectorAll('a').forEach(el => {
      const text = el.textContent.trim();
      if (text.length < 3 || text.length > 60) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      links.push({
        el, idx: idx++,
        text,
        href: el.href,
        docY: (window.scrollY || window.pageYOffset || 0) + rect.top + rect.height / 2,
        inViewport: !(rect.top > window.innerHeight || rect.bottom < 0),
      });
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
