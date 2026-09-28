// The numbered menu of the VELIO agent's free-text messages goes out as
// WhatsApp reply buttons (Andrés, 28/9): tapping beats typing "1".
//
// The source of truth is the skill (mensajes-whatsapp/plantillas/plantillas.py,
// `OPCIONES_BOTON` and `a_botones`): the agent converts the text when it
// sends it. This copy only shows the audit page what the customer will get.
// If you change one, change the other.

/** [menu option, button, keep the option written in the body]. The option
 *  stays written when it carries a price the 20-letter button can't show. */
const OPCIONES: [RegExp, string, boolean][] = [
  [/^S[ií], todo est[aá] correcto/, 'Sí, todo correcto', false],
  [/^Necesito cambiar algo/, 'Cambiar algo', false],
  [/^Ya no deseo el pedido/, 'Ya no lo deseo', false],
  [/^S[ií], lo deseo/, 'Sí, lo deseo', false],
  [/^Ya no lo deseo/, 'Ya no lo deseo', false],
  [/^S[ií], env[ií]enme las 2 unidades/, 'Sí, las 2 unidades', false],
  [/^Prefiero solo 1 unidad/, 'Solo 1 unidad', false],
  [/^La \*oferta doble\*/, 'Oferta doble', true],
  [/^Una sola \*oferta/, 'Una sola oferta', true],
  [/^S[ií], quiero los (\d+)/, 'Sí, quiero los {0}', true],
  [/^No, d[ée]jeme solo uno/, 'Solo uno', true],
]
const INVITACION_NUMERO =
  /(Para responderme rápido puede|Puede responderme) (escribir )?solo (con )?un número: 👇/
const INVITACION_BOTON = 'Toque una opción aquí abajo. 👇'
const OPCION = /^\*\d\* — /

export interface ConBotones {
  cuerpo: string
  botones: string[]
}

/** The message as the customer receives it, or null when it has no menu
 *  that fits in buttons (then it goes out as text, numbers and all). */
export function aBotones(texto: string | null | undefined): ConBotones | null {
  const lineas = (texto ?? '').split('\n')
  const menu = lineas.flatMap((l, i) => (OPCION.test(l.trim()) ? [i] : []))
  if (menu.length < 2 || menu.length > 3 || menu.some((n, k) => n !== menu[0] + k)) return null

  const botones: string[] = []
  const quedan: string[] = []
  for (const i of menu) {
    const opcion = lineas[i].trim().replace(OPCION, '')
    const regla = OPCIONES.find(([patron]) => patron.test(opcion))
    if (!regla) return null
    const [patron, boton, seQueda] = regla
    const grupos = opcion.match(patron)?.slice(1) ?? []
    botones.push(boton.replace(/\{(\d)\}/g, (_, n: string) => grupos[Number(n)] ?? ''))
    if (seQueda) quedan.push('🔹 ' + opcion)
  }
  if (new Set(botones).size !== botones.length || botones.some((b) => b.length > 20)) return null

  let invitaba = false
  for (let i = menu[0] - 1; i >= Math.max(menu[0] - 2, 0); i--) {
    if (INVITACION_NUMERO.test(lineas[i])) {
      lineas[i] = lineas[i].replace(new RegExp('\\s*' + INVITACION_NUMERO.source), '').trimEnd()
      invitaba = true
      break
    }
  }
  const nuevas = [...quedan, ...(invitaba ? [...(quedan.length ? [''] : []), INVITACION_BOTON] : [])]
  lineas.splice(menu[0], menu.length, ...nuevas)
  const cuerpo = lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (cuerpo.length > 1024) return null
  return { cuerpo, botones }
}
