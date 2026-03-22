import { Hono } from 'hono'
import { sendMessage, markAsRead, sendButtons, sendList } from '../services/whatsapp/client.js'
import { parseTransaction, parseTransactions, generateInsight } from '../services/ai/parser.js'
import { supabase } from '../lib/supabase.js'
import { updateStreak, getProfile } from '../services/gamification.js'
import { createPaymentLink } from '../services/midtrans.js'
import { handleOnboarding, isOnboarding } from '../services/onboarding.js'
import { downloadWAMedia } from '../services/whatsapp/media.js'
import { parseReceiptImage } from '../services/ai/ocr.js'
import { checkOcrLimit, checkBudgetLimit, getUpsellMessage, PLAN_NAMES } from '../services/planLimits.js'
import { addXp, formatXpMessage, checkDailyBonus, updateWeeklyChallenge, initWeeklyChallenges } from '../services/xp.js'
import { generateShareCard } from '../services/shareCard.js'
import { parseGoalCommand, createGoal, addToGoal, listGoals, showGoalMenu, handleGoalTemplate, handleGoalAmount, handleGoalDeadline, GOAL_TEMPLATES } from '../services/goals.js'
import { sendImage } from '../services/whatsapp/client.js'
import * as fs from 'fs'

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

webhook.post('/payment-notification', async (c) => {
  const body = await c.req.json()
  const orderId = body.order_id
  const transactionStatus = body.transaction_status
  const fraudStatus = body.fraud_status
  if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
    if (fraudStatus === 'accept' || transactionStatus === 'settlement') {
      const parts = orderId.split('-')
      const userId = parts[1]
      const planCode = parts[2] // 'p' = personal, 'b' = business
      const plan = planCode === 'b' ? 'business' : 'personal'
      const planName = plan === 'business' ? 'Business 👑' : 'Personal ⭐'
      const planEmoji = plan === 'business' ? '👑' : '⭐'
      if (userId) {
        const premiumUntil = new Date()
        premiumUntil.setMonth(premiumUntil.getMonth() + 1)
        await supabase.from('users').update({
          is_premium: true,
          plan: plan,
          premium_until: premiumUntil.toISOString()
        }).eq('id', userId)
        const { data: user } = await supabase.from('users').select('phone').eq('id', userId).single()
        if (user) await sendMessage(user.phone,
          `${planEmoji} *Selamat! Kamu sekarang ${planName}!*\n\n` +
          `✅ Semua fitur ${planName} aktif\n` +
          `📅 Berlaku hingga: ${premiumUntil.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}\n\n` +
          `Terima kasih sudah upgrade SmartMoney AI! 🎉\n\nKetik *bantuan* untuk lihat semua fitur kamu.`
        )
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

    console.log(`Message from ${from}: ${text} (buttonId: ${buttonId}, type: ${msgType})`)
    markAsRead(message.id).catch(() => {})

    // Duplicate protection
    const { data: existing } = await supabase.from('processed_messages').select('message_id').eq('message_id', message.id).single()
    if (existing) { console.log(`Duplicate message skipped: ${message.id}`); return c.json({ status: 'ok' }) }
    await supabase.from('processed_messages').insert({ message_id: message.id })

    try {
      let { data: user } = await supabase.from('users').select('*').eq('phone', from).single()

      if (!user) {
        const { data: newUser } = await supabase.from('users').insert({ phone: from }).select().single()
        user = newUser
        await handleOnboarding(user, text, from, buttonId)
        return c.json({ status: 'ok' })
      }

      if (isOnboarding(user)) {
        const handled = await handleOnboarding(user, text, from, buttonId)
        if (handled) return c.json({ status: 'ok' })
      }

      // ── Handle image: OCR struk ──
      if (msgType === 'image') {
        const mediaId = message.image?.id
        const caption = message.image?.caption || ''

        // Cek limit OCR
      const plan = (user.plan || 'free') as 'free' | 'personal' | 'business'
      const ocrCheck = await checkOcrLimit(user.id, plan)
      if (!ocrCheck.allowed) {
        await sendMessage(from, getUpsellMessage('ocr', plan))
        return c.json({ status: 'ok' })
      }

      await sendMessage(from, '📸 Struk diterima! Sedang dianalisis... tunggu sebentar ya 🔍')

        try {
          const { base64, mimeType } = await downloadWAMedia(mediaId)
          const result = await parseReceiptImage(base64, mimeType)

          const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
          const itemList = result.items.length > 0
            ? result.items.map((i) => `  • ${i.name}: Rp ${fmt(i.price)}`).join('\n')
            : '  (item tidak terbaca)'

          const merchantText = result.merchant ? `🏪 *${result.merchant}*\n` : ''
          const dateText = result.date ? `📅 ${result.date}\n` : ''
          const confidenceEmoji = result.confidence === 'high' ? '✅' : result.confidence === 'medium' ? '⚠️' : '❓'

          const confirmMsg =
            `${confidenceEmoji} *Hasil Scan Struk*\n\n` +
            `${merchantText}${dateText}` +
            `📦 *Item:*\n${itemList}\n\n` +
            `💰 *Total: Rp ${fmt(result.total)}*\n` +
            `🏷️ Kategori: ${result.category}\n\n` +
            `Simpan transaksi ini?`

          await supabase.from('users').update({
            pending_action: {
              type: 'confirm_ocr',
              amount: result.total,
              category: result.category,
              merchant: result.merchant,
              date: result.date,
              note: caption || result.merchant || 'Belanja struk',
            }
          }).eq('phone', from)

          await sendButtons(from, confirmMsg, [
            { id: 'ocr_confirm_yes', title: '✅ Ya, Simpan' },
            { id: 'ocr_confirm_no', title: '❌ Batalkan' }
          ])
        } catch (err: any) {
          console.error('[OCR] Error:', err.message)
          if (err.message === 'Bukan struk belanja') {
            await sendMessage(from, '🤔 Gambar ini sepertinya bukan struk belanja.\n\nKirim foto nota/struk yang jelas ya!')
          } else {
            await sendMessage(from, '😅 Struk sulit dibaca.\n\nCoba foto ulang dengan:\n• Pencahayaan lebih terang\n• Posisi kamera lurus\n• Seluruh struk terlihat')
          }
        }
        return c.json({ status: 'ok' })
      }

      // ── Handle pending action (konfirmasi hapus/edit/ocr) ──
      if (user.pending_action) {
        const action = user.pending_action as any

        // Konfirmasi simpan OCR
        if (action.type === 'confirm_ocr' && buttonId === 'ocr_confirm_yes') {
          const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
          await supabase.from('transactions').insert({
            user_id: user.id,
            amount: action.amount,
            type: 'expense',
            category: action.category,
            description: action.note,
            date: action.date || new Date().toISOString().split('T')[0],
          })
          await supabase.from('users').update({ pending_action: null }).eq('id', user.id)
          await sendMessage(from,
            `✅ *Transaksi tersimpan!*\n\n` +
            `💸 Rp ${fmt(action.amount)}\n` +
            `🏷️ ${action.category}\n` +
            `📝 ${action.note}\n\n` +
            `Saldo kamu sudah diupdate 🎯`
          )
          return c.json({ status: 'ok' })
        }

        // Batalkan OCR
        if (action.type === 'confirm_ocr' && buttonId === 'ocr_confirm_no') {
          await supabase.from('users').update({ pending_action: null }).eq('id', user.id)
          await sendMessage(from, '❌ Oke, transaksi dibatalkan.')
          return c.json({ status: 'ok' })
        }

        // Konfirmasi hapus
        if (action.type === 'confirm_delete' && (buttonId === 'confirm_yes' || buttonId?.startsWith('del_'))) {
          const txId = buttonId === 'confirm_yes' ? action.tx_id : buttonId.replace('del_', '')
          await supabase.from('transactions').delete().eq('id', txId).eq('user_id', user.id)
          await supabase.from('users').update({ pending_action: null }).eq('id', user.id)
          await sendMessage(from, '✅ *Transaksi berhasil dihapus!*\n\nKetik *riwayat* untuk lihat transaksi terbaru.')
          return c.json({ status: 'ok' })
        }

        // Batalkan aksi
        if (buttonId === 'confirm_no' || text.toLowerCase() === 'batal') {
          await supabase.from('users').update({ pending_action: null }).eq('id', user.id)
          await sendMessage(from, '↩️ Dibatalkan. Ada yang bisa aku bantu?')
          return c.json({ status: 'ok' })
        }

        // Pilih transaksi dari list untuk dihapus
        if (action.type === 'select_delete' && buttonId?.startsWith('del_')) {
          const txId = buttonId.replace('del_', '')
          const { data: tx } = await supabase.from('transactions').select('*').eq('id', txId).single()
          if (tx) {
            const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
            await supabase.from('users').update({ pending_action: { type: 'confirm_delete', tx_id: txId } }).eq('id', user.id)
            await sendButtons(from,
              `Hapus transaksi ini?\n\n${tx.type === 'income' ? '💰' : '💸'} *${tx.description}*\n🏷️ ${tx.category}\n💵 Rp ${fmt(tx.amount)}\n📅 ${new Date(tx.created_at).toLocaleDateString('id-ID')}`,
              [
                { id: 'confirm_yes', title: '🗑️ Ya, Hapus' },
                { id: 'confirm_no', title: '↩️ Batal' }
              ]
            )
          }
          return c.json({ status: 'ok' })
        }

        // Edit nominal transaksi
        if (action.type === 'confirm_edit') {
          const amountStr = text.toLowerCase().trim()
          let newAmount = 0
          if (amountStr.includes('jt') || amountStr.includes('juta')) newAmount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000000
          else if (amountStr.includes('rb') || amountStr.includes('ribu') || amountStr.includes('k')) newAmount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000
          else newAmount = parseFloat(amountStr.replace(/[^\d.]/g, ''))

          if (newAmount > 0) {
            await supabase.from('transactions').update({ amount: newAmount }).eq('id', action.tx_id).eq('user_id', user.id)
            await supabase.from('users').update({ pending_action: null }).eq('id', user.id)
            const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
            await sendMessage(from, `✅ *Transaksi berhasil diupdate!*\n\nNominal baru: Rp ${fmt(newAmount)}\n\nKetik *riwayat* untuk lihat transaksi terbaru.`)
          } else {
            await sendMessage(from, 'Format nominal tidak valid. Coba ketik nominal baru, contoh: *35000* atau *35rb*')
          }
          return c.json({ status: 'ok' })
        }

        // Pilih transaksi dari list untuk diedit
        if (action.type === 'select_edit' && buttonId?.startsWith('edit_')) {
          const txId = buttonId.replace('edit_', '')
          const { data: tx } = await supabase.from('transactions').select('*').eq('id', txId).single()
          if (tx) {
            const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
            await supabase.from('users').update({ pending_action: { type: 'confirm_edit', tx_id: txId } }).eq('id', user.id)
            await sendMessage(from, `✏️ *Edit transaksi:*\n\n${tx.type === 'income' ? '💰' : '💸'} *${tx.description}*\n🏷️ ${tx.category}\n💵 Rp ${fmt(tx.amount)} (saat ini)\n\nKetik *nominal baru*, contoh: *50000* atau *50rb*`)
          }
          return c.json({ status: 'ok' })
        }

        // Handler goal setup - input amount
        if (action.type === 'goal_setup' && action.step === 'ask_amount') {
          await handleGoalAmount(from, text, user.id, action)
          return c.json({ status: 'ok' })
        }

        // Clear pending action jika tidak ada yang cocok
        await supabase.from('users').update({ pending_action: null }).eq('id', user.id)
      }

      const cmd = text?.toLowerCase()

      // ── Command: hapus ──
      if (cmd === 'hapus' || cmd === 'hapus terakhir' || cmd === 'delete') {
        const { data: transactions } = await supabase
          .from('transactions').select('*').eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(5)

        if (!transactions || transactions.length === 0) {
          await sendMessage(from, 'Belum ada transaksi yang bisa dihapus.')
          return c.json({ status: 'ok' })
        }

        if (cmd === 'hapus terakhir') {
          const tx = transactions[0]
          const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
          await supabase.from('users').update({ pending_action: { type: 'confirm_delete', tx_id: tx.id } }).eq('id', user.id)
          await sendButtons(from,
            `Hapus transaksi terakhir ini?\n\n${tx.type === 'income' ? '💰' : '💸'} *${tx.description}*\n🏷️ ${tx.category}\n💵 Rp ${fmt(tx.amount)}\n📅 ${new Date(tx.created_at).toLocaleDateString('id-ID')}`,
            [
              { id: 'confirm_yes', title: '🗑️ Ya, Hapus' },
              { id: 'confirm_no', title: '↩️ Batal' }
            ]
          )
        } else {
          const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
          await supabase.from('users').update({ pending_action: { type: 'select_delete' } }).eq('id', user.id)
          await sendList(from,
            'Pilih transaksi yang ingin dihapus:',
            'Pilih Transaksi',
            [{
              title: '5 Transaksi Terakhir',
              rows: transactions.map(tx => ({
                id: `del_${tx.id}`,
                title: `${tx.type === 'income' ? '💰' : '💸'} ${tx.description}`,
                description: `Rp ${fmt(tx.amount)} · ${new Date(tx.created_at).toLocaleDateString('id-ID')}`
              }))
            }],
            '🗑️ Hapus Transaksi'
          )
        }
        return c.json({ status: 'ok' })
      }

      // ── Command: edit ──
      if (cmd === 'edit' || cmd === 'edit terakhir' || cmd?.startsWith('edit ')) {
        const { data: transactions } = await supabase
          .from('transactions').select('*').eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(5)

        if (!transactions || transactions.length === 0) {
          await sendMessage(from, 'Belum ada transaksi yang bisa diedit.')
          return c.json({ status: 'ok' })
        }

        // Edit terakhir dengan nominal langsung: "edit 50rb"
        if (cmd?.startsWith('edit ') && cmd !== 'edit terakhir') {
          const amountStr = cmd.replace('edit ', '').trim()
          let newAmount = 0
          if (amountStr.includes('jt') || amountStr.includes('juta')) newAmount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000000
          else if (amountStr.includes('rb') || amountStr.includes('ribu') || amountStr.includes('k')) newAmount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000
          else newAmount = parseFloat(amountStr.replace(/[^\d.]/g, ''))

          if (newAmount > 0) {
            const tx = transactions[0]
            const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
            await supabase.from('users').update({ pending_action: { type: 'confirm_delete', tx_id: tx.id } }).eq('id', user.id)
            await sendButtons(from,
              `Update transaksi terakhir?\n\n${tx.type === 'income' ? '💰' : '💸'} *${tx.description}*\n💵 Rp ${fmt(tx.amount)} → Rp ${fmt(newAmount)}`,
              [
                { id: 'confirm_yes', title: '✅ Ya, Update' },
                { id: 'confirm_no', title: '↩️ Batal' }
              ]
            )
            // Store proper edit action
            await supabase.from('users').update({ pending_action: { type: 'confirm_edit', tx_id: tx.id, new_amount: newAmount, auto_confirm: true } }).eq('id', user.id)
            // Auto process
            await supabase.from('transactions').update({ amount: newAmount }).eq('id', tx.id).eq('user_id', user.id)
            await supabase.from('users').update({ pending_action: null }).eq('id', user.id)
            await sendMessage(from, `✅ *Transaksi berhasil diupdate!*\n\n${tx.type === 'income' ? '💰' : '💸'} ${tx.description}\n💵 Rp ${fmt(tx.amount)} → *Rp ${fmt(newAmount)}*`)
            return c.json({ status: 'ok' })
          }
        }

        // Pilih dari list transaksi
        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        await supabase.from('users').update({ pending_action: { type: 'select_edit' } }).eq('id', user.id)
        await sendList(from,
          'Pilih transaksi yang ingin diedit nominalnya:',
          'Pilih Transaksi',
          [{
            title: '5 Transaksi Terakhir',
            rows: transactions.map(tx => ({
              id: `edit_${tx.id}`,
              title: `${tx.type === 'income' ? '💰' : '💸'} ${tx.description}`,
              description: `Rp ${fmt(tx.amount)} · ${new Date(tx.created_at).toLocaleDateString('id-ID')}`
            }))
          }],
          '✏️ Edit Transaksi'
        )
        return c.json({ status: 'ok' })
      }

      // ── Handler template goal dari list reply ──
      if (buttonId && GOAL_TEMPLATES.find(t => t.id === buttonId)) {
        await handleGoalTemplate(from, buttonId, user.id)
        return c.json({ status: 'ok' })
      }

      // ── Handler goal_dur button ──
      if (buttonId?.startsWith('goal_dur_') && user.pending_action) {
        const action = user.pending_action as any
        if (action.type === 'goal_setup') {
          const plan = (user.plan || 'free') as string
          await handleGoalDeadline(from, buttonId, user.id, action, plan)
          return c.json({ status: 'ok' })
        }
      }

      // ── Command: goals ──
      const goalCmd = parseGoalCommand(text)
      if (goalCmd.type !== null) {
        const plan = (user.plan || 'free') as string

        if (goalCmd.type === 'list') {
          await showGoalMenu(from, plan)
          return c.json({ status: 'ok' })
        }

        if (goalCmd.type === 'create' && goalCmd.name && goalCmd.amount && goalCmd.deadline) {
          const msg = await createGoal(user.id, goalCmd.name, goalCmd.amount, goalCmd.deadline, plan)
          await sendMessage(from, msg)
          if (msg.includes('berhasil dibuat')) {
            const xpRes = await addXp(user.id, 'set_budget')
            await sendMessage(from, formatXpMessage(xpRes))
          }
          return c.json({ status: 'ok' })
        }

        if (goalCmd.type === 'add' && goalCmd.keyword && goalCmd.amount) {
          const msg = await addToGoal(user.id, goalCmd.keyword, goalCmd.amount)
          await sendMessage(from, msg)
          if (msg.includes('GOAL TERCAPAI')) {
            const xpRes = await addXp(user.id, 'goal_achieved')
            await sendMessage(from, formatXpMessage(xpRes))
          } else {
            const xpRes = await addXp(user.id, 'transaction', 5)
            await sendMessage(from, formatXpMessage(xpRes))
          }
          return c.json({ status: 'ok' })
        }
      }

      // ── Command: share ──
      if (cmd === 'share' || cmd === 'bagikan') {
        const plan = user.plan || 'free'
        if (plan === 'free') {
          await sendMessage(from, getUpsellMessage('export', 'free'))
          return c.json({ status: 'ok' })
        }

        try {
          await sendMessage(from, '🎨 Sedang generate kartu share kamu... tunggu sebentar!')

          // Ambil data untuk share card
          const now = new Date()
          const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
          const { data: txThisMonth } = await supabase
            .from('transactions').select('*')
            .eq('user_id', user.id)
            .gte('created_at', firstDay.toISOString())

          const income = txThisMonth?.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0) || 0
          const expense = txThisMonth?.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) || 0
          const saved = income - expense

          const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

          const imgPath = await generateShareCard({
            type: 'monthly_save',
            name: user.name || 'Sobat',
            value: saved > 0 ? saved : expense,
            month: months[now.getMonth()],
          })

          const imgBuffer = fs.readFileSync(imgPath)
          fs.unlinkSync(imgPath)

          await sendImage(from, imgBuffer,
            `📊 Laporan ${months[now.getMonth()]} ${now.getFullYear()} ku!

Dibuat dengan SmartMoney AI 🤖
Coba gratis via WhatsApp!`
          )

          const xpShareResult = await addXp(user.id, 'transaction', 5)
          await sendMessage(from, `✅ Kartu share berhasil dikirim!\n\nSimpan dan share ke story WA, IG, atau Facebook kamu ya! 📸${formatXpMessage(xpShareResult)}`)
        } catch (err) {
          console.error('[Share] Error:', err)
          await sendMessage(from, '😅 Gagal generate kartu. Coba lagi ya!')
        }
        return c.json({ status: 'ok' })
      }

      // ── Command: bantuan ──
      if (cmd === 'bantuan' || cmd === 'help') {
        const premiumInfo = user.is_premium ? '\n⭐ *Status: Premium*' : '\n\n💎 *Upgrade Premium* — Ketik *upgrade* untuk fitur lengkap (Rp 29.000/bulan)'
        await sendMessage(from, `*SmartMoney AI - Menu Bantuan* 🤖\n\n*Catat Transaksi:*\n- "makan siang 35rb"\n- "gajian 5jt"\n- "transfer gopay 100rb"\n\n*Foto Struk:*\n- Kirim foto struk/nota → otomatis terbaca 📸\n\n*Share & Pamer:*\n- *share* — generate kartu laporan untuk story WA/IG/FB 📸\n\n*Lihat Data:*\n- *saldo* — ringkasan keuangan\n- *riwayat* — 5 transaksi terakhir\n- *hari ini* — transaksi hari ini\n- *minggu ini* — laporan mingguan\n- *bulan ini* — laporan bulanan\n- *budget* — lihat semua budget\n- *profil* — streak & badge kamu\n\n*Edit & Hapus:*\n- *hapus terakhir* — hapus transaksi terakhir\n- *hapus* — pilih transaksi untuk dihapus\n- *edit 50rb* — edit nominal transaksi terakhir\n- *edit* — pilih transaksi untuk diedit\n\n*Set Budget:*\n- "budget makan 500rb"\n\n*Lainnya:*\n- *bantuan* — tampilkan menu ini${premiumInfo}`)
        return c.json({ status: 'ok' })
      }

      // ── Command: upgrade ──
      if (cmd === 'upgrade' || cmd === 'premium' || cmd === 'bayar') {
        const plan = user.plan || 'free'

        if (plan === 'business') {
          await sendMessage(from, `👑 *Kamu sudah di plan Business!*\n\nKamu sudah menikmati semua fitur terbaik SmartMoney AI. Terima kasih! 🎉`)
          return c.json({ status: 'ok' })
        }

        if (plan === 'personal') {
          const until = new Date(user.premium_until)
          const personalUrl = await createPaymentLink(user.id, from, 'business')
          await sendMessage(from,
            `⭐ *Kamu sudah Personal!*\n\nAktif hingga: ${until.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}\n\n` +
            `👑 *Upgrade ke Business — ~~Rp 99.000~~ Rp 49.000/bulan*\n` +
            `✅ Export Excel\n✅ Laporan pajak\n✅ Goals unlimited\n✅ Streak freeze 3x\n✅ Komisi referral 30%\n\n` +
            `👇 Bayar sekarang:\n${personalUrl}\n\n_Link berlaku 24 jam._`
          )
          return c.json({ status: 'ok' })
        }

        // User gratis — tampilkan 2 pilihan
        const personalUrl = await createPaymentLink(user.id, from, 'personal')
        const businessUrl = await createPaymentLink(user.id, from, 'business')
        await sendMessage(from,
          `🚀 *Upgrade SmartMoney AI*\n\n` +
          `⭐ *Personal — Rp 29.000/bulan*\n` +
          `✅ Riwayat unlimited\n✅ OCR struk unlimited\n✅ Budget unlimited\n✅ 3 Goals nabung\n✅ Laporan PDF\n✅ Streak freeze 1x\n✅ Komisi referral 20%\n` +
          `👉 ${personalUrl}\n\n` +
          `👑 *Business — ~~Rp 99.000~~ Rp 49.000/bulan*\n` +
          `✅ Semua fitur Personal\n✅ Export Excel\n✅ Laporan pajak\n✅ Goals unlimited\n✅ Streak freeze 3x\n✅ Komisi referral 30%\n` +
          `👉 ${businessUrl}\n\n` +
          `_Link berlaku 24 jam. Fitur aktif otomatis setelah bayar!_ 🎉`
        )
        return c.json({ status: 'ok' })
      }

      // ── Command: saldo ──
      if (cmd === 'saldo' || cmd === 'balance') {
        const { data: transactions } = await supabase.from('transactions').select('type, amount').eq('user_id', user.id)
        const income = transactions?.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0) || 0
        const expense = transactions?.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0) || 0
        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const namaSaldo = user.name ? `${user.name}` : 'Kamu'
        const saldoMsg = income - expense >= 0 
          ? `\n\n💚 Bagus! ${namaSaldo} masih surplus bulan ini. Pertahankan ya!`
          : `\n\n💛 ${namaSaldo}, pengeluaran melebihi pemasukan. Yuk kita review bersama!`
        await sendMessage(from, `💰 *Ringkasan Keuangan ${user.name ? user.name : ''}*\n\n📈 Pemasukan: Rp ${fmt(income)}\n📉 Pengeluaran: Rp ${fmt(expense)}\n💵 Saldo: Rp ${fmt(income - expense)}${saldoMsg}`)
        return c.json({ status: 'ok' })
      }

      // ── Command: riwayat ──
      if (cmd === 'riwayat' || cmd === 'history') {
        const { data: transactions } = await supabase.from('transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5)
        if (!transactions || transactions.length === 0) {
          await sendMessage(from, 'Belum ada transaksi. Yuk mulai catat! 📝')
          return c.json({ status: 'ok' })
        }
        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const list = transactions.map((t, i) => `${i + 1}. ${t.type === 'income' ? '💰' : '💸'} ${t.description} — Rp ${fmt(t.amount)}\n    🏷️ ${t.category}`).join('\n\n')
        await sendMessage(from, `📋 *5 Transaksi Terakhir*\n\n${list}`)
        return c.json({ status: 'ok' })
      }

      // ── Command: hari ini ──
      if (cmd === 'hari ini' || cmd === 'today') {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const { data: transactions } = await supabase.from('transactions').select('*').eq('user_id', user.id).gte('created_at', today.toISOString()).order('created_at', { ascending: false })
        if (!transactions || transactions.length === 0) { await sendMessage(from, 'Belum ada transaksi hari ini. Yuk catat! 📝'); return c.json({ status: 'ok' }) }
        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
        const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)
        await sendMessage(from, `📅 *Transaksi Hari Ini*\n\n${transactions.map(t => `${t.type === 'income' ? '💰' : '💸'} ${t.description} — Rp ${fmt(t.amount)}`).join('\n')}\n\n📈 Masuk: Rp ${fmt(income)}\n📉 Keluar: Rp ${fmt(expense)}`)
        return c.json({ status: 'ok' })
      }

      // ── Command: minggu ini ──
      if (cmd === 'minggu ini' || cmd === 'weekly') {
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
        const { data: transactions } = await supabase.from('transactions').select('*').eq('user_id', user.id).gte('created_at', weekAgo.toISOString()).order('created_at', { ascending: false })
        if (!transactions || transactions.length === 0) { await sendMessage(from, 'Belum ada transaksi minggu ini. Yuk catat! 📝'); return c.json({ status: 'ok' }) }
        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
        const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)
        const byCategory: Record<string, number> = {}
        transactions.filter(t => t.type === 'expense').forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + t.amount })
        const categoryList = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, amt]) => `  • ${cat}: Rp ${fmt(amt)}`).join('\n')
        await sendMessage(from, `📊 *Laporan Minggu Ini*\n\n📈 Pemasukan: Rp ${fmt(income)}\n📉 Pengeluaran: Rp ${fmt(expense)}\n💵 Selisih: Rp ${fmt(income - expense)}\n\n*Top Pengeluaran:*\n${categoryList || '  Belum ada'}`)
        return c.json({ status: 'ok' })
      }

      // ── Command: bulan ini ──
      if (cmd === 'bulan ini' || cmd === 'monthly') {
        const now = new Date()
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
        const { data: transactions } = await supabase.from('transactions').select('*').eq('user_id', user.id).gte('created_at', firstDay.toISOString()).order('created_at', { ascending: false })
        if (!transactions || transactions.length === 0) { await sendMessage(from, 'Belum ada transaksi bulan ini. Yuk catat! 📝'); return c.json({ status: 'ok' }) }
        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
        const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)
        const byCategory: Record<string, number> = {}
        transactions.filter(t => t.type === 'expense').forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + t.amount })
        const categoryList = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, amt]) => `  • ${cat}: Rp ${fmt(amt)}`).join('\n')
        const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
        await sendMessage(from, `📅 *Laporan ${months[now.getMonth()]} ${now.getFullYear()}*\n\n📈 Pemasukan: Rp ${fmt(income)}\n📉 Pengeluaran: Rp ${fmt(expense)}\n💵 Saldo: Rp ${fmt(income - expense)}\n📊 Total: ${transactions.length}x\n\n*Top Pengeluaran:*\n${categoryList || '  Belum ada'}`)
        return c.json({ status: 'ok' })
      }

      // ── Command: budget ──
      if (cmd === 'budget') {
        const { data: budgets } = await supabase.from('budgets').select('*').eq('user_id', user.id)
        if (!budgets || budgets.length === 0) { await sendMessage(from, 'Belum ada budget. Set budget: "budget makan 500rb"'); return c.json({ status: 'ok' }) }
        const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
        const now = new Date(); const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
        const { data: transactions } = await supabase.from('transactions').select('*').eq('user_id', user.id).eq('type', 'expense').gte('created_at', firstDay.toISOString())
        const list = budgets.map(b => {
          const spent = transactions?.filter(t => t.category === b.category).reduce((sum, t) => sum + t.amount, 0) || 0
          const pct = Math.round((spent / b.amount) * 100)
          return `${pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢'} *${b.category}*: Rp ${fmt(spent)} / Rp ${fmt(b.amount)} (${pct}%)`
        }).join('\n')
        await sendMessage(from, `🎯 *Budget Bulan Ini*\n\n${list}\n\n🟢 Aman  🟡 Hampir habis  🔴 Melebihi`)
        return c.json({ status: 'ok' })
      }

      // ── Command: profil ──
      if (cmd === 'profil' || cmd === 'profile') {
        const profile = await getProfile(user.id)
        const badgeList = profile.badges.length > 0 ? profile.badges.map(b => `${b.badge_emoji} ${b.badge_name}`).join('\n') : '  Belum ada badge. Mulai catat transaksi!'
        const streakEmoji = profile.streak >= 7 ? '🔥' : profile.streak >= 3 ? '⚡' : '✨'
        const name = user.name ? `*${user.name}*\n` : ''
        const premiumStatus = user.is_premium ? '\n⭐ Status: *Premium*' : '\n💎 Status: Gratis — ketik *upgrade* untuk premium'
        const userXp = user.xp || 0
        const userLevel = user.level || 1
        const { getLevelFromXp } = await import('../services/xp.js')
        const { current: levelData, nextLevel: nextLvl, xpToNext } = getLevelFromXp(userXp)
        const xpBar = nextLvl
          ? `\n⚡ *XP: ${userXp}* | ${levelData.name}\n📊 ${xpToNext} XP lagi ke ${nextLvl.name}`
          : `\n⚡ *XP: ${userXp}* | ${levelData.name} (MAX!)`
        await sendMessage(from, `👤 *Profil Kamu*\n\n${name}${streakEmoji} Streak: ${profile.streak} hari\n🏆 Terpanjang: ${profile.longestStreak} hari\n📊 Total transaksi: ${profile.totalTransactions}${xpBar}${premiumStatus}\n\n*Badge:*\n${badgeList}`)
        return c.json({ status: 'ok' })
      }

      // ── Command: set budget ──
      const budgetMatch = cmd?.match(/^budget\s+(\w+)\s+([\d,.]+\s*(?:rb|ribu|jt|juta|k)?)$/i)
      if (budgetMatch) {
        const category = budgetMatch[1].toLowerCase()
        const amountStr = budgetMatch[2].toLowerCase().trim()
        let amount = 0
        if (amountStr.includes('jt') || amountStr.includes('juta')) amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000000
        else if (amountStr.includes('rb') || amountStr.includes('ribu') || amountStr.includes('k')) amount = parseFloat(amountStr.replace(/[^\d.]/g, '')) * 1000
        else amount = parseFloat(amountStr.replace(/[^\d.]/g, ''))
        if (amount > 0) {
          const budgetPlan = (user.plan || 'free') as 'free' | 'personal' | 'business'
          const budgetCheck = await checkBudgetLimit(user.id, budgetPlan)
          if (!budgetCheck.allowed) {
            await sendMessage(from, getUpsellMessage('budget', budgetPlan))
            return c.json({ status: 'ok' })
          }
          await supabase.from('budgets').upsert({ user_id: user.id, category, amount, period: 'monthly' }, { onConflict: 'user_id,category,period' })
          const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)
          await sendMessage(from, `✅ *Budget diset!*\n\n🏷️ Kategori: ${category}\n💵 Budget: Rp ${fmt(amount)}/bulan`)
        } else {
          await sendMessage(from, 'Format budget salah. Coba: "budget makan 500rb"')
        }
        return c.json({ status: 'ok' })
      }

      // ── Default: AI parsing transaksi (support multi) ──
      const parseResult = await parseTransactions(text)
      console.log('Parsed:', parseResult)

      if (!parseResult.transactions.length || parseResult.transactions[0].type === 'unknown' || parseResult.transactions[0].amount === 0) {
        const sapaanBingung = user.name ? `Hmm, ${user.name}, ` : 'Hmm, '
        await sendMessage(from, `${sapaanBingung}aku belum paham maksudnya. Coba ketik:\n- "makan 25rb"\n- "gaji 5jt"\n- "beli kopi 15rb, bensin 50rb, makan siang 25rb"\n\nAtau ketik *bantuan* untuk lihat semua fitur ya! 😊`)
        return c.json({ status: 'ok' })
      }

      const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)

      // Simpan semua transaksi
      for (const tx of parseResult.transactions) {
        await supabase.from('transactions').insert({ user_id: user.id, type: tx.type, amount: tx.amount, category: tx.category, description: tx.description })
      }

      const { streak, newBadges } = await updateStreak(user.id)
      const xpResult = await addXp(user.id, 'transaction', parseResult.transactions.length * 10)
      const dailyBonus = await checkDailyBonus(user.id)
      let bonusXpResult = null
      if (dailyBonus) bonusXpResult = await addXp(user.id, 'transaction_bonus_3x')
      await updateWeeklyChallenge(user.id, 'transactions_5')
      await updateWeeklyChallenge(user.id, 'daily_streak')
      await initWeeklyChallenges(user.id)

      const xpText = formatXpMessage(xpResult)
      const bonusXpText = bonusXpResult ? `\n🎯 *Bonus 3x transaksi hari ini!*${formatXpMessage(bonusXpResult)}` : ''
      const badgeText = newBadges.length > 0 ? `\n\n🎉 *Badge baru!*\n${newBadges.map(b => `${b.emoji} ${b.name}`).join('\n')}` : ''
      const streakText = streak > 1 ? `\n🔥 Streak: ${streak} hari` : ''

      // Auto share card saat streak milestone atau level up (khusus premium)
      const userPlan = user.plan || 'free'
      if (userPlan !== 'free') {
        try {
          // Share card streak milestone (7 dan 30 hari)
          if (streak === 7 || streak === 30) {
            const imgPath = await generateShareCard({ type: 'streak', name: user.name || 'Sobat', streak })
            const imgBuffer = fs.readFileSync(imgPath)
            fs.unlinkSync(imgPath)
            await sendImage(from, imgBuffer, `🔥 ${streak} hari streak! Konsisten banget! Simpan dan share ke story kamu ya!`)
          }

          // Share card level up
          if (xpResult.leveledUp) {
            const imgPath = await generateShareCard({ type: 'level_up', name: user.name || 'Sobat', levelName: xpResult.levelName })
            const imgBuffer = fs.readFileSync(imgPath)
            fs.unlinkSync(imgPath)
            await sendImage(from, imgBuffer, `⚡ Level up! Sekarang ${xpResult.levelName}! Share ke story kamu! 🎉`)
          }
        } catch (err) {
          console.error('[ShareCard] Error detail:', err)
          console.error('[ShareCard] Error message:', (err as any)?.message)
          console.error('[ShareCard] Error stack:', (err as any)?.stack)
        }
      }

      if (parseResult.isMultiple) {
        const totalExpense = parseResult.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
        const totalIncome = parseResult.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
        const txList = parseResult.transactions.map(t => `${t.type === 'income' ? '💰' : '💸'} ${t.description} — Rp ${fmt(t.amount)} (${t.category})`).join('\n')
        await sendMessage(from,
          `✅ *${parseResult.transactions.length} transaksi dicatat!*\n\n${txList}` +
          `${totalExpense > 0 ? `\n\n💸 Total pengeluaran: Rp ${fmt(totalExpense)}` : ''}` +
          `${totalIncome > 0 ? `\n💰 Total pemasukan: Rp ${fmt(totalIncome)}` : ''}` +
          `${streakText}${badgeText}${xpText}${bonusXpText}`
        )
      } else {
        const parsed = parseResult.transactions[0]
        let budgetAlert = ''
        if (parsed.type === 'expense') {
          const now = new Date(); const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
          const { data: budget } = await supabase.from('budgets').select('*').eq('user_id', user.id).eq('category', parsed.category).single()
          if (budget) {
            const { data: txThisMonth } = await supabase.from('transactions').select('amount').eq('user_id', user.id).eq('category', parsed.category).eq('type', 'expense').gte('created_at', firstDay.toISOString())
            const totalSpent = txThisMonth?.reduce((sum, t) => sum + t.amount, 0) || 0
            const pct = Math.round((totalSpent / budget.amount) * 100)
            if (pct >= 100) budgetAlert = `\n\n🔴 *Budget Alert!* Pengeluaran ${parsed.category} sudah *melebihi budget* (${pct}%)! Total: Rp ${fmt(totalSpent)} dari Rp ${fmt(budget.amount)}.`
            else if (pct >= 80) budgetAlert = `\n\n⚠️ *Budget Alert!* Pengeluaran ${parsed.category} sudah ${pct}%. Sisa Rp ${fmt(budget.amount - totalSpent)} lagi.`
          }
        }
        const { data: recentTx } = await supabase.from('transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10)
        const insight = await generateInsight({ description: parsed.description, amount: parsed.amount, category: parsed.category, type: parsed.type }, recentTx || [], user.name || undefined)
        // Sapaan personal berdasarkan streak dan konteks
      const greeting = user.name ? `${user.name}, ` : ''
      const motivasi = streak >= 7 ? `\n🔥 Keren banget ${user.name || 'kamu'}, streak ${streak} hari!` : streak >= 3 ? `\n⚡ Konsisten terus ya ${user.name || ''}!`.trim() : ''
      
      await sendMessage(from, `${parsed.type === 'income' ? '💰' : '💸'} *${parsed.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} dicatat!*\n\n📝 ${parsed.description}\n🏷️ ${parsed.category}\n💵 Rp ${fmt(parsed.amount)}\n👛 ${parsed.wallet}${streakText}${motivasi}${budgetAlert}${badgeText}${insight ? `\n\n💡 ${insight}` : ''}${xpText}${bonusXpText}`)
      }

    } catch (err) {
      console.error('Error:', err)
      await sendMessage(from, 'Maaf, ada error. Coba lagi ya!')
    }
  }

  return c.json({ status: 'ok' })
})

export default webhook
