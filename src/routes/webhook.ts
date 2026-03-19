import { Hono } from 'hono'
import { sendMessage } from '../services/whatsapp/client.js'
import { parseTransaction } from '../services/ai/parser.js'
import { supabase } from '../lib/supabase.js'

const webhook = new Hono()

webhook.get('/webhook', (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified!')
    return c.text(challenge ?? '')
  }

  return c.json({ error: 'Forbidden' }, 403)
})

webhook.post('/webhook', async (c) => {
  const body = await c.req.json()

  const entry = body?.entry?.[0]
  const changes = entry?.changes?.[0]
  const message = changes?.value?.messages?.[0]

  if (message) {
    const from = message.from
    const text = message?.text?.body

    console.log(`Message from ${from}: ${text}`)

    try {
      let { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('phone', from)
        .single()

      if (!user) {
        const { data: newUser } = await supabase
          .from('users')
          .insert({ phone: from })
          .select()
          .single()
        user = newUser

        await sendMessage(from, 'Halo! Selamat datang di SmartMoney AI 👋\n\nAku akan bantu catat keuanganmu. Langsung ketik transaksimu, contoh:\n- "makan siang 35rb"\n- "gajian 5jt"\n- "gopay 150rb bensin"')
        return c.json({ status: 'ok' })
      }

      const parsed = await parseTransaction(text)
      console.log('Parsed:', parsed)

      if (parsed.type === 'unknown' || parsed.amount === 0) {
        await sendMessage(from, 'Hmm, aku kurang paham maksudnya. Coba ketik seperti ini:\n- "makan 25rb"\n- "gaji 5jt"\n- "bensin gopay 50rb"')
        return c.json({ status: 'ok' })
      }

      await supabase.from('transactions').insert({
        user_id: user.id,
        type: parsed.type,
        amount: parsed.amount,
        category: parsed.category,
        description: parsed.description,
      })

      const emoji = parsed.type === 'income' ? '💰' : '💸'
      const typeText = parsed.type === 'income' ? 'Pemasukan' : 'Pengeluaran'
      const amountFormatted = new Intl.NumberFormat('id-ID').format(parsed.amount)

      await sendMessage(from, `${emoji} *${typeText} dicatat!*\n\n📝 ${parsed.description}\n🏷️ ${parsed.category}\n💵 Rp ${amountFormatted}\n👛 ${parsed.wallet}`)

    } catch (err) {
      console.error('Error:', err)
      await sendMessage(from, 'Maaf, ada error. Coba lagi ya!')
    }
  }

  return c.json({ status: 'ok' })
})

export default webhook