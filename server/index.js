const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// ==================== CORS 配置 ====================
// 允许所有来源跨域访问（widget.js 和 API 都需要）
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' }));

// 额外确保所有响应都有 CORS 头（防止反向代理覆盖）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ==================== 服务端配置 ====================
// 在这里配置 LLM API 地址和模型名，第三方无法获取
const CONFIG = {
  llmApiUrl: process.env.LLM_API_URL || 'http://192.168.100.249:1234/v1/chat/completions',
  llmModel: process.env.LLM_MODEL || 'huihui-qwen3.6-27b-abliterated-mtp',
  port: process.env.PORT || 3210,
  maxTokens: parseInt(process.env.MAX_TOKENS) || 300,
  temperature: parseFloat(process.env.TEMPERATURE) || 0.9,
};

// ==================== Widget JS 服务 ====================
app.get('/widget.js', (req, res) => {
  const widgetPath = path.join(__dirname, 'public', 'widget.js');
  let code = fs.readFileSync(widgetPath, 'utf-8');

  // 注入服务端配置（API 地址和模型名不暴露给前端）
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const srvHost = req.headers['x-forwarded-host'] || req.get('host') || 'cogpet.move-ai.org';
  const serverConfig = JSON.stringify({
    apiEndpoint: `${proto}://${srvHost}/api/chat`,
  });
  code = `window.__COGPET_CONFIG__=${serverConfig};\n` + code;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(code);
});

// ==================== LLM 代理接口 ====================
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const resp = await fetch(CONFIG.llmApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CONFIG.llmModel,
        messages,
        temperature: CONFIG.temperature,
        max_tokens: CONFIG.maxTokens,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[LLM] ${resp.status}: ${text.slice(0, 200)}`);
      return res.status(resp.status).json({ error: `LLM API error: ${resp.status}` });
    }

    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('[LLM] Fetch error:', err.message);
    res.status(502).json({ error: 'LLM service unreachable', detail: err.message });
  }
});

// ==================== 健康检查 ====================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: CONFIG.llmModel });
});

// ==================== 启动 ====================
app.listen(CONFIG.port, () => {
  console.log(`\n  🐾 CogPet Server running on http://localhost:${CONFIG.port}`);
  console.log(`  📦 Widget:  <script src="https://cogpet.move-ai.org/widget.js"></script>`);
  console.log(`  🤖 LLM API: ${CONFIG.llmApiUrl}`);
  console.log(`  🧠 Model:   ${CONFIG.llmModel}\n`);
});
