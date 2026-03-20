import { createCanvas, registerFont } from 'canvas'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export type ShareCardType = 'monthly_save' | 'streak' | 'level_up' | 'goal_achieved'

export interface ShareCardData {
  type: ShareCardType
  name: string
  value?: number
  streak?: number
  levelName?: string
  goalName?: string
  month?: string
}

function formatRupiah(amount: number): string {
  if (amount >= 1000000) return `Rp ${(amount / 1000000).toFixed(1)}jt`
  if (amount >= 1000) return `Rp ${(amount / 1000).toFixed(0)}rb`
  return `Rp ${amount}`
}

export async function generateShareCard(data: ShareCardData): Promise<string> {
  const width = 1080
  const height = 1920
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // Background gradient
  const bgColors: Record<ShareCardType, string[]> = {
    monthly_save:  ['#0F2027', '#203A43', '#2C5364'],
    streak:        ['#1A1A2E', '#16213E', '#0F3460'],
    level_up:      ['#1A0533', '#2D1B69', '#4A2080'],
    goal_achieved: ['#0D1F0D', '#1A3A1A', '#2D5A2D'],
  }

  const [c1, c2, c3] = bgColors[data.type]
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, c1)
  gradient.addColorStop(0.5, c2)
  gradient.addColorStop(1, c3)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // Decorative circles
  ctx.globalAlpha = 0.08
  ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.arc(900, 200, 300, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(100, 1700, 250, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(540, 960, 400, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1

  // Top branding
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.roundRect(60, 80, 320, 60, 30)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('SmartMoney AI', 220, 120)

  // Main emoji
  const emojis: Record<ShareCardType, string> = {
    monthly_save:  '💰',
    streak:        '🔥',
    level_up:      '⚡',
    goal_achieved: '🏆',
  }
  ctx.font = '180px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(emojis[data.type], width / 2, 560)

  // Main value
  ctx.fillStyle = '#ffffff'
  if (data.type === 'monthly_save' && data.value !== undefined) {
    ctx.font = 'bold 96px sans-serif'
    ctx.fillText(formatRupiah(data.value), width / 2, 780)
    ctx.font = 'bold 48px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText('berhasil aku hemat bulan ini!', width / 2, 860)
  } else if (data.type === 'streak' && data.streak !== undefined) {
    ctx.font = 'bold 160px sans-serif'
    ctx.fillStyle = '#FFD700'
    ctx.fillText(`${data.streak}`, width / 2, 800)
    ctx.font = 'bold 52px sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('hari streak konsisten! 🔥', width / 2, 880)
  } else if (data.type === 'level_up' && data.levelName) {
    ctx.font = 'bold 56px sans-serif'
    ctx.fillStyle = '#C084FC'
    ctx.fillText('LEVEL UP!', width / 2, 740)
    ctx.font = 'bold 64px sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(data.levelName, width / 2, 840)
  } else if (data.type === 'goal_achieved' && data.goalName && data.value !== undefined) {
    ctx.font = 'bold 52px sans-serif'
    ctx.fillStyle = '#86EFAC'
    ctx.fillText('Goal tercapai!', width / 2, 720)
    ctx.font = 'bold 80px sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(formatRupiah(data.value), width / 2, 830)
    ctx.font = 'bold 44px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText(data.goalName, width / 2, 900)
  }

  // User name
  ctx.font = '40px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText(`— ${data.name}`, width / 2, 1020)

  // Motivational quote
  const quotes: Record<ShareCardType, string> = {
    monthly_save:  '"Konsistensi adalah kunci kebebasan finansial"',
    streak:        '"Kebiasaan kecil, dampak besar"',
    level_up:      '"Setiap langkah membawa lebih dekat ke tujuan"',
    goal_achieved: '"Mimpi yang direncanakan menjadi kenyataan"',
  }
  ctx.font = 'italic 34px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.fillText(quotes[data.type], width / 2, 1140)

  // CTA box
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.roundRect(120, 1280, 840, 130, 20)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 36px sans-serif'
  ctx.fillText('Kelola keuanganmu via WhatsApp', width / 2, 1340)
  ctx.font = '30px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText('SmartMoney AI • Gratis untuk dicoba', width / 2, 1390)

  // Watermark bottom
  ctx.font = '26px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fillText('smartmoney-ai-landing.vercel.app', width / 2, 1820)

  // Save to temp file
  const tmpPath = path.join(os.tmpdir(), `share_${Date.now()}.png`)
  const buffer = canvas.toBuffer('image/png')
  fs.writeFileSync(tmpPath, buffer)

  return tmpPath
}
EOFcat > ~/smartmoney-ai/src/services/shareCard.ts << 'EOF'
import { createCanvas, registerFont } from 'canvas'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export type ShareCardType = 'monthly_save' | 'streak' | 'level_up' | 'goal_achieved'

export interface ShareCardData {
  type: ShareCardType
  name: string
  value?: number
  streak?: number
  levelName?: string
  goalName?: string
  month?: string
}

function formatRupiah(amount: number): string {
  if (amount >= 1000000) return `Rp ${(amount / 1000000).toFixed(1)}jt`
  if (amount >= 1000) return `Rp ${(amount / 1000).toFixed(0)}rb`
  return `Rp ${amount}`
}

export async function generateShareCard(data: ShareCardData): Promise<string> {
  const width = 1080
  const height = 1920
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // Background gradient
  const bgColors: Record<ShareCardType, string[]> = {
    monthly_save:  ['#0F2027', '#203A43', '#2C5364'],
    streak:        ['#1A1A2E', '#16213E', '#0F3460'],
    level_up:      ['#1A0533', '#2D1B69', '#4A2080'],
    goal_achieved: ['#0D1F0D', '#1A3A1A', '#2D5A2D'],
  }

  const [c1, c2, c3] = bgColors[data.type]
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, c1)
  gradient.addColorStop(0.5, c2)
  gradient.addColorStop(1, c3)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // Decorative circles
  ctx.globalAlpha = 0.08
  ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.arc(900, 200, 300, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(100, 1700, 250, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(540, 960, 400, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1

  // Top branding
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.roundRect(60, 80, 320, 60, 30)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('SmartMoney AI', 220, 120)

  // Main emoji
  const emojis: Record<ShareCardType, string> = {
    monthly_save:  '💰',
    streak:        '🔥',
    level_up:      '⚡',
    goal_achieved: '🏆',
  }
  ctx.font = '180px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(emojis[data.type], width / 2, 560)

  // Main value
  ctx.fillStyle = '#ffffff'
  if (data.type === 'monthly_save' && data.value !== undefined) {
    ctx.font = 'bold 96px sans-serif'
    ctx.fillText(formatRupiah(data.value), width / 2, 780)
    ctx.font = 'bold 48px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText('berhasil aku hemat bulan ini!', width / 2, 860)
  } else if (data.type === 'streak' && data.streak !== undefined) {
    ctx.font = 'bold 160px sans-serif'
    ctx.fillStyle = '#FFD700'
    ctx.fillText(`${data.streak}`, width / 2, 800)
    ctx.font = 'bold 52px sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('hari streak konsisten! 🔥', width / 2, 880)
  } else if (data.type === 'level_up' && data.levelName) {
    ctx.font = 'bold 56px sans-serif'
    ctx.fillStyle = '#C084FC'
    ctx.fillText('LEVEL UP!', width / 2, 740)
    ctx.font = 'bold 64px sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(data.levelName, width / 2, 840)
  } else if (data.type === 'goal_achieved' && data.goalName && data.value !== undefined) {
    ctx.font = 'bold 52px sans-serif'
    ctx.fillStyle = '#86EFAC'
    ctx.fillText('Goal tercapai!', width / 2, 720)
    ctx.font = 'bold 80px sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(formatRupiah(data.value), width / 2, 830)
    ctx.font = 'bold 44px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText(data.goalName, width / 2, 900)
  }

  // User name
  ctx.font = '40px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText(`— ${data.name}`, width / 2, 1020)

  // Motivational quote
  const quotes: Record<ShareCardType, string> = {
    monthly_save:  '"Konsistensi adalah kunci kebebasan finansial"',
    streak:        '"Kebiasaan kecil, dampak besar"',
    level_up:      '"Setiap langkah membawa lebih dekat ke tujuan"',
    goal_achieved: '"Mimpi yang direncanakan menjadi kenyataan"',
  }
  ctx.font = 'italic 34px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.fillText(quotes[data.type], width / 2, 1140)

  // CTA box
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.roundRect(120, 1280, 840, 130, 20)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 36px sans-serif'
  ctx.fillText('Kelola keuanganmu via WhatsApp', width / 2, 1340)
  ctx.font = '30px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText('SmartMoney AI • Gratis untuk dicoba', width / 2, 1390)

  // Watermark bottom
  ctx.font = '26px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fillText('smartmoney-ai-landing.vercel.app', width / 2, 1820)

  // Save to temp file
  const tmpPath = path.join(os.tmpdir(), `share_${Date.now()}.png`)
  const buffer = canvas.toBuffer('image/png')
  fs.writeFileSync(tmpPath, buffer)

  return tmpPath
}
