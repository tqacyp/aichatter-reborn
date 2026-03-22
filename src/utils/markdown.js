import { marked } from 'marked';
import katex from 'katex';
import hljs from 'highlight.js';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';

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

// 代码高亮函数
function highlightCode(code, language) {
  const codeStr = ensureString(code);
  if (!codeStr) return '';

  // 如果没有指定语言，自动检测
  if (!language) {
    try {
      const result = hljs.highlightAuto(codeStr);
      return `<pre><code class="hljs">${result.value}</code></pre>`;
    } catch (err) {
      console.warn('自动高亮失败:', err);
      return `<pre><code>${escapeHtml(codeStr)}</code></pre>`;
    }
  }

  // 指定语言
  if (hljs.getLanguage(language)) {
    try {
      const result = hljs.highlight(codeStr, { language });
      return `<pre><code class="hljs language-${language}">${result.value}</code></pre>`;
    } catch (err) {
      console.warn(`高亮失败 (${language}):`, err);
    }
  }

  // 降级：无高亮
  return `<pre><code>${escapeHtml(codeStr)}</code></pre>`;
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
      tokenizer(src, tokens) {
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

  const displayMath = (formula) => {
    try {
      return katex.renderToString(formula, {
        throwOnError: false,
        displayMode: true,
        output: 'html'
      });
    } catch (e) {
      return `<div class="katex-error">${escapeHtml(formula)}</div>`;
    }
  };

  const inlineMath = (formula) => {
    try {
      return katex.renderToString(formula, {
        throwOnError: false,
        displayMode: false,
        output: 'html'
      });
    } catch (e) {
      return `<span class="katex-error">${escapeHtml(formula)}</span>`;
    }
  };

  let result = str;

  // 块级公式
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => displayMath(f.trim()));
  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_, f) => displayMath(f.trim()));

  // 行内公式
  result = result.replace(/\$([^\$]+?)\$/g, (_, f) => inlineMath(f.trim()));
  result = result.replace(/\\\(([\s\S]+?)\\\)/g, (_, f) => inlineMath(f.trim()));

  return result;
}

// 主渲染函数
export async function renderMarkdown(markdownText) {
  if (!markdownText) return '';
  try {
    const text = ensureString(markdownText);
    const processed = processMathExpressions(text);
    const html = await marked.parse(processed);
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