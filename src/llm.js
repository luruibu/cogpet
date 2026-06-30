// src/llm.js - LLM 调用 + Prompt 构建
export class LLMClient {
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

export function parseLLMResponse(text, defaultExpression = 'happy') {
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
