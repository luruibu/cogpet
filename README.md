# CogPet 🐾

> An autonomous AI pet that lives in your browser — it moves, creates, talks, and remembers.

浏览器里的小生命。不是被你控制的 — 它自己决定做什么。

## 截图

![CogPet 演示](pet1.png)

## ✨ 特性

| 功能 | 说明 |
|------|------|
| 🧠 **AI 自主决策** | 每隔几秒询问 LLM，根据能量、饱腹、心情、记忆自主决定行为 |
| 🎨 **屏幕创造** | 在页面上生成食物、玩具、花朵、装饰品，和它共存在屏幕上 |
| 🌐 **感知页面** | 读取页面标题、文本、图片，对当前网页内容发表评论 |
| 💬 **有记忆的对话** | 记住你说过的每句话和它做过的每件事，对话有完整上下文 |
| 🐾 **5 种宠物** | 猫、狗、兔子、小鸟、仓鼠，各有独特手绘造型 |
| 🎭 **流畅动画** | 挥手、弹性跳跃、跳舞（带音符粒子）、转圈、睡觉、吃东西 |
| 👔 **自定义外观** | 10 种主题色、5 种服饰、7 种表情 |
| 📦 **一行代码嵌入** | 任何网站加一个 `<script>` 标签即可使用 |

## 🚀 快速开始（独立模式）

直接打开 `pet.html` 即可体验：

```bash
# 用本地服务器打开（推荐，避免 CORS 问题）
cd cogpet
npx serve .
# 或
python -m http.server 8080
```

> ⚠️ **使用本地小模型时**：请务必关闭模型的**思考/推理模式（Thinking Mode）**。
> 小模型开启思考后会输出大量无关内容，导致 JSON 解析失败。
> 在 LM Studio 中，使用 qwen3.5-4b 模型时，在提示模板的最上方加入 `{%- set enable_thinking = false %}` 即可关闭。

## 🌐 嵌入到你的网站

### 第 1 步：启动 CogPet 服务

```bash
cd cogpet/server
npm install
npm start
```

在 `server/index.js` 中配置你的 LLM API 地址和模型名（**不会暴露给第三方**）：

```javascript
const CONFIG = {
  llmApiUrl: process.env.LLM_API_URL || 'http://your-llm-server:1234/v1/chat/completions',
  llmModel: process.env.LLM_MODEL || 'your-model-name',
  port: process.env.PORT || 3210,
};
```

也可通过环境变量配置：

```bash
LLM_API_URL=http://192.168.1.x:1234/v1/chat/completions \
LLM_MODEL=qwen3-8b \
PORT=3210 \
npm start
```

### 第 2 步：在你的网站中嵌入

```html
<script
  src="http://localhost:3210/widget.js"
  data-pet="cat"
  data-color="#ff9800"
  data-outfit="bow"
  data-interval="10"
  data-position="right"
  data-scan="true">
</script>
```

就这一行代码，宠物就会出现在你的页面上。

### 可配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `data-pet` | `cat` | 宠物类型：`cat` / `dog` / `rabbit` / `bird` / `hamster` |
| `data-color` | `#ff9800` | 主题色（hex） |
| `data-outfit` | `none` | 服饰：`none` / `hat` / `bow` / `scarf` / `sunglasses` / `crown` |
| `data-interval` | `10` | 决策间隔（秒） |
| `data-position` | `right` | 初始位置：`left` / `center` / `right` |
| `data-scan` | `true` | 是否扫描页面内容：`true` / `false` |

> 🔒 **安全**：LLM API 地址和模型名封装在服务端，第三方无法获取。

## 🧩 工作原理

```
第三方网站                          CogPet 服务器
    │                                    │
    │  ① 加载 widget.js                  │
    │ ─────────────────────────────────> │
    │  ② 返回打包好的 JS（46KB）          │
    │ <───────────────────────────────── │
    │                                    │
    │  ③ JS 注入 Shadow DOM 容器          │
    │  ④ 扫描页面内容（标题/文本/图片）    │
    │  ⑤ 每 N 秒 POST /api/chat          │
    │     { petState, memory, pageCtx }   │
    │ ─────────────────────────────────> │
    │  ⑥ 服务端转发到 LLM API             │
    │ <─────────── LLM 决策 ──────────── │
    │  ⑦ 返回 { action, speech, ... }    │
    │ <───────────────────────────────── │
    │  ⑧ 宠物执行动作                     │
```

### 页面感知

宠物可以"看到"当前页面的内容：

- **页面标题和描述** — 知道你在看什么网站
- **文章标题** — 可以评论 "这个标题好有趣！"
- **图片** — 走到图片旁边说 "好漂亮的图片~"
- **链接** — 发现页面上的链接
- **页面类型** — 自动识别：文章/购物/视频/社交/代码

### 页面交互动作

| 动作 | 说明 |
|------|------|
| `comment` | 对页面内容发表评论，走到相关位置 |
| `react` | 对页面元素做出表情反应（❤️ 喜欢 / 😲 惊讶 / 🤔 好奇） |
| `explore` | 走到页面某个区域探索 |
| `create` | 在页面上创造食物、玩具、花朵等物品 |

### Shadow DOM 隔离

宠物使用 Shadow DOM 渲染，样式完全隔离，不会影响宿主页面的任何样式和脚本。

## 📁 项目结构

```
cogpet/
├── server/
│   ├── index.js              # Express 服务（LLM 代理 + Widget 托管）
│   ├── package.json
│   └── public/
│       └── widget.js         # 打包后的嵌入脚本（单文件 46KB）
├── src/
│   ├── engine.js             # 宠物核心引擎（状态机 + Canvas 渲染）
│   ├── scanner.js            # 页面内容扫描器
│   ├── llm.js                # LLM 调用 + Prompt 构建
│   ├── memory.js             # 记忆系统（localStorage 持久化）
│   └── objects.js            # 世界物品系统
├── scripts/
│   └── build.js              # 打包脚本（node scripts/build.js）
├── pet.html                  # 独立演示版
├── README.md
└── LICENSE
```

## 🔧 技术栈

- **渲染**: HTML5 Canvas + Shadow DOM（样式完全隔离）
- **AI**: OpenAI 兼容 API（支持 LM Studio、Ollama、vLLM 等）
- **后端**: Node.js + Express（LLM 代理，隐藏 API 密钥）
- **打包**: 自定义打包脚本，输出单文件 widget.js

## 📄 License

MIT
