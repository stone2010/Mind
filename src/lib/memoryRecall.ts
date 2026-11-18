// 轻量记忆相关性检索：不依赖模型或向量库，用 CJK 友好的关键词重叠打分，
// 按当前问题挑出最相关的长期记忆，既省 token 又更准。

export interface MemoryItem {
  id: string;
  content: string;
}

function tokenizeCjk(text: string): Set<string> {
  const tokens = new Set<string>();
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  // 连续 CJK 字：取相邻二元组（bigram）以保留词组信号
  const cjkRuns = clean.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.add(run);
    } else {
      for (let i = 0; i < run.length - 1; i += 1) {
        tokens.add(run.slice(i, i + 2));
      }
    }
  }
  // 非 CJK 词：取长度 ≥ 2 的词根
  for (const word of clean.split(" ")) {
    if (/^[a-z0-9]+$/.test(word) && word.length >= 2) {
      tokens.add(word);
    }
  }
  return tokens;
}

/**
 * 从记忆中挑出与 query 最相关的前 n 条；无相关时返回最近的前 n 条兜底。
 * 纯本地计算，零模型调用。
 */
export function pickRelevantMemories(
  memories: MemoryItem[],
  query: string,
  n = 8,
): MemoryItem[] {
  const qTokens = tokenizeCjk(query);
  if (qTokens.size === 0) {
    return memories.slice(-n);
  }
  const scored = memories
    .map((m, idx) => {
      const mTokens = tokenizeCjk(m.content);
      let overlap = 0;
      for (const t of qTokens) {
        if (mTokens.has(t)) overlap += 1;
      }
      // 关键词命中是主信号；只有命中时才用"越新越靠前"做平局 tiebreak，
      // 避免无关的最新记忆压过真正相关的旧记忆。
      return { m, overlap, idx, score: overlap * 1000 + (overlap > 0 ? idx : 0) };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, n);
  if (top.every((t) => t.overlap === 0)) {
    // 没有任何关键词命中 → 退回最近的 n 条，避免注入无关内容
    return memories.slice(-n);
  }
  return top.map((t) => t.m);
}
