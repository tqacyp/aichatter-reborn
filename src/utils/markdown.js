import { marked } from 'marked';
import katex from 'katex';
import hljs from 'highlight.js';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';

// KaTeX渲染缓存（公式字符串 + 显示模式 -> HTML）
const katexCache = new Map();

// 缓存最大大小，避免内存泄漏
const MAX_CACHE_SIZE = 1000;

// 预编译正则表达式（性能优化）
const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /`([^`\n]+)`/g;
// 合并的数学公式正则表达式
const MATH_BLOCK_REGEX = /\$\$([\s\S]+?)\$\$|(?<!\\)\\\[([\s\S]+?)\\\]|\\\\\[([\s\S]+?)\\\\\]/g;
const MATH_INLINE_REGEX = /\$([^$]+?)\$|(?<!\\)\\\(([\s\S]+?)\\\)|\\\\\(([\s\S]+?)\\\\\)/g;

// 缓存管理器（性能优化）
const caches = {
  // markdown解析结果缓存：key -> html
  markdown: new Map(),
  // 代码高亮缓存：(code + language) -> html
  highlight: new Map(),
  // 预处理结果缓存：text -> processedText
  processed: new Map(),
  // KaTeX缓存（已有，但改为LRU管理）
  katex: katexCache, // 引用现有缓存

  // 最大缓存条目数
  maxSize: {
    markdown: 200,
    highlight: 500,
    processed: 300,
    katex: MAX_CACHE_SIZE
  },

  // 缓存访问时间记录（用于LRU）
  accessTime: {
    markdown: new Map(),
    highlight: new Map(),
    processed: new Map(),
    katex: new Map()
  },

  // 获取缓存（更新访问时间）
  get(cacheName, key) {
    const cache = this[cacheName];
    if (cache.has(key)) {
      // 更新访问时间
      this.accessTime[cacheName].set(key, Date.now());
      return cache.get(key);
    }
    return null;
  },

  // 设置缓存
  set(cacheName, key, value) {
    const cache = this[cacheName];
    const maxSize = this.maxSize[cacheName];

    // 如果缓存已满，清理最久未使用的
    if (cache.size >= maxSize) {
      this.cleanup(cacheName);
    }

    cache.set(key, value);
    this.accessTime[cacheName].set(key, Date.now());
  },

  // 清理最久未使用的缓存（LRU）
  cleanup(cacheName) {
    const cache = this[cacheName];
    const accessMap = this.accessTime[cacheName];
    const maxSize = this.maxSize[cacheName];

    if (cache.size >= maxSize) {
      // 按访问时间排序，删除最早的一半
      const entries = Array.from(accessMap.entries());
      entries.sort((a, b) => a[1] - b[1]); // 按时间升序

      const toDelete = entries.slice(0, Math.floor(maxSize / 2));
      toDelete.forEach(([key]) => {
        cache.delete(key);
        accessMap.delete(key);
      });
    }
  },

  // 清理所有缓存
  clearAll() {
    this.markdown.clear();
    this.highlight.clear();
    this.processed.clear();
    this.katex.clear();
    this.accessTime.markdown.clear();
    this.accessTime.highlight.clear();
    this.accessTime.processed.clear();
    this.accessTime.katex.clear();
  }
};


// 辅助函数：安全转换为字符串
function ensureString(input) {
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return '';
  if (typeof input === 'object') {
    if (input.text) return String(input.text);
    if (input.raw) return String(input.raw);
    return JSON.stringify(input);
  }
  return String(input);
}

// 转义 HTML
function escapeHtml(input) {
  const str = ensureString(input);
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// KaTeX渲染函数（带缓存，使用LRU缓存管理器）
function renderKatex(formula, displayMode) {
  const key = `${displayMode ? 'display:' : 'inline:'}${formula}`;

  // 检查缓存（使用缓存管理器，支持LRU）
  const cached = caches.get('katex', key);
  if (cached !== null) {
    return cached;
  }

  try {
    const result = katex.renderToString(formula, {
      throwOnError: false,
      displayMode: displayMode,
      output: 'html'
    });

    // 缓存结果（缓存管理器会自动处理LRU清理）
    caches.set('katex', key, result);
    return result;
  } catch (e) {
    console.error("KaTeX渲染失败:", e, 'formula:', formula);
    // 错误结果也缓存，避免重复尝试渲染无效公式
    const errorHtml = displayMode
      ? `<div class="katex-error">${escapeHtml(formula)}</div>`
      : `<span class="katex-error">${escapeHtml(formula)}</span>`;
    caches.set('katex', key, errorHtml);
    return errorHtml;
  }
}

// 代码高亮函数（带缓存）
function highlightCode(code, language) {
  const codeStr = ensureString(code);
  if (!codeStr) return '';

  // 生成缓存键（代码内容 + 语言）
  const cacheKey = `${codeStr}|${language || 'auto'}`;

  // 检查缓存
  const cached = caches.get('highlight', cacheKey);
  if (cached !== null) {
    return cached;
  }

  let result = '';

  // 如果没有指定语言，自动检测
  if (!language) {
    try {
      const hljsResult = hljs.highlightAuto(codeStr);
      result = `<pre><code class="hljs">${hljsResult.value}</code></pre>`;
    } catch (err) {
      console.warn('自动高亮失败:', err);
      result = `<pre><code>${escapeHtml(codeStr)}</code></pre>`;
    }
  } else if (hljs.getLanguage(language)) {
    // 指定语言
    try {
      const hljsResult = hljs.highlight(codeStr, { language });
      result = `<pre><code class="hljs language-${language}">${hljsResult.value}</code></pre>`;
    } catch (err) {
      console.warn(`高亮失败 (${language}):`, err);
      result = `<pre><code>${escapeHtml(codeStr)}</code></pre>`;
    }
  } else {
    // 降级：无高亮
    result = `<pre><code>${escapeHtml(codeStr)}</code></pre>`;
  }

  // 缓存结果
  caches.set('highlight', cacheKey, result);
  return result;
}

// 使用 marked 扩展来处理代码块
marked.use({
  extensions: [
    {
      name: 'code',
      level: 'block',
      start(src) {
        // 匹配代码块开始标记
        return src.match(/^```/m)?.index;
      },
      tokenizer(src) {
        const rule = /^```(\w*)\n([\s\S]*?)```/;
        const match = rule.exec(src);
        if (match) {
          const language = match[1] || undefined;
          const code = match[2];
          return {
            type: 'code',
            raw: match[0],
            lang: language,
            text: code
          };
        }
        return undefined;
      },
      renderer(token) {
        // token 包含 lang 和 text 属性
        return highlightCode(token.text, token.lang);
      }
    }
  ]
});

// 数学公式预处理（可选）
function processMathExpressions(text) {
  const str = ensureString(text);
  if (!str) return '';


  //console.log('processMathExpressions input:', str.substring(0, 200));

  // 第一步：保护代码块和内联代码的内容（但保留标记）
  const codeBlockContents = [];
  const inlineCodeContents = [];
  let protectedText = str;

  // 保护代码块内容：匹配 ```language\ncontent\n``` 或 ```\ncontent\n```
  protectedText = protectedText.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, content) => {
    const id = `__CODEBLOCK_CONTENT_${codeBlockContents.length}__`;
    codeBlockContents.push(content);
    return `\`\`\`${lang}\n${id}\n\`\`\``;
  });

  // 保护内联代码内容：匹配 `content`
  protectedText = protectedText.replace(/`([^`\n]+)`/g, (match, content) => {
    const id = `__INLINECODE_CONTENT_${inlineCodeContents.length}__`;
    inlineCodeContents.push(content);
    return `\`${id}\``;
  });

  // 第二步：处理数学公式
  let result = protectedText;

  // 块级公式：支持 $$...$$ 和 \[...\] 以及 \\[...\\]
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => renderKatex(f.trim(), true));
  result = result.replace(/(?<!\\)\\\[([\s\S]+?)\\\]/g, (_, f) => renderKatex(f.trim(), true));
  result = result.replace(/\\\\\[([\s\S]+?)\\\\\]/g, (_, f) => renderKatex(f.trim(), true));

  // 行内公式：支持 $...$ 和 \(...) 以及 \\(...\\)
  result = result.replace(/\$([^$]+?)\$/g, (_, f) => renderKatex(f.trim(), false));
  result = result.replace(/(?<!\\)\\\(([\s\S]+?)\\\)/g, (_, f) => renderKatex(f.trim(), false));
  result = result.replace(/\\\\\(([\s\S]+?)\\\\\)/g, (_, f) => renderKatex(f.trim(), false));

  // 第三步：恢复代码块和内联代码的内容
  // 恢复内联代码内容
  inlineCodeContents.forEach((content, index) => {
    const placeholder = `__INLINECODE_CONTENT_${index}__`;
    result = result.replace(placeholder, content);
  });

  // 恢复代码块内容
  codeBlockContents.forEach((content, index) => {
    const placeholder = `__CODEBLOCK_CONTENT_${index}__`;
    result = result.replace(placeholder, content);
  });

  //console.log('processMathExpressions output:', result.substring(0, 200));

  return result;
}

// 优化的数学公式预处理函数（减少正则表达式遍历次数）
function processMathExpressionsOptimized(text) {
  const str = ensureString(text);
  if (!str) return '';

  //console.log('processMathExpressionsOptimized input:', str.substring(0, 200));

  // 第一步：保护代码块和内联代码的内容（但保留标记）
  const codeBlockContents = [];
  const inlineCodeContents = [];
  let protectedText = str;

  // 保护代码块内容：匹配 ```language\ncontent\n``` 或 ```\ncontent\n```
  protectedText = protectedText.replace(CODE_BLOCK_REGEX, (match, lang, content) => {
    const id = `__CODEBLOCK_CONTENT_${codeBlockContents.length}__`;
    codeBlockContents.push(content);
    return `\`\`\`${lang}\n${id}\n\`\`\``;
  });

  // 保护内联代码内容：匹配 `content`
  protectedText = protectedText.replace(INLINE_CODE_REGEX, (match, content) => {
    const id = `__INLINECODE_CONTENT_${inlineCodeContents.length}__`;
    inlineCodeContents.push(content);
    return `\`${id}\``;
  });

  // 第二步：处理数学公式（合并为2次遍历）
  let result = protectedText;

  // 块级公式：支持 $$...$$ 和 \[...\] 以及 \\[...\\]（合并为1个正则表达式）
  result = result.replace(MATH_BLOCK_REGEX, (match, f1, f2, f3) => {
    // f1匹配$$...$$，f2匹配\[...\]，f3匹配\\[...\\]
    const formula = (f1 || f2 || f3 || '').trim();
    return formula ? renderKatex(formula, true) : match;
  });

  // 行内公式：支持 $...$ 和 \(...) 以及 \\(...\\)（合并为1个正则表达式）
  result = result.replace(MATH_INLINE_REGEX, (match, f1, f2, f3) => {
    // f1匹配$...$，f2匹配\(...)，f3匹配\\(...\\)
    const formula = (f1 || f2 || f3 || '').trim();
    return formula ? renderKatex(formula, false) : match;
  });

  // 第三步：恢复代码块和内联代码的内容
  // 恢复内联代码内容
  inlineCodeContents.forEach((content, index) => {
    const placeholder = `__INLINECODE_CONTENT_${index}__`;
    result = result.replace(placeholder, content);
  });

  // 恢复代码块内容
  codeBlockContents.forEach((content, index) => {
    const placeholder = `__CODEBLOCK_CONTENT_${index}__`;
    result = result.replace(placeholder, content);
  });

  //console.log('processMathExpressionsOptimized output:', result.substring(0, 200));

  return result;
}

// 主渲染函数（带缓存）
export async function renderMarkdown(markdownText) {
  if (!markdownText) return '';

  const text = ensureString(markdownText);

  // 生成缓存键（使用文本内容）
  const cacheKey = `md:${text}`;

  // 检查markdown解析缓存
  const cachedHtml = caches.get('markdown', cacheKey);
  if (cachedHtml !== null) {
    return cachedHtml;
  }

  try {
    // 检查预处理结果缓存
    const processedCacheKey = `proc:${text}`;
    let processed = caches.get('processed', processedCacheKey);

    if (processed === null) {
      processed = processMathExpressionsOptimized(text);
      // 缓存预处理结果
      caches.set('processed', processedCacheKey, processed);
    }

    //console.log('renderMarkdown after processMathExpressions:', processed.substring(0, 200));

    // 配置marked不转义HTML，以便KaTeX生成的HTML能够正确渲染
    const html = await marked.parse(processed, {
      sanitize: false,
      headerIds: false,
      mangle: false,
      gfm: true,
      breaks: false,
      smartypants: false
    });

    // 缓存最终结果
    caches.set('markdown', cacheKey, html);

    //console.log('renderMarkdown final html:', html.substring(0, 200));
    return html;
  } catch (error) {
    console.error('Markdown渲染错误:', error);
    return `<div class="error">渲染失败: ${error.message}</div>`;
  }
}

// 加载外部文件
export async function loadMarkdownFile(filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return await renderMarkdown(text);
  } catch (error) {
    console.error('加载文件失败:', error);
    return `<div class="error">加载失败: ${error.message}</div>`;
  }
}