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

export interface ParseResult {
  transactions: ParsedTransaction[]
  isMultiple: boolean
}

export async function parseTransaction(text: string): Promise<ParsedTransaction> {
  const result = await parseTransactions(text)
  return result.transactions[0] || {
    type: 'unknown', amount: 0, category: 'lainnya', description: text, wallet: 'cash'
  }
}

export async function parseTransactions(text: string): Promise<ParseResult> {
  try {
    console.log('Calling Claude API (multi-parser)...')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Kamu adalah AI parser transaksi keuangan Indonesia. Parse pesan berikut.

Pesan: "${text}"

Pesan bisa berisi SATU atau BEBERAPA transaksi sekaligus.
Contoh multi: "beli kopi 15rb, bensin 50rb, makan siang 25rb"
Contoh single: "gaji bulan ini 5jt"

Balas HANYA dengan JSON ini (tanpa penjelasan apapun):
{
  "transactions": [
    {
      "type": "income|expense|transfer|unknown",
      "amount": angka_tanpa_titik_koma,
      "category": "kategori",
      "description": "deskripsi singkat",
      "wallet": "cash|gopay|ovo|bca|bri|mandiri|other"
    }
  ]
}

Aturan:
- Deteksi semua transaksi dalam pesan, bisa 1 atau lebih
- type income: gaji, dapat uang, transfer masuk, terima
- type expense: beli, makan, bayar, jajan, keluar uang
- amount: konversi rb/ribu/k=x1000, jt/juta=x1000000
- category expense: Makanan, Transport, Belanja, Hiburan, Tagihan, Kesehatan, Lainnya
- category income: Gaji, Freelance, Bisnis, Investasi, Lainnya
- wallet: tebak dari konteks (gopay/ovo/dana/bca dll), default cash
- Kalau pesan tidak ada transaksi sama sekali, return type unknown amount 0`
        }
      ]
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''
    console.log('Raw AI response:', raw)

    const cleaned = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    const transactions: ParsedTransaction[] = parsed.transactions || []
    const validTransactions = transactions.filter(t => t.type !== 'unknown' && t.amount > 0)

    console.log('Parsed transactions:', validTransactions)

    return {
      transactions: validTransactions.length > 0 ? validTransactions : [{
        type: 'unknown', amount: 0, category: 'lainnya', description: text, wallet: 'cash'
      }],
      isMultiple: validTransactions.length > 1
    }

  } catch (err) {
    console.error('parseTransactions error:', err)
    return {
      transactions: [{ type: 'unknown', amount: 0, category: 'lainnya', description: text, wallet: 'cash' }],
      isMultiple: false
    }
  }
}

export async function generateInsight(
  latestTransaction: { description: string; amount: number; category: string; type: string },
  recentTransactions: { type: string; amount: number; category: string; description: string; created_at: string }[],
  userName?: string
): Promise<string> {
  try {
    const summary = recentTransactions
      .slice(0, 10)
      .map(t => `${t.type === 'income' ? '+' : '-'}${t.amount} (${t.category}: ${t.description})`)
      .join('\n')

    const nama = userName ? userName : 'kamu'

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Kamu adalah SmartMoney AI, financial advisor pribadi yang hangat, cerdas, dan peduli seperti sahabat terpercaya. Gaya bicara: santai tapi profesional, seperti BCA Prioritas banker yang kenal nasabahnya secara personal.

Nama user: ${nama}
Transaksi terbaru: ${latestTransaction.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} "${latestTransaction.description}" Rp ${latestTransaction.amount}
Kategori: ${latestTransaction.category}

10 transaksi terakhir:
${summary}

Tulis insight 1-2 kalimat yang:
- Personal dan spesifik (mention pola atau kebiasaan yang terlihat)
- Actionable (ada saran konkret)
- Hangat dan supportif (bukan menghakimi)
- Sesekali sebut nama ${nama} kalau terasa natural
- Bahasa Indonesia santai, boleh pakai 1 emoji yang relevan
- JANGAN sebut angka yang sudah ada di pesan utama
- Langsung ke insight, tanpa sapaan atau pembuka`
        }
      ]
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''
    return raw.trim()
  } catch {
    return ''
  }
}
