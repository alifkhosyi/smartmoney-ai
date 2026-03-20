import cron from 'node-cron'
import { createClient } from '@supabase/supabase-js'
import { sendMessage } from './whatsapp/client.js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function formatRupiah(amount: number): string {
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(amount)
}

async function getWeeklyData(userId: string) {
  const now = new Date()
  const lastMonday = new Date(now)
  lastMonday.setDate(now.getDate() - now.getDay() - 6)
  lastMonday.setHours(0, 0, 0, 0)
  const lastSunday = new Date(lastMonday)
  lastSunday.setDate(lastMonday.getDate() + 6)
  lastSunday.setHours(23, 59, 59, 999)

  const { data } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', lastMonday.toISOString())
    .lte('created_at', lastSunday.toISOString())

  return data || []
}

async function generateInsight(name: string, totalExpense: number, totalIncome: number, topCategory: string, txCount: number): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Kamu financial advisor bot WhatsApp Indonesia yang friendly. Buat insight singkat (2-3 kalimat, max 150 karakter) untuk ${name} dengan data: pengeluaran ${formatRupiah(totalExpense)}, pemasukan ${formatRupiah(totalIncome)}, kategori terbesar ${topCategory}, ${txCount} transaksi. Bahasa santai, 1-2 emoji, 1 saran actionable.`
      }]
    })
    return response.content[0].type === 'text' ? response.content[0].text : ''
  } catch {
    return '💡 Tetap semangat catat keuangan ya!'
  }
}

async function sendWeeklyReport(user: any) {
  const transactions = await getWeeklyData(user.id)
  if (transactions.length === 0) return

  const expenses = transactions.filter(t => t.type === 'expense')
  const incomes = transactions.filter(t => t.type === 'income')
  const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0)
  const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0)
  const balance = totalIncome - totalExpense

  const categoryMap: Record<string, number> = {}
  expenses.forEach(t => { categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount })
  const top3 = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const topCategory = top3[0]?.[0] || 'Lainnya'
  const top3Text = top3.map(([cat, amt]) => `  • ${cat}: ${formatRupiah(amt)}`).join('\n')

  const balanceEmoji = balance >= 0 ? '📈' : '📉'
  const balanceText = balance >= 0 ? `+${formatRupiah(balance)} (surplus)` : `${formatRupiah(balance)} (defisit)`
  const insight = await generateInsight(user.name || 'Sobat', totalExpense, totalIncome, topCategory, transactions.length)

  const report =
    `📊 *Laporan Minggu Lalu*\n` +
    `Halo ${user.name || 'Sobat'}! Ini rekap keuangan kamu 👇\n\n` +
    `💸 *Pengeluaran:* ${formatRupiah(totalExpense)}\n` +
    `💰 *Pemasukan:* ${formatRupiah(totalIncome)}\n` +
    `${balanceEmoji} *Selisih:* ${balanceText}\n\n` +
    `🏷️ *Top Kategori:*\n${top3Text || '  (belum ada data)'}\n\n` +
    `📝 *Total transaksi:* ${transactions.length}x\n\n` +
    `💡 *AI Insight:*\n${insight}\n\n` +
    `_Ketik *bantuan* untuk lihat menu lengkap_ 📱`

  await sendMessage(user.phone, report)
}

export async function sendWeeklyReportToAll() {
  console.log('[WeeklyReport] Mulai kirim laporan...')
  const { data: users, error } = await supabase.from('users').select('id, phone, name').not('phone', 'is', null)
  if (error || !users) { console.error('[WeeklyReport] Gagal ambil users:', error); return }

  for (const user of users) {
    try {
      await sendWeeklyReport(user)
      await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.error(`[WeeklyReport] Gagal kirim ke ${user.phone}:`, err)
    }
  }
  console.log('[WeeklyReport] Selesai!')
}

export function startWeeklyCron() {
  cron.schedule('0 1 * * 1', async () => {
    console.log('[WeeklyReport] Cron triggered!')
    await sendWeeklyReportToAll()
  }, { timezone: 'Asia/Jakarta' })
  console.log('[WeeklyReport] Cron scheduled — Senin 08:00 WIB')
}
