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

    await sendList(
      from,
      `Pilihan yang tepat, *${name}!* 💪\n\nSatu lagi — kira-kira berapa *penghasilan bulanan* kamu? Ini membantu aku memberikan saran yang lebih personal untukmu.`,
      'Pilih Kisaran',
      [{
        title: 'Penghasilan Bulanan',
        rows: [
          { id: 'income_1', title: '< Rp 3 juta', description: 'Di bawah 3 juta per bulan' },
          { id: 'income_2', title: 'Rp 3 – 5 juta', description: 'Antara 3 sampai 5 juta' },
          { id: 'income_3', title: 'Rp 5 – 10 juta', description: 'Antara 5 sampai 10 juta' },
          { id: 'income_4', title: 'Rp 10 – 20 juta', description: 'Antara 10 sampai 20 juta' },
          { id: 'income_5', title: '> Rp 20 juta', description: 'Di atas 20 juta per bulan' },
          { id: 'income_skip', title: '🙈 Lewati', description: 'Tidak ingin berbagi info ini' },
        ]
      }],
      '💰 Penghasilan Bulanan',
      'Informasi ini hanya digunakan untuk saran personal'
    )
    return true
  }

  // Step 3: Simpan penghasilan + tutorial catat pertama
  if (step === 3) {
    const incomeId = buttonId
    const incomeData = incomeId ? INCOME_OPTIONS[incomeId] : null
    const income = incomeData?.amount || 0

    await supabase.from('users').update({ monthly_income: income || null, onboarding_step: 4 }).eq('id', user.id)

    const { data: updatedUser } = await supabase.from('users').select('name').eq('id', user.id).single()
    const name = updatedUser?.name || 'Kamu'
    const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n)

    let tipText = ''
    if (income > 0) {
      tipText = `\n\n💡 *Saran alokasi (50/30/20):*\n• 🏠 Kebutuhan: Rp ${fmt(Math.round(income * 0.5))}\n• 🎉 Keinginan: Rp ${fmt(Math.round(income * 0.3))}\n• 💰 Tabungan: Rp ${fmt(Math.round(income * 0.2))}\n`
    }

    await sendMessage(from,
      `Siap, *${name}!* ${income > 0 ? tipText + '\n' : ''}Sekarang saatnya *mencoba catat transaksi pertamamu!* 🎯\n\nCaranya gampang banget, cukup ketik seperti percakapan biasa:\n\n💬 *"makan siang 35rb"*\n💬 *"beli kopi 20k"*\n💬 *"gajian 5jt"*\n💬 *"bayar listrik 200rb"*\n\nYuk coba sekarang! Ketik transaksimu 👇`
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
        `🎉 *Yeay! Transaksi pertama berhasil, ${name}!*\n\nKamu udah mulai perjalanan finansialmu yang lebih baik! 🚀\n\nIni semua yang bisa kamu lakukan:\n\n*📊 Cek Laporan:*\n• *saldo* — ringkasan keuangan\n• *hari ini* — transaksi hari ini\n• *minggu ini* — laporan mingguan\n• *bulan ini* — laporan bulanan\n• *riwayat* — 5 transaksi terakhir\n\n*🎯 Kelola Budget:*\n• *"budget makan 500rb"* — set batas\n• *budget* — lihat semua budget\n\n*👤 Lainnya:*\n• *profil* — streak & badge kamu\n• *bantuan* — menu lengkap\n• *upgrade* — fitur premium\n\n🔥 Streak kamu dimulai hari ini! Catat setiap hari untuk jaga streak-mu!`
      )
    }, 3000)

    return false
  }

  return false
}

export function isOnboarding(user: any): boolean {
  return (user.onboarding_step ?? 0) < 5
}
