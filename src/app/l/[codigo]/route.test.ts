import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  contenido: null as unknown,
  insert: vi.fn(),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) =>
      tabla === 'agente_archivos'
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: mocks.contenido === null ? null : { contenido: mocks.contenido },
                }),
              }),
            }),
          }
        : { insert: mocks.insert },
  }),
}))

import { GET } from './route'

const TIENDA = 'https://veliocolombia.com/'

async function abrir(codigo: string) {
  const res = await GET(new Request(`https://crm.veliocolombia.com/l/${codigo}`), {
    params: Promise.resolve({ codigo }),
  })
  return { status: res.status, location: res.headers.get('location') }
}

describe('GET /l/:codigo', () => {
  beforeEach(() => {
    mocks.contenido = null
    mocks.insert.mockReset()
    mocks.insert.mockResolvedValue({ error: null })
  })

  it('redirects to the stored long link, query string untouched, and logs the open', async () => {
    const largo = 'https://veliocolombia.com/products/aspersor-de-agua-360?rsiacd=bWV0cmljc19x+/=&utm_source=fb'
    mocks.contenido = { url: largo, pedido: 'D124' }
    expect(await abrir('Wykhgvm')).toEqual({ status: 302, location: largo })
    expect(mocks.insert).toHaveBeenCalledWith({
      tipo: 'enlace_abierto',
      pedido: 'D124',
      detalle: { codigo: 'Wykhgvm' },
    })
  })

  it('accepts the old myshopify domain too', async () => {
    mocks.contenido = { url: 'https://veliocol.myshopify.com/products/aspersor-de-agua-360' }
    expect((await abrir('abc1234')).location).toBe('https://veliocol.myshopify.com/products/aspersor-de-agua-360')
  })

  it('never redirects outside the store', async () => {
    mocks.contenido = { url: 'https://evil.example.com/phish' }
    expect((await abrir('abc1234')).location).toBe(TIENDA)
    mocks.contenido = { url: 'http://veliocolombia.com/products/x' }
    expect((await abrir('abc1234')).location).toBe(TIENDA)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('an unknown or malformed code goes to the store home', async () => {
    expect(await abrir('noexiste')).toEqual({ status: 302, location: TIENDA })
    expect((await abrir('../../etc')).location).toBe(TIENDA)
  })
})
