import { createCanvas } from 'canvas'
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
  if (amount >= 1000000000) return `Rp ${(amount / 1000000000).toFixed(1)} M`
  if (amount >= 1000000) return `Rp ${(amount / 1000000).toFixed(1)} jt`
  if (amount >= 1000) return `Rp ${(amount / 1000).toFixed(0)} rb`
  return `Rp ${amount}`
}

function wrapText(ctx: any, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

export async function generateShareCard(data: ShareCardData): Promise<string> {
  const W = 1080
  const H = 1920
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  // ── Background solid (no gradient, more reliable) ──
  const bgMap: Record<ShareCardType, string> = {
    monthly_save:  '#1a1a2e',
    streak:        '#16213e',
    level_up:      '#1a0533',
    goal_achieved: '#0d2818',
  }
  const accentMap: Record<ShareCardType, string> = {
    monthly_save:  '#FFD700',
    streak:        '#FF6B35',
    level_up:      '#C084FC',
    goal_achieved: '#4ADE80',
  }

  const bg = bgMap[data.type]
  const accent = accentMap[data.type]

  // Background
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Top accent bar
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, W, 12)

  // Bottom accent bar
  ctx.fillRect(0, H - 12, W, 12)

  // Big circle decoration
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.06
  ctx.beginPath()
  ctx.arc(W * 0.85, H * 0.18, 380, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(W * 0.1, H * 0.82, 300, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // ── Brand name ──
  ctx.fillStyle = '#ffffff'
  ctx.globalAlpha = 0.5
  ctx.font = 'bold 36px Arial'
  ctx.textAlign = 'left'
  ctx.fillText('SmartMoney AI', 80, 100)
  ctx.globalAlpha = 1

  // ── Horizontal divider ──
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.3
  ctx.fillRect(80, 120, 920, 2)
  ctx.globalAlpha = 1

  // ── Main type label ──
  const typeLabel: Record<ShareCardType, string> = {
    monthly_save:  'LAPORAN BULANAN',
    streak:        'STREAK KONSISTEN',
    level_up:      'LEVEL UP!',
    goal_achieved: 'GOAL TERCAPAI!',
  }

  ctx.fillStyle = accent
  ctx.font = 'bold 52px Arial'
  ctx.textAlign = 'center'
  ctx.fillText(typeLabel[data.type], W / 2, 260)

  // ── Main value ──
  ctx.fillStyle = '#ffffff'
  if (data.type === 'monthly_save' && data.value !== undefined) {
    ctx.font = 'bold 110px Arial'
    ctx.fillStyle = accent
    ctx.fillText(formatRupiah(data.value), W / 2, 520)
    ctx.font = 'bold 52px Arial'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('berhasil dihemat!', W / 2, 620)

  } else if (data.type === 'streak' && data.streak !== undefined) {
    ctx.font = 'bold 280px Arial'
    ctx.fillStyle = accent
    ctx.fillText(`${data.streak}`, W / 2, 620)
    ctx.font = 'bold 56px Arial'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('hari berturut-turut!', W / 2, 720)

  } else if (data.type === 'level_up' && data.levelName) {
    const cleanLevel = data.levelName.replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim()
    ctx.font = 'bold 100px Arial'
    ctx.fillStyle = accent
    ctx.fillText('NAIK LEVEL!', W / 2, 480)
    ctx.font = 'bold 72px Arial'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(cleanLevel, W / 2, 600)

  } else if (data.type === 'goal_achieved' && data.value !== undefined) {
    ctx.font = 'bold 96px Arial'
    ctx.fillStyle = accent
    ctx.fillText(formatRupiah(data.value), W / 2, 500)
    if (data.goalName) {
      ctx.font = 'bold 52px Arial'
      ctx.fillStyle = '#ffffff'
      const lines = wrapText(ctx, data.goalName, 800)
      lines.forEach((line, i) => ctx.fillText(line, W / 2, 600 + i * 70))
    }
  }

  // ── User name ──
  const cleanName = (data.name || 'Sobat').replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim()
  ctx.font = 'bold 48px Arial'
  ctx.fillStyle = '#ffffff'
  ctx.globalAlpha = 0.7
  ctx.fillText(cleanName, W / 2, 860)
  ctx.globalAlpha = 1

  // ── Divider ──
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.2
  ctx.fillRect(200, 910, 680, 2)
  ctx.globalAlpha = 1

  // ── Quote ──
  const quotes: Record<ShareCardType, string> = {
    monthly_save:  'Konsistensi adalah kunci kebebasan finansial',
    streak:        'Kebiasaan kecil membawa dampak besar',
    level_up:      'Setiap langkah membawa lebih dekat ke tujuan',
    goal_achieved: 'Mimpi yang direncanakan menjadi kenyataan',
  }
  ctx.font = 'italic 38px Arial'
  ctx.fillStyle = '#ffffff'
  ctx.globalAlpha = 0.45
  const quoteLines = wrapText(ctx, `"${quotes[data.type]}"`, 820)
  quoteLines.forEach((line, i) => ctx.fillText(line, W / 2, 980 + i * 55))
  ctx.globalAlpha = 1

  // ── CTA Box ──
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.12
  ctx.beginPath()
  ctx.roundRect(100, 1680, 880, 160, [20])
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 38px Arial'
  ctx.fillText('Kelola keuangan via WhatsApp', W / 2, 1748)
  ctx.font = '32px Arial'
  ctx.globalAlpha = 0.6
  ctx.fillText('SmartMoney AI - Gratis untuk dicoba!', W / 2, 1800)
  ctx.globalAlpha = 1

  // Save
  const tmpPath = path.join(os.tmpdir(), `share_${Date.now()}.png`)
  fs.writeFileSync(tmpPath, canvas.toBuffer('image/png'))
  return tmpPath
}
