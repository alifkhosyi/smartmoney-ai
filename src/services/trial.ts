import { createClient } from '@supabase/supabase-js'
import { sendMessage, sendButtons } from './whatsapp/client.js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export function getTrialDaysLeft(trialUntil: string): number {
  const now = new Date()
  const until = new Date(trialUntil)
  const diff = until.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export function isTrialActive(user: any): boolean {
  if (user.plan === 'personal' || user.plan === 'business') return false // sudah bayar
  if (!user.trial_until) return false
  return new Date(user.trial_until) > new Date()
}

export function isTrialExpired(user: any): boolean {
  if (user.plan === 'personal' || user.plan === 'business') return false // sudah bayar
  if (!user.trial_until) return true
  return new Date(user.trial_until) <= new Date()
}

export async function sendTrialReminder(user: any, from: string) {
  const daysLeft = getTrialDaysLeft(user.trial_until)
  const name = user.name || 'Sobat'

  if (daysLeft === 2) {
    await sendMessage(from,
      `⏰ *${name}, trial kamu tinggal 2 hari lagi!*\n\n` +
      `Kamu sudah catat banyak transaksi dan insight keuanganmu mulai terlihat. Sayang kalau berhenti di sini!\n\n` +
      `Setelah trial berakhir, kamu masih bisa pakai versi gratis tapi dengan fitur terbatas:\n` +
      `❌ Riwayat hanya 30 hari\n` +
      `❌ OCR struk hanya 5x/bulan\n` +
      `❌ Budget hanya 2 kategori\n\n` +
      `Ketik *upgrade* untuk lanjut dengan semua fitur! 🚀`
    )
  } else if (daysLeft === 0) {
    await sendButtons(from,
      `🔔 *${name}, trial 14 hari kamu berakhir hari ini!*\n\n` +
      `Terima kasih sudah mencoba SmartMoney AI! Data & riwayat transaksimu tetap aman.\n\n` +
      `Mau lanjut dengan semua fitur premium?\n\n` +
      `⭐ Personal: Rp 29.000/bulan\n` +
      `👑 Business: Rp 49.000/bulan`,
      [
        { id: 'upgrade_now', title: '⭐ Upgrade Sekarang' },
        { id: 'use_free', title: '🆓 Pakai Gratis Dulu' },
      ]
    )
  }
}

export async function sendTrialExpiredMessage(from: string, name: string) {
  await sendButtons(from,
    `⏰ *Trial kamu sudah berakhir, ${name}!*\n\n` +
    `Kamu masih bisa pakai versi gratis, tapi beberapa fitur premium tidak tersedia.\n\n` +
    `Upgrade sekarang untuk:\n` +
    `✅ Riwayat unlimited\n` +
    `✅ OCR struk unlimited\n` +
    `✅ Budget & goals unlimited\n` +
    `✅ Laporan PDF\n\n` +
    `Hanya *Rp 29.000/bulan* — kurang dari segelas kopi per hari! ☕`,
    [
      { id: 'upgrade_now', title: '⭐ Upgrade Sekarang' },
      { id: 'use_free', title: '🆓 Lanjut Gratis' },
    ]
  )
}

// Cek dan kirim reminder trial (dipanggil dari cron)
export async function checkTrialReminders() {
  console.log('[Trial] Cek reminder trial...')

  const { data: users } = await supabase
    .from('users')
    .select('id, phone, name, trial_until, plan')
    .not('phone', 'is', null)
    .eq('plan', 'free')
    .not('trial_until', 'is', null)

  if (!users) return

  for (const user of users) {
    try {
      const daysLeft = getTrialDaysLeft(user.trial_until)
      if (daysLeft === 2 || daysLeft === 0) {
        await sendTrialReminder(user, user.phone)
        await new Promise(r => setTimeout(r, 500))
      }
    } catch (err) {
      console.error(`[Trial] Error untuk ${user.phone}:`, err)
    }
  }

  console.log('[Trial] Selesai cek reminder')
}
