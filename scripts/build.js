// scripts/build.js - 打包成单文件 widget
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const outFile = path.join(__dirname, '..', 'server', 'public', 'widget.js');

// 读取所有源文件
const memoryCode = fs.readFileSync(path.join(srcDir, 'memory.js'), 'utf-8');
const scannerCode = fs.readFileSync(path.join(srcDir, 'scanner.js'), 'utf-8');
const llmCode = fs.readFileSync(path.join(srcDir, 'llm.js'), 'utf-8');
const objectsCode = fs.readFileSync(path.join(srcDir, 'objects.js'), 'utf-8');
const engineCode = fs.readFileSync(path.join(srcDir, 'engine.js'), 'utf-8');

// 转换为 IIFE 友好的格式（去掉 export/import）
function toInline(code) {
  return code
    .replace(/export\s+(class|function|const|let|var)\s+/g, '$1 ')
    .replace(/import\s*\{[^}]+\}\s*from\s*'[^']+';/g, '')
    .replace(/import\s+\w+\s+from\s*'[^']+';/g, '');
}

const inlined = [
  '// ===== CogPet Memory Store =====',
  toInline(memoryCode),
  '// ===== CogPet Page Scanner =====',
  toInline(scannerCode),
  '// ===== CogPet LLM Client =====',
  toInline(llmCode),
  '// ===== CogPet World Objects =====',
  toInline(objectsCode),
  '// ===== CogPet Engine =====',
  toInline(engineCode),
].join('\n\n');

const bundle = `
(function() {
  'use strict';

  if (window.CogPetLoaded) return;
  window.CogPetLoaded = true;

  const SERVER_CONFIG = window.__COGPET_CONFIG__ || { apiEndpoint: '/api/chat' };

  ${inlined}

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
`.trim();

fs.writeFileSync(outFile, bundle, 'utf-8');
console.log(`✅ Built widget.js (${(bundle.length / 1024).toFixed(1)} KB)`);
