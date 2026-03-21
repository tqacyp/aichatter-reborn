import { marked } from 'marked';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// 配置marked选项
marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,
  smartLists: true,
  smartypants: false
});

// 安全地将输入转换为字符串
function ensureString(input) {
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return '';
  if (typeof input === 'object') {
    // 如果是对象，尝试获取text属性或转换为字符串
    if (input.text) return String(input.text);
    if (input.raw) return String(input.raw);
    return JSON.stringify(input);
  }
  return String(input);
}

// 处理数学公式
function renderMath(text) {
  const str = ensureString(text);
  if (!str) return '';
  
  // 处理行内公式：$...$
  let result = str.replace(/\$([^\$]+?)\$/g, (match, formula) => {
    try {
      return katex.renderToString(formula, {
        throwOnError: false,
        displayMode: false
      });
    } catch (e) {
      console.warn('KaTeX渲染错误（行内）:', e);
      return match;
    }
  });

  // 处理块级公式：$$...$$
  result = result.replace(/\$\$([^\$]+?)\$\$/g, (match, formula) => {
    try {
      return katex.renderToString(formula, {
        throwOnError: false,
        displayMode: true
      });
    } catch (e) {
      console.warn('KaTeX渲染错误（块级）:', e);
      return match;
    }
  });

  return result;
}

// 使用marked的扩展功能，而不是自定义渲染器
marked.use({
  extensions: [
    {
      name: 'katex',
      level: 'inline',
      start(src) {
        return src.match(/\$/)?.index;
      },
      tokenizer(src, tokens) {
        const match = src.match(/^\$([^\$]+?)\$/);
        if (match) {
          return {
            type: 'katex',
            raw: match[0],
            text: match[1].trim()
          };
        }
        return undefined;
      },
      renderer(token) {
        try {
          return katex.renderToString(token.text, {
            throwOnError: false,
            displayMode: false
          });
        } catch (e) {
          return token.text;
        }
      }
    },
    {
      name: 'katex-display',
      level: 'block',
      start(src) {
        return src.match(/\$\$/)?.index;
      },
      tokenizer(src, tokens) {
        const match = src.match(/^\$\$([^\$]+?)\$\$/);
        if (match) {
          return {
            type: 'katex-display',
            raw: match[0],
            text: match[1].trim()
          };
        }
        return undefined;
      },
      renderer(token) {
        try {
          return katex.renderToString(token.text, {
            throwOnError: false,
            displayMode: true
          });
        } catch (e) {
          return `<pre>${token.text}</pre>`;
        }
      }
    }
  ]
});

// 主要渲染函数
export async function renderMarkdown(markdownText) {
  if (!markdownText) return '';
  
  try {
    // 确保输入是字符串
    const text = ensureString(markdownText);
    // 使用marked解析
    const html = await marked.parse(text);
    return html;
  } catch (error) {
    console.error('Markdown渲染错误:', error);
    return `<div class="error">渲染失败: ${error.message}</div>`;
  }
}

// 加载markdown文件
export async function loadMarkdownFile(filePath) {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const text = await response.text();
    return await renderMarkdown(text);
  } catch (error) {
    console.error('加载markdown文件失败:', error);
    return `<div class="error">加载失败: ${error.message}</div>`;
  }
}