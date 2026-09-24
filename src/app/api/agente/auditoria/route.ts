import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { ESTADOS_ABIERTOS, requireAgenteAccess } from '@/lib/agente/access'

// GET /api/agente/auditoria?vista=abiertos|cerrados
//
// The VELIO agent's audit queue. Each row also carries `plantilla_texto`:
// the Meta template body with its {{n}} filled from `variables`, when the
// template has been synced into message_templates — so the page shows the
// message exactly as the customer would read it.

export async function GET(request: Request) {
  let ctx
  try {
    ctx = await requireAgenteAccess()
  } catch (err) {
    return toErrorResponse(err)
  }

  const vista = new URL(request.url).searchParams.get('vista') === 'cerrados' ? 'cerrados' : 'abiertos'
  const db = supabaseAdmin()
  let query = db.from('agente_auditoria').select('*')
  query =
    vista === 'abiertos'
      ? query.in('estado', [...ESTADOS_ABIERTOS]).order('creado_en', { ascending: true })
      : query
          .not('estado', 'in', `(${ESTADOS_ABIERTOS.join(',')})`)
          .order('actualizado_en', { ascending: false })
          .limit(100)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const nombres = [...new Set((data ?? []).map((c) => c.plantilla_meta).filter(Boolean))]
  const cuerpos: Record<string, string> = {}
  if (nombres.length) {
    const { data: plantillas } = await db
      .from('message_templates')
      .select('name, body_text, account_id')
      .in('name', nombres)
    for (const p of plantillas ?? []) {
      if (p.account_id === ctx.accountId) cuerpos[p.name] = p.body_text
    }
  }

  const casos = (data ?? []).map((c) => {
    const cuerpo = c.plantilla_meta ? cuerpos[c.plantilla_meta] : undefined
    const vars: string[] = Array.isArray(c.variables) ? c.variables : []
    return {
      ...c,
      plantilla_texto: cuerpo
        ? cuerpo.replace(/\{\{(\d+)\}\}/g, (m: string, n: string) => vars[Number(n) - 1] ?? m)
        : null,
    }
  })
  return NextResponse.json({ casos })
}
