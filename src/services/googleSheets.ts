import { google } from 'googleapis'

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive'
]

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: SCOPES
  })
}

export async function getOrCreateUserSheet(userId: string, phone: string): Promise<string> {
  const auth = getAuth()
  const drive = google.drive({ version: 'v3', auth })
  const sheets = google.sheets({ version: 'v4', auth })

  // Cek apakah sheet sudah ada (cari di Drive)
  const fileName = `SmartMoney_${phone}`
  const searchRes = await drive.files.list({
    q: `name='${fileName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id, name)'
  })

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    return searchRes.data.files[0].id!
  }

  // Buat spreadsheet baru
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: fileName },
      sheets: [
        { properties: { title: 'Transaksi', sheetId: 0 } },
        { properties: { title: 'Ringkasan', sheetId: 1 } },
        { properties: { title: 'Per Kategori', sheetId: 2 } }
      ]
    }
  })

  const spreadsheetId = createRes.data.spreadsheetId!

  // Setup header Transaksi
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Transaksi!A1:G1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Tanggal', 'Tipe', 'Kategori', 'Deskripsi', 'Jumlah', 'Bulan', 'Tahun']]
    }
  })

  // Format header bold
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.06, green: 0.43, blue: 0.34 },
                horizontalAlignment: 'CENTER'
              }
            },
            fields: 'userEnteredFormat'
          }
        }
      ]
    }
  })

  // Share ke admin (opsional - bisa dihapus kalau tidak mau)
  if (process.env.ADMIN_EMAIL) {
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: process.env.ADMIN_EMAIL
      }
    })
  }

  return spreadsheetId
}

export async function appendTransaction(
  spreadsheetId: string,
  transaction: {
    date: string
    type: string
    category: string
    description: string
    amount: number
  }
) {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  const date = new Date(transaction.date)
  const bulan = date.toLocaleString('id-ID', { month: 'long' })
  const tahun = date.getFullYear()

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Transaksi!A:G',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        date.toLocaleDateString('id-ID'),
        transaction.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
        transaction.category,
        transaction.description,
        transaction.amount,
        bulan,
        tahun
      ]]
    }
  })

  // Update ringkasan otomatis
  await updateSummary(spreadsheetId, sheets)
}

async function updateSummary(spreadsheetId: string, sheets: any) {
  // Ambil semua data transaksi
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Transaksi!A2:G'
  })

  const rows = res.data.values || []
  if (rows.length === 0) return

  // Hitung per bulan
  const summary: Record<string, { income: number, expense: number }> = {}
  for (const row of rows) {
    const key = `${row[5]} ${row[6]}` // "Januari 2026"
    if (!summary[key]) summary[key] = { income: 0, expense: 0 }
    const amount = parseFloat(String(row[4]).replace(/[^0-9.]/g, '')) || 0
    if (row[1] === 'Pemasukan') summary[key].income += amount
    else summary[key].expense += amount
  }

  // Tulis ke sheet Ringkasan
  const summaryRows = [['Bulan', 'Pemasukan', 'Pengeluaran', 'Selisih']]
  for (const [bulan, data] of Object.entries(summary)) {
    summaryRows.push([bulan, data.income as any, data.expense as any, (data.income - data.expense) as any])
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Ringkasan!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: summaryRows }
  })

  // Hitung per kategori (bulan ini)
  const now = new Date()
  const bulanIni = now.toLocaleString('id-ID', { month: 'long' })
  const tahunIni = now.getFullYear().toString()

  const categoryMap: Record<string, number> = {}
  for (const row of rows) {
    if (row[5] === bulanIni && row[6] === tahunIni && row[1] === 'Pengeluaran') {
      const cat = row[2] || 'Lainnya'
      const amount = parseFloat(String(row[4]).replace(/[^0-9.]/g, '')) || 0
      categoryMap[cat] = (categoryMap[cat] || 0) + amount
    }
  }

  const catRows = [['Kategori', `Pengeluaran ${bulanIni} ${tahunIni}`]]
  for (const [cat, amt] of Object.entries(categoryMap)) {
    catRows.push([cat, amt as any])
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Per Kategori!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: catRows }
  })
}

export function getSheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}
