import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { requireAgenteAccess } from '@/lib/agente/access'

// GET /api/agente/por-confirmar
//
// Orders still "Por confirmar" in Dropi whose customer already answered us
// in the chat: the ones Andrés has to confirm (or fix) in Dropi. The note
// says what the customer asked for, from the agent's reading of the reply
// (its audit case, or the `respuesta_clasificada` event) — and when the
// agent never read it (he answered by hand), the customer's own words.
//
// Sources: the agent's Dropi mirror (agente_archivos data/estado-actual.json),
// the CRM chat, and the agente_* tables.

interface RegistroDropi {
  lista?: string
  ausente?: boolean
  cliente?: string
  telefono?: string
  ciudad?: string
  direccion?: string
  valor?: number
  fecha_pedido?: string
  tienda?: string
  producto?: string
}

interface Mensaje {
  conversation_id: string
  sender_type: string
  content_type: string
  content_text: string | null
  media_url: string | null
  created_at: string
}

const INTENCION: Record<string, string> = {
  confirma: 'Confirmó',
  cambio: 'Pidió un cambio',
  dato: 'Agregó un dato',
  pregunta: 'Hizo una pregunta',
  cancela: 'Quiere cancelar',
  otro: 'Escribió algo',
}

const ultimos10 = (t?: string) => (t ?? '').replace(/\D/g, '').slice(-10)

// Dropi's dates are Bogotá time without a zone.
const fechaDropi = (f?: string) => (f ? new Date(`${f.replace(' ', 'T')}-05:00`) : null)

export async function GET() {
  let ctx
  try {
    ctx = await requireAgenteAccess()
  } catch (err) {
    return toErrorResponse(err)
  }
  const db = supabaseAdmin()

  const { data: archivo, error } = await db
    .from('agente_archivos')
    .select('contenido')
    .eq('ruta', 'data/estado-actual.json')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const estado = (archivo?.contenido ?? {}) as Record<string, RegistroDropi>
  const pedidos = Object.entries(estado).filter(
    ([, r]) => r.lista === 'Por confirmar' && !r.ausente && ultimos10(r.telefono).length === 10,
  )
  if (!pedidos.length) return NextResponse.json({ pedidos: [] })
  const ids = pedidos.map(([p]) => p)
  const telefonos = [...new Set(pedidos.map(([, r]) => ultimos10(r.telefono)))]

  const [casos, eventos, contactos] = await Promise.all([
    db
      .from('agente_auditoria')
      .select('pedido, tipo, estado, actualizado_en, contexto')
      .in('pedido', ids)
      .in('tipo', ['confirmacion', 'respuesta'])
      .order('actualizado_en', { ascending: false }),
    db
      .from('agente_eventos')
      .select('pedido, creado_en, detalle')
      .in('pedido', ids)
      .eq('tipo', 'respuesta_clasificada')
      .order('creado_en', { ascending: false }),
    db
      .from('contacts')
      .select('id, phone')
      .eq('account_id', ctx.accountId)
      .or(telefonos.map((t) => `phone.like.*${t}`).join(',')),
  ])

  const contactoTel = new Map<string, string>()
  for (const c of contactos.data ?? []) contactoTel.set(c.id, ultimos10(c.phone))
  const convTel = new Map<string, string>()
  const convDeTel = new Map<string, string>()
  if (contactoTel.size) {
    const { data: convs } = await db
      .from('conversations')
      .select('id, contact_id, last_message_at')
      .eq('account_id', ctx.accountId)
      .in('contact_id', [...contactoTel.keys()])
      .order('last_message_at', { ascending: false })
    for (const c of convs ?? []) {
      const tel = contactoTel.get(c.contact_id)
      if (!tel) continue
      convTel.set(c.id, tel)
      if (!convDeTel.has(tel)) convDeTel.set(tel, c.id)
    }
  }

  const desdeMin = Math.min(
    ...pedidos.map(([, r]) => (fechaDropi(r.fecha_pedido)?.getTime() ?? Date.now()) - 2 * 3600 * 1000),
  )
  const porTel = new Map<string, Mensaje[]>()
  if (convTel.size) {
    const { data: msgs } = await db
      .from('messages')
      .select('conversation_id, sender_type, content_type, content_text, media_url, created_at')
      .in('conversation_id', [...convTel.keys()])
      .gte('created_at', new Date(desdeMin).toISOString())
      .order('created_at', { ascending: true })
      .limit(5000)
    for (const m of (msgs ?? []) as Mensaje[]) {
      const tel = convTel.get(m.conversation_id)
      if (!tel) continue
      if (!porTel.has(tel)) porTel.set(tel, [])
      porTel.get(tel)!.push(m)
    }
  }

  const casoDe = new Map<string, NonNullable<typeof casos.data>[number]>()
  for (const c of casos.data ?? []) if (c.pedido && !casoDe.has(c.pedido)) casoDe.set(c.pedido, c)
  const eventoDe = new Map<string, NonNullable<typeof eventos.data>[number]>()
  for (const e of eventos.data ?? []) if (e.pedido && !eventoDe.has(e.pedido)) eventoDe.set(e.pedido, e)

  const salida = []
  for (const [pedido, r] of pedidos) {
    const tel = ultimos10(r.telefono)
    const desde = (fechaDropi(r.fecha_pedido)?.getTime() ?? 0) - 2 * 3600 * 1000
    const msgs = (porTel.get(tel) ?? []).filter((m) => new Date(m.created_at).getTime() >= desde)
    const primeroNuestro = msgs.find((m) => m.sender_type !== 'customer')
    // Only answers to us count: the Releasit "quiero confirmarlo" that opens
    // the chat is not a confirmation of the data we showed.
    const respuestas = primeroNuestro
      ? msgs.filter((m) => m.sender_type === 'customer' && m.created_at > primeroNuestro.created_at)
      : []
    const caso = casoDe.get(pedido)
    if (!respuestas.length && !caso) continue

    const ctxCaso = (caso?.contexto ?? {}) as Record<string, unknown>
    const detalleEv = (eventoDe.get(pedido)?.detalle ?? {}) as Record<string, unknown>
    const clasif = (ctxCaso.clasificacion ?? detalleEv.clasificacion ?? null) as
      | { intencion?: string; resumen?: string }
      | null
    const pide: string[] = []
    if (typeof ctxCaso.unidades === 'number') {
      const valor = typeof ctxCaso.valor_nuevo === 'number' ? ` por $${ctxCaso.valor_nuevo.toLocaleString('es-CO')}` : ''
      pide.push(`Cambiar la cantidad a ${ctxCaso.unidades} unidades${valor}`)
    }
    if (typeof ctxCaso.direccion_nueva === 'string' && ctxCaso.direccion_nueva) {
      pide.push(`Cambiar la dirección a: ${ctxCaso.direccion_nueva}`)
    }
    const ultimoCliente = respuestas.at(-1)
    const ultimoNuestro = msgs.filter((m) => m.sender_type !== 'customer').at(-1)

    salida.push({
      pedido,
      cliente: r.cliente ?? '',
      telefono: tel,
      ciudad: r.ciudad ?? '',
      direccion: r.direccion ?? '',
      valor: r.valor ?? null,
      producto: r.producto ?? '',
      tienda: r.tienda ?? '',
      fecha_pedido: r.fecha_pedido ?? '',
      intencion: clasif?.intencion ?? null,
      etiqueta: clasif?.intencion ? (INTENCION[clasif.intencion] ?? clasif.intencion) : 'Respondió',
      resumen: clasif?.resumen ?? '',
      pide,
      caso_estado: caso?.estado ?? null,
      // Did we write after his last message? Otherwise he is waiting on us.
      le_respondimos: Boolean(
        ultimoCliente && ultimoNuestro && ultimoNuestro.created_at > ultimoCliente.created_at,
      ),
      ultimo_mensaje: ultimoCliente?.created_at ?? null,
      conversacion: convDeTel.get(tel) ?? null,
      mensajes: respuestas.slice(-4).map((m) => ({
        texto: m.content_text,
        tipo: m.content_type,
        media_url: m.media_url,
        fecha: m.created_at,
      })),
    })
  }
  salida.sort((a, b) => (b.ultimo_mensaje ?? '').localeCompare(a.ultimo_mensaje ?? ''))
  return NextResponse.json({ pedidos: salida })
}
