import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from 'dotenv'
import webhook from './routes/webhook.js'
import { supabase } from './lib/supabase.js'
import { startReminderCron } from './services/reminder.js'
import { checkTrialReminders } from './services/trial.js'
import { startWeeklyCron } from './services/weeklyReport.js'

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

app.get('/admin/test-reminder', async (c) => {
  const { sendReminders } = await import('./services/reminder.js')
  await sendReminders()
  return c.json({ success: true, message: 'Reminder terkirim!' })
})

app.get('/admin/test-weekly-report', async (c) => {
  const { sendWeeklyReportToAll } = await import('./services/weeklyReport.js')
  await sendWeeklyReportToAll()
  return c.json({ success: true, message: 'Laporan mingguan terkirim!' })
})

app.get('/admin/test-trial-reminder', async (c) => {
  const { checkTrialReminders } = await import('./services/trial.js')
  await checkTrialReminders()
  return c.json({ success: true, message: 'Trial reminder dicek!' })
})

app.route('/', webhook)

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`SmartMoney AI running on port ${port}`)
  startReminderCron()
  startWeeklyCron()

  // Cek trial reminder setiap hari jam 10:00 WIB
  import('node-cron').then(cron => {
    cron.default.schedule('0 3 * * *', async () => {
      console.log('[Trial] Cron triggered!')
      await checkTrialReminders()
    }, { timezone: 'Asia/Jakarta' })
    console.log('[Trial] Cron scheduled — setiap hari 10:00 WIB')
  })
})

export default app
