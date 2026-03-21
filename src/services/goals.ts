import { createClient } from '@supabase/supabase-js'
import { sendMessage } from './whatsapp/client.js'
import { addXp, formatXpMessage } from './xp.js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)

function getWeeksUntil(deadline: Date): number {
  const now = new Date()
  const diff = deadline.getTime() - now.getTime()
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24 * 7)))
}

function getProgressBar(current: number, target: number): string {
  const pct = Math.min(100, Math.round((current / target) * 100))
  const filled = Math.round(pct / 10)
  const empty = 10 - filled
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}%`
}

function detectEmoji(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('liburan') || lower.includes('travel') || lower.includes('bali') || lower.includes('jalan')) return '✈️'
  if (lower.includes('rumah') || lower.includes('kpr') || lower.includes('apartemen')) return '🏠'
  if (lower.includes('motor') || lower.includes('mobil') || lower.includes('kendaraan')) return '🚗'
  if (lower.includes('nikah') || lower.includes('wedding') || lower.includes('pernikahan')) return '💍'
  if (lower.includes('hp') || lower.includes('laptop') || lower.includes('gadget') || lower.includes('elektronik')) return '📱'
  if (lower.includes('darurat') || lower.includes('emergency')) return '🛡️'
  if (lower.includes('investasi') || lower.includes('saham')) return '📈'
  if (lower.includes('pendidikan') || lower.includes('kuliah') || lower.includes('sekolah')) return '🎓'
  return '🎯'
}

export async function createGoal(
  userId: string,
  name: string,
  targetAmount: number,
  deadlineDate: Date,
  plan: string
): Promise<string> {
  // Cek limit goal berdasarkan plan
  const { count } = await supabase
    .from('goals')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('completed', false)

  const activeGoals = count || 0
  const maxGoals = plan === 'business' ? Infinity : plan === 'personal' ? 3 : 0

  if (maxGoals === 0) {
    return `🎯 Fitur Goals hanya tersedia di plan berbayar.\n\n⭐ *Upgrade ke Personal* untuk buat hingga 3 goals\nHanya Rp 29.000/bulan\n\nKetik *upgrade* untuk info lebih lanjut.`
  }

  if (activeGoals >= maxGoals) {
    return `⚠️ Kamu sudah punya ${activeGoals} goal aktif (maks ${maxGoals} untuk plan ${plan}).\n\nSelesaikan atau hapus goal yang ada dulu, atau upgrade ke Business untuk goals unlimited.\n\nKetik *goals* untuk lihat goal kamu.`
  }

  const emoji = detectEmoji(name)
  const weeksLeft = getWeeksUntil(deadlineDate)
  const weeklyTarget = Math.ceil(targetAmount / weeksLeft)

  await supabase.from('goals').insert({
    user_id: userId,
    name,
    target_amount: targetAmount,
    current_amount: 0,
    deadline: deadlineDate.toISOString().split('T')[0],
    emoji,
  })

  const deadlineStr = deadlineDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    `${emoji} *Goal berhasil dibuat!*\n\n` +
    `📌 ${name}\n` +
    `💰 Target: Rp ${fmt(targetAmount)}\n` +
    `📅 Deadline: ${deadlineStr}\n` +
    `📆 Sisa waktu: ${weeksLeft} minggu\n` +
    `💡 Nabung per minggu: Rp ${fmt(weeklyTarget)}\n\n` +
    `Untuk tambah tabungan, ketik:\n_"nabung ${name.toLowerCase()} 100rb"_`
  )
}

export async function addToGoal(
  userId: string,
  goalKeyword: string,
  amount: number
): Promise<string> {
  // Cari goal yang namanya mirip keyword
  const { data: goals } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .eq('completed', false)

  if (!goals || goals.length === 0) {
    return `Belum ada goal aktif. Buat dulu dengan:\n_"nabung liburan bali 5jt dalam 3 bulan"_`
  }

  const matched = goals.find(g =>
    g.name.toLowerCase().includes(goalKeyword.toLowerCase()) ||
    goalKeyword.toLowerCase().includes(g.name.toLowerCase().split(' ')[0])
  ) || goals[0]

  const newAmount = matched.current_amount + amount
  const completed = newAmount >= matched.target_amount

  await supabase
    .from('goals')
    .update({ current_amount: newAmount, completed })
    .eq('id', matched.id)

  const progress = getProgressBar(newAmount, matched.target_amount)
  const remaining = Math.max(0, matched.target_amount - newAmount)
  const weeksLeft = getWeeksUntil(new Date(matched.deadline))
  const weeklyNeeded = remaining > 0 ? Math.ceil(remaining / weeksLeft) : 0

  if (completed) {
    return (
      `🎉 *GOAL TERCAPAI!*\n\n` +
      `${matched.emoji} ${matched.name}\n` +
      `✅ Terkumpul: Rp ${fmt(newAmount)} / Rp ${fmt(matched.target_amount)}\n\n` +
      `Selamat! Kamu berhasil mencapai goal ini! 🏆\n\n` +
      `Ketik *share* untuk bagikan pencapaian ini ke story! 📸`
    )
  }

  return (
    `${matched.emoji} *${matched.name}*\n\n` +
    `+Rp ${fmt(amount)} ditabung!\n\n` +
    `${progress}\n` +
    `Terkumpul: Rp ${fmt(newAmount)} / Rp ${fmt(matched.target_amount)}\n` +
    `Sisa: Rp ${fmt(remaining)}\n` +
    `💡 Nabung Rp ${fmt(weeklyNeeded)}/minggu lagi untuk tepat waktu`
  )
}

export async function listGoals(userId: string): Promise<string> {
  const { data: goals } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .eq('completed', false)
    .order('created_at', { ascending: true })

  if (!goals || goals.length === 0) {
    return (
      `🎯 *Goals Kamu*\n\nBelum ada goal aktif.\n\n` +
      `Buat goal pertamamu:\n_"nabung liburan bali 5jt dalam 3 bulan"_\n_"nabung darurat 10jt dalam 6 bulan"_`
    )
  }

  const goalList = goals.map(g => {
    const progress = getProgressBar(g.current_amount, g.target_amount)
    const remaining = Math.max(0, g.target_amount - g.current_amount)
    const deadlineStr = new Date(g.deadline).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })
    return (
      `${g.emoji} *${g.name}*\n` +
      `${progress}\n` +
      `Rp ${fmt(g.current_amount)} / Rp ${fmt(g.target_amount)}\n` +
      `📅 Deadline: ${deadlineStr} | Sisa: Rp ${fmt(remaining)}`
    )
  }).join('\n\n')

  return `🎯 *Goals Kamu*\n\n${goalList}\n\nKetik _"nabung [nama goal] [jumlah]"_ untuk menabung`
}

// Parse command goal dari teks natural
export function parseGoalCommand(text: string): {
  type: 'create' | 'add' | 'list' | null
  name?: string
  amount?: number
  deadline?: Date
  keyword?: string
} {
  const lower = text.toLowerCase().trim()

  // List goals
  if (lower === 'goals' || lower === 'goal' || lower === 'tabungan') {
    return { type: 'list' }
  }

  // Tambah ke goal: "nabung bali 100rb" atau "tabung darurat 500rb"
  const addMatch = lower.match(/^(?:nabung|tabung|setor)\s+(.+?)\s+([\d,.]+\s*(?:rb|ribu|jt|juta|k)?)$/i)
  if (addMatch) {
    const keyword = addMatch[1].trim()
    const amountStr = addMatch[2].toLowerCase()
    let amount = 0
    if (amountStr.includes('jt') || amountStr.includes('juta')) amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000000
    else if (amountStr.includes('rb') || amountStr.includes('ribu') || amountStr.includes('k')) amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000
    else amount = parseFloat(amountStr.replace(/[^\d.]/g, ''))

    if (amount > 0) return { type: 'add', keyword, amount }
  }

  // Buat goal: "nabung liburan bali 5jt dalam 3 bulan"
  const createMatch = lower.match(/^(?:nabung|goal|target|mau nabung)\s+(.+?)\s+([\d,.]+\s*(?:rb|ribu|jt|juta|k)?)\s+(?:dalam|selama)\s+(\d+)\s+(bulan|minggu|tahun)$/i)
  if (createMatch) {
    const name = createMatch[1].trim()
    const amountStr = createMatch[2].toLowerCase()
    let amount = 0
    if (amountStr.includes('jt') || amountStr.includes('juta')) amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000000
    else if (amountStr.includes('rb') || amountStr.includes('ribu') || amountStr.includes('k')) amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000
    else amount = parseFloat(amountStr.replace(/[^\d.]/g, ''))

    const duration = parseInt(createMatch[3])
    const unit = createMatch[4]
    const deadline = new Date()
    if (unit === 'bulan') deadline.setMonth(deadline.getMonth() + duration)
    else if (unit === 'minggu') deadline.setDate(deadline.getDate() + duration * 7)
    else if (unit === 'tahun') deadline.setFullYear(deadline.getFullYear() + duration)

    if (amount > 0) return { type: 'create', name, amount, deadline }
  }

  return { type: null }
}
