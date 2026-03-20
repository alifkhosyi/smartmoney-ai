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

const PLAN_CONFIG = {
  personal: {
    price: 29000,
    name: 'SmartMoney AI Personal ⭐ - 1 Bulan',
    id: 'personal-monthly'
  },
  business: {
    price: 49000,
    name: 'SmartMoney AI Business 👑 - 1 Bulan',
    id: 'business-monthly'
  },
  // backward compat
  premium: {
    price: 29000,
    name: 'SmartMoney AI Personal ⭐ - 1 Bulan',
    id: 'personal-monthly'
  }
}

export async function createPaymentLink(
  userId: string,
  phone: string,
  plan: 'personal' | 'business' | 'premium'
): Promise<string> {
  const config = PLAN_CONFIG[plan]
  const shortId = userId.replace(/-/g, '').substring(0, 12)
  const orderId = `sm-${shortId}-${plan.charAt(0)}-${Date.now().toString().slice(-8)}`

  const parameter = {
    transaction_details: { order_id: orderId, gross_amount: config.price },
    customer_details: { phone: phone },
    item_details: [{ id: config.id, price: config.price, quantity: 1, name: config.name }],
    callbacks: { finish: 'https://smartmoney-ai-landing.vercel.app' }
  }

  const transaction = await snap.createTransaction(parameter)
  return transaction.redirect_url
}

export async function verifyPayment(orderId: string): Promise<string> {
  const coreAny = core as any
  const status = await coreAny.transaction.status(orderId)
  return status.transaction_status
}
