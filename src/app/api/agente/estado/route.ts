import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { requireAgenteAccess } from '@/lib/agente/access'

// GET /api/agente/estado
//
// Health of the VELIO agent for the banner on the audit page: when the
// Dropi token expires (the JWT `exp` saved by scripts/subir_token.py), when
// the agent last synced Dropi, and when it last did anything at all.
//
// Only the `vence` / `fecha` fields of the token row are selected — the
// token itself never leaves the database.

export async function GET() {
  try {
    await requireAgenteAccess()
  } catch (err) {
    return toErrorResponse(err)
  }
  const db = supabaseAdmin()

  const [token, sync, actividad] = await Promise.all([
    db
      .from('agente_archivos')
      .select('vence:contenido->>vence, subido:contenido->>fecha')
      .eq('ruta', 'secretos/dropi-token')
      .maybeSingle(),
    db
      .from('agente_eventos')
      .select('creado_en')
      .eq('tipo', 'sincronizado')
      .order('creado_en', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('agente_eventos')
      .select('creado_en')
      .order('creado_en', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    token_vence: (token.data as { vence?: string } | null)?.vence || null,
    token_subido: (token.data as { subido?: string } | null)?.subido || null,
    ultima_sync: sync.data?.creado_en ?? null,
    ultima_actividad: actividad.data?.creado_en ?? null,
  })
}
