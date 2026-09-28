import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

// GET /l/:codigo — the short link in the VELIO agent's cart messages.
//
// Releasit's cart-recovery link carries the customer's data and the ad's
// UTMs inside, 450-600 characters: a filled Meta template went over the
// 1024-character limit (error 132005) and the link read as noise in the
// chat. The agent stores the long link in agente_archivos (ruta
// `enlaces/<codigo>`, velio-agente/agente/enlaces.py) and sends
// /l/<codigo>; this redirects to it untouched (Andrés, 28/9).
//
// Public on purpose (the middleware only guards its own list of paths).
// It is not an open redirect: it only follows a URL the agent stored, and
// only to the store. Anything else lands on the store's home page.

const TIENDA = 'https://veliocolombia.com'
const DESTINOS = new Set(['veliocolombia.com', 'www.veliocolombia.com', 'veliocol.myshopify.com'])
const SIN_CACHE = { 'Cache-Control': 'no-store' }

function destinoValido(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && DESTINOS.has(u.hostname) ? u.toString() : null
  } catch {
    return null
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  if (!/^[A-Za-z0-9]{5,12}$/.test(codigo)) {
    return NextResponse.redirect(TIENDA, { status: 302, headers: SIN_CACHE })
  }

  const db = supabaseAdmin()
  const { data } = await db
    .from('agente_archivos')
    .select('contenido')
    .eq('ruta', `enlaces/${codigo}`)
    .maybeSingle()
  const contenido = (data?.contenido ?? {}) as { url?: unknown; pedido?: string | null }
  const destino = destinoValido(contenido.url)
  if (!destino) return NextResponse.redirect(TIENDA, { status: 302, headers: SIN_CACHE })

  // So Andrés can tell the customer opened it. A failed insert never blocks
  // the redirect: supabase-js reports errors instead of throwing.
  await db.from('agente_eventos').insert({
    tipo: 'enlace_abierto',
    pedido: contenido.pedido ?? null,
    detalle: { codigo },
  })

  return NextResponse.redirect(destino, { status: 302, headers: SIN_CACHE })
}
