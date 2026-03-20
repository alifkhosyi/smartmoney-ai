import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const XP_REWARDS = {
  transaction: 10,
  transaction_bonus_3x: 25,
  ocr_scan: 15,
  set_budget: 20,
  goal_achieved: 100,
  streak_7days: 50,
  streak_30days: 200,
  weekly_challenge: 75,
}

export const LEVELS = [
  { level: 1, name: '🌱 Pemula',           minXp: 0 },
  { level: 2, name: '📈 Pencatat',         minXp: 200 },
  { level: 3, name: '💡 Sadar Finansial',  minXp: 500 },
  { level: 4, name: '🎯 Terencana',        minXp: 1000 },
  { level: 5, name: '💪 Disiplin',         minXp: 2000 },
  { level: 6, name: '🏆 Ahli Finansial',   minXp: 5000 },
  { level: 7, name: '👑 Master Finansial', minXp: 10000 },
]

export function getLevelFromXp(xp: number) {
  let current = LEVELS[0]
  for (const l of LEVELS) {
    if (xp >= l.minXp) current = l
  }
  const nextLevel = LEVELS.find(l => l.level === current.level + 1)
  const xpToNext = nextLevel ? nextLevel.minXp - xp : 0
  return { current, nextLevel, xpToNext }
}

export interface XpResult {
  xpGained: number
  totalXp: number
  leveledUp: boolean
  oldLevel: number
  newLevel: number
  levelName: string
  milestone: string | null
  xpToNext: number
  nextLevelName: string | null
}

export async function addXp(userId: string, type: keyof typeof XP_REWARDS, customXp?: number): Promise<XpResult> {
  const xpGained = customXp ?? XP_REWARDS[type]

  // Ambil XP dan level sekarang
  const { data: user } = await supabase
    .from('users')
    .select('xp, level')
    .eq('id', userId)
    .single()

  const oldXp = user?.xp || 0
  const oldLevel = user?.level || 1
  const newXp = oldXp + xpGained

  // Hitung level baru
  const { current: newLevelData, nextLevel, xpToNext } = getLevelFromXp(newXp)
  const newLevel = newLevelData.level
  const leveledUp = newLevel > oldLevel

  // Update ke DB
  await supabase
    .from('users')
    .update({ xp: newXp, level: newLevel })
    .eq('id', userId)

  // Cek milestone
  let milestone: string | null = null
  if (newXp >= 1000 && oldXp < 1000) milestone = '🎊 Milestone: 1.000 XP tercapai!'
  if (newXp >= 5000 && oldXp < 5000) milestone = '🎊 Milestone: 5.000 XP tercapai!'
  if (newXp >= 10000 && oldXp < 10000) milestone = '🎊 Milestone: 10.000 XP tercapai! Kamu Master Finansial!'

  return {
    xpGained,
    totalXp: newXp,
    leveledUp,
    oldLevel,
    newLevel,
    levelName: newLevelData.name,
    milestone,
    xpToNext,
    nextLevelName: nextLevel?.name || null,
  }
}

export function formatXpMessage(result: XpResult): string {
  let msg = `\n⚡ *+${result.xpGained} XP* (Total: ${result.totalXp} XP)`

  if (result.leveledUp) {
    msg += `\n\n🎉 *LEVEL UP!* Kamu sekarang ${result.levelName}!`
  }

  if (result.nextLevelName && result.xpToNext > 0) {
    msg += `\n📊 ${result.xpToNext} XP lagi ke ${result.nextLevelName}`
  }

  if (result.milestone) {
    msg += `\n\n${result.milestone}`
  }

  return msg
}

// Cek bonus 3x transaksi hari ini
export async function checkDailyBonus(userId: string): Promise<boolean> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', today.toISOString())

  return (count || 0) === 3 // Tepat 3 = trigger bonus
}

// Update weekly challenge progress
export async function updateWeeklyChallenge(userId: string, type: string): Promise<{ completed: boolean; xpReward: number } | null> {
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay() + 1)
  weekStart.setHours(0, 0, 0, 0)
  const weekStartStr = weekStart.toISOString().split('T')[0]

  const { data: challenge } = await supabase
    .from('weekly_challenges')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStartStr)
    .eq('challenge_type', type)
    .single()

  if (!challenge || challenge.completed) return null

  const newProgress = challenge.progress + 1
  const completed = newProgress >= challenge.target

  await supabase
    .from('weekly_challenges')
    .update({ progress: newProgress, completed })
    .eq('id', challenge.id)

  if (completed) return { completed: true, xpReward: challenge.xp_reward }
  return null
}

// Inisialisasi weekly challenges untuk user (dipanggil tiap Senin)
export async function initWeeklyChallenges(userId: string) {
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay() + 1)
  weekStart.setHours(0, 0, 0, 0)
  const weekStartStr = weekStart.toISOString().split('T')[0]

  const challenges = [
    { challenge_type: 'transactions_5', target: 5, xp_reward: 50 },
    { challenge_type: 'daily_streak', target: 7, xp_reward: 100 },
    { challenge_type: 'budget_check', target: 3, xp_reward: 75 },
  ]

  for (const c of challenges) {
    await supabase.from('weekly_challenges').upsert(
      { user_id: userId, week_start: weekStartStr, ...c },
      { onConflict: 'user_id,week_start,challenge_type' }
    )
  }
}
