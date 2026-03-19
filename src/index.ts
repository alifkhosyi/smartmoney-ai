import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from 'dotenv'
import webhook from './routes/webhook'
import { supabase } from './lib/supabase'

config()

supabase.from('users').select('count').then(({ data, error }) => {
  if (error) console.error('Supabase error:', error.message)
  else console.log('Supabase connected!')
})

const app = new Hono()

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() })
})

app.route('/', webhook)

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, () => {
  console.log(`SmartMoney AI running on http://localhost:${port}`)
})

export default app