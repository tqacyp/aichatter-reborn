import { marked } from 'marked';
import katex from 'katex';
import hljs from 'highlight.js';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';

/* ───── 预编译正则表达式 ───── */

const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /`([^`\n]+)`/g;
const MATH_BLOCK_REGEX = /\$\$([\s\S]+?)\$\$|(?<!\\)\\\[([\s\S]+?)\\\]|\\\\\[([\s\S]+?)\\\\\]/g;
const MATH_INLINE_REGEX = /\$([^$]+?)\$|(?<!\\)\\\(([\s\S]+?)\\\)|\\\\\(([\s\S]+?)\\\\\)/g;

/* ───── 缓存层（基于Map插入顺序的LRU，O(1)淘汰） ───── */

const cacheConfig = {
    markdown: { maxSize: 200 },
    highlight: { maxSize: 500 },
    processed: { maxSize: 300 },
    katex:     { maxSize: 1000 },
};

/** @type {Record<string, Map<string, string>>} */
const stores = {};
for (const name of Object.keys(cacheConfig)) {
    stores[name] = new Map();
}

/**
 * 从缓存获取值，同时将其标记为最近使用
 * @param {string} storeName - 缓存名称
 * @param {string} key - 缓存键
 * @returns {string|null}
 */
function cacheGet(storeName, key) {
    const store = stores[storeName];
    const value = store.get(key);
    if (value !== undefined) {
        // 删后重插，移至Map末尾 = 最近使用
        store.delete(key);
        store.set(key, value);
        return value;
    }
    return null;
}

/**
 * 写入缓存，容量满时淘汰最久未使用的条目（Map的第一个键）
 * @param {string} storeName - 缓存名称
 * @param {string} key - 缓存键
 * @param {string} value - 缓存值
 */
function cacheSet(storeName, key, value) {
    const store = stores[storeName];
    if (store.size >= cacheConfig[storeName].maxSize) {
        // Map首键 = 最久未使用
        const firstKey = store.keys().next().value;
        store.delete(firstKey);
    }
    store.set(key, value);
}

/** 清空所有缓存 */
function clearAllCaches() {
    for (const store of Object.values(stores)) {
        store.clear();
    }
}

/* ───── 辅助函数 ───── */

/**
 * 安全转换为字符串
 * @param {*} input - 任意输入
 * @returns {string}
 */
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

/**
 * 转义HTML特殊字符
 * @param {*} input - 任意输入
 * @returns {string}
 */
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

/**
 * 渲染KaTeX公式（带缓存）
 * @param {string} formula - LaTeX公式
 * @param {boolean} displayMode - 是否为块级公式
 * @returns {string} HTML
 */
function renderKatex(formula, displayMode) {
    const key = `${displayMode ? 'display:' : 'inline:'}${formula}`;

    const cached = cacheGet('katex', key);
    if (cached !== null) return cached;

    try {
        const result = katex.renderToString(formula, {
            throwOnError: false,
            displayMode,
            output: 'html'
        });
        cacheSet('katex', key, result);
        return result;
    } catch (e) {
        console.error("KaTeX渲染失败:", e, 'formula:', formula);
        const errorHtml = displayMode
            ? `<div class="katex-error">${escapeHtml(formula)}</div>`
            : `<span class="katex-error">${escapeHtml(formula)}</span>`;
        cacheSet('katex', key, errorHtml);
        return errorHtml;
    }
}

/**
 * 代码高亮（带缓存）
 * @param {string} code - 代码文本
 * @param {string} language - 语言标识
 * @returns {string} HTML
 */
function highlightCode(code, language) {
    const codeStr = ensureString(code);
    if (!codeStr) return '';

    const cacheKey = `${codeStr}|${language || 'auto'}`;

    const cached = cacheGet('highlight', cacheKey);
    if (cached !== null) return cached;

    let result;

    if (!language) {
        try {
            const hljsResult = hljs.highlightAuto(codeStr);
            result = `<pre><code class="hljs">${hljsResult.value}</code></pre>`;
        } catch (err) {
            console.warn('自动高亮失败:', err);
            result = `<pre><code>${escapeHtml(codeStr)}</code></pre>`;
        }
    } else if (hljs.getLanguage(language)) {
        try {
            const hljsResult = hljs.highlight(codeStr, { language });
            result = `<pre><code class="hljs language-${language}">${hljsResult.value}</code></pre>`;
        } catch (err) {
            console.warn(`高亮失败 (${language}):`, err);
            result = `<pre><code>${escapeHtml(codeStr)}</code></pre>`;
        }
    } else {
        result = `<pre><code>${escapeHtml(codeStr)}</code></pre>`;
    }

    cacheSet('highlight', cacheKey, result);
    return result;
}

/* ───── marked 扩展：代码高亮 ───── */

marked.use({
    extensions: [
        {
            name: 'code',
            level: 'block',
            start(src) {
                return src.match(/^```/m)?.index;
            },
            tokenizer(src) {
                const rule = /^```(\w*)\n([\s\S]*?)```/;
                const match = rule.exec(src);
                if (match) {
                    return {
                        type: 'code',
                        raw: match[0],
                        lang: match[1] || undefined,
                        text: match[2]
                    };
                }
                return undefined;
            },
            renderer(token) {
                return highlightCode(token.text, token.lang);
            }
        }
    ]
});

/* ───── 数学公式预处理 ───── */

/**
 * 前置处理：保护代码区域 → 渲染数学公式 → 恢复代码区域
 * 用唯一占位符避免与用户输入中的字面文本冲突
 * @param {string} text - 原始Markdown文本
 * @returns {string} 处理后的文本
 */
function processMathExpressions(text) {
    const str = ensureString(text);
    if (!str) return '';

    const codeBlockContents = [];
    const inlineCodeContents = [];
    const uid = Date.now().toString(36);

    // 第一步：保护代码块内容
    let result = str.replace(CODE_BLOCK_REGEX, (match, lang, content) => {
        const id = `__CBC_${uid}_${codeBlockContents.length}__`;
        codeBlockContents.push(content);
        return `\`\`\`${lang}\n${id}\n\`\`\``;
    });

    // 保护内联代码内容
    result = result.replace(INLINE_CODE_REGEX, (match, content) => {
        const id = `__ICC_${uid}_${inlineCodeContents.length}__`;
        inlineCodeContents.push(content);
        return `\`${id}\``;
    });

    // 第二步：渲染数学公式
    result = result.replace(MATH_BLOCK_REGEX, (match, f1, f2, f3) => {
        const formula = (f1 || f2 || f3 || '').trim();
        return formula ? renderKatex(formula, true) : match;
    });

    result = result.replace(MATH_INLINE_REGEX, (match, f1, f2, f3) => {
        const formula = (f1 || f2 || f3 || '').trim();
        return formula ? renderKatex(formula, false) : match;
    });

    // 第三步：恢复代码内容
    for (let i = 0; i < codeBlockContents.length; i++) {
        result = result.replace(`__CBC_${uid}_${i}__`, codeBlockContents[i]);
    }
    for (let i = 0; i < inlineCodeContents.length; i++) {
        result = result.replace(`__ICC_${uid}_${i}__`, inlineCodeContents[i]);
    }

    return result;
}

/* ───── 主渲染函数 ───── */

/**
 * 完整Markdown渲染管线：数学公式 → marked → 代码高亮
 * @param {string} markdownText - 原始Markdown文本
 * @returns {Promise<string>} 渲染后的HTML
 */
export async function renderMarkdown(markdownText) {
    if (!markdownText) return '';

    const text = ensureString(markdownText);
    const cacheKey = `md:${text}`;

    const cached = cacheGet('markdown', cacheKey);
    if (cached !== null) return cached;

    try {
        const procKey = `proc:${text}`;
        let processed = cacheGet('processed', procKey);
        if (processed === null) {
            processed = processMathExpressions(text);
            cacheSet('processed', procKey, processed);
        }

        const html = marked.parse(processed, {
            gfm: true,
            breaks: false,
            headerIds: false,
        });

        cacheSet('markdown', cacheKey, html);
        return html;
    } catch (error) {
        console.error('Markdown渲染错误:', error);
        return `<div class="error">渲染失败: ${error.message}</div>`;
    }
}
