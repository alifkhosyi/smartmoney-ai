import { createClient } from '@supabase/supabase-js'
import { sendMessage, sendList, sendButtons } from './whatsapp/client.js'
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

export const GOAL_TEMPLATES = [
  { id: 'goal_liburan',    emoji: '✈️', name: 'Liburan',          contoh: '5.000.000', durasi: '3 bulan' },
  { id: 'goal_rumah',      emoji: '🏠', name: 'DP Rumah',         contoh: '50.000.000', durasi: '24 bulan' },
  { id: 'goal_kendaraan',  emoji: '🚗', name: 'Kendaraan',        contoh: '10.000.000', durasi: '12 bulan' },
  { id: 'goal_nikah',      emoji: '💍', name: 'Pernikahan',       contoh: '30.000.000', durasi: '18 bulan' },
  { id: 'goal_darurat',    emoji: '🛡️', name: 'Dana Darurat',     contoh: '15.000.000', durasi: '6 bulan' },
  { id: 'goal_gadget',     emoji: '📱', name: 'Gadget/Elektronik',contoh: '3.000.000',  durasi: '3 bulan' },
  { id: 'goal_pendidikan', emoji: '🎓', name: 'Pendidikan',       contoh: '20.000.000', durasi: '12 bulan' },
  { id: 'goal_lainnya',    emoji: '🎯', name: 'Lainnya',          contoh: '5.000.000',  durasi: '6 bulan' },
]

// Tampilkan menu pilihan goal
export async function showGoalMenu(phone: string, plan: string) {
  if (plan === 'free') {
    await sendMessage(phone,
      `🎯 *Financial Goals*\n\n` +
      `Fitur Goals membantu kamu nabung dengan terarah!\n\n` +
      `⭐ *Upgrade ke Personal* untuk akses Goals\nHanya Rp 29.000/bulan\n\n` +
      `Ketik *upgrade* untuk info lebih lanjut.`
    )
    return
  }

  await sendList(
    phone,
    '🎯 Mau nabung untuk apa? Pilih tujuan kamu:',
    'Pilih Tujuan',
    [{
      title: 'Tujuan Nabung Populer',
      rows: GOAL_TEMPLATES.map(t => ({
        id: t.id,
        title: `${t.emoji} ${t.name}`,
        description: `Contoh target: Rp ${t.contoh} dalam ${t.durasi}`
      }))
    }],
    '🎯 Pilih Tujuan'
  )
}

// Handle setelah user pilih template
export async function handleGoalTemplate(phone: string, templateId: string, userId: string) {
  const template = GOAL_TEMPLATES.find(t => t.id === templateId)
  if (!template) return

  // Simpan pending action untuk tanya target & deadline
  await supabase.from('users').update({
    pending_action: {
      type: 'goal_setup',
      step: 'ask_amount',
      goal_name: template.name,
      goal_emoji: template.emoji,
    }
  }).eq('id', userId)

  await sendMessage(phone,
    `${template.emoji} *${template.name}*\n\n` +
    `Berapa target yang ingin kamu kumpulkan?\n\n` +
    `Contoh: _5jt_, _10.000.000_, _500rb_\n\n` +
    `_(Ketik nominal targetmu)_`
  )
}

// Handle input amount setelah pilih template
export async function handleGoalAmount(phone: string, text: string, userId: string, pendingAction: any) {
  const amountStr = text.toLowerCase().trim()
  let amount = 0
  if (amountStr.includes('jt') || amountStr.includes('juta')) amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000000
  else if (amountStr.includes('rb') || amountStr.includes('ribu') || amountStr.includes('k')) amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000
  else amount = parseFloat(amountStr.replace(/[^\d.]/g, ''))

  if (!amount || amount <= 0) {
    await sendMessage(phone, '❌ Nominal tidak valid. Coba lagi, contoh: _5jt_ atau _5000000_')
    return
  }

  // Update pending action dengan amount, tanya deadline
  await supabase.from('users').update({
    pending_action: {
      ...pendingAction,
      step: 'ask_deadline',
      goal_amount: amount,
    }
  }).eq('id', userId)

  await sendButtons(phone,
    `${pendingAction.goal_emoji} *${pendingAction.goal_name}*\n` +
    `Target: Rp ${fmt(amount)}\n\n` +
    `Dalam berapa lama mau tercapai?`,
    [
      { id: 'goal_dur_3', title: '3 Bulan' },
      { id: 'goal_dur_6', title: '6 Bulan' },
      { id: 'goal_dur_12', title: '12 Bulan' },
    ]
  )
}

// Handle pilihan durasi
export async function handleGoalDeadline(phone: string, buttonId: string, userId: string, pendingAction: any, plan: string) {
  const durMap: Record<string, number> = {
    'goal_dur_3': 3,
    'goal_dur_6': 6,
    'goal_dur_12': 12,
  }
  const months = durMap[buttonId]
  if (!months) return

  const deadline = new Date()
  deadline.setMonth(deadline.getMonth() + months)

  const msg = await createGoal(userId, pendingAction.goal_name, pendingAction.goal_amount, deadline, plan)

  // Clear pending action
  await supabase.from('users').update({ pending_action: null }).eq('id', userId)

  await sendMessage(phone, msg)
}

export async function createGoal(
  userId: string,
  name: string,
  targetAmount: number,
  deadlineDate: Date,
  plan: string
): Promise<string> {
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
    return `⚠️ Kamu sudah punya ${activeGoals} goal aktif (maks ${maxGoals} untuk plan ${plan}).\n\nSelesaikan atau hapus goal yang ada dulu.\n\nKetik *goals* untuk lihat goal kamu.`
  }

  const emoji = detectEmoji(name)
  const weeksLeft = getWeeksUntil(deadlineDate)
  const weeklyTarget = Math.ceil(targetAmount / weeksLeft)
  const deadlineStr = deadlineDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })

  await supabase.from('goals').insert({
    user_id: userId,
    name,
    target_amount: targetAmount,
    current_amount: 0,
    deadline: deadlineDate.toISOString().split('T')[0],
    emoji,
  })

  return (
    `${emoji} *Goal berhasil dibuat!*\n\n` +
    `📌 ${name}\n` +
    `💰 Target: Rp ${fmt(targetAmount)}\n` +
    `📅 Deadline: ${deadlineStr}\n` +
    `📆 Sisa: ${weeksLeft} minggu\n` +
    `💡 Nabung per minggu: Rp ${fmt(weeklyTarget)}\n\n` +
    `Untuk nabung, ketik:\n_"nabung ${name.toLowerCase()} 100rb"_\n\nAtau ketik *goals* untuk lihat semua goalmu 🎯`
  )
}

export async function addToGoal(userId: string, goalKeyword: string, amount: number): Promise<string> {
  const { data: goals } = await supabase
    .from('goals').select('*')
    .eq('user_id', userId).eq('completed', false)

  if (!goals || goals.length === 0) {
    return `Belum ada goal aktif. Ketik *goals* untuk buat goal pertamamu! 🎯`
  }

  const matched = goals.find(g =>
    g.name.toLowerCase().includes(goalKeyword.toLowerCase()) ||
    goalKeyword.toLowerCase().includes(g.name.toLowerCase().split(' ')[0])
  ) || goals[0]

  const newAmount = matched.current_amount + amount
  const completed = newAmount >= matched.target_amount

  await supabase.from('goals').update({ current_amount: newAmount, completed }).eq('id', matched.id)

  const progress = getProgressBar(newAmount, matched.target_amount)
  const remaining = Math.max(0, matched.target_amount - newAmount)
  const weeksLeft = getWeeksUntil(new Date(matched.deadline))
  const weeklyNeeded = remaining > 0 ? Math.ceil(remaining / weeksLeft) : 0

  if (completed) {
    return (
      `🎉 *GOAL TERCAPAI!*\n\n` +
      `${matched.emoji} ${matched.name}\n` +
      `✅ Terkumpul: Rp ${fmt(newAmount)} / Rp ${fmt(matched.target_amount)}\n\n` +
      `Selamat! Kamu berhasil! 🏆\n\n` +
      `Ketik *share* untuk bagikan ke story! 📸`
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
    .from('goals').select('*')
    .eq('user_id', userId).eq('completed', false)
    .order('created_at', { ascending: true })

  if (!goals || goals.length === 0) {
    return (
      `🎯 *Goals Kamu*\n\nBelum ada goal aktif.\n\n` +
      `Ketik *goals* lagi untuk mulai buat goal nabungmu! 💪`
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
      `📅 ${deadlineStr} | Sisa: Rp ${fmt(remaining)}`
    )
  }).join('\n\n')

  return `🎯 *Goals Kamu*\n\n${goalList}\n\nKetik _"nabung [nama goal] [jumlah]"_ untuk menabung 💰`
}

export function parseGoalCommand(text: string): {
  type: 'create' | 'add' | 'list' | null
  name?: string
  amount?: number
  deadline?: Date
  keyword?: string
} {
  const lower = text.toLowerCase().trim()

  if (lower === 'goals' || lower === 'goal' || lower === 'tabungan') {
    return { type: 'list' }
  }

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
