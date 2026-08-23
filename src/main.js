import './style.css'
import './code-style.css'
import { renderMarkdown } from './utils/markdown.js'

/* DOM 对象 */
const messageContainer = document.getElementById('message-container')
const inputBox = document.getElementById('input-box')
const submitButton = document.getElementById('submit-button')
const stopButton = document.getElementById('stop-button')
const newSessionButton = document.getElementById('new-session-button')
const thinkingToggle = document.getElementById('thinking-toggle')

/* 状态管理 */
let isSending = false
let currentAbortController = null
let currentLoadingIndicator = null

/* ───── 消息内容渲染 ───── */

/**
 * 渲染用户消息内容（纯文本，保留换行）
 */
async function renderUserMessageContent(element, content) {
    element.textContent = content
}

/**
 * 渲染Markdown内容到指定元素，失败时降级为纯文本
 */
async function renderMarkdownContent(element, content) {
    try {
        element.innerHTML = await renderMarkdown(content)
        element.classList.remove('plain-fallback')
    } catch (error) {
        console.error('Markdown渲染失败:', error)
        element.textContent = content
        element.classList.add('plain-fallback')
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
 */
async function loadCurrentConversationMessages(conversationId) {
    try {
        const response = await fetch(`/api/chat/${conversationId}/messages`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (data.success && data.messages) {
            await renderConversationMessages(data.messages)
        } else {
            throw new Error(data.error || '加载消息失败')
        }
    } catch (error) {
        console.error('加载对话消息失败:', error)
        addErrorMessage(`加载对话消息失败: ${error.message}`)
    }
}

/**
 * 将历史消息批量渲染到UI（仅展示，不触发发送）
 */
async function renderConversationMessages(messages) {
    const selectors = [
        '.user-message-container',
        '.assistant-message-container',
        '.reasoning-message-container',
        '.message-status',
        '.error-message'
    ].join(',')
    messageContainer.querySelectorAll(selectors).forEach(el => el.remove())

    if (!messages.length) {
        showWelcome()
        return
    }

    hideWelcome()
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

    messageContainer.scrollTop = messageContainer.scrollHeight
}

/**
 * 渲染对话列表到侧边栏
 */
function renderConversations(conversations) {
    const container = document.getElementById('chat-histories-container')
    container.innerHTML = ''

    if (conversations.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'empty-history'
        empty.textContent = '暂无对话记录'
        container.appendChild(empty)
        return
    }

    conversations.forEach(conv => {
        const link = document.createElement('a')
        link.href = `/chat/${conv.id}`
        link.textContent = conv.title || '新对话'
        link.dataset.conversationId = conv.id

        link.addEventListener('click', async (e) => {
            e.preventDefault()
            if (isSending) {
                if (!confirm('正在生成回复，切换对话将中断本次生成，确定继续？')) {
                    return
                }
                await handleStop()
            }
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
 */
function showConversationsError(message) {
    const container = document.getElementById('chat-histories-container')
    const error = document.createElement('div')
    error.className = 'error-message'
    error.textContent = message
    container.replaceChildren(error)
}

/* ───── 加载/错误状态UI ───── */

function showWelcome() {
    const welcome = document.getElementById('welcome')
    if (welcome) welcome.hidden = false
}

function hideWelcome() {
    const welcome = document.getElementById('welcome')
    if (welcome) welcome.hidden = true
}

/**
 * 显示"AI正在思考"加载指示器，并切换到发送中状态
 */
function showLoading() {
    removeLoadingIndicator()
    document.querySelectorAll('.retry-status').forEach(el => el.remove())

    const statusDiv = document.createElement('div')
    statusDiv.className = 'message-status'
    statusDiv.id = 'loading-indicator'
    statusDiv.innerHTML = 'AI正在思考<span class="loading-dots"></span>'

    messageContainer.appendChild(statusDiv)
    currentLoadingIndicator = statusDiv

    setInputEnabled(false)
    if (stopButton) {
        stopButton.hidden = false
        stopButton.disabled = false
        stopButton.textContent = '停止'
    }

    scrollToBottom(messageContainer)
}

/**
 * 仅移除加载指示器，不恢复输入控件（流式内容已经开始输出时使用）
 */
function removeLoadingIndicator() {
    if (currentLoadingIndicator) {
        currentLoadingIndicator.remove()
        currentLoadingIndicator = null
    }
}

/**
 * 恢复输入控件，移除加载指示器
 */
function hideLoading() {
    removeLoadingIndicator()
    setInputEnabled(true)
    if (stopButton) {
        stopButton.hidden = true
        stopButton.disabled = true
    }
}

function setInputEnabled(enabled) {
    if (inputBox) inputBox.disabled = !enabled
    if (submitButton) submitButton.disabled = !enabled
    if (newSessionButton) newSessionButton.disabled = !enabled
}

/**
 * 在消息区展示一行轻量状态
 */
function showMessageStatus(message) {
    const statusDiv = document.createElement('div')
    statusDiv.className = 'message-status'
    statusDiv.textContent = message
    messageContainer.appendChild(statusDiv)
    scrollToBottom(messageContainer)
}

/**
 * 显示发送失败提示及重试按钮
 */
function showRetryButton(errorMessage, retryPayload) {
    document.querySelectorAll('.retry-status').forEach(el => el.remove())

    const errorDiv = document.createElement('div')
    errorDiv.className = 'message-status retry-status'

    const errorText = document.createElement('span')
    errorText.textContent = `发送失败: ${errorMessage}`

    const retryButton = document.createElement('button')
    retryButton.className = 'retry-button'
    retryButton.textContent = '重试'
    retryButton.onclick = () => {
        errorDiv.remove()
        sendMessage(retryPayload)
    }

    errorDiv.appendChild(errorText)
    errorDiv.appendChild(retryButton)
    messageContainer.appendChild(errorDiv)

    scrollToBottom(messageContainer)
}

/**
 * 添加错误消息到消息列表
 */
function addErrorMessage(content) {
    const errorDiv = document.createElement('div')
    errorDiv.className = 'error-message'
    errorDiv.textContent = `错误: ${content}`
    messageContainer.appendChild(errorDiv)
    scrollToBottom(messageContainer)
}

/* ───── 消息发送 ───── */

/**
 * 处理新用户消息：先渲染用户气泡，再发起请求。
 * 返回 true 表示已接收并开始发送，false 表示被拒绝。
 */
async function handleUserMessage(content, options = {}) {
    if (isSending) {
        console.warn('已有消息正在发送，请等待')
        return false
    }

    const conversationId = getCurrentConversationId()
    if (!conversationId) {
        addErrorMessage('未找到对话ID，请先创建或选择对话')
        return false
    }

    const thinking = options.thinking ?? (thinkingToggle ? thinkingToggle.checked : false)
    const clientMessageId = options.clientMessageId || createClientMessageId()

    await addUserMessageToUI(content)
    sendMessage({ content, thinking, clientMessageId })

    return true
}

function createClientMessageId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID()
    }
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * 将用户消息添加到UI（仅DOM操作，不发送）
 */
async function addUserMessageToUI(content) {
    hideWelcome()

    const container = document.createElement('div')
    container.className = 'user-message-container'
    const messageDiv = document.createElement('div')
    messageDiv.className = 'user-message'
    await renderUserMessageContent(messageDiv, content)
    container.appendChild(messageDiv)
    messageContainer.appendChild(container)
    scrollToBottom(messageContainer)
}

/**
 * 将助手消息添加到UI（仅DOM操作）
 */
async function addAssistantMessage(content) {
    hideWelcome()

    const container = document.createElement('div')
    container.className = 'assistant-message-container'

    const messageDiv = document.createElement('div')
    messageDiv.className = 'assistant-message markdown-body'
    await renderMarkdownContent(messageDiv, content)

    container.appendChild(messageDiv)
    messageContainer.appendChild(container)
    scrollToBottom(messageContainer)
}

/**
 * 将思考消息添加到UI（默认折叠）
 */
async function addReasoningMessageToUI(content) {
    hideWelcome()
    const messageDiv = createReasoningMessage()
    await renderMarkdownContent(messageDiv, content)
}

/**
 * 发送消息到后端（流式响应）
 */
async function sendMessage({ content, thinking, clientMessageId }) {
    if (isSending) {
        console.warn('已有消息正在发送，请等待')
        return
    }

    const conversationId = getCurrentConversationId()
    if (!conversationId) {
        addErrorMessage('未找到对话ID，请先创建或选择对话')
        return
    }

    isSending = true
    currentAbortController = new AbortController()
    showLoading()

    try {
        const makeRequest = () => fetch('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversation_id: conversationId,
                message: content,
                thinking: thinking,
                client_message_id: clientMessageId
            }),
            signal: currentAbortController.signal
        })

        let response = await makeRequest()

        // 上一轮回复可能刚结束、后端还在保存；短暂等待后自动重试一次
        if (response.status === 409) {
            await new Promise(resolve => setTimeout(resolve, 400))
            response = await makeRequest()
        }

        if (!response.ok) {
            let detail = ''
            try {
                const errorData = await response.json()
                detail = errorData.error || ''
            } catch {
                detail = await response.text()
            }
            throw new Error(detail || `HTTP错误 ${response.status}`)
        }

        await processStreamResponse(response, thinking)
        // 回复结束后刷新侧边栏标题（首次回复会生成对话标题）
        loadConversations()
    } catch (error) {
        if (error.name === 'AbortError') {
            showMessageStatus('已停止生成')
        } else {
            console.error('发送消息失败:', error)
            // 移除本次失败请求已经画出来的半截回复，避免重试后出现两段回答
            messageContainer.querySelectorAll('.streaming-message').forEach(el => el.remove())
            showRetryButton(error.message, { content, thinking, clientMessageId })
        }
    } finally {
        isSending = false
        currentAbortController = null
        hideLoading()
    }
}

/**
 * 停止当前生成：先通知后端（后端会保存已生成的部分内容），再断开前端流
 */
async function handleStop() {
    if (!isSending || !currentAbortController) return

    if (stopButton) {
        stopButton.disabled = true
        stopButton.textContent = '停止中...'
    }

    const conversationId = getCurrentConversationId()
    if (conversationId) {
        try {
            await fetch('/api/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation_id: conversationId })
            })
        } catch (error) {
            console.warn('通知后端停止失败，将直接断开连接:', error)
        }
    }

    // 后端正常结束时会发送 done；这里 abort 只是兜底，避免前端一直等待
    currentAbortController?.abort()
}

/* ───── 输入事件处理 ───── */

function autoResizeInput() {
    inputBox.style.height = 'auto'
    inputBox.style.height = Math.min(inputBox.scrollHeight, 220) + 'px'
}

/**
 * 统一的发送处理逻辑（键盘Enter和按钮点击共用）
 */
async function handleSendAction() {
    if (isSending) return

    const content = inputBox.value.trim()
    if (!content) return

    const accepted = await handleUserMessage(content)
    if (accepted) {
        inputBox.value = ''
        autoResizeInput()
    }
}

inputBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        handleSendAction()
    }
})

inputBox.addEventListener('input', autoResizeInput)

submitButton.addEventListener('click', (event) => {
    event.preventDefault()
    handleSendAction()
})

stopButton.addEventListener('click', (event) => {
    event.preventDefault()
    handleStop()
})

/* ───── 新对话 ───── */

/**
 * 创建新对话并重定向到其页面
 */
async function createAndRedirectToNewConversation() {
    try {
        const response = await fetch('/api/newsession', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp: Date.now() })
        })

        if (!response.ok) {
            throw new Error(`HTTP错误 ${response.status}`)
        }

        const result = await response.json()
        if (result.uuid) {
            window.location.href = `/chat/${result.uuid}`
        } else {
            throw new Error('服务端未返回对话ID')
        }
    } catch (error) {
        console.error('自动创建对话失败:', error)
        addErrorMessage(`无法创建新对话: ${error.message}`)
    }
}

newSessionButton.addEventListener('click', async (event) => {
    event.preventDefault()
    if (isSending && !confirm('正在生成回复，开启新对话将中断本次生成，确定继续？')) {
        return
    }
    if (inputBox.value.trim() && !confirm('开启新对话将丢失未发送内容，确定继续？')) {
        return
    }
    await createAndRedirectToNewConversation()
})

/* ───── 工具函数 ───── */

/**
 * 从当前URL路径中提取对话UUID
 */
function getCurrentConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/)
    return match ? match[1] : null
}

/**
 * 判断元素是否滚动到接近底部
 */
function isScrolledToBottom(element) {
    const { scrollTop, scrollHeight, clientHeight } = element
    return scrollTop + clientHeight >= scrollHeight - 70
}

/**
 * 滚动容器到底部（仅当用户没有主动上翻时）
 */
function scrollToBottom(element) {
    if (isScrolledToBottom(element)) {
        element.scrollTop = element.scrollHeight
    }
}

/* ───── 流式响应处理 ───── */

/**
 * 处理SSE流式响应，实时更新UI。
 * 使用行缓冲 + streaming TextDecoder，避免网络分片把一行 JSON 拆坏。
 */
async function processStreamResponse(response, thinkingEnabled) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { stream: true })
    let buffer = ''
    let assistantContent = ''
    let reasoningContent = ''
    let assistantMessageDiv = null
    let reasoningMessageDiv = null
    let isFirstChunk = true
    let hasReceivedContent = false
    let sawDone = false
    let sawError = false

    const handleData = async (data) => {
        if (data.success === false) {
            sawError = true
            messageContainer.querySelectorAll('.streaming-message').forEach(el => el.classList.remove('streaming-message'))
            addErrorMessage(data.message || '未知错误')
            return 'error'
        }

        if (data.done) {
            sawDone = true
            messageContainer.querySelectorAll('.streaming-message').forEach(el => el.classList.remove('streaming-message'))
            if (data.cancelled) {
                showMessageStatus('已停止生成')
            }
            return 'done'
        }

        const delta = typeof data.message_delta === 'string' ? data.message_delta : ''
        if (!delta) return null

        if (!hasReceivedContent) {
            removeLoadingIndicator()
            hasReceivedContent = true
        }

        if (data.reasoning) {
            reasoningContent += delta
            if (thinkingEnabled) {
                if (!reasoningMessageDiv) {
                    reasoningMessageDiv = createReasoningMessage({ streaming: true })
                }
                await updateReasoningUI(reasoningMessageDiv, reasoningContent)
            }
        } else {
            assistantContent += delta
            if (isFirstChunk) {
                assistantMessageDiv = createAssistantMessage({ streaming: true })
                isFirstChunk = false
            }
            await updateAssistantUI(assistantMessageDiv, assistantContent)
        }

        return null
    }

    const processCompleteLines = async () => {
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue

            const dataStr = line.slice(6).trim()
            if (!dataStr) continue

            try {
                const data = JSON.parse(dataStr)
                const result = await handleData(data)
                if (result === 'done' || result === 'error') {
                    return result
                }
            } catch (error) {
                console.error('解析SSE数据失败:', error, line)
            }
        }
        return null
    }

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const result = await processCompleteLines()
            if (result === 'done' || result === 'error') break
        }

        // 服务端结束流时，把 decoder 中剩余的字节刷出来
        buffer += decoder.decode()
        await processCompleteLines()

        if (!sawDone && !sawError) {
            showMessageStatus('连接意外结束')
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('读取流式响应失败:', error)
            addErrorMessage(`流式响应处理失败: ${error.message}`)
        }
        throw error
    } finally {
        reader.releaseLock()
    }
}

/**
 * 创建助手消息容器DOM，追加到消息列表
 */
function createAssistantMessage({ streaming = false } = {}) {
    hideWelcome()

    const container = document.createElement('div')
    container.className = 'assistant-message-container'
    if (streaming) container.classList.add('streaming-message')

    const messageDiv = document.createElement('div')
    messageDiv.className = 'assistant-message markdown-body'

    container.appendChild(messageDiv)
    messageContainer.appendChild(container)

    return messageDiv
}

/**
 * 创建可折叠的思考过程消息容器，追加到消息列表
 */
function createReasoningMessage({ streaming = false } = {}) {
    hideWelcome()

    const container = document.createElement('div')
    container.className = 'reasoning-message-container'
    if (streaming) container.classList.add('streaming-message')

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
    messageDiv.className = 'reasoning-message markdown-body'
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
 */
async function updateAssistantUI(messageDiv, content) {
    await renderMarkdownContent(messageDiv, content)
    scrollToBottom(messageContainer)
}

/**
 * 实时更新思考消息DOM内容并滚动到底部
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
