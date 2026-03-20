import { Hono } from 'hono'
import { sendMessage, markAsRead } from '../services/whatsapp/client.js'
import { parseTransaction, generateInsight } from '../services/ai/parser.js'
import { supabase } from '../lib/supabase.js'
import { updateStreak, getProfile } from '../services/gamification.js'
import { createPaymentLink } from '../services/midtrans.js'
import { handleOnboarding, isOnboarding } from '../services/onboarding.js'

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

// Midtrans payment notification webhook
webhook.post('/payment-notification', async (c) => {
  const body = await c.req.json()
  console.log('Payment notification:', body)

  const orderId = body.order_id
  const transactionStatus = body.transaction_status
  const fraudStatus = body.fraud_status

  if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
    if (fraudStatus === 'accept' || transactionStatus === 'settlement') {
      // Extract userId from orderId format: smartmoney-{userId}-{timestamp}
      const parts = orderId.split('-')
      const userId = parts[1]

      if (userId) {
        // Update user to premium
        const premiumUntil = new Date()
        premiumUntil.setMonth(premiumUntil.getMonth() + 1)

        await supabase
          .from('users')
          .update({
            is_premium: true,
            premium_until: premiumUntil.toISOString()
          })
          .eq('id', userId)

        // Get user phone and notify
        const { data: user } = await supabase
          .from('users')
          .select('phone')
          .eq('id', userId)
          .single()

        if (user) {
          await sendMessage(
            user.phone,
            `🌟 *Selamat! Kamu sekarang Premium!*\n\n✅ Akses semua fitur premium aktif\n📅 Berlaku hingga: ${premiumUntil.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}\n\nKetik *laporan* untuk generate PDF report pertamamu! 🎉`
          )
        }
      }
    }
  }

  return c.json({ status: 'ok' })
})

webhook.post('/webhook', async (c) => {
  const body = await c.req.json()

  const entry = body?.entry?.[0]
  const changes = entry?.changes?.[0]
  const message = changes?.value?.messages?.[0]

  if (message) {
    const from = message.from
    const msgType = message?.type

    // Handle interactive button/list replies
    let text = ''
    let buttonId: string | undefined = undefined

    if (msgType === 'interactive') {
      const interactive = message?.interactive
      if (interactive?.type === 'button_reply') {
        buttonId = interactive.button_reply?.id
        text = interactive.button_reply?.title || ''
      } else if (interactive?.type === 'list_reply') {
        buttonId = interactive.list_reply?.id
        text = interactive.list_reply?.title || ''
      }
    } else {
      text = message?.text?.body?.trim() || ''
    }

    console.log(`Message from ${from}: ${text} (buttonId: ${buttonId})`)
    markAsRead(message.id).catch(() => {})

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

        // Trigger onboarding step 0 for new user
        await handleOnboarding(user, text, from, buttonId)
        return c.json({ status: 'ok' })
      }

      // Handle onboarding for existing user not finished yet
      if (isOnboarding(user)) {
        const handled = await handleOnboarding(user, text, from, buttonId)
        if (handled) return c.json({ status: 'ok' })
        // If not handled (step 4 = first transaction), continue to parse
      }

      const cmd = text?.toLowerCase()

      // Command: bantuan
      if (cmd === 'bantuan' || cmd === 'help') {
        const premiumInfo = user.is_premium
          ? '\n⭐ *Status: Premium* — Ketik *laporan* untuk PDF report'
          : '\n\n💎 *Upgrade Premium* — Ketik *upgrade* untuk fitur lengkap (Rp 29.000/bulan)'

        await sendMessage(from, `*SmartMoney AI - Menu Bantuan* 🤖\n\n*Catat Transaksi:*\n- "makan siang 35rb"\n- "gajian 5jt"\n- "transfer gopay 100rb"\n\n*Lihat Data:*\n- *saldo* — ringkasan keuangan\n- *riwayat* — 5 transaksi terakhir\n- *hari ini* — transaksi hari ini\n- *minggu ini* — laporan mingguan\n- *bulan ini* — laporan bulanan\n- *budget* — lihat semua budget\n- *profil* — streak & badge kamu\n\n*Set Budget:*\n- "budget makan 500rb"\n- "budget transport 300rb"\n\n*Lainnya:*\n- *bantuan* — tampilkan menu ini${premiumInfo}`)
        return c.json({ status: 'ok' })
      }

      // Command: laporan (Google Sheets)
      if (cmd === 'laporan' || cmd === 'sheet' || cmd === 'spreadsheet') {

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
