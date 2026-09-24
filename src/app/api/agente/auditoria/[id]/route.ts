import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { requireAgenteAccess } from '@/lib/agente/access'

// POST /api/agente/auditoria/:id   { accion, version, nota? }
//
//   aprobar   pendiente -> aprobado. The agent service picks it up on its
//             next pass (~30 s) and sends it; this route never sends.
//   rechazar  pendiente|con_nota|error -> rechazado. Nothing is sent.
//   nota      pendiente|error -> con_nota. An instruction for the agent:
//             Andrés applies it in a Claude Code session, which regenerates
//             the message from the skill's templates and puts the case back
//             to pendiente (version + 1) for a second approval.
//   atendido  a case with nothing to send (a customer's reply that Andrés
//             answers in the chat) -> atendido.
//
// `version` is the one the page showed. If the agent regenerated the case
// meanwhile, the update matches no row and the page is asked to reload —
// so nobody approves a message they did not read.

const TRANSICIONES: Record<string, { desde: string[]; hacia: string }> = {
  aprobar: { desde: ['pendiente'], hacia: 'aprobado' },
  rechazar: { desde: ['pendiente', 'con_nota', 'error'], hacia: 'rechazado' },
  nota: { desde: ['pendiente', 'error'], hacia: 'con_nota' },
  atendido: { desde: ['pendiente', 'error'], hacia: 'atendido' },
  reintentar: { desde: ['error'], hacia: 'aprobado' },
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireAgenteAccess()
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const accion = typeof body?.accion === 'string' ? body.accion : ''
  const version = Number(body?.version)
  const regla = TRANSICIONES[accion]
  if (!regla || !Number.isInteger(version)) {
    return NextResponse.json({ error: 'accion o version invalida' }, { status: 400 })
  }

  const cambio: Record<string, unknown> = {
    estado: regla.hacia,
    resuelto_por: ctx.userId,
    resuelto_en: new Date().toISOString(),
    actualizado_en: new Date().toISOString(),
  }
  if (accion === 'nota') {
    const nota = typeof body?.nota === 'string' ? body.nota.trim() : ''
    if (!nota) return NextResponse.json({ error: 'la nota esta vacia' }, { status: 400 })
    cambio.nota = nota.slice(0, 4000)
  }
  if (accion === 'aprobar' || accion === 'reintentar') cambio.error = null

  const db = supabaseAdmin()
  if (accion === 'aprobar') {
    // Only cases that carry something to send can be approved.
    const { data: caso } = await db
      .from('agente_auditoria')
      .select('mensaje_propuesto, plantilla_meta, tipo')
      .eq('id', id)
      .maybeSingle()
    if (caso && !caso.mensaje_propuesto && !caso.plantilla_meta) {
      return NextResponse.json(
        { error: 'Este caso no tiene mensaje para enviar: márcalo como atendido.' },
        { status: 400 },
      )
    }
  }

  const { data, error } = await db
    .from('agente_auditoria')
    .update(cambio)
    .eq('id', id)
    .eq('version', version)
    .in('estado', regla.desde)
    .select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) {
    return NextResponse.json(
      { error: 'El caso cambió mientras lo mirabas. Recarga la página.' },
      { status: 409 },
    )
  }
  return NextResponse.json({ caso: data[0] })
}
