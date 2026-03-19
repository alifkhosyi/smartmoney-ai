import { config } from 'dotenv'
config()

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL!
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN!

export async function sendMessage(to: string, message: string) {
  const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`

  console.log('Sending to:', to)
  console.log('URL:', url)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message }
    })
  })

  const data = await response.json()
  console.log('WA Response:', JSON.stringify(data, null, 2))
  return data
}