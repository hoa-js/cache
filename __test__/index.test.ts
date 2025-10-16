import { Hoa } from 'hoa'
import type { HoaContext } from 'hoa'
import { describe, it, expect } from '@jest/globals'
import { cache } from '../src/index'
import { router } from '@hoajs/router'

const executionCtx = {
  waitUntil: async (promise: Promise<Response>) => {
    await promise
  }
}

describe('Customizing Caching Keys', () => {
  const app = new Hoa()
  const dynamicCacheName = 'dynamic-cache-name'
  app.use(cache({ wait: true, cacheName: () => dynamicCacheName }))
  it('Should use dynamically generated cache name', async () => {
    app.use(async (ctx: HoaContext, next) => {
      ctx.res.body = { success: true }
    })
    const response = await app.fetch(new Request('http://localhost', { method: 'GET' }))
    const res = await response.json()
    const cache = await caches.open(dynamicCacheName)
    const keys = Array.from(await cache.keys())
    expect(keys.length).toBe(1)
    expect(res).toEqual({ success: true })
  })
})

describe('Customizing Caching Keys by async', () => {
  const app = new Hoa()
  const dynamicCacheKey = 'dynamic-cache-key'
  app.use(cache({
    wait: true,
    cacheName: () => new Promise(resolve => {
      setTimeout(() => {
        resolve(dynamicCacheKey)
      }, 200)
    })
  }))
  it('Should use dynamically generated cache name', async () => {
    app.use(async (ctx: HoaContext, next) => {
      ctx.res.body = { success: true }
    })
    const response = await app.fetch(new Request('http://localhost', { method: 'GET' }))
    const res = await response.json()
    const cache = await caches.open(dynamicCacheKey)
    const keys = Array.from(await cache.keys())
    expect(keys.length).toBe(1)
    expect(res).toEqual({ success: true })
  })
})

describe('Cache Middleware', () => {
  const app = new Hoa()
  app.extend(router())
  let count = 1
  app.get('/wait/',
    cache({ wait: true, cacheName: 'hoa-app-v1', cacheControl: 'max-age=60' }),
    (ctx) => {
      ctx.res.set('X-count', `${count}`)
      count++
      ctx.res.body = `${count}`
    }
  )
  it('Should return cached response', async () => {
    await app.fetch(new Request('http://localhost/wait/'))
    const response = await app.fetch(new Request('http://localhost/wait/'))
    const res = await response.text()
    const cache = await caches.open('hoa-app-v1')
    const cacheLength = Array.from(await cache.keys()).length
    expect(cacheLength).toBe(1)
    expect(response.status).toBe(200)
    expect(res).toBe('2')
    expect(response.headers.get('cache-control')).toBe('max-age=60')
    expect(response.headers.get('X-count')).toBe('1')
  })

  app.get('/not-wait/',
    cache({ cacheName: 'hoa-app-v2', cacheControl: 'max-age=60', keyGenerator: () => 'not-wait' }),
    (ctx) => {
      ctx.res.body = ctx.req.query.page
    }
  )

  it('Should not return cached response', async () => {
    await app.fetch(new Request('http://localhost' + '/not-wait/?page=1'), undefined, executionCtx)
    const response = await app.fetch(new Request('http://localhost/not-wait/?page=2'), undefined, executionCtx)
    const res = await response.text()
    const cache = await caches.open('hoa-app-v2')
    const cacheLength = Array.from(await cache.keys()).length
    expect(cacheLength).toBe(0)
    expect(response.status).toBe(200)
    expect(res).toBe('2')
    expect(response.headers.get('cache-control')).toBe('max-age=60')
  })

  app.get('/header/:path',
    cache({ wait: true, cacheName: 'hoa-app-header', cacheControl: 'max-age=20' }),
    (ctx) => {
      ctx.res.headers = ctx.req.headers
      ctx.res.body = 'header'
    }
  )

  it('Should use custom header values', async () => {
    const response = await app.fetch(new Request('http://localhost/header/use-config', {
      headers: { 'cache-control': 'max-age=60' }
    }))
    const res = await response.text()
    expect(res).not.toBeNull()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('max-age=60')
  })

  it('Should merge header values', async () => {
    const response = await app.fetch(new Request('http://localhost/header/merge-header', {
      headers: { 'Cache-Control': 'private' }
    }))
    const res = await response.text()
    expect(res).not.toBeNull()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, max-age=20')
  })

  app.get('/header2/:path',
    cache({ wait: true, cacheName: 'hoa-app-header-2', cacheControl: 'public' }),
    (ctx) => {
      ctx.res.headers = ctx.req.headers
      ctx.res.body = 'header2'
    }
  )

  it('Should append directive without value to Cache-Control', async () => {
    const response = await app.fetch(new Request('http://localhost/header2/merge', {
      headers: { 'Cache-Control': 'private' }
    }))
    const res = await response.text()
    expect(res).not.toBeNull()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, public')
  })

  app.get('/vary/:path',
    cache({
      wait: true,
      cacheName: 'hoa-app-vary',
      cacheControl: 'max-age=20',
      vary: ['Accept']
    }),
    (ctx) => {
      ctx.res.headers = ctx.req.headers
      ctx.res.body = 'vary'
    }
  )

  it('Should correctly apply a single Vary header from middleware', async () => {
    const response = await app.fetch(new Request('http://localhost/vary/single'))
    const res = await response.text()
    expect(res).not.toBeNull()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('max-age=20')
    expect(response.headers.get('vary')).toBe('accept')
  })

  it('Should merge header vary values', async () => {
    const response = await app.fetch(new Request('http://localhost/vary/merge-header', {
      headers: { Vary: 'Accept-Encoding' }
    }))
    const res = await response.text()
    expect(res).not.toBeNull()
    expect(response.status).toBe(200)
    expect(response.headers.get('vary')).toBe('accept, accept-encoding')
  })

  it('Should deduplicate when merge header vary values', async () => {
    const response = await app.fetch(new Request('http://localhost/vary/merge-header', {
      headers: { Vary: 'Accept-Encoding, Accept' }
    }))
    const res = await response.text()
    expect(res).not.toBeNull()
    expect(response.status).toBe(200)
    expect(response.headers.get('vary')).toBe('accept, accept-encoding')
  })

  it('Should prioritize the "*" Vary header from handler over any set by middleware', async () => {
    const response = await app.fetch(new Request('http://localhost/vary/merge-header-1', {
      headers: { Vary: '*' }
    }))
    const res = await response.text()
    expect(res).not.toBeNull()
    expect(response.status).toBe(200)
    expect(response.headers.get('vary')).toBe('*')
  })

  app.get('/vary-str/:path',
    cache({
      wait: true,
      cacheName: 'hoa-app-vary-str',
      cacheControl: 'max-age=20',
      vary: 'Accept-Encoding'
    }),
    (ctx) => {
      ctx.res.headers = ctx.req.headers
      ctx.res.body = 'vary-str'
    }
  )

  it('Should handle string vary option and merge with handler header', async () => {
    const response = await app.fetch(new Request('http://localhost/vary-str/merge', {
      headers: { Vary: 'Accept' }
    }))
    const res = await response.text()
    expect(res).not.toBeNull()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('max-age=20')
    expect(response.headers.get('vary')).toBe('accept, accept-encoding')
  })

  app.get('/res/:type',
    cache({
      wait: true,
      cacheName: 'hoa-app-vary',
      cacheControl: 'max-age=20',
      vary: ['Accept']
    }),
    (ctx) => {
      ctx.res.headers = ctx.req.headers
      let body
      const typeParam = ctx.req.params?.type ?? 'Response'
      switch (typeParam) {
        case 'Blob':
          body = new Blob(['{"a":1}'], { type: 'application/json' })
          break
        case 'Response':
          body = new Response('cached')
          break
        case 'ArrayBuffer':
          body = new ArrayBuffer(2)
          break
        case 'FormData': {
          const fd = new FormData()
          fd.append('field', 'value')
          body = fd
          break
        }
        case 'Stream': {
          body = new ReadableStream({
            start (controller) {
              controller.enqueue(new TextEncoder().encode('cached'))
              controller.close()
            }
          })
          break
        }
        case 'URLSearchParams': {
          const params = new URLSearchParams({ a: '1', b: '2' })
          body = params
          break
        }
        case 'json_stringify_error': {
          const a = { a: 1 }
          a['b'] = a
          body = a
          break
        }
      }
      ctx.res.body = body
    }
  )
  // 'json_stringify_error'
  it.each(['Blob', 'Response', 'Stream', 'ArrayBuffer', 'FormData', 'URLSearchParams'])('Should serialize response when response is %s', async (responseType) => {
    const response = await app.fetch(new Request('http://localhost/res/' + responseType, {
      headers: { Vary: '*' }
    }))
    let res
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      res = await response.json()
    } else {
      res = await response.text()
    }
    if (responseType === 'json_stringify_error') {
      expect(response.status).toBe(500)
      expect(response.headers.get('vary')).toBeNull()
    } else {
      expect(response.status).toBe(200)
      expect(response.headers.get('vary')).toBe('*')
    }
    expect(res).not.toBeNull()
  })

  it('Should not allow "*" as a Vary header in middleware configuration due to its impact on caching effectiveness', async () => {
    expect(() => cache({ cacheName: 'hoa-app-vary-*', wait: true, vary: ['*'] })).toThrow()
    expect(() => cache({ cacheName: 'hoa-app-vary-*', wait: true, vary: '*' })).toThrow()
  })

  app.get('/default/:code',
    cache({
      wait: true,
      cacheName: 'hoa-app-status',
      cacheControl: 'max-age=20',
    }),
    (ctx) => {
      ctx.res.body = 'cached'
      const codeParam = ctx.req.params?.code ?? '200'
      const code = Number(codeParam)
      ctx.res.status = code
    }
  )

  it.each([200])('Should cache %i in default cacheable status codes', async (code) => {
    await app.fetch(new Request('http://localhost/default/' + code))
    const response = await app.fetch(new Request('http://localhost/default/' + code))
    expect(response.status).toBe(code)
    expect(response.headers.get('cache-control')).toBe('max-age=20')
  })

  it.each([
    201, 202, 205, 207, 208, 226, 302, 303, 304, 307, 308, 400, 401, 402, 403,
    406, 407, 408, 409, 411, 412, 413, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429,
    431, 451, 500, 502, 503, 504, 505, 506, 507, 508, 510, 511,
  ])('Should not cache %i in default cacheable status codes', async (code) => {
    await app.fetch(new Request('http://localhost/default/' + code))
    const response = await app.fetch(new Request('http://localhost/default/' + code))
    expect(response.status).toBe(code)
    expect(response.headers.get('cache-control')).not.toBe('max-age=20')
  })

  // it.each([
  //   100, 101, 102, 103
  // ])('Should not cache %i in default cacheable status codes', async (code) => {
  //   await app.fetch(new Request('http://localhost/default/' + code))
  //   const response = await app.fetch(new Request('http://localhost/default/' + code))
  //   expect(response.status).toBe(code)
  //   expect(response.headers.get('cache-control')).toBe('max-age=20')
  // })

  app.get('/custom/:code',
    cache({
      wait: true,
      cacheName: 'hoa-app-custom',
      cacheControl: 'max-age=20',
      cacheableStatusCodes: [200, 201]
    }),
    (ctx) => {
      ctx.res.body = 'cached'
      const codeParam = ctx.req.params?.code ?? '200'
      const code = Number(codeParam)
      ctx.res.status = code
    }
  )

  it.each([200, 201])('Should cache %i in custom cacheable status codes', async (code) => {
    await app.fetch(new Request('http://localhost/custom/' + code))
    const response = await app.fetch(new Request('http://localhost/custom/' + code))
    expect(response.status).toBe(code)
    expect(response.headers.get('cache-control')).toBe('max-age=20')
  })

  it.each([
    202, 205, 207, 208, 226, 302, 303, 304, 307, 308, 400, 401, 402, 403, 406,
    407, 408, 409, 411, 412, 413, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431,
    451, 500, 502, 503, 504, 505, 506, 507, 508, 510, 511
  ])('Should not cache %i in custom cacheable status codes', async (code) => {
    await app.fetch(new Request('http://localhost/custom/' + code))
    const response = await app.fetch(new Request('http://localhost/custom/' + code))
    expect(response.status).toBe(code)
    expect(response.headers.get('cache-control')).not.toBe('max-age=20')
  })
})

describe('', () => {
  it('Should not be enabled if caches is not defined', async () => {
    (globalThis as any).caches = undefined
    const app = new Hoa()
    app.extend(router())
    app.use(cache({ cacheName: 'cache', cacheControl: 'max-age=10' }))
    app.get('/', (ctx) => {
      ctx.res.body = 'cached'
    })
    expect(caches).toBeUndefined()
    const response = await app.fetch(new Request('http://localhost/'))
    const res = await response.text()
    expect(res).not.toBeNull()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(null)
  })

  it('Should write to cache via fallback when no wait and no executionCtx', async () => {
    // restore caches mock locally (module import is cached; rebuild here)
    const memoryCache = new Map<string, Map<string | Request, Response>>()
    globalThis.caches = {
      async open (name: string) {
        let m = memoryCache.get(name)
        if (!m) {
          memoryCache.set(name, m = new Map())
        }
        return {
          async keys () {
            return Promise.resolve([...m.keys()])
          },
          async match (key: string | Request) {
            return Promise.resolve(m.get(key))
          },
          async delete (key: string | Request) {
            const isDelete = m.delete(key)
            return Promise.resolve(isDelete)
          },
          async put (key: string | Request, value: Response) {
            return new Promise(resolve => {
              setTimeout(() => {
                m.set(key, value)
                resolve(undefined)
              }, 10)
            })
          },
        }
      },
    } as any
    // Setup app without wait and without passing executionCtx to fetch
    const app = new Hoa()
    app.extend(router())
    app.get('/fallback/',
      cache({ cacheName: 'hoa-app-fallback', keyGenerator: () => 'fallback-key' }),
      (ctx) => {
        ctx.res.body = 'ok'
      }
    )
    const response = await app.fetch(new Request('http://localhost/fallback/'))
    expect(response.status).toBe(200)
    // allow async cache.put to resolve
    await new Promise(resolve => setTimeout(resolve, 30))
    const cacheStore = await caches.open('hoa-app-fallback')
    const keys = Array.from(await cacheStore.keys())
    expect(keys).toContain('fallback-key')
  })

  it('Should use default options when middleware called without config', async () => {
    const app = new Hoa()
    app.extend(router())
    app.use(cache())
    app.get('/default-cache/', (ctx) => {
      ctx.res.body = 'ok'
    })
    const res1 = await app.fetch(new Request('http://localhost/default-cache/'))
    expect(res1.status).toBe(200)
    // allow async cache.put to resolve for default wait=false
    await new Promise(resolve => setTimeout(resolve, 30))
    const cacheStore = await caches.open('cache')
    const keys = Array.from(await cacheStore.keys())
    expect(keys.length).toBeGreaterThan(0)
  })
})
