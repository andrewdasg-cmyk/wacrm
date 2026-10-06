// What has to be changed in Dropi BEFORE an order is confirmed.
//
// Confirming only flips the status in Dropi: it does not apply what the
// customer asked for in the chat. A pickup order confirmed as a home
// delivery, or an address corrected in the chat but not in Dropi, ships
// wrong and comes back. The audit page shows these as big alerts
// (Andrés, 2026-09-28) on the "Confirmar en Dropi" tab and on the cases
// whose approval confirms or opens the order.

export interface RetiroAlerta {
  // The office as the message names it ("Inter Rapidísimo — Oficina
  // principal de Bolívar"), or null when only the address says pickup.
  oficina: string | null
  // The carrier Dropi has now, when it differs from the office's.
  otra_transportadora: string | null
}

const sinTildes = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// The agent decides pickup on the first contact with the skill's own rule
// (`pide_retiro_en_oficina` + Maps) and ALWAYS sends it to audit, with the
// office in `contexto.oficina`. This fallback is for orders without that
// case, so it is deliberately narrow: a pickup word AND a carrier named.
// "Oficina 272" next to a street number is someone's office, not a pickup.
const PALABRA_RETIRO = /\b(retir|reclam|recog|oficina|sede|punto)/
const TRANSPORTADORA = /(inter ?rapid|interap|servientrega|coordinadora|\benvia\b|\btcc\b|deprisa)/

export function direccionPideRetiro(direccion: string | null | undefined): boolean {
  const d = sinTildes(direccion ?? '')
  return PALABRA_RETIRO.test(d) && TRANSPORTADORA.test(d)
}

export function esCasoDeRetiro(
  plantillaMeta: string | null | undefined,
  contexto: Record<string, unknown> | null | undefined,
): boolean {
  const ctx = contexto ?? {}
  return (
    plantillaMeta === 'velio_confirmacion_retiro' ||
    ctx.plantilla_escucha === 'velio_confirmacion_retiro' ||
    (typeof ctx.oficina === 'string' && ctx.oficina.trim() !== '')
  )
}

// "Inter Rapidísimo" vs "INTERRAPIDISIMO": the first letters are enough to
// tell carriers apart (inter, envia, coord, servi, tcc, depri).
const clave = (t: string) => sinTildes(t).replace(/[^a-z]/g, '').slice(0, 5)

export function otraTransportadora(oficina: string | null, transportadoraDropi: string | null | undefined) {
  const deOficina = (oficina ?? '').split('—')[0].trim()
  const enDropi = (transportadoraDropi ?? '').trim()
  if (!deOficina || !enDropi) return null
  return clave(deOficina) === clave(enDropi) ? null : enDropi
}

// A pickup written as one more change ("Dejarlo como RETIRO EN OFICINA: …"):
// the pages that already show the orange pickup box leave it out of the list.
export const esCambioDeRetiro = (cambio: string) => cambio.startsWith('Dejarlo como RETIRO')

// The changes Andrés has to apply in Dropi, as the audit case stores them.
// A confirmation carries the agent's own list (`cambios_dropi`, written by
// acciones.sellar); older cases and customer replies only have the fields.
export function cambiosDelContexto(contexto: Record<string, unknown> | null | undefined): string[] {
  const ctx = contexto ?? {}
  if (Array.isArray(ctx.cambios_dropi) && ctx.cambios_dropi.length) {
    return ctx.cambios_dropi.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
  }
  const cambios: string[] = []
  if (typeof ctx.unidades !== 'number' && typeof ctx.combos === 'number' && ctx.combos > 0) {
    cambios.push(`Cambiar la cantidad a ${ctx.combos * 2} unidades`)
  }
  if (typeof ctx.unidades === 'number') {
    const valor =
      typeof ctx.valor_nuevo === 'number' ? ` por $${ctx.valor_nuevo.toLocaleString('es-CO')}` : ''
    cambios.push(`Cambiar la cantidad a ${ctx.unidades} unidades${valor}`)
  }
  if (typeof ctx.direccion_nueva === 'string' && ctx.direccion_nueva) {
    cambios.push(`Cambiar la dirección a: ${ctx.direccion_nueva}`)
  }
  return cambios
}
