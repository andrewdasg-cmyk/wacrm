import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { requireAgenteAccess } from '@/lib/agente/access'

// GET /api/agente/conversacion?telefono=3001234567
//
// The whole chat with a customer, for the audit page: an audit case only
// carries the last thing the customer wrote, and with many cases open it is
// easy to lose the thread (Andrés, 28/9). Reads the same messages the inbox
// shows, oldest first, merging every conversation of that number in the
// account (the CRM can hold a duplicate contact for the same phone).

const LIMITE = 150

export async function GET(request: Request) {
  let ctx
  try {
    ctx = await requireAgenteAccess()
  } catch (err) {
    return toErrorResponse(err)
  }
  const telefono = (new URL(request.url).searchParams.get('telefono') ?? '').replace(/\D/g, '').slice(-10)
  if (telefono.length !== 10) {
    return NextResponse.json({ error: 'Teléfono inválido' }, { status: 400 })
  }
  const db = supabaseAdmin()

  const { data: contactos, error } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', ctx.accountId)
    .like('phone', `%${telefono}`)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!contactos?.length) return NextResponse.json({ conversacion: null, mensajes: [] })

  const { data: convs } = await db
    .from('conversations')
    .select('id, last_message_at')
    .eq('account_id', ctx.accountId)
    .in('contact_id', contactos.map((c) => c.id))
    .order('last_message_at', { ascending: false })
  const ids = (convs ?? []).map((c) => c.id)
  if (!ids.length) return NextResponse.json({ conversacion: null, mensajes: [] })

  // Newest first to keep the last LIMITE, then back to reading order.
  const { data: filas, error: errMsgs } = await db
    .from('messages')
    .select('id, sender_type, content_type, content_text, template_name, media_url, media_type, status, created_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false })
    .limit(LIMITE)
  if (errMsgs) return NextResponse.json({ error: errMsgs.message }, { status: 500 })

  return NextResponse.json({
    // The most recent one: where "Abrir en el chat" should land.
    conversacion: ids[0],
    mensajes: (filas ?? []).reverse().map((m) => ({
      id: m.id,
      nuestro: m.sender_type !== 'customer',
      tipo: m.content_type,
      texto: m.content_text,
      plantilla: m.template_name,
      media_url: m.media_url,
      media_type: m.media_type,
      estado: m.status,
      fecha: m.created_at,
    })),
    completa: (filas ?? []).length < LIMITE,
  })
}
