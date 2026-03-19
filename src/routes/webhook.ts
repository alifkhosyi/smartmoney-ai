import { Hono } from 'hono'
import { sendMessage } from '../services/whatsapp/client.js'
import { parseTransaction } from '../services/ai/parser.js'
import { supabase } from '../lib/supabase.js'

const webhook = new Hono()

webhook.get('/webhook', (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified!')
    return c.text(challenge ?? '')
  }

  return c.json({ error: 'Forbidden' }, 403)
})

webhook.post('/webhook', async (c) => {
  const body = await c.req.json()

  const entry = body?.entry?.[0]
  const changes = entry?.changes?.[0]
  const message = changes?.value?.messages?.[0]

  if (message) {
    const from = message.from
    const text = message?.text?.body?.trim()

    console.log(`Message from ${from}: ${text}`)

    try {
      let { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('phone', from)
        .single()

      if (!user) {
        const { data: newUser } = await supabase
          .from('users')
          .insert({ phone: from })
          .select()
          .single()
        user = newUser

        await sendMessage(from, 'Halo! Selamat datang di *SmartMoney AI* 👋\n\nAku asisten keuanganmu. Langsung ketik transaksimu:\n- "makan siang 35rb"\n- "gajian 5jt"\n- "gopay 150rb bensin"\n\nKetik *bantuan* untuk lihat semua fitur.')
        return c.json({ status: 'ok' })
      }

      const cmd = text?.toLowerCase()

      // Command: bantuan
      if (cmd === 'bantuan' || cmd === 'help') {
        await sendMessage(from, '*SmartMoney AI - Menu Bantuan* 🤖\n\n*Catat Transaksi:*\n- "makan siang 35rb"\n- "gajian 5jt"\n- "transfer gopay 100rb"\n\n*Lihat Data:*\n- *saldo* — ringkasan keuangan\n- *riwayat* — 5 transaksi terakhir\n- *hari ini* — transaksi hari ini\n- *minggu ini* — laporan mingguan\n- *bulan ini* — laporan bulanan\n\n*Lainnya:*\n- *bantuan* — tampilkan menu ini')
        return c.json({ status: 'ok' })
      }

      // Command: saldo
      if (cmd === 'saldo' || cmd === 'balance') {
        const { data: transactions } = await supabase
          .from('transactions')
          .select('type, amount')
          .eq('user_id', user.id)

        const income = transactions?.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0) || 0
        const expense = transactions?.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0) || 0
        const balance = income - expense

        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)

        await sendMessage(from, `💰 *Ringkasan Keuangan*\n\n📈 Pemasukan: Rp ${fmt(income)}\n📉 Pengeluaran: Rp ${fmt(expense)}\n💵 Saldo: Rp ${fmt(balance)}`)
        return c.json({ status: 'ok' })
      }

      // Command: riwayat
      if (cmd === 'riwayat' || cmd === 'history') {
        const { data: transactions } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5)

        if (!transactions || transactions.length === 0) {
          await sendMessage(from, 'Belum ada transaksi. Yuk mulai catat! 📝')
          return c.json({ status: 'ok' })
        }

        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const list = transactions.map((t, i) => {
          const emoji = t.type === 'income' ? '💰' : '💸'
          return `${i + 1}. ${emoji} ${t.description} — Rp ${fmt(t.amount)}\n    🏷️ ${t.category}`
        }).join('\n\n')

        await sendMessage(from, `📋 *5 Transaksi Terakhir*\n\n${list}`)
        return c.json({ status: 'ok' })
      }

      // Command: hari ini
      if (cmd === 'hari ini' || cmd === 'today') {
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        const { data: transactions } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .gte('created_at', today.toISOString())
          .order('created_at', { ascending: false })

        if (!transactions || transactions.length === 0) {
          await sendMessage(from, 'Belum ada transaksi hari ini. Yuk catat! 📝')
          return c.json({ status: 'ok' })
        }

        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
        const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)

        const list = transactions.map(t => {
          const emoji = t.type === 'income' ? '💰' : '💸'
          return `${emoji} ${t.description} — Rp ${fmt(t.amount)}`
        }).join('\n')

        await sendMessage(from, `📅 *Transaksi Hari Ini*\n\n${list}\n\n📈 Masuk: Rp ${fmt(income)}\n📉 Keluar: Rp ${fmt(expense)}`)
        return c.json({ status: 'ok' })
      }

      // Command: minggu ini
      if (cmd === 'minggu ini' || cmd === 'weekly') {
        const weekAgo = new Date()
        weekAgo.setDate(weekAgo.getDate() - 7)

        const { data: transactions } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .gte('created_at', weekAgo.toISOString())
          .order('created_at', { ascending: false })

        if (!transactions || transactions.length === 0) {
          await sendMessage(from, 'Belum ada transaksi minggu ini. Yuk catat! 📝')
          return c.json({ status: 'ok' })
        }

        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
        const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)

        const byCategory: Record<string, number> = {}
        transactions.filter(t => t.type === 'expense').forEach(t => {
          byCategory[t.category] = (byCategory[t.category] || 0) + t.amount
        })
        const categoryList = Object.entries(byCategory)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([cat, amt]) => `  • ${cat}: Rp ${fmt(amt)}`)
          .join('\n')

        await sendMessage(from, `📊 *Laporan Minggu Ini*\n\n📈 Pemasukan: Rp ${fmt(income)}\n📉 Pengeluaran: Rp ${fmt(expense)}\n💵 Selisih: Rp ${fmt(income - expense)}\n\n*Top Pengeluaran:*\n${categoryList || '  Belum ada'}`)
        return c.json({ status: 'ok' })
      }

      // Command: bulan ini
      if (cmd === 'bulan ini' || cmd === 'monthly') {
        const now = new Date()
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)

        const { data: transactions } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .gte('created_at', firstDay.toISOString())
          .order('created_at', { ascending: false })

        if (!transactions || transactions.length === 0) {
          await sendMessage(from, 'Belum ada transaksi bulan ini. Yuk catat! 📝')
          return c.json({ status: 'ok' })
        }

        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
        const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)
        const balance = income - expense

        const byCategory: Record<string, number> = {}
        transactions.filter(t => t.type === 'expense').forEach(t => {
          byCategory[t.category] = (byCategory[t.category] || 0) + t.amount
        })
        const categoryList = Object.entries(byCategory)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([cat, amt]) => `  • ${cat}: Rp ${fmt(amt)}`)
          .join('\n')

        const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
        const monthName = months[now.getMonth()]

        await sendMessage(from, `📅 *Laporan ${monthName} ${now.getFullYear()}*\n\n📈 Pemasukan: Rp ${fmt(income)}\n📉 Pengeluaran: Rp ${fmt(expense)}\n💵 Saldo: Rp ${fmt(balance)}\n📊 Total transaksi: ${transactions.length}x\n\n*Top Pengeluaran:*\n${categoryList || '  Belum ada'}`)
        return c.json({ status: 'ok' })
      }

      // Default: AI parsing transaksi
      const parsed = await parseTransaction(text)
      console.log('Parsed:', parsed)

      if (parsed.type === 'unknown' || parsed.amount === 0) {
        await sendMessage(from, 'Hmm, aku kurang paham. Coba ketik:\n- "makan 25rb"\n- "gaji 5jt"\n- "bensin gopay 50rb"\n\nAtau ketik *bantuan* untuk lihat menu.')
        return c.json({ status: 'ok' })
      }

      await supabase.from('transactions').insert({
        user_id: user.id,
        type: parsed.type,
        amount: parsed.amount,
        category: parsed.category,
        description: parsed.description,
      })

      const emoji = parsed.type === 'income' ? '💰' : '💸'
      const typeText = parsed.type === 'income' ? 'Pemasukan' : 'Pengeluaran'
      const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)

      await sendMessage(from, `${emoji} *${typeText} dicatat!*\n\n📝 ${parsed.description}\n🏷️ ${parsed.category}\n💵 Rp ${fmt(parsed.amount)}\n👛 ${parsed.wallet}`)

    } catch (err) {
      console.error('Error:', err)
      await sendMessage(from, 'Maaf, ada error. Coba lagi ya!')
    }
  }

  return c.json({ status: 'ok' })
})

export default webhook