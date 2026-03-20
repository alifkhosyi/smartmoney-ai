import { config } from 'dotenv'
config()

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL!
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN!

const headers = {
  'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
  'Content-Type': 'application/json'
}

const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`

export async function markAsRead(messageId: string) {
  await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    })
  }).catch(() => {})
}

export async function sendMessage(to: string, message: string) {
  const response = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message }
    })
  })
  return response.json()
}

// Quick Reply Buttons — max 3 tombol
export async function sendButtons(
  to: string,
  body: string,
  buttons: { id: string; title: string }[],
  header?: string,
  footer?: string
) {
  const response = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(header && { header: { type: 'text', text: header } }),
        body: { text: body },
        ...(footer && { footer: { text: footer } }),
        action: {
          buttons: buttons.map(b => ({
            type: 'reply',
            reply: { id: b.id, title: b.title }
          }))
        }
      }
    })
  })
  return response.json()
}

// List Message — max 10 pilihan
export async function sendList(
  to: string,
  body: string,
  buttonText: string,
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[],
  header?: string,
  footer?: string
) {
  const response = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(header && { header: { type: 'text', text: header } }),
        body: { text: body },
        ...(footer && { footer: { text: footer } }),
        action: {
          button: buttonText,
          sections
        }
      }
    })
  })
  return response.json()
}

export async function sendImage(to: string, imageBuffer: Buffer, caption: string) {
  const mediaUrl = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/media`
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' })
  formData.append('file', blob, 'share.png')
  formData.append('type', 'image/png')
  formData.append('messaging_product', 'whatsapp')
  const uploadRes = await fetch(mediaUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_API_TOKEN}` },
    body: formData
  })
  const uploadData = await uploadRes.json()
  const mediaId = uploadData.id
  if (!mediaId) throw new Error('Gagal upload media ke WA')
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { id: mediaId, caption }
    })
  })
  return response.json()
}
