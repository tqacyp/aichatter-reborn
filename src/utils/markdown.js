import { marked } from 'marked'
import katex from 'katex'
import hljs from 'highlight.js'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'

/* ───── 预编译正则表达式 ───── */

const CODE_BLOCK_REGEX = /```([^\n]*)\n([\s\S]*?)```/g
const INLINE_CODE_REGEX = /`([^`\n]+)`/g

// 块级公式：$$...$$ 或 \[...\]
const MATH_BLOCK_REGEX = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g
// 行内公式：$...$ 或 \(...\)
// $ 前后不能紧邻空白或另一个 $，避免把货币金额、流式输出中的半个 $$ 误判为公式
const MATH_INLINE_REGEX = /(?<!\\)(?<!\$)\$(?!\$)([^$\n]+?)(?<!\s)\$(?!\$)|\\\(([\s\S]+?)\\\)/g

/* ───── 缓存层（基于Map插入顺序的LRU） ───── */

const cacheConfig = {
    markdown: { maxSize: 200 },
    highlight: { maxSize: 500 },
    katex: { maxSize: 1000 },
}

/** @type {Record<string, Map<string, string>>} */
const stores = {}
for (const name of Object.keys(cacheConfig)) {
    stores[name] = new Map()
}

/**
 * 从缓存获取值，同时将其标记为最近使用
 */
function cacheGet(storeName, key) {
    const store = stores[storeName]
    const value = store.get(key)
    if (value !== undefined) {
        store.delete(key)
        store.set(key, value)
        return value
    }
    return null
}

/**
 * 写入缓存，容量满时淘汰最久未使用的条目
 */
function cacheSet(storeName, key, value) {
    const store = stores[storeName]
    if (store.size >= cacheConfig[storeName].maxSize) {
        const firstKey = store.keys().next().value
        store.delete(firstKey)
    }
    store.set(key, value)
}

/* ───── 辅助函数 ───── */

function ensureString(input) {
    if (typeof input === 'string') return input
    if (input === null || input === undefined) return ''
    if (typeof input === 'object') {
        if (input.text) return String(input.text)
        if (input.raw) return String(input.raw)
        return JSON.stringify(input)
    }
    return String(input)
}

function escapeHtml(input) {
    const str = ensureString(input)
    if (!str) return ''
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/**
 * 渲染KaTeX公式（带缓存）
 */
function renderKatex(formula, displayMode) {
    const key = `${displayMode ? 'display:' : 'inline:'}${formula}`

    const cached = cacheGet('katex', key)
    if (cached !== null) return cached

    try {
        const result = katex.renderToString(formula, {
            throwOnError: false,
            displayMode,
            output: 'html'
        })
        cacheSet('katex', key, result)
        return result
    } catch (error) {
        console.error('KaTeX渲染失败:', error, 'formula:', formula)
        const errorHtml = displayMode
            ? `<div class="katex-error">${escapeHtml(formula)}</div>`
            : `<span class="katex-error">${escapeHtml(formula)}</span>`
        cacheSet('katex', key, errorHtml)
        return errorHtml
    }
}

/**
 * 代码高亮（带缓存）
 */
function highlightCode(code, language) {
    const codeStr = ensureString(code)
    if (!codeStr) return ''

    const safeLanguage = (language || '').trim().replace(/[^\w-]/g, '')
    const cacheKey = `${codeStr}|${safeLanguage || 'auto'}`

    const cached = cacheGet('highlight', cacheKey)
    if (cached !== null) return cached

    let result

    if (!safeLanguage) {
        try {
            const hljsResult = hljs.highlightAuto(codeStr)
            result = `<pre><code class="hljs">${hljsResult.value}</code></pre>`
        } catch (error) {
            console.warn('自动高亮失败:', error)
            result = `<pre><code>${escapeHtml(codeStr)}</code></pre>`
        }
    } else if (hljs.getLanguage(safeLanguage)) {
        try {
            const hljsResult = hljs.highlight(codeStr, { language: safeLanguage })
            result = `<pre><code class="hljs language-${safeLanguage}">${hljsResult.value}</code></pre>`
        } catch (error) {
            console.warn(`高亮失败 (${safeLanguage}):`, error)
            result = `<pre><code>${escapeHtml(codeStr)}</code></pre>`
        }
    } else {
        result = `<pre><code>${escapeHtml(codeStr)}</code></pre>`
    }

    cacheSet('highlight', cacheKey, result)
    return result
}

/* ───── 数学公式与代码块预处理 ───── */

/**
 * 保护代码区域与数学公式：
 * 代码块/行内代码/块级公式/行内公式全部先替换为 HTML 注释占位符，
 * 等 marked 解析完成后再各自还原成高亮代码 / KaTeX HTML。
 *
 * 注意：公式必须"先占位、后渲染"—— 如果先将 KaTeX 生成的 HTML 交给
 * marked 解析，marked 会把它当作普通 markdown 文本处理，破坏其中的
 * SVG path 数据、属性引号等（表现为表格里泄漏出 c-2.7,0,...、H400000v40H...
 * 之类的裸文本，或公式显示为原始 LaTeX 源码）。
 * 占位符是纯 HTML 注释，不包含 | 等字符，因此还能避免公式中的 | 撑坏表格。
 */
function processMathExpressions(text) {
    const str = ensureString(text)
    if (!str) return { text: '', blockCodes: [], inlineCodes: [], blockMaths: [], inlineMaths: [], prefix: '' }

    const prefix = `AICHAT_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    const blockCodes = []
    const inlineCodes = []
    const blockMaths = []
    const inlineMaths = []

    // 第一步：保护代码块
    let result = str.replace(CODE_BLOCK_REGEX, (match, lang, code) => {
        const token = `${prefix}_CB_${blockCodes.length}`
        blockCodes.push({ lang: (lang || '').trim(), code })
        return `\n<!--${token}-->\n`
    })

    // 第二步：保护行内代码
    result = result.replace(INLINE_CODE_REGEX, (match, code) => {
        const token = `${prefix}_IC_${inlineCodes.length}`
        inlineCodes.push(code)
        return `<!--${token}-->`
    })

    // 第三步：保护块级公式（必须先于行内，避免 $$ 被行内正则拆坏）
    result = result.replace(MATH_BLOCK_REGEX, (match, f1, f2) => {
        const formula = (f1 || f2 || '').trim()
        if (!formula) return match
        const token = `${prefix}_MB_${blockMaths.length}`
        blockMaths.push(formula)
        return `<!--${token}-->`
    })

    // 第四步：保护行内公式
    result = result.replace(MATH_INLINE_REGEX, (match, f1, f2) => {
        const formula = (f1 || f2 || '').trim()
        if (!formula) return match
        const token = `${prefix}_MI_${inlineMaths.length}`
        inlineMaths.push(formula)
        return `<!--${token}-->`
    })

    return { text: result, blockCodes, inlineCodes, blockMaths, inlineMaths, prefix }
}

/**
 * 把 marked 输出中的占位注释替换为 公式HTML / 高亮代码HTML
 */
function restorePlaceholders(html, prepared) {
    let result = html

    // 公式：marked 解析完成后再插入 KaTeX HTML，避免被 marked 改写
    for (let i = 0; i < prepared.blockMaths.length; i++) {
        const token = `<!--${prepared.prefix}_MB_${i}-->`
        result = result.split(token).join(renderKatex(prepared.blockMaths[i], true))
    }

    for (let i = 0; i < prepared.inlineMaths.length; i++) {
        const token = `<!--${prepared.prefix}_MI_${i}-->`
        result = result.split(token).join(renderKatex(prepared.inlineMaths[i], false))
    }

    for (let i = 0; i < prepared.blockCodes.length; i++) {
        const token = `<!--${prepared.prefix}_CB_${i}-->`
        const { lang, code } = prepared.blockCodes[i]
        result = result.split(token).join(highlightCode(code, lang))
    }

    for (let i = 0; i < prepared.inlineCodes.length; i++) {
        const token = `<!--${prepared.prefix}_IC_${i}-->`
        const code = prepared.inlineCodes[i]
        result = result.split(token).join(`<code>${escapeHtml(code)}</code>`)
    }

    return result
}

/* ───── 主渲染函数 ───── */

/**
 * 完整Markdown渲染管线：保护代码块/公式 → marked 解析 → 还原 公式HTML与高亮代码
 */
export async function renderMarkdown(markdownText) {
    if (!markdownText) return ''

    const text = ensureString(markdownText)
    const cacheKey = `md:${text}`

    const cached = cacheGet('markdown', cacheKey)
    if (cached !== null) return cached

    try {
        const prepared = processMathExpressions(text)
        const html = marked.parse(prepared.text, {
            gfm: true,
            breaks: false,
            async: false
        })

        const finalHtml = restorePlaceholders(html, prepared)
        cacheSet('markdown', cacheKey, finalHtml)
        return finalHtml
    } catch (error) {
        console.error('Markdown渲染错误:', error)
        return `<div class="error">渲染失败: ${escapeHtml(error.message)}</div>`
    }
}
