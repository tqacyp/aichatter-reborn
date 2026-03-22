import './style.css'
import './code-style.css'
// import { init } from './test-format.js'

/* DOM 对象 */
const chatHistories = document.getElementById("chat-histories-container")
const messageContainer = document.getElementById("message-container")
const inputBox = document.getElementById("input-box")

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