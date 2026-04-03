import './style.css'
import './code-style.css'
import { renderMarkdown } from './utils/markdown.js'
// import { init } from './test-format.js'

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
const SEND_COOLDOWN_MS = 1000  // 1秒冷却时间
let isProcessingEvent = false  // 防止事件重复处理

/* 流式渲染性能优化 */
let assistantRenderTimeout = null
let reasoningRenderTimeout = null
const RENDER_DEBOUNCE_MS = 0  // 防抖时间100ms
const RENDER_CHUNK_SIZE = 0    // 至少累积50个字符才渲染
let pendingAssistantUpdate = { element: null, content: '' }
let pendingReasoningUpdate = { element: null, content: '' }

/* 消息内容渲染函数 */
// 渲染用户消息内容（简单文本，只处理换行符）
async function renderUserMessageContent(element, content) {
    element.innerHTML = content.replace(/\n/g, '<br>')
}

// 渲染助手消息内容（使用完整markdown）
async function renderAssistantMessageContent(element, content) {
    try {
        const html = await renderMarkdown(content)
        element.innerHTML = html
    } catch (error) {
        console.error('Markdown渲染失败:', error)
        // 降级处理：使用简单的换行符替换
        element.innerHTML = content.replace(/\n/g, '<br>')
    }
}

// 渲染思考过程消息内容（简化markdown渲染）
async function renderReasoningMessageContent(element, content) {
    try {
        // 简化版：只处理基本markdown格式
        const html = await renderMarkdown(content)
        element.innerHTML = html
    } catch (error) {
        console.error('思考过程渲染失败:', error)
        element.innerHTML = content.replace(/\n/g, '<br>')
    }
}

/* 对话历史管理 */
async function loadConversations() {
    try {
        const response = await fetch('/api/conversations');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.success) {
            renderConversations(data.conversations);
        } else {
            showConversationsError('加载对话列表失败: ' + (data.error || '未知错误'));
        }
    } catch (error) {
        console.error('加载对话列表失败:', error);
        showConversationsError('加载对话列表失败，请刷新页面');
    }
}

// 加载当前对话的消息
async function loadCurrentConversationMessages(conversationId) {
    try {
        const response = await fetch(`/api/chat/${conversationId}/messages`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data.success && data.messages) {
            await renderConversationMessages(data.messages);
        } else {
            console.error('加载对话消息失败:', data.error);
        }
    } catch (error) {
        console.error('加载对话消息失败:', error);
    }
}

// 渲染对话消息到UI
async function renderConversationMessages(messages) {
    // 清空当前消息容器（保留加载状态等）
    const userMessages = messageContainer.querySelectorAll('.user-message-container');
    const assistantMessages = messageContainer.querySelectorAll('.assistant-message-container');
    const reasoningMessages = messageContainer.querySelectorAll('.reasoning-message-container');

    [...userMessages, ...assistantMessages, ...reasoningMessages].forEach(el => el.remove());

    // 渲染每条消息（使用display函数，不触发发送）
    for (const msg of messages) {
        if (msg.role === 'user') {
            await displayUserMessage(msg.content);
        } else if (msg.role === 'assistant') {
            if (msg.is_reasoning) {
                // 思考内容
                await displayReasoningMessage(msg.content);
            } else {
                // 普通助手回复
                await displayAssistantMessage(msg.content);
            }
        }
    }
}

function renderConversations(conversations) {
    const container = document.getElementById('chat-histories-container');
    container.innerHTML = '';

    if (conversations.length === 0) {
        container.innerHTML = '<div class="empty-history">暂无对话记录</div>';
        return;
    }

    conversations.forEach(conv => {
        const link = document.createElement('a');
        link.href = `/chat/${conv.id}`;
        link.textContent = conv.title || '新对话';
        link.dataset.conversationId = conv.id;

        link.addEventListener('click', (e) => {
            e.preventDefault();
            // 如果当前有未发送内容，确认切换
            if (inputBox.value.trim() && !confirm('切换对话将丢失未发送内容，确定继续？')) {
                return;
            }
            window.location.href = `/chat/${conv.id}`;
        });

        container.appendChild(link);
    });

    // 高亮当前对话
    highlightCurrentConversation();
}

function highlightCurrentConversation() {
    const currentId = getCurrentConversationId();
    if (!currentId) return;

    const links = document.querySelectorAll('#chat-histories-container a');
    links.forEach(link => {
        if (link.dataset.conversationId === currentId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

function showConversationsError(message) {
    const container = document.getElementById('chat-histories-container');
    container.innerHTML = `<div class="error-message">${message}</div>`;
}

// 显示加载状态
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

    // 禁用输入控件
    if (inputBox) inputBox.disabled = true
    if (submitButton) submitButton.disabled = true

    // 滚动到底部
    messageContainer.scrollTop = messageContainer.scrollHeight
}

// 隐藏加载状态
function hideLoading() {
    if (currentLoadingIndicator) {
        currentLoadingIndicator.remove()
        currentLoadingIndicator = null
    }

    // 启用输入控件
    if (inputBox) inputBox.disabled = false
    if (submitButton) submitButton.disabled = false
}

// 显示重试按钮
function showRetryButton(errorMessage) {
    const errorDiv = document.createElement('div')
    errorDiv.className = 'message-status'

    const errorText = document.createElement('span')
    errorText.textContent = `发送失败: ${errorMessage}`

    const retryButton = document.createElement('button')
    retryButton.className = 'retry-button'
    retryButton.textContent = '重试'
    retryButton.onclick = function() {
        const lastMessage = inputBox.value.trim()
        if (lastMessage) {
            errorDiv.remove()
            addUserMessage(lastMessage)
        }
    }

    errorDiv.appendChild(errorText)
    errorDiv.appendChild(retryButton)
    messageContainer.appendChild(errorDiv)

    // 滚动到底部
    messageContainer.scrollTop = messageContainer.scrollHeight
}

// 处理用户发送消息

async function addUserMessage(content) {
    //console.log('addUserMessage called with content:', content, 'stack:', new Error().stack)
    // 追加用户消息到message-container
    const newUserMessageContainer = document.createElement('div')
    newUserMessageContainer.className = 'user-message-container'
    const newUserMessage = document.createElement('div')
    newUserMessage.className = 'user-message'
    await renderUserMessageContent(newUserMessage, content)
    newUserMessageContainer.appendChild(newUserMessage)
    messageContainer.appendChild(newUserMessageContainer)
}

// 显示用户消息（不发送到后端）
async function displayUserMessage(content) {
    await originalAddUserMessage(content)
}

// 显示助手消息（不发送到后端）
async function displayAssistantMessage(content) {
    await addAssistantMessage(content)
}

// 显示思考消息（不发送到后端）
async function displayReasoningMessage(content) {
    const messageDiv = createReasoningMessage()
    await renderReasoningMessageContent(messageDiv, content)
}

inputBox.addEventListener('keydown',function(event){
    // 发送用户消息
    if (event.key === 'Enter' && !event.shiftKey) {
        //console.log('Enter key pressed, calling addUserMessage')
        event.preventDefault()
        event.stopPropagation()

        // 防止重复处理
        if (isProcessingEvent) {
            console.warn('事件已在处理中，跳过')
            return
        }

        isProcessingEvent = true
        const content = this.value.trim()
        if (content) {
            addUserMessage(content)
            this.value = ''
        }

        // 短时间内重置标志，防止阻塞后续事件
        setTimeout(() => {
            isProcessingEvent = false
        }, 100)
    }
})

submitButton.addEventListener('click',function(event) {
    // 同样是发送用户消息（按钮）
    if (event.button === 0) {
        //console.log('Submit button clicked, calling addUserMessage')
        event.preventDefault()
        event.stopPropagation()

        // 防止重复处理
        if (isProcessingEvent) {
            console.warn('事件已在处理中，跳过')
            return
        }

        isProcessingEvent = true
        const content = inputBox.value.trim()
        if(content) {
            addUserMessage(content)
            inputBox.value = ''
        }

        // 短时间内重置标志，防止阻塞后续事件
        setTimeout(() => {
            isProcessingEvent = false
        }, 100)
    }
})

// 处理新对话请求

async function newSession(timestampNow) {
    let conversationUuid = null
    try {
        const response = await fetch("/api/newsession",{
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({timestamp: timestampNow})
        })
        const result = await response.json()
        conversationUuid = result.uuid
    } catch (e) {
        console.error("请求出错:error",e)
    }
    return conversationUuid
}

newSessionButton.addEventListener('click', async function(event) {
    if (event.button === 0) {
        const timestampNow = Date.now()
        const uuid = await newSession(timestampNow)
        if (uuid) {
            window.location.href = (`/chat/${uuid}`)
        } else {
            console.error("创建新对话失败,uuid:", uuid)
        }
    }
})

// 获取当前对话ID
function getCurrentConversationId() {
    const path = window.location.pathname
    const match = path.match(/\/chat\/([a-f0-9-]+)/)
    return match ? match[1] : null
}

// 自动创建新对话并重定向
async function createAndRedirectToNewConversation() {
    try {
        const timestampNow = Date.now();
        const response = await fetch("/api/newsession", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ timestamp: timestampNow })
        });

        if (!response.ok) {
            throw new Error(`HTTP错误 ${response.status}`);
        }

        const result = await response.json();
        const conversationUuid = result.uuid;

        if (conversationUuid) {
            // 重定向到新对话
            window.location.href = `/chat/${conversationUuid}`;
        } else {
            console.error("创建新对话失败");
            // 降级处理：显示错误信息
            document.body.innerHTML = '<div style="padding: 20px; text-align: center;">无法创建新对话，请刷新页面重试</div>';
        }
    } catch (error) {
        console.error("自动创建对话失败:", error);
        document.body.innerHTML = `<div style="padding: 20px; text-align: center;">自动创建对话失败: ${error.message}</div>`;
    }
}

// 添加助手消息到UI
async function addAssistantMessage(content) {
    const container = document.createElement('div')
    container.className = 'assistant-message-container'

    const messageDiv = document.createElement('div')
    messageDiv.className = 'assistant-message'
    await renderAssistantMessageContent(messageDiv, content)

    container.appendChild(messageDiv)
    messageContainer.appendChild(container)
}

// 添加错误消息到UI
function addErrorMessage(content) {
    const errorDiv = document.createElement('div')
    errorDiv.className = 'error-message'
    errorDiv.textContent = `错误: ${content}`
    messageContainer.appendChild(errorDiv)
}

// 发送消息到后端（流式响应）
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
            headers: {
                "Content-Type": "application/json",
            },
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

        // 处理流式响应
        await processStreamResponse(response, thinking)

    } catch (error) {
        console.error("发送消息失败:", error)
        hideLoading()
        showRetryButton(error.message)
    } finally {
        isSending = false
    }
}

// 处理流式响应
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
                if (line.startsWith('data: ')) {
                    try {
                        const dataStr = line.slice(6).trim() // 去掉"data: "
                        if (!dataStr) continue

                        const data = JSON.parse(dataStr)

                        if (!data.success) {
                            // 错误处理
                            hideLoading()
                            addErrorMessage(data.message || "未知错误")
                            return
                        }

                        if (data.done) {
                            // 流结束
                            hideLoading()
                            return
                        }

                        // 隐藏加载状态（当收到第一个有效内容时）
                        if (!hasReceivedContent && (data.message_delta || data.reasoning)) {
                            hideLoading()
                            hasReceivedContent = true
                        }

                        if (data.reasoning) {
                            // 思考内容
                            reasoningContent += data.message_delta || ''

                            if (thinkingEnabled) {
                                // 更新或创建思考消息显示
                                if (!reasoningMessageDiv) {
                                    reasoningMessageDiv = createReasoningMessage()
                                }
                                await updateReasoningUI(reasoningMessageDiv, reasoningContent)
                            }
                        } else {
                            // 最终回复内容
                            assistantContent += data.message_delta || ''

                            if (isFirstChunk) {
                                // 创建助手消息容器
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
        }
    } catch (error) {
        console.error("读取流式响应失败:", error)
        hideLoading()
        addErrorMessage(`流式响应处理失败: ${error.message}`)
    } finally {
        reader.releaseLock()
    }
}

// 创建助手消息容器
function createAssistantMessage() {
    const container = document.createElement('div')
    container.className = 'assistant-message-container'

    const messageDiv = document.createElement('div')
    messageDiv.className = 'assistant-message'

    container.appendChild(messageDiv)
    messageContainer.appendChild(container)

    return messageDiv
}

// 创建思考消息容器
function createReasoningMessage() {
    const container = document.createElement('div')
    container.className = 'reasoning-message-container'

    // 折叠头部
    const header = document.createElement('div')
    header.className = 'reasoning-header'
    header.innerHTML = `
        <span class="reasoning-title">思考过程</span>
        <button class="reasoning-toggle">收起</button>
    `

    // 内容容器（默认展开）
    const contentContainer = document.createElement('div')
    contentContainer.className = 'reasoning-content'
    contentContainer.style.display = 'block'

    const messageDiv = document.createElement('div')
    messageDiv.className = 'reasoning-message'
    contentContainer.appendChild(messageDiv)

    container.appendChild(header)
    container.appendChild(contentContainer)

    // 折叠/展开事件
    header.querySelector('.reasoning-toggle').addEventListener('click', () => {
        const isHidden = contentContainer.style.display === 'none'
        contentContainer.style.display = isHidden ? 'block' : 'none'
        header.querySelector('.reasoning-toggle').textContent =
            isHidden ? '收起' : '展开'
    })

    messageContainer.appendChild(container)
    return messageDiv
}

// 更新助手消息UI（防抖优化）
async function updateAssistantUI(messageDiv, content) {
    // 更新待处理的内容
    pendingAssistantUpdate.element = messageDiv
    pendingAssistantUpdate.content = content

    // 如果内容增长小于阈值且已有定时器，则延迟渲染
    const contentLength = content.length
    const prevLength = pendingAssistantUpdate.element.dataset.lastLength || 0

    if (contentLength - prevLength < RENDER_CHUNK_SIZE && assistantRenderTimeout !== null) {
        // 已经有定时器，等待它触发
        return
    }

    // 清除现有定时器
    if (assistantRenderTimeout) {
        clearTimeout(assistantRenderTimeout)
    }

    // 设置新的防抖定时器
    assistantRenderTimeout = setTimeout(async () => {
        await renderAssistantMessageContent(messageDiv, content)
        // 记录已渲染的长度
        messageDiv.dataset.lastLength = content.length.toString()
        // 自动滚动到底部
        messageContainer.scrollTop = messageContainer.scrollHeight
        assistantRenderTimeout = null
    }, RENDER_DEBOUNCE_MS)
}

// 更新思考消息UI（防抖优化）
async function updateReasoningUI(messageDiv, content) {
    // 更新待处理的内容
    pendingReasoningUpdate.element = messageDiv
    pendingReasoningUpdate.content = content

    // 如果内容增长小于阈值且已有定时器，则延迟渲染
    const contentLength = content.length
    const prevLength = pendingReasoningUpdate.element ? (pendingReasoningUpdate.element.dataset.lastLength || 0) : 0

    if (contentLength - prevLength < RENDER_CHUNK_SIZE && reasoningRenderTimeout !== null) {
        // 已经有定时器，等待它触发
        return
    }

    // 清除现有定时器
    if (reasoningRenderTimeout) {
        clearTimeout(reasoningRenderTimeout)
    }

    // 设置新的防抖定时器
    reasoningRenderTimeout = setTimeout(async () => {
        await renderReasoningMessageContent(messageDiv, content)
        // 记录已渲染的长度
        messageDiv.dataset.lastLength = content.length.toString()
        // 自动滚动到底部
        messageContainer.scrollTop = messageContainer.scrollHeight
        reasoningRenderTimeout = null
    }, RENDER_DEBOUNCE_MS)
}

// 修改现有的事件监听器，添加消息发送
const originalAddUserMessage = addUserMessage
addUserMessage = async function(content) {
    //console.log('Overridden addUserIdMessage called with content:', content)

    // 防重复检查：避免短时间内发送相同消息
    const now = Date.now()
    if (content === lastSentMessage && (now - lastSentTime) < SEND_COOLDOWN_MS) {
        console.warn('重复消息被阻止:', content)
        return
    }

    // 更新最后发送的消息和时间
    lastSentMessage = content
    lastSentTime = now

    //console.log('Overridden addUserMessage: calling originalAddUserMessage')
    await originalAddUserMessage(content)
    //console.log('Overridden addUserMessage: calling sendMessage')
    // 发送消息到后端，使用思考模式开关的状态
    const thinkingEnabled = thinkingToggle ? thinkingToggle.checked : false
    sendMessage(content, thinkingEnabled)
}

// 也可以直接修改事件监听器，但为了兼容现有代码，使用包装函数

// 页面初始化
document.addEventListener('DOMContentLoaded', () => {
    // 检查当前是否是根路径
    const currentPath = window.location.pathname;

    if (currentPath === '/' || currentPath === '/index.html') {
        // 自动创建新对话并重定向
        createAndRedirectToNewConversation();
    } else {
        // 原有逻辑：加载对话列表和当前对话消息
        loadConversations();

        // 如果有当前对话ID，加载该对话的消息
        const currentId = getCurrentConversationId();
        if (currentId) {
            loadCurrentConversationMessages(currentId);
        }
    }
});
