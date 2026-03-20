import cron from 'node-cron'
import { createClient } from '@supabase/supabase-js'
import { sendMessage } from './whatsapp/client.js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const REMINDER_MESSAGES = [
  `👋 Hei! Sudah 2 hari kamu belum catat keuangan.\n\nYuk catat pengeluaran hari ini biar keuangan tetap terkontrol! 💪\n\nTinggal ketik: _"makan 25rb"_ atau _"bensin 50rb"_`,
  `📊 Jangan lupa catat keuangan kamu ya!\n\nKebiasaan catat rutin = keuangan lebih sehat. Cuma butuh 5 detik! ⚡\n\nCoba ketik transaksi terakhir kamu sekarang.`,
  `💡 SmartMoney AI kangen kamu!\n\nSudah beberapa hari belum ada catatan. Konsistensi adalah kunci kebebasan finansial! 🗝️\n\nKetik *bantuan* untuk lihat semua fitur.`,
]

async function sendReminders() {
  console.log('[Reminder] Cek user yang tidak aktif...')

  const twoDaysAgo = new Date()
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

  // Ambil semua user yang sudah onboarding selesai
  const { data: users, error } = await supabase
    .from('users')
    .select('id, phone, name')
    .not('phone', 'is', null)
    .gt('onboarding_step', 3)

  if (error || !users) {
    console.error('[Reminder] Gagal ambil users:', error)
    return
  }

  let sentCount = 0

  for (const user of users) {
    try {
      // Cek transaksi terakhir user
      const { data: lastTx } = await supabase
        .from('transactions')
        .select('created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      // Skip kalau belum pernah transaksi sama sekali
      if (!lastTx) continue

      const lastTxDate = new Date(lastTx.created_at)
      const diffDays = Math.floor(
        (Date.now() - lastTxDate.getTime()) / (1000 * 60 * 60 * 24)
      )

      // Kirim reminder kalau 2-6 hari tidak aktif
      // Lebih dari 7 hari skip (mungkin sudah churn, jangan spam)
      if (diffDays >= 2 && diffDays <= 6) {
        const msgIndex = Math.min(diffDays - 2, REMINDER_MESSAGES.length - 1)
        const name = user.name ? `${user.name}! ` : ''
        const msg = REMINDER_MESSAGES[msgIndex].replace('Hei!', `Hei ${name}`)

        await sendMessage(user.phone, msg)
        sentCount++

        // Delay 500ms antar pesan hindari rate limit WA
        await new Promise((r) => setTimeout(r, 500))
      }
    } catch (err) {
      console.error(`[Reminder] Gagal kirim ke ${user.phone}:`, err)
    }
  }

  console.log(`[Reminder] Selesai, terkirim ke ${sentCount} user`)
}

// Jadwal: Setiap hari jam 09:00 WIB
export function startReminderCron() {
  cron.schedule(
    '0 9 * * *',
    async () => {
      console.log('[Reminder] Cron triggered!')
      await sendReminders()
    },
    { timezone: 'Asia/Jakarta' }
  )

  console.log('[Reminder] Cron scheduled — setiap hari 09:00 WIB')
}

export { sendReminders }
