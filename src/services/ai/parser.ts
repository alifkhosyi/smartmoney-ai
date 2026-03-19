import Anthropic from '@anthropic-ai/sdk'
import { config } from 'dotenv'

config()

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!
})

export interface ParsedTransaction {
  type: 'income' | 'expense' | 'transfer' | 'unknown'
  amount: number
  category: string
  description: string
  wallet: string
}

export async function parseTransaction(text: string): Promise<ParsedTransaction> {
  try {
    console.log('Calling Claude API...')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Kamu adalah AI parser transaksi keuangan Indonesia. Parse pesan berikut menjadi JSON.

Pesan: "${text}"

Balas HANYA dengan JSON ini (tanpa penjelasan apapun):
{
  "type": "income|expense|transfer|unknown",
  "amount": angka_tanpa_titik_koma,
  "category": "kategori",
  "description": "deskripsi singkat",
  "wallet": "cash|gopay|ovo|bca|bri|mandiri|other"
}

Aturan:
- type income: gaji, dapat uang, transfer masuk
- type expense: beli, makan, bayar, keluar uang
- amount: konversi rb/ribu=x1000, jt/juta=x1000000
- category expense: makan, transport, belanja, hiburan, tagihan, kesehatan, lainnya
- category income: gaji, freelance, bisnis, investasi, lainnya
- wallet: tebak dari konteks, default cash`
        }
      ]
    })

    console.log('Claude API response received')

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''
    console.log('Raw AI response:', raw)

    const cleaned = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    console.log('Parsed result:', parsed)
    return parsed

  } catch (err) {
    console.error('parseTransaction error:', err)
    return {
      type: 'unknown',
      amount: 0,
      category: 'lainnya',
      description: text,
      wallet: 'cash'
    }
  }
}

export async function generateInsight(
  latestTransaction: { description: string; amount: number; category: string; type: string },
  recentTransactions: { type: string; amount: number; category: string; description: string; created_at: string }[]
): Promise<string> {
  try {
    const summary = recentTransactions
      .slice(0, 10)
      .map(t => `${t.type === 'income' ? '+' : '-'}${t.amount} (${t.category}: ${t.description})`)
      .join('\n')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `Kamu adalah asisten keuangan. Berikan insight singkat (max 2 kalimat) dalam bahasa Indonesia berdasarkan transaksi terbaru user.

Transaksi terbaru: ${latestTransaction.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} ${latestTransaction.description} Rp ${latestTransaction.amount}

10 transaksi terakhir:
${summary}

Berikan insight yang personal, spesifik, dan actionable. Jangan sebut angka yang sudah disebutkan di pesan utama. Langsung ke poin, tanpa pembuka.`
        }
      ]
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''
    return raw.trim()
  } catch {
    return ''
  }
}