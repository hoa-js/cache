import { HoaContext, HoaMiddleware } from 'hoa'

const DEFAULT_CACHEABLE_STATUS_CODES = [200]

export interface CacheOptions {
  cacheName?: string | ((ctx: HoaContext) => Promise<string> | string)
  wait?: boolean
  cacheControl?: string
  vary?: string | string[]
  keyGenerator?: (ctx: HoaContext) => Promise<string> | string
  cacheableStatusCodes?: number[]
}

export function cache (options: CacheOptions = {}): HoaMiddleware {
  const {
    cacheName = 'hoa-cache',
    vary, cacheControl,
    wait = false,
    keyGenerator,
    cacheableStatusCodes = DEFAULT_CACHEABLE_STATUS_CODES
  } = options
  if (!globalThis.caches) {
    return async function (ctx, next) {
      return await next()
    }
  }
  const cacheControlDirectives = cacheControl?.split(',')
    .map(directive => directive.toLowerCase())
  const varyDirectives = Array.isArray(vary) ? vary : vary?.split(',').map(directive => directive.trim())
  if (vary?.includes('*')) {
    throw new Error('Cache Middleware vary configuration cannot include "*", as it disallows effective caching')
  }
  const cacheableStatusCodeSet = new Set(cacheableStatusCodes)
  function addHeader (ctx: HoaContext) {
    if (cacheControlDirectives) {
      const existedDirectives = ctx.res.get('Cache-Control')?.split(',')
        .map(d => d.trim().split('=', 1)[0]) ?? []
      for (const directive of cacheControlDirectives) {
        const trimmedDirective = directive.trim()
        const firstPosition = trimmedDirective.indexOf('=')
        let name = firstPosition <= 0 ? trimmedDirective : trimmedDirective.slice(0, firstPosition)
        const value = firstPosition <= 0 ? undefined : trimmedDirective.slice(firstPosition + 1)
        name = name.toLowerCase()
        if (!existedDirectives.includes(name)) {
          ctx.res.append('Cache-Control', `${name}${value ? `=${value}` : ''}`)
        }
      }
    }
    if (varyDirectives) {
      const existedDirectives = (ctx.res.get('Vary')?.split(',').map(d => d.trim()) ?? []).map(d => d.toLowerCase())
      const _vary = Array.from(new Set([...existedDirectives, ...varyDirectives].map(d => d.toLowerCase()))).sort()
      if (_vary.includes('*')) {
        ctx.res.set('Vary', '*')
      } else {
        ctx.res.set('Vary', _vary.join(','))
      }
    }
  }
  return async function cacheMiddleware (ctx, next) {
    let key = ctx.req.href
    if (keyGenerator) {
      key = await keyGenerator(ctx)
    }

    const _cacheName = typeof cacheName === 'function' ? await cacheName(ctx) : cacheName
    const cache = await caches.open(_cacheName)
    const cached = await cache.match(key)
    if (cached) {
      const cachedText = await cached.text()
      const data = JSON.parse(cachedText)
      ctx.res.status = data.status
      ctx.res.statusText = data.statusText
      ctx.res.headers = data.headers
      ctx.res.body = data.body
      return
    }
    await next()
    if (!cacheableStatusCodeSet.has(ctx.res.status)) {
      return
    }
    addHeader(ctx)
    const entry = await serializeResponse(ctx)
    const responseToStore = new Response(entry, {
      headers: { 'Content-Type': 'application/json' }
    })
    if (wait) {
      await cache.put(key, responseToStore)
    } else {
      ctx.executionCtx.waitUntil(cache.put(key, responseToStore))
    }
  }
}

async function serializeResponse (ctx: HoaContext) {
  const res = ctx.res
  let body = res.body
  if (body instanceof Response) {
    const cloned = body.clone()
    body = await cloned.text()
  }
  const _headers = { ...res.headers }
  if (body instanceof ReadableStream) {
    const [cachedBody, returnedBody] = body.tee()
    ctx.res.body = returnedBody
    _headers['Content-Type'] = 'text/plain; charset=utf-8'
    const reader = cachedBody.getReader()
    const chunks = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const totalLength = chunks.reduce((len, c) => len + c.length, 0)
    const all = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      all.set(chunk, offset)
      offset += chunk.length
    }
    body = new TextDecoder().decode(all)
  } else if (body instanceof Blob) {
    body = await body.text()
  } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    body = new TextDecoder().decode(body)
  } else if (typeof body !== 'string') {
    try {
      body = JSON.stringify(body)
    } catch {
      body = String(body)
    }
  }

  return JSON.stringify({
    status: res.status,
    statusText: res.statusText,
    headers: _headers,
    body
  })
}

export default cache
