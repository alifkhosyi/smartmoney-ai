import { supabase } from '../lib/supabase.js'

const BADGES = [
  { key: 'first_transaction', name: 'Pemula Finansial', emoji: '🌱', desc: 'Transaksi pertama' },
  { key: 'streak_3', name: 'Konsisten 3 Hari', emoji: '🔥', desc: '3 hari berturut-turut' },
  { key: 'streak_7', name: 'Seminggu Penuh', emoji: '⚡', desc: '7 hari berturut-turut' },
  { key: 'streak_30', name: 'Master Keuangan', emoji: '👑', desc: '30 hari berturut-turut' },
  { key: 'tx_10', name: 'Rajin Mencatat', emoji: '📝', desc: '10 transaksi' },
  { key: 'tx_50', name: 'Pencatat Handal', emoji: '💪', desc: '50 transaksi' },
  { key: 'tx_100', name: 'Legenda Finansial', emoji: '🏆', desc: '100 transaksi' },
  { key: 'budget_setter', name: 'Perencana Bijak', emoji: '🎯', desc: 'Set budget pertama' },
]

export async function updateStreak(userId: string): Promise<{ streak: number; newBadges: typeof BADGES }> {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  const { data: streak } = await supabase
    .from('streaks')
    .select('*')
    .eq('user_id', userId)
    .single()

  let currentStreak = 1
  let longestStreak = 1

  if (streak) {
    const lastDate = streak.last_transaction_date

    if (lastDate === today) {
      // Sudah catat hari ini, tidak perlu update
      return { streak: streak.current_streak, newBadges: [] }
    } else if (lastDate === yesterday) {
      // Lanjut streak
      currentStreak = streak.current_streak + 1
      longestStreak = Math.max(currentStreak, streak.longest_streak)
    } else {
      // Streak putus, mulai dari 1
      currentStreak = 1
      longestStreak = streak.longest_streak
    }
  }

  await supabase.from('streaks').upsert({
    user_id: userId,
    current_streak: currentStreak,
    longest_streak: longestStreak,
    last_transaction_date: today,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' })

  // Cek badge baru
  const newBadges: typeof BADGES = []

  // Cek total transaksi
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  const totalTx = count || 0

  // Badge berdasarkan jumlah transaksi
  const txBadges = [
    { count: 1, key: 'first_transaction' },
    { count: 10, key: 'tx_10' },
    { count: 50, key: 'tx_50' },
    { count: 100, key: 'tx_100' },
  ]

  for (const tb of txBadges) {
    if (totalTx >= tb.count) {
      const badge = BADGES.find(b => b.key === tb.key)!
      const { error } = await supabase.from('badges').insert({
        user_id: userId,
        badge_key: badge.key,
        badge_name: badge.name,
        badge_emoji: badge.emoji
      })
      if (!error) newBadges.push(badge)
    }
  }

  // Badge berdasarkan streak
  const streakBadges = [
    { streak: 3, key: 'streak_3' },
    { streak: 7, key: 'streak_7' },
    { streak: 30, key: 'streak_30' },
  ]

  for (const sb of streakBadges) {
    if (currentStreak >= sb.streak) {
      const badge = BADGES.find(b => b.key === sb.key)!
      const { error } = await supabase.from('badges').insert({
        user_id: userId,
        badge_key: badge.key,
        badge_name: badge.name,
        badge_emoji: badge.emoji
      })
      if (!error) newBadges.push(badge)
    }
  }

  return { streak: currentStreak, newBadges }
}

export async function getProfile(userId: string) {
  const { data: streak } = await supabase
    .from('streaks')
    .select('*')
    .eq('user_id', userId)
    .single()

  const { data: badges } = await supabase
    .from('badges')
    .select('*')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false })

  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  return {
    streak: streak?.current_streak || 0,
    longestStreak: streak?.longest_streak || 0,
    totalTransactions: count || 0,
    badges: badges || []
  }
}