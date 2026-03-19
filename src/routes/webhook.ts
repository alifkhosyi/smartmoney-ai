import { Hono } from 'hono'
import { sendMessage } from '../services/whatsapp/client.js'
import { parseTransaction, generateInsight } from '../services/ai/parser.js'
import { supabase } from '../lib/supabase.js'
import { updateStreak, getProfile } from '../services/gamification.js'

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
        await sendMessage(from, '*SmartMoney AI - Menu Bantuan* 🤖\n\n*Catat Transaksi:*\n- "makan siang 35rb"\n- "gajian 5jt"\n- "transfer gopay 100rb"\n\n*Lihat Data:*\n- *saldo* — ringkasan keuangan\n- *riwayat* — 5 transaksi terakhir\n- *hari ini* — transaksi hari ini\n- *minggu ini* — laporan mingguan\n- *bulan ini* — laporan bulanan\n- *budget* — lihat semua budget\n- *profil* — streak & badge kamu\n\n*Set Budget:*\n- "budget makan 500rb"\n- "budget transport 300rb"\n\n*Lainnya:*\n- *bantuan* — tampilkan menu ini')
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

      // Command: lihat budget
      if (cmd === 'budget') {
        const { data: budgets } = await supabase
          .from('budgets')
          .select('*')
          .eq('user_id', user.id)

        if (!budgets || budgets.length === 0) {
          await sendMessage(from, 'Belum ada budget. Set budget dengan cara:\n- "budget makan 500rb"\n- "budget transport 300rb"\n- "budget hiburan 200rb"')
          return c.json({ status: 'ok' })
        }

        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const now = new Date()
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)

        const { data: transactions } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .eq('type', 'expense')
          .gte('created_at', firstDay.toISOString())

        const list = budgets.map(b => {
          const spent = transactions?.filter(t => t.category === b.category).reduce((sum, t) => sum + t.amount, 0) || 0
          const pct = Math.round((spent / b.amount) * 100)
          const bar = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢'
          return `${bar} *${b.category}*: Rp ${fmt(spent)} / Rp ${fmt(b.amount)} (${pct}%)`
        }).join('\n')

        await sendMessage(from, `🎯 *Budget Bulan Ini*\n\n${list}\n\n🟢 Aman  🟡 Hampir habis  🔴 Melebihi`)
        return c.json({ status: 'ok' })
      }

      // Command: profil
      if (cmd === 'profil' || cmd === 'profile') {
        const profile = await getProfile(user.id)
        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)

        const badgeList = profile.badges.length > 0
          ? profile.badges.map(b => `${b.badge_emoji} ${b.badge_name}`).join('\n')
          : '  Belum ada badge. Mulai catat transaksi!'

        const streakEmoji = profile.streak >= 7 ? '🔥' : profile.streak >= 3 ? '⚡' : '✨'

        await sendMessage(from, `👤 *Profil Kamu*\n\n${streakEmoji} Streak: ${profile.streak} hari berturut-turut\n🏆 Streak terpanjang: ${profile.longestStreak} hari\n📊 Total transaksi: ${profile.totalTransactions}\n\n*Badge yang diraih:*\n${badgeList}`)
        return c.json({ status: 'ok' })
      }

      // Command: set budget (format: "budget makan 500rb")
      const budgetMatch = cmd?.match(/^budget\s+(\w+)\s+([\d,.]+\s*(?:rb|ribu|jt|juta|k)?)$/i)
      if (budgetMatch) {
        const category = budgetMatch[1].toLowerCase()
        const amountStr = budgetMatch[2].toLowerCase().trim()
        let amount = 0

        if (amountStr.includes('jt') || amountStr.includes('juta')) {
          amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000000
        } else if (amountStr.includes('rb') || amountStr.includes('ribu') || amountStr.includes('k')) {
          amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000
        } else {
          amount = parseFloat(amountStr.replace(/[^\d.]/g, ''))
        }

        if (amount > 0) {
          await supabase.from('budgets').upsert({
            user_id: user.id,
            category,
            amount,
            period: 'monthly'
          }, { onConflict: 'user_id,category,period' })

          const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
          await sendMessage(from, `✅ *Budget diset!*\n\n🏷️ Kategori: ${category}\n💵 Budget: Rp ${fmt(amount)}/bulan\n\nAku akan notif kamu kalau pengeluaran mendekati batas!`)
        } else {
          await sendMessage(from, 'Format budget salah. Coba: "budget makan 500rb"')
        }
        return c.json({ status: 'ok' })
      }

      // Default: AI parsing transaksi
      const parsed = await parseTransaction(text)
      console.log('Parsed:', parsed)

      if (parsed.type === 'unknown' || parsed.amount === 0) {
        await sendMessage(from, 'Hmm, aku kurang paham. Coba ketik:\n- "makan 25rb"\n- "gaji 5jt"\n- "bensin gopay 50rb"\n\nAtau ketik *bantuan* untuk lihat menu.')
        return c.json({ status: 'ok' })
      }

      // Simpan ke database
      await supabase.from('transactions').insert({
        user_id: user.id,
        type: parsed.type,
        amount: parsed.amount,
        category: parsed.category,
        description: parsed.description,
      })

      // Update streak & cek badge baru
      const { streak, newBadges } = await updateStreak(user.id)

      // Cek budget alert
      let budgetAlert = ''
      if (parsed.type === 'expense') {
        const now = new Date()
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)

        const { data: budget } = await supabase
          .from('budgets')
          .select('*')
          .eq('user_id', user.id)
          .eq('category', parsed.category)
          .single()

        if (budget) {
          const { data: txThisMonth } = await supabase
            .from('transactions')
            .select('amount')
            .eq('user_id', user.id)
            .eq('category', parsed.category)
            .eq('type', 'expense')
            .gte('created_at', firstDay.toISOString())

          const totalSpent = txThisMonth?.reduce((sum, t) => sum + t.amount, 0) || 0
          const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
          const pct = Math.round((totalSpent / budget.amount) * 100)

          if (pct >= 100) {
            budgetAlert = `\n\n🔴 *Budget Alert!* Pengeluaran ${parsed.category} bulan ini sudah *melebihi budget* (${pct}%)! Total: Rp ${fmt(totalSpent)} dari Rp ${fmt(budget.amount)}.`
          } else if (pct >= 80) {
            budgetAlert = `\n\n⚠️ *Budget Alert!* Pengeluaran ${parsed.category} sudah ${pct}% dari budget. Sisa Rp ${fmt(budget.amount - totalSpent)} lagi.`
          }
        }
      }

      // Badge notification
      const badgeText = newBadges.length > 0
        ? `\n\n🎉 *Badge baru!*\n${newBadges.map(b => `${b.emoji} ${b.name}`).join('\n')}`
        : ''

      // Streak text
      const streakText = streak > 1 ? `\n🔥 Streak: ${streak} hari` : ''

      // Generate AI insight
      const { data: recentTx } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10)

      const insight = await generateInsight(
        { description: parsed.description, amount: parsed.amount, category: parsed.category, type: parsed.type },
        recentTx || []
      )

      const emoji = parsed.type === 'income' ? '💰' : '💸'
      const typeText = parsed.type === 'income' ? 'Pemasukan' : 'Pengeluaran'
      const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
      const insightText = insight ? `\n\n💡 *Insight:* ${insight}` : ''

      await sendMessage(from, `${emoji} *${typeText} dicatat!*\n\n📝 ${parsed.description}\n🏷️ ${parsed.category}\n💵 Rp ${fmt(parsed.amount)}\n👛 ${parsed.wallet}${streakText}${budgetAlert}${badgeText}${insightText}`)

    } catch (err) {
      console.error('Error:', err)
      await sendMessage(from, 'Maaf, ada error. Coba lagi ya!')
    }
  }

  return c.json({ status: 'ok' })
})

export default webhook