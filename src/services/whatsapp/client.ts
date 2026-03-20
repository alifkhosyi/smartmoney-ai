import { config } from 'dotenv'
config()

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL!
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN!

const headers = {
  'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
  'Content-Type': 'application/json'
}

export async function sendTyping(to: string) {
  const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`
  await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'reaction',
      reaction: { message_id: 'typing', emoji: '⏳' }
    })
  }).catch(() => {})
}

export async function markAsRead(messageId: string) {
  const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`
  await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    })
  }).catch(() => {})
}

export async function sendMessage(to: string, message: string) {
  const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message }
    })
  })

  const data = await response.json()
  return data
}
