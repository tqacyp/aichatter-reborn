import './style.css'
import './code-style.css'
import { renderMarkdown } from './utils/markdown.js'
import { AdvancedScrollDetector } from './scrollDetector.js'

/* DOM 对象 */
const messageContainer = document.getElementById("message-container")
const inputBox = document.getElementById("input-box")
const submitButton = document.getElementById("submit-button")
const newSessionButton = document.getElementById("new-session-button")
const thinkingToggle = document.getElementById("thinking-toggle")

/* 状态管理 */
let isSending = false
let currentLoadingIndicator = null
let lastSentMessage = null
let lastSentTime = 0
const SEND_COOLDOWN_MS = 1000

/* 滚动检测器（全局单例，避免重复注册事件监听） */
const scrollDetector = new AdvancedScrollDetector()

/* ───── 消息内容渲染 ───── */

/**
 * 渲染用户消息内容（纯文本，仅处理换行符）
 * @param {HTMLElement} element - 目标DOM元素
 * @param {string} content - 消息文本
 */
async function renderUserMessageContent(element, content) {
    element.innerHTML = content.replace(/\n/g, '<br>')
}

/**
 * 渲染Markdown内容到指定元素，失败时降级为纯文本
 * @param {HTMLElement} element - 目标DOM元素
 * @param {string} content - Markdown文本
 */
async function renderMarkdownContent(element, content) {
    try {
        element.innerHTML = await renderMarkdown(content)
    } catch (error) {
        console.error('Markdown渲染失败:', error)
        element.innerHTML = content.replace(/\n/g, '<br>')
    }
}

/* ───── 对话历史管理 ───── */

/**
 * 从后端加载对话列表并渲染到侧边栏
 */
async function loadConversations() {
    try {
        const response = await fetch('/api/conversations')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (data.success) {
            renderConversations(data.conversations)
        } else {
            showConversationsError('加载对话列表失败: ' + (data.error || '未知错误'))
        }
    } catch (error) {
        console.error('加载对话列表失败:', error)
        showConversationsError('加载对话列表失败，请刷新页面')
    }
}

/**
 * 加载指定对话的历史消息
 * @param {string} conversationId - 对话UUID
 */
async function loadCurrentConversationMessages(conversationId) {
    try {
        const response = await fetch(`/api/chat/${conversationId}/messages`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (data.success && data.messages) {
            await renderConversationMessages(data.messages)
        } else {
            console.error('加载对话消息失败:', data.error)
        }
    } catch (error) {
        console.error('加载对话消息失败:', error)
    }
}

/**
 * 将历史消息批量渲染到UI（仅展示，不触发发送）
 * @param {Array} messages - 消息对象数组
 */
async function renderConversationMessages(messages) {
    const selectors = [
        '.user-message-container',
        '.assistant-message-container',
        '.reasoning-message-container'
    ].join(',')
    messageContainer.querySelectorAll(selectors).forEach(el => el.remove())

    for (const msg of messages) {
        if (msg.role === 'user') {
            await addUserMessageToUI(msg.content)
        } else if (msg.role === 'assistant') {
            if (msg.is_reasoning) {
                await addReasoningMessageToUI(msg.content)
            } else {
                await addAssistantMessage(msg.content)
            }
        }
    }
}

/**
 * 渲染对话列表到侧边栏
 * @param {Array} conversations - 对话对象数组
 */
function renderConversations(conversations) {
    const container = document.getElementById('chat-histories-container')
    container.innerHTML = ''

    if (conversations.length === 0) {
        container.innerHTML = '<div class="empty-history">暂无对话记录</div>'
        return
    }

    conversations.forEach(conv => {
        const link = document.createElement('a')
        link.href = `/chat/${conv.id}`
        link.textContent = conv.title || '新对话'
        link.dataset.conversationId = conv.id

        link.addEventListener('click', (e) => {
            e.preventDefault()
            if (inputBox.value.trim() && !confirm('切换对话将丢失未发送内容，确定继续？')) {
                return
            }
            window.location.href = `/chat/${conv.id}`
        })

        container.appendChild(link)
    })

    highlightCurrentConversation()
}

/**
 * 高亮侧边栏中当前对话的链接
 */
function highlightCurrentConversation() {
    const currentId = getCurrentConversationId()
    if (!currentId) return

    document.querySelectorAll('#chat-histories-container a').forEach(link => {
        link.classList.toggle('active', link.dataset.conversationId === currentId)
    })
}

/**
 * 在侧边栏显示错误信息
 * @param {string} message - 错误描述
 */
function showConversationsError(message) {
    const container = document.getElementById('chat-histories-container')
    container.innerHTML = `<div class="error-message">${message}</div>`
}

/* ───── 加载/错误状态UI ───── */

/**
 * 显示"AI正在思考"加载指示器，禁用输入控件
 */
function showLoading() {
    if (currentLoadingIndicator) {
        currentLoadingIndicator.remove()
    }

    const statusDiv = document.createElement('div')
    statusDiv.className = 'message-status'
    statusDiv.id = 'loading-indicator'
    statusDiv.innerHTML = 'AI正在思考<span class="loading-dots"></span>'

    messageContainer.appendChild(statusDiv)
    currentLoadingIndicator = statusDiv

    if (inputBox) inputBox.disabled = true
    if (submitButton) submitButton.disabled = true

    scrollToBottom(messageContainer)
}

/**
 * 隐藏加载指示器，恢复输入控件
 */
function hideLoading() {
    if (currentLoadingIndicator) {
        currentLoadingIndicator.remove()
        currentLoadingIndicator = null
    }

    if (inputBox) inputBox.disabled = false
    if (submitButton) submitButton.disabled = false
}

/**
 * 显示发送失败提示及重试按钮
 * @param {string} errorMessage - 错误描述
 */
function showRetryButton(errorMessage) {
    const errorDiv = document.createElement('div')
    errorDiv.className = 'message-status'

    const errorText = document.createElement('span')
    errorText.textContent = `发送失败: ${errorMessage}`

    const retryButton = document.createElement('button')
    retryButton.className = 'retry-button'
    retryButton.textContent = '重试'
    retryButton.onclick = () => {
        const lastMessage = inputBox.value.trim()
        if (lastMessage) {
            errorDiv.remove()
            handleUserMessage(lastMessage)
        }
    }

    errorDiv.appendChild(errorText)
    errorDiv.appendChild(retryButton)
    messageContainer.appendChild(errorDiv)

    scrollToBottom(messageContainer)
}

/* ───── 消息发送 ───── */

/**
 * 处理用户消息：添加到UI并发送到后端
 * @param {string} content - 用户输入的消息文本
 */
async function handleUserMessage(content) {
    const now = Date.now()
    if (content === lastSentMessage && (now - lastSentTime) < SEND_COOLDOWN_MS) {
        console.warn('重复消息被阻止:', content)
        return
    }

    lastSentMessage = content
    lastSentTime = now

    await addUserMessageToUI(content)
    const thinkingEnabled = thinkingToggle ? thinkingToggle.checked : false
    sendMessage(content, thinkingEnabled)
}

/**
 * 将用户消息添加到UI（仅DOM操作，不发送）
 * @param {string} content - 消息文本
 */
async function addUserMessageToUI(content) {
    const container = document.createElement('div')
    container.className = 'user-message-container'
    const messageDiv = document.createElement('div')
    messageDiv.className = 'user-message'
    await renderUserMessageContent(messageDiv, content)
    container.appendChild(messageDiv)
    messageContainer.appendChild(container)
}

/**
 * 将助手消息添加到UI（仅DOM操作）
 * @param {string} content - Markdown消息文本
 */
async function addAssistantMessage(content) {
    const container = document.createElement('div')
    container.className = 'assistant-message-container'

    const messageDiv = document.createElement('div')
    messageDiv.className = 'assistant-message'
    await renderMarkdownContent(messageDiv, content)

    container.appendChild(messageDiv)
    messageContainer.appendChild(container)
}

/**
 * 将思考消息添加到UI（仅DOM操作，默认折叠）
 * @param {string} content - 思考过程Markdown文本
 */
async function addReasoningMessageToUI(content) {
    const messageDiv = createReasoningMessage()
    await renderMarkdownContent(messageDiv, content)
}

/**
 * 添加错误消息到消息列表
 * @param {string} content - 错误描述
 */
function addErrorMessage(content) {
    const errorDiv = document.createElement('div')
    errorDiv.className = 'error-message'
    errorDiv.textContent = `错误: ${content}`
    messageContainer.appendChild(errorDiv)
}

/**
 * 发送消息到后端（流式响应）
 * @param {string} content - 消息文本
 * @param {boolean} thinking - 是否启用思考模式
 */
async function sendMessage(content, thinking = false) {
    if (isSending) {
        console.warn("已有消息正在发送，请等待")
        return
    }

    const conversationId = getCurrentConversationId()
    if (!conversationId) {
        console.error("未找到对话ID")
        addErrorMessage("未找到对话ID，请先创建或选择对话")
        return
    }

    isSending = true
    showLoading()

    try {
        const response = await fetch("/api/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversation_id: conversationId,
                message: content,
                thinking: thinking
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`HTTP错误 ${response.status}: ${errorText}`)
        }

        await processStreamResponse(response, thinking)
    } catch (error) {
        console.error("发送消息失败:", error)
        hideLoading()
        showRetryButton(error.message)
    } finally {
        isSending = false
    }
}

/* ───── 输入事件处理 ───── */

/**
 * 统一的发送处理逻辑（键盘Enter和按钮点击共用）
 */
function handleSendAction() {
    const content = inputBox.value.trim()
    if (!content) return

    handleUserMessage(content)
    inputBox.value = ''
}

inputBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        handleSendAction()
    }
})

submitButton.addEventListener('click', (event) => {
    event.preventDefault()
    handleSendAction()
})

/* ───── 新对话 ───── */

/**
 * 创建新对话并重定向到其页面
 */
async function createAndRedirectToNewConversation() {
    try {
        const response = await fetch("/api/newsession", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timestamp: Date.now() })
        })

        if (!response.ok) {
            throw new Error(`HTTP错误 ${response.status}`)
        }

        const result = await response.json()
        if (result.uuid) {
            window.location.href = `/chat/${result.uuid}`
        } else {
            console.error("创建新对话失败")
            document.body.innerHTML = '<div style="padding: 20px; text-align: center;">无法创建新对话，请刷新页面重试</div>'
        }
    } catch (error) {
        console.error("自动创建对话失败:", error)
        document.body.innerHTML = `<div style="padding: 20px; text-align: center;">自动创建对话失败: ${error.message}</div>`
    }
}

newSessionButton.addEventListener('click', createAndRedirectToNewConversation)

/* ───── 工具函数 ───── */

/**
 * 从当前URL路径中提取对话UUID
 * @returns {string|null} 对话UUID或null
 */
function getCurrentConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/)
    return match ? match[1] : null
}

/**
 * 判断元素是否滚动到接近底部
 * @param {HTMLElement} element - 要检查的滚动容器
 * @returns {boolean}
 */
function isScrolledToBottom(element) {
    const { scrollTop, scrollHeight, clientHeight } = element
    return scrollTop + clientHeight >= scrollHeight - 70
}

/**
 * 滚动容器到底部（仅当用户未主动滚动时）
 * @param {HTMLElement} element - 要滚动的容器
 */
function scrollToBottom(element) {
    if (isScrolledToBottom(element) && !scrollDetector.isScrollingNow()) {
        element.scrollTo({
            top: element.scrollHeight,
            behavior: 'smooth'
        })
    }
}

/* ───── 流式响应处理 ───── */

/**
 * 处理SSE流式响应，实时更新UI
 * @param {Response} response - fetch响应对象
 * @param {boolean} thinkingEnabled - 是否启用思考模式展示
 */
async function processStreamResponse(response, thinkingEnabled) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let assistantContent = ""
    let reasoningContent = ""
    let assistantMessageDiv = null
    let reasoningMessageDiv = null
    let isFirstChunk = true
    let hasReceivedContent = false

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value)
            const lines = chunk.split('\n')

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue

                try {
                    const dataStr = line.slice(6).trim()
                    if (!dataStr) continue

                    const data = JSON.parse(dataStr)

                    if (!data.success) {
                        hideLoading()
                        addErrorMessage(data.message || "未知错误")
                        return
                    }

                    if (data.done) {
                        hideLoading()
                        return
                    }

                    if (!hasReceivedContent && (data.message_delta || data.reasoning)) {
                        hideLoading()
                        hasReceivedContent = true
                    }

                    if (data.reasoning) {
                        reasoningContent += data.message_delta || ''
                        if (thinkingEnabled) {
                            if (!reasoningMessageDiv) {
                                reasoningMessageDiv = createReasoningMessage()
                            }
                            await updateReasoningUI(reasoningMessageDiv, reasoningContent)
                        }
                    } else {
                        assistantContent += data.message_delta || ''
                        if (isFirstChunk) {
                            assistantMessageDiv = createAssistantMessage()
                            isFirstChunk = false
                        }
                        await updateAssistantUI(assistantMessageDiv, assistantContent)
                    }
                } catch (e) {
                    console.error("解析SSE数据失败:", e, line)
                }
            }
        }
    } catch (error) {
        console.error("读取流式响应失败:", error)
        hideLoading()
        addErrorMessage(`流式响应处理失败: ${error.message}`)
    } finally {
        reader.releaseLock()
    }
}

/**
 * 创建助手消息容器DOM，追加到消息列表
 * @returns {HTMLElement} 消息内容的div元素
 */
function createAssistantMessage() {
    const container = document.createElement('div')
    container.className = 'assistant-message-container'

    const messageDiv = document.createElement('div')
    messageDiv.className = 'assistant-message'

    container.appendChild(messageDiv)
    messageContainer.appendChild(container)

    return messageDiv
}

/**
 * 创建可折叠的思考过程消息容器，追加到消息列表
 * @returns {HTMLElement} 思考内容的div元素
 */
function createReasoningMessage() {
    const container = document.createElement('div')
    container.className = 'reasoning-message-container'

    const header = document.createElement('div')
    header.className = 'reasoning-header'
    header.innerHTML = `
        <span class="reasoning-title">思考过程</span>
        <button class="reasoning-toggle">展开</button>
    `

    const contentContainer = document.createElement('div')
    contentContainer.className = 'reasoning-content'
    contentContainer.style.display = 'none'

    const messageDiv = document.createElement('div')
    messageDiv.className = 'reasoning-message'
    contentContainer.appendChild(messageDiv)

    container.appendChild(header)
    container.appendChild(contentContainer)

    header.querySelector('.reasoning-toggle').addEventListener('click', () => {
        const isHidden = contentContainer.style.display === 'none'
        contentContainer.style.display = isHidden ? 'block' : 'none'
        header.querySelector('.reasoning-toggle').textContent = isHidden ? '收起' : '展开'
    })

    messageContainer.appendChild(container)
    return messageDiv
}

/**
 * 实时更新助手消息DOM内容并滚动到底部
 * @param {HTMLElement} messageDiv - 助手消息的div元素
 * @param {string} content - 当前的完整Markdown内容
 */
async function updateAssistantUI(messageDiv, content) {
    await renderMarkdownContent(messageDiv, content)
    scrollToBottom(messageContainer)
}

/**
 * 实时更新思考消息DOM内容并滚动到底部
 * @param {HTMLElement} messageDiv - 思考消息的div元素
 * @param {string} content - 当前的完整Markdown内容
 */
async function updateReasoningUI(messageDiv, content) {
    await renderMarkdownContent(messageDiv, content)
    scrollToBottom(messageContainer)
}

/* ───── 页面初始化 ───── */

document.addEventListener('DOMContentLoaded', () => {
    const currentPath = window.location.pathname

    if (currentPath === '/' || currentPath === '/index.html') {
        createAndRedirectToNewConversation()
    } else {
        loadConversations()

        const currentId = getCurrentConversationId()
        if (currentId) {
            loadCurrentConversationMessages(currentId)
        }
    }
})
