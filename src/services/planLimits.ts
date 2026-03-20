import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export type Plan = 'free' | 'personal' | 'business'

export const PLAN_LIMITS = {
  free: {
    historyDays: 30,
    ocrPerMonth: 5,
    budgetCategories: 2,
    goals: 0,
    streakFreeze: 0,
    canExportPDF: false,
    canExportExcel: false,
    canShare: false,
    aiInsightLevel: 'basic',
    referralCommission: 10,
  },
  personal: {
    historyDays: Infinity,
    ocrPerMonth: Infinity,
    budgetCategories: Infinity,
    goals: 3,
    streakFreeze: 1,
    canExportPDF: true,
    canExportExcel: false,
    canShare: true,
    aiInsightLevel: 'deep',
    referralCommission: 20,
  },
  business: {
    historyDays: Infinity,
    ocrPerMonth: Infinity,
    budgetCategories: Infinity,
    goals: Infinity,
    streakFreeze: 3,
    canExportPDF: true,
    canExportExcel: true,
    canShare: true,
    aiInsightLevel: 'deep',
    referralCommission: 30,
  },
}

export const PLAN_PRICES = {
  free: 0,
  personal: 29000,
  business: 49000,
}

export const PLAN_NAMES = {
  free: 'Gratis',
  personal: 'Personal ⭐',
  business: 'Business 👑',
}

// Cek apakah user masih dalam batas OCR bulan ini
export async function checkOcrLimit(userId: string, plan: Plan): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = PLAN_LIMITS[plan].ocrPerMonth
  if (limit === Infinity) return { allowed: true, used: 0, limit: Infinity }

  const firstDay = new Date()
  firstDay.setDate(1)
  firstDay.setHours(0, 0, 0, 0)

  // Hitung OCR dari transactions yang punya note 'Belanja struk' atau dari struk
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', firstDay.toISOString())
    .like('description', '%struk%')

  const used = count || 0
  return { allowed: used < limit, used, limit }
}

// Cek apakah user masih bisa lihat riwayat (berdasarkan historyDays)
export function getHistoryDate(plan: Plan): Date {
  const days = PLAN_LIMITS[plan].historyDays
  if (days === Infinity) return new Date('2000-01-01')
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

// Cek berapa budget kategori yang sudah dipakai
export async function checkBudgetLimit(userId: string, plan: Plan): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = PLAN_LIMITS[plan].budgetCategories
  if (limit === Infinity) return { allowed: true, used: 0, limit: Infinity }

  const { count } = await supabase
    .from('budgets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  const used = count || 0
  return { allowed: used < limit, used, limit }
}

// Generate pesan upsell yang menarik
export function getUpsellMessage(feature: string, currentPlan: Plan): string {
  const upgradeTo = currentPlan === 'free' ? 'Personal' : 'Business'
  const price = currentPlan === 'free' ? '29.000' : '49.000'

  const messages: Record<string, string> = {
    ocr: `📸 Limit scan struk bulan ini sudah habis!\n\n⭐ *Upgrade ke ${upgradeTo}* untuk scan unlimited\nHanya Rp ${price}/bulan\n\nKetik *upgrade* untuk info lebih lanjut.`,
    history: `📊 Riwayat hanya tersedia 30 hari terakhir di plan Gratis.\n\n⭐ *Upgrade ke ${upgradeTo}* untuk riwayat unlimited + laporan lengkap\nHanya Rp ${price}/bulan\n\nKetik *upgrade* untuk info lebih lanjut.`,
    budget: `🎯 Kamu sudah pakai 2 kategori budget (batas plan Gratis).\n\n⭐ *Upgrade ke ${upgradeTo}* untuk budget kategori unlimited\nHanya Rp ${price}/bulan\n\nKetik *upgrade* untuk info lebih lanjut.`,
    export: `📄 Export laporan hanya tersedia di plan berbayar.\n\n⭐ *Upgrade ke ${upgradeTo}* untuk export PDF & Excel\nHanya Rp ${price}/bulan\n\nKetik *upgrade* untuk info lebih lanjut.`,
    goals: `🎯 Fitur Goals hanya tersedia di plan berbayar.\n\n⭐ *Upgrade ke Personal* untuk buat hingga 3 goals nabung\nHanya Rp 29.000/bulan\n\nKetik *upgrade* untuk info lebih lanjut.`,
  }

  return messages[feature] || `⭐ Fitur ini tersedia di plan ${upgradeTo}.\n\nKetik *upgrade* untuk info lebih lanjut.`
}
