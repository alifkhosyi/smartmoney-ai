import { supabase } from '../lib/supabase.js'
import { sendMessage, sendButtons, sendList } from './whatsapp/client.js'

const GOALS: Record<string, string> = {
  'goal_saving': '💰 Nabung lebih banyak',
  'goal_control': '📊 Kontrol pengeluaran',
  'goal_target': '🎯 Capai target finansial',
  'goal_debt': '💳 Bebas dari hutang',
  'goal_asset': '🏠 Beli aset (rumah/kendaraan)',
  'goal_all': '🌟 Semua tujuan di atas',
}

const INCOME_OPTIONS: Record<string, { label: string; amount: number }> = {
  'income_1': { label: '< Rp 3 juta', amount: 2500000 },
  'income_2': { label: 'Rp 3 – 5 juta', amount: 4000000 },
  'income_3': { label: 'Rp 5 – 10 juta', amount: 7500000 },
  'income_4': { label: 'Rp 10 – 20 juta', amount: 15000000 },
  'income_5': { label: '> Rp 20 juta', amount: 25000000 },
  'income_skip': { label: 'Lewati', amount: 0 },
}

export async function handleOnboarding(user: any, text: string, from: string, buttonId?: string): Promise<boolean> {
  const step = user.onboarding_step ?? 0

  // Step 0: Sambutan + tanya nama
  if (step === 0) {
    await sendMessage(from,
      `Halo! Selamat datang di *SmartMoney AI* 👋\n\nAku asisten keuangan pribadimu yang siap bantu kamu kelola keuangan langsung dari WhatsApp — tanpa ribet, tanpa install app!\n\nSebelum mulai, boleh aku tau *nama panggilan kamu* siapa? 😊`
    )
    await supabase.from('users').update({ onboarding_step: 1 }).eq('id', user.id)
    return true
  }

  // Step 1: Simpan nama + tanya tujuan via List Message
  if (step === 1) {
    const name = text.trim().split(' ')[0]
    const capitalName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()

    await supabase.from('users').update({ name: capitalName, onboarding_step: 2 }).eq('id', user.id)

    await sendMessage(from,
      `Senang kenalan sama kamu, *${capitalName}!* 🎉\n\nAku mau bantu kamu capai tujuan finansialmu. *Apa tujuan keuangan kamu?*\n\n1️⃣ 💰 Nabung lebih banyak\n2️⃣ 📊 Kontrol pengeluaran\n3️⃣ 🎯 Capai target finansial\n4️⃣ 💳 Bebas dari hutang\n5️⃣ 🏠 Beli aset (rumah/kendaraan)\n6️⃣ 📈 Investasi & kembangkan uang\n7️⃣ 👨‍👩‍👧 Kebutuhan keluarga\n8️⃣ 💼 Modal usaha/bisnis\n\n✏️ *Boleh pilih lebih dari satu!*\nContoh: ketik *1,3,5* atau *nabung dan investasi*\n\nAtau ketik tujuanmu sendiri jika tidak ada di list! 😊`
    )
    return true
  }

  // Step 2: Simpan tujuan (multi-pilih) + tanya penghasilan
  if (step === 2) {
    let goal = ''

    // Kalau dari list reply (pilih satu dari list)
    if (buttonId && GOALS[buttonId]) {
      goal = GOALS[buttonId]
    } else if (text.trim()) {
      // User ketik sendiri atau ketik angka multi-pilih
      const input = text.trim()
      
      // Cek apakah input berupa angka/kombinasi angka (misal: 1,2,3 atau 1 3 5)
      const GOAL_LIST = [
        '💰 Nabung lebih banyak',
        '📊 Kontrol pengeluaran', 
        '🎯 Capai target finansial',
        '💳 Bebas dari hutang',
        '🏠 Beli aset (rumah/kendaraan)',
        '📈 Investasi & kembangkan uang',
        '👨‍👩‍👧 Kebutuhan keluarga',
        '💼 Modal usaha/bisnis',
      ]
      
      const numbers = input.match(/\d+/g)
      if (numbers) {
        const chosen = numbers
          .map(n => parseInt(n))
          .filter(n => n >= 1 && n <= GOAL_LIST.length)
          .map(n => GOAL_LIST[n - 1])
        
        if (chosen.length > 0) {
          goal = chosen.join(', ')
          // Cek apakah ada tambahan teks selain angka
          const extraText = input.replace(/[\d,;\s]+/g, '').trim()
          if (extraText) goal += `, ${extraText}`
        } else {
          // Angka tidak valid, anggap teks bebas
          goal = input
        }
      } else {
        // Teks bebas langsung disimpan
        goal = input
      }
    }

    // Kalau masih kosong, minta ulang
    if (!goal) {
      await sendMessage(from,
        `Hmm, aku belum tangkap pilihanmu. Ketik nomor pilihanmu ya, contoh: *1,3* atau *2* \n\nAtau ketik tujuanmu langsung dalam kalimat! 😊`
      )
      return true
    }

    await supabase.from('users').update({ financial_goal: goal, onboarding_step: 3 }).eq('id', user.id)

    const { data: updatedUser } = await supabase.from('users').select('name').eq('id', user.id).single()
    const name = updatedUser?.name || 'Kamu'

    // Respon hangat acknowledge pilihan user
    const goalParts = goal.split(',').map((g: string) => g.trim())
    const goalSummary = goalParts.length > 1
      ? `*${goalParts.length} tujuan* sekaligus`
      : `tujuan *${goal.trim()}*`

    await sendMessage(from,
      `Luar biasa, *${name}!* 🌟\n\nKamu punya ${goalSummary} — itu langkah pertama yang keren banget! Banyak orang tidak pernah sampai di tahap ini. Aku bangga kamu sudah mulai! 💪\n\nSekarang satu pertanyaan lagi ya — *berapa penghasilan bulanan kamu?*\n\nKetik nominalnya langsung, contoh:\n• *5000000*\n• *5jt*\n• *5.000.000*\n\nAtau ketik *skip* kalau tidak ingin berbagi 😊`
    )
    return true
  }

  // Step 3: Simpan penghasilan manual + tutorial catat pertama
  if (step === 3) {
    let income = 0
    const input = (text || '').toLowerCase().trim()

    if (input === 'skip' || input === 'lewati' || input === 'tidak') {
      income = 0
    } else if (buttonId && INCOME_OPTIONS[buttonId]) {
      // fallback kalau masih ada list reply
      income = INCOME_OPTIONS[buttonId].amount
    } else {
      // Parse input manual
      const clean = input.replace(/rp\.?\s*/g, '').replace(/,/g, '.').replace(/\s+/g, '')
      const num = parseFloat(clean.replace(/[^\d.]/g, ''))
      if (clean.includes('miliar') || clean.includes('mld')) income = num * 1000000000
      else if (clean.includes('juta') || clean.includes('jt')) income = num * 1000000
      else if (clean.includes('ribu') || clean.includes('rb') || clean.includes('k')) income = num * 1000
      else income = num || 0
    }

    // Kalau tidak bisa parse dan bukan skip, minta ulang
    if (income === 0 && input !== 'skip' && input !== 'lewati' && input !== 'tidak' && input.length > 0 && !['skip','lewati','tidak'].includes(input)) {
      const fmt2 = (n: number) => new Intl.NumberFormat('id-ID').format(n)
      // Cek apakah memang 0 atau tidak bisa diparsing
      if (isNaN(parseFloat(input.replace(/[^\d.]/g, '')))) {
        await sendMessage(from,
          `Hmm, aku kurang paham formatnya. Coba ketik seperti ini ya:\n• *5000000*\n• *5jt*\n• *5.000.000*\n\nAtau ketik *skip* kalau tidak mau berbagi 😊`
        )
        return true
      }
    }

    await supabase.from('users').update({ monthly_income: income || null, onboarding_step: 4 }).eq('id', user.id)

    const { data: updatedUser } = await supabase.from('users').select('name').eq('id', user.id).single()
    const name = updatedUser?.name || 'Kamu'
    const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)

    let responseMsg = ''
    if (income > 0) {
      const tabungan = Math.round(income * 0.2)
      const kebutuhan = Math.round(income * 0.5)
      const keinginan = Math.round(income * 0.3)
      responseMsg = `Noted! Penghasilan *Rp ${fmt(income)}/bulan* ya ${name} 📝\n\n` +
        `Berdasarkan penghasilanmu, ini saran alokasi ideal *50/30/20*:\n` +
        `🏠 Kebutuhan: *Rp ${fmt(kebutuhan)}*\n` +
        `🎉 Gaya hidup: *Rp ${fmt(keinginan)}*\n` +
        `💰 Tabungan & investasi: *Rp ${fmt(tabungan)}*\n\n` +
        `Dengan SmartMoney AI, kita akan pantau bareng supaya kamu bisa capai angka ini! 🎯\n\n`
    } else {
      responseMsg = `Oke ${name}, tidak apa-apa! Kita tetap bisa bantu kamu kelola keuangan dengan baik! 😊\n\n`
    }

    await sendMessage(from,
      `${responseMsg}Sekarang saatnya *mencoba catat transaksi pertamamu!* \n\nCaranya gampang banget, cukup ketik seperti ngobrol biasa:\n\n💬 *"makan siang 35rb"*\n💬 *"beli kopi 20k"*\n💬 *"gajian 5jt"*\n💬 *"bayar listrik 200rb"*\n\nAku siap mencatat! Yuk coba sekarang 👇`
    )
    return true
  }

  // Step 4: Transaksi pertama — selesai onboarding!
  if (step === 4) {
    await supabase.from('users').update({ onboarding_step: 5 }).eq('id', user.id)

    const { data: updatedUser } = await supabase.from('users').select('name').eq('id', user.id).single()
    const name = updatedUser?.name || 'Kamu'

    setTimeout(async () => {
      await sendMessage(from,
        `🎉 *Yes! Transaksi pertama berhasil, ${name}!*\n\nIni momen yang berarti — kamu baru saja mengambil langkah pertama menuju kebebasan finansial! Banyak orang berencana tapi tidak pernah mulai. Kamu sudah mulai! 🌟\n\nAku akan selalu ada di sini menemanimu, ${name}. Setiap transaksi yang kamu catat adalah investasi untuk masa depanmu sendiri! 💪\n\n*Ini yang bisa kita lakukan bersama:*\n\n📊 *Laporan:* saldo, hari ini, minggu ini, bulan ini, riwayat\n🎯 *Budget:* "budget makan 500rb"\n📸 *Foto struk:* kirim foto nota langsung dicatat\n🎯 *Goals:* ketik "goals" untuk nabung terarah\n👤 *Profil:* lihat streak & badge kamu\n\n🔥 Streak-mu dimulai hari ini! Catat setiap hari ya ${name}, aku akan selalu ingatkan kalau kamu lupa! 😊`
      )
    }, 3000)

    return false
  }

  return false
}

export function isOnboarding(user: any): boolean {
  return (user.onboarding_step ?? 0) < 5
}
