import { describe, expect, it } from 'vitest'
import {
  cambiosDelContexto,
  direccionPideRetiro,
  esCasoDeRetiro,
  otraTransportadora,
} from './alertas'

describe('direccionPideRetiro', () => {
  it('pickup word and carrier named: pickup', () => {
    expect(direccionPideRetiro('Retiro Oficina interrapidisimo honda tolima')).toBe(true)
    expect(direccionPideRetiro('Carrera 3 # 5 -56 Interrrapidisimo barrio centro')).toBe(false)
    expect(direccionPideRetiro('Oficina Inter Rapidísimo, Sasaima')).toBe(true)
    expect(direccionPideRetiro('Reclamar en Servientrega del centro')).toBe(true)
  })

  it('an office next to a street number is not a pickup', () => {
    expect(direccionPideRetiro('Calle 4 Sur #43a-195, Edificio El Centro Ejecutivo, oficina 272')).toBe(false)
    expect(direccionPideRetiro('Avenida 3 Norte #35N-90, Prados del Norte')).toBe(false)
    expect(direccionPideRetiro('')).toBe(false)
    expect(direccionPideRetiro(undefined)).toBe(false)
  })
})

describe('esCasoDeRetiro', () => {
  it('reads the pickup template or the office the agent found', () => {
    expect(esCasoDeRetiro('velio_confirmacion_retiro', {})).toBe(true)
    expect(esCasoDeRetiro('velio_confirmacion_pedido', { oficina: 'Inter Rapidísimo — Oficina principal de Bolívar' })).toBe(true)
    expect(esCasoDeRetiro(null, { plantilla_escucha: 'velio_confirmacion_retiro' })).toBe(true)
    expect(esCasoDeRetiro('velio_confirmacion_pedido', { oficina: '' })).toBe(false)
    expect(esCasoDeRetiro(null, null)).toBe(false)
  })
})

describe('otraTransportadora', () => {
  it('flags Dropi carrying another carrier than the office', () => {
    expect(otraTransportadora('Inter Rapidísimo — Oficina principal de Bolívar', 'COORDINADORA')).toBe('COORDINADORA')
    expect(otraTransportadora('Inter Rapidísimo — Oficina principal de Bolívar', 'INTERRAPIDISIMO')).toBeNull()
    expect(otraTransportadora('Envía — Oficina principal de Honda', 'ENVIA')).toBeNull()
  })

  it('says nothing without both carriers', () => {
    expect(otraTransportadora(null, 'ENVIA')).toBeNull()
    expect(otraTransportadora('Inter Rapidísimo — Oficina principal', '')).toBeNull()
  })
})

describe('cambiosDelContexto', () => {
  it('lists quantity and address changes', () => {
    expect(cambiosDelContexto({ unidades: 4, valor_nuevo: 159800, direccion_nueva: 'Calle 1 #2-3' })).toEqual([
      `Cambiar la cantidad a 4 unidades por $${(159800).toLocaleString('es-CO')}`,
      'Cambiar la dirección a: Calle 1 #2-3',
    ])
    expect(cambiosDelContexto({})).toEqual([])
    expect(cambiosDelContexto(null)).toEqual([])
  })
})
