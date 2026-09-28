import { describe, expect, it } from 'vitest'
import { aBotones } from './botones'

describe('aBotones', () => {
  it('turns the confirm menu into buttons and drops the numbers', () => {
    const texto =
      'Hola\n\nPara responderme rápido puede escribir solo un número: 👇\n*1* — Sí, todo está correcto ✅\n*2* — Necesito cambiar algo 📝\n*3* — Ya no deseo el pedido ❌\n\nQuedo atento. 🤗'
    expect(aBotones(texto)).toEqual({
      cuerpo: 'Hola\n\nToque una opción aquí abajo. 👇\n\nQuedo atento. 🤗',
      botones: ['Sí, todo correcto', 'Cambiar algo', 'Ya no lo deseo'],
    })
  })

  it('keeps options that carry a price, and fills the number in the button', () => {
    const texto =
      '¿Los 2 pedidos fueron a propósito? Puede responderme solo con un número: 👇\n*1* — Sí, quiero los 2 (4 unidades por $159.900)\n*2* — No, déjeme solo uno (2 unidades por $79.900)\n*3* — Ya no deseo el pedido ❌'
    expect(aBotones(texto)).toEqual({
      cuerpo:
        '¿Los 2 pedidos fueron a propósito?\n🔹 Sí, quiero los 2 (4 unidades por $159.900)\n🔹 No, déjeme solo uno (2 unidades por $79.900)\n\nToque una opción aquí abajo. 👇',
      botones: ['Sí, quiero los 2', 'Solo uno', 'Ya no lo deseo'],
    })
  })

  it('an inline menu without the invitation just loses its lines', () => {
    const texto = '¿Se lo despacho con las 2 unidades?\n*1* — Sí, envíenme las 2 unidades 🎁\n*2* — Prefiero solo 1 unidad\n'
    expect(aBotones(texto)).toEqual({
      cuerpo: '¿Se lo despacho con las 2 unidades?',
      botones: ['Sí, las 2 unidades', 'Solo 1 unidad'],
    })
  })

  it('leaves text alone when an option is unknown or there is no menu', () => {
    expect(aBotones('*1* — Usted paga ahora\n*3* — O cancelamos')).toBeNull()
    expect(aBotones('Hola, sin menú')).toBeNull()
    expect(aBotones(null)).toBeNull()
  })
})
