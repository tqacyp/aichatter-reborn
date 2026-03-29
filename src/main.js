import './style.css'
import './code-style.css'
// import { init } from './test-format.js'

/* DOM 对象 */
const chatHistories = document.getElementById("chat-histories-container")
const messageContainer = document.getElementById("message-container")
const inputBox = document.getElementById("input-box")
const submitButton = document.getElementById("submit-button")
const newSessionButton = document.getElementById("new-session-button")

// 处理用户发送消息

function addUserMessage(content) {
    // 追加用户消息到message-container
    const newUserMessageContainer = document.createElement('div')
    newUserMessageContainer.className = 'user-message-container'
    const newUserMessage = document.createElement('div')
    const contentWithNewlines = content.replace(/\n/g,'<br>')
    newUserMessage.innerHTML = contentWithNewlines
    newUserMessage.className = 'user-message'
    newUserMessageContainer.appendChild(newUserMessage)
    messageContainer.appendChild(newUserMessageContainer)
}

inputBox.addEventListener('keydown',function(event){
    // 发送用户消息
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        const content = this.value.trim()
        if (content) {
            addUserMessage(content)
            this.value = ''
        }
    }
})

submitButton.addEventListener('click',function(event) {
    // 同样是发送用户消息（按钮）
    if (event.button === 0) {
        const content = inputBox.value.trim()
        if(content) {
            addUserMessage(content)
            inputBox.value = ''
        }
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
