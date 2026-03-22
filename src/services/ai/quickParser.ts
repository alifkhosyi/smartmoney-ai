// Quick parser untuk transaksi umum tanpa AI
// Kalau tidak match, fallback ke Claude AI

export interface QuickParseResult {
  matched: boolean
  type?: 'income' | 'expense'
  category?: string
  description?: string
  amount?: number
  wallet?: string
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Makanan': ['makan', 'minum', 'kopi', 'coffee', 'nasi', 'ayam', 'soto', 'bakso', 'mie', 'pizza', 'burger', 'roti', 'snack', 'jajan', 'lunch', 'dinner', 'breakfast', 'sarapan', 'siang', 'malam', 'resto', 'warung', 'cafe', 'seafood', 'sushi', 'steak', 'es', 'teh', 'susu', 'juice', 'boba', 'indomie', 'gofood', 'grabfood', 'shopeefood'],
  'Transport': ['bensin', 'bbm', 'pertamax', 'pertalite', 'solar', 'ojek', 'gojek', 'grab', 'taxi', 'taksi', 'angkot', 'busway', 'mrt', 'lrt', 'kereta', 'krl', 'tol', 'parkir', 'motor', 'mobil', 'uber', 'maxim'],
  'Belanja': ['belanja', 'beli', 'shopee', 'tokopedia', 'lazada', 'indomaret', 'alfamart', 'supermarket', 'hypermart', 'carrefour', 'giant', 'pakaian', 'baju', 'celana', 'sepatu', 'tas', 'aksesoris', 'elektronik', 'gadget'],
  'Tagihan': ['listrik', 'air', 'pdam', 'internet', 'wifi', 'pulsa', 'kuota', 'tv', 'indihome', 'telkom', 'cicilan', 'kredit', 'asuransi', 'iuran', 'arisan', 'kontrakan', 'kost', 'sewa'],
  'Kesehatan': ['dokter', 'rumah sakit', 'rs', 'obat', 'apotek', 'vitamin', 'suplemen', 'gym', 'fitness', 'olahraga', 'senam', 'periksa', 'klinik'],
  'Hiburan': ['nonton', 'bioskop', 'cinema', 'netflix', 'spotify', 'game', 'main', 'liburan', 'wisata', 'hotel', 'karaoke', 'konser'],
  'Pendidikan': ['kursus', 'les', 'sekolah', 'kuliah', 'buku', 'alat tulis', 'spp', 'uang sekolah'],
}

const INCOME_KEYWORDS = ['gaji', 'gajian', 'salary', 'bonus', 'transfer masuk', 'terima', 'dapat uang', 'freelance', 'proyek', 'project', 'komisi', 'dividen', 'invest', 'jual']

const WALLET_KEYWORDS: Record<string, string[]> = {
  'gopay': ['gopay', 'gopay'],
  'ovo': ['ovo'],
  'dana': ['dana'],
  'bca': ['bca', 'bank bca'],
  'mandiri': ['mandiri', 'bank mandiri'],
  'bri': ['bri', 'bank bri'],
  'bni': ['bni', 'bank bni'],
  'shopee': ['shopeepay', 'spay'],
}

function parseAmount(text: string): number {
  const clean = text.toLowerCase().replace(/rp\.?\s*/g, '').replace(/,/g, '.')
  const match = clean.match(/([\d.]+)\s*(juta|jt|ribu|rb|k|m\b)?/)
  if (!match) return 0
  const num = parseFloat(match[1].replace(/\./g, match[1].split('.').length > 2 ? '' : '.'))
  const unit = match[2] || ''
  if (unit.includes('juta') || unit === 'jt') return num * 1000000
  if (unit.includes('ribu') || unit === 'rb' || unit === 'k') return num * 1000
  return num
}

function detectWallet(text: string): string {
  const lower = text.toLowerCase()
  for (const [wallet, keywords] of Object.entries(WALLET_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return wallet
  }
  return 'cash'
}

export function quickParse(text: string): QuickParseResult {
  const lower = text.toLowerCase().trim()

  // Deteksi amount dulu
  const amount = parseAmount(lower)
  if (amount <= 0) return { matched: false }

  // Deteksi income
  const isIncome = INCOME_KEYWORDS.some(k => lower.includes(k))
  if (isIncome) {
    return {
      matched: true,
      type: 'income',
      amount,
      category: 'Gaji',
      description: text.trim(),
      wallet: detectWallet(lower)
    }
  }

  // Deteksi kategori expense
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) {
      return {
        matched: true,
        type: 'expense',
        amount,
        category,
        description: text.trim(),
        wallet: detectWallet(lower)
      }
    }
  }

  // Tidak match keyword spesifik tapi ada amount → fallback ke AI
  return { matched: false }
}
