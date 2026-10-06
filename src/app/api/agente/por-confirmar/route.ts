import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { requireAgenteAccess } from '@/lib/agente/access'
import {
  cambiosDelContexto,
  direccionPideRetiro,
  esCambioDeRetiro,
  esCasoDeRetiro,
  otraTransportadora,
} from '@/lib/agente/alertas'

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
  transportadora?: string
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
  pausa: 'Lo deja para después',
  otro: 'Escribió algo',
}

/** agente_eventos.tipo of "Quitar de la lista". */
const QUITADO = 'confirmar_quitado'
/** agente_eventos.tipo of "Cambios hechos y pedido confirmado" / "Ya lo confirmé en Dropi". */
const HECHO = 'confirmar_hecho'

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

  const [casos, eventos, contactos, casosRetiro, quitados, hechos, sincronizado] = await Promise.all([
    // A case Andrés rejected, marked as handled, or that expired does not
    // keep the order here (Hugo Acosta, 29/9: only the ad's auto-message;
    // Nelson Umbarila, 30/9: only the Releasit summary, before our first
    // message). A real answer to us still shows it (`respuestas`).
    db
      .from('agente_auditoria')
      .select('pedido, tipo, estado, actualizado_en, contexto, mensaje_propuesto, plantilla_meta')
      .in('pedido', ids)
      .in('tipo', ['confirmacion', 'respuesta'])
      .not('estado', 'in', '(rechazado,vencido,atendido)')
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
    // Any case of these orders, to find the pickups: the agent sends every
    // pickup first contact to audit with its office (see lib/agente/alertas).
    db
      .from('agente_auditoria')
      .select('pedido, plantilla_meta, contexto')
      .in('pedido', ids)
      .order('actualizado_en', { ascending: false }),
    // "Quitar de la lista" (DELETE below).
    db
      .from('agente_eventos')
      .select('pedido, creado_en')
      .in('pedido', ids)
      .eq('tipo', QUITADO)
      .order('creado_en', { ascending: false }),
    // "Cambios hechos y pedido confirmado" (POST below).
    db
      .from('agente_eventos')
      .select('pedido, creado_en')
      .in('pedido', ids)
      .eq('tipo', HECHO)
      .order('creado_en', { ascending: false }),
    // When did the agent last read Dropi? An order marked as done before
    // that and still "Por confirmar" was not really confirmed.
    db
      .from('agente_eventos')
      .select('creado_en')
      .eq('tipo', 'sincronizado')
      .order('creado_en', { ascending: false })
      .limit(1),
  ])
  const hechoEn = new Map<string, string>()
  for (const h of hechos.data ?? []) if (h.pedido && !hechoEn.has(h.pedido)) hechoEn.set(h.pedido, h.creado_en)
  const ultimaSync = sincronizado.data?.[0]?.creado_en ? new Date(sincronizado.data[0].creado_en).getTime() : 0
  const quitadoEn = new Map<string, string>()
  for (const q of quitados.data ?? []) if (q.pedido && !quitadoEn.has(q.pedido)) quitadoEn.set(q.pedido, q.creado_en)

  const oficinaDe = new Map<string, string | null>()
  for (const c of casosRetiro.data ?? []) {
    if (!c.pedido || oficinaDe.has(c.pedido)) continue
    const ctx = (c.contexto ?? {}) as Record<string, unknown>
    if (esCasoDeRetiro(c.plantilla_meta, ctx)) {
      oficinaDe.set(c.pedido, typeof ctx.oficina === 'string' && ctx.oficina ? ctx.oficina : null)
    }
  }

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
    const todos = cambiosDelContexto(ctxCaso)
    const esRetiro =
      oficinaDe.has(pedido) || direccionPideRetiro(r.direccion) || todos.some(esCambioDeRetiro)
    // The pickup has its own box: it does not go twice.
    const pide = todos.filter((c) => !esCambioDeRetiro(c))
    // A change the agent could not turn into data ("otro teléfono", a
    // product) still has to be applied in Dropi: its summary is the change.
    const cambios = [...pide]
    if (!cambios.length && (clasif?.intencion === 'cambio' || clasif?.intencion === 'dato') && clasif.resumen) {
      cambios.push(clasif.resumen)
    }
    const oficina = oficinaDe.get(pedido) ?? null
    const ultimoCliente = respuestas.at(-1)
    const ultimoNuestro = msgs.filter((m) => m.sender_type !== 'customer').at(-1)
    // Removed by hand: it comes back only if the customer writes again.
    const quitado = quitadoEn.get(pedido)
    if (quitado && (!ultimoCliente || new Date(ultimoCliente.created_at) <= new Date(quitado))) continue
    // Marked as done: hidden until the agent reads Dropi again. If Dropi
    // still has it "Por confirmar" after that read, it comes back, in red.
    const hecho = hechoEn.get(pedido) ?? null
    const leidoDespues = hecho ? ultimaSync > new Date(hecho).getTime() + 60_000 : false
    if (hecho && !leidoDespues) continue

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
      cambios,
      retiro: esRetiro
        ? { oficina, otra_transportadora: otraTransportadora(oficina, r.transportadora) }
        : null,
      // He said it was done, and Dropi still shows it unconfirmed.
      hecho_sin_confirmar: hecho,
      caso_estado: caso?.estado ?? null,
      caso_tipo: caso?.tipo ?? null,
      // Is there already a message drafted for this customer in the queue?
      caso_tiene_mensaje: Boolean(caso && (caso.mensaje_propuesto || caso.plantilla_meta)),
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

// POST /api/agente/por-confirmar  { pedido }
//
// "Armar confirmación": Andrés already settled the chat by hand. Queues an
// `armar_confirmacion` task; on its next pass (≤30 s) the agent reads the
// conversation, builds the confirmation message with the final address or
// quantity (agente/cambios.py) and leaves it in the audit queue.
export async function POST(request: Request) {
  try {
    await requireAgenteAccess()
  } catch (err) {
    return toErrorResponse(err)
  }
  const body = (await request.json().catch(() => null)) as
    | { pedido?: unknown; hecho?: unknown; armar?: unknown }
    | null
  const pedido = typeof body?.pedido === 'string' ? body.pedido.trim() : ''
  if (!/^\d{5,12}$/.test(pedido)) {
    return NextResponse.json({ error: 'Número de pedido inválido' }, { status: 400 })
  }
  const db = supabaseAdmin()
  // "Cambios hechos y pedido confirmado": Andrés already edited and
  // confirmed the order in Dropi. The card goes away, and if the customer
  // has no confirmation message yet (`armar`), the agent drafts it.
  const hecho = body?.hecho === true
  if (hecho) {
    const { error } = await db
      .from('agente_eventos')
      .insert({ tipo: HECHO, pedido, detalle: { por: 'Andres (Confirmar en Dropi)' } })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (body?.armar !== true) return NextResponse.json({ ok: true, armada: false })
  }
  const { error } = await db.from('agente_tareas').insert({
    clave: `armar:${pedido}:${Date.now()}`,
    tipo: 'armar_confirmacion',
    ejecutar_en: new Date().toISOString(),
    datos: hecho ? { pedido, hecho: true } : { pedido },
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, armada: true })
}

// DELETE /api/agente/por-confirmar  { pedido }
//
// "Quitar de la lista": the order stays "Por confirmar" in Dropi but there is
// nothing to confirm yet (James Parra only said "Buenas", 29/9). Logged as an
// agente_eventos row; GET hides the order until the customer writes again.
export async function DELETE(request: Request) {
  try {
    await requireAgenteAccess()
  } catch (err) {
    return toErrorResponse(err)
  }
  const body = (await request.json().catch(() => null)) as { pedido?: unknown } | null
  const pedido = typeof body?.pedido === 'string' ? body.pedido.trim() : ''
  if (!/^\d{5,12}$/.test(pedido)) {
    return NextResponse.json({ error: 'Número de pedido inválido' }, { status: 400 })
  }
  const { error } = await supabaseAdmin()
    .from('agente_eventos')
    .insert({ tipo: QUITADO, pedido, detalle: { por: 'Andres (Confirmar en Dropi)' } })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
