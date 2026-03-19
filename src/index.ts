import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from 'dotenv'
import webhook from './routes/webhook.js'
import { supabase } from './lib/supabase.js'

config()

supabase.from('users').select('count').then(({ data, error }) => {
  if (error) console.error('Supabase error:', error.message)
  else console.log('Supabase connected!')
})

const app = new Hono()

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

app.get('/privacy', (c) => {
  return c.html(`
    <html>
      <body style="font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
        <h1>Kebijakan Privasi SmartMoney AI</h1>
        <p>SmartMoney AI mengumpulkan data transaksi keuangan yang Anda kirimkan melalui WhatsApp untuk keperluan pencatatan pribadi Anda.</p>
        <p>Data Anda disimpan dengan aman dan tidak dibagikan kepada pihak ketiga.</p>
        <p>Untuk pertanyaan, hubungi kami melalui WhatsApp.</p>
        <p><small>Terakhir diperbarui: Maret 2026</small></p>
      </body>
    </html>
  `)
})

app.route('/', webhook)

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`SmartMoney AI running on port ${port}`)
})

export default app