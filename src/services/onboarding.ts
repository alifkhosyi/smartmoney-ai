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

    await sendList(
      from,
      `Senang kenalan sama kamu, *${capitalName}!* 🎉\n\nAku mau bantu kamu capai tujuan finansialmu. Sekarang, apa *tujuan keuangan utama* kamu?`,
      'Pilih Tujuan',
      [{
        title: 'Tujuan Finansialku',
        rows: [
          { id: 'goal_saving', title: '💰 Nabung lebih banyak', description: 'Sisihkan lebih banyak dari penghasilan' },
          { id: 'goal_control', title: '📊 Kontrol pengeluaran', description: 'Tahu kemana uang pergi setiap bulan' },
          { id: 'goal_target', title: '🎯 Capai target finansial', description: 'Punya target dan lacak progressnya' },
          { id: 'goal_debt', title: '💳 Bebas dari hutang', description: 'Lunasi hutang lebih cepat' },
          { id: 'goal_asset', title: '🏠 Beli aset', description: 'Rumah, kendaraan, atau investasi' },
          { id: 'goal_all', title: '🌟 Semua tujuan di atas', description: 'Aku mau semua!' },
        ]
      }],
      '🎯 Pilih Tujuan Finansial',
      'Pilih yang paling sesuai dengan kondisimu sekarang'
    )
    return true
  }

  // Step 2: Simpan tujuan + tanya penghasilan via List Message
  if (step === 2) {
    const goalId = buttonId
    const goal = goalId && GOALS[goalId] ? GOALS[goalId] : text.trim()

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
