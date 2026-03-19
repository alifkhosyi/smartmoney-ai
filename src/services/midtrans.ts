import midtransClient from 'midtrans-client'

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || ''
})

const core = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || ''
})

export async function createPaymentLink(
  userId: string,
  phone: string,
  plan: 'premium'
): Promise<string> {
  const orderId = `smartmoney-${userId}-${Date.now()}`

  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: 29000
    },
    customer_details: {
      phone: phone
    },
    item_details: [{
      id: 'premium-monthly',
      price: 29000,
      quantity: 1,
      name: 'SmartMoney AI Premium - 1 Bulan'
    }],
    callbacks: {
      finish: 'https://smartmoney-ai-landing.vercel.app'
    }
  }

  const transaction = await snap.createTransaction(parameter)
  return transaction.redirect_url
}

export async function verifyPayment(orderId: string): Promise<string> {
  const status = await core.transaction.status(orderId)
  return status.transaction_status
}
