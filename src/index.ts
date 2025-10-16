import type { HoaContext, HoaMiddleware } from 'hoa'

const DEFAULT_CACHEABLE_STATUS_CODES = [200]

export interface CacheOptions {
  cacheName?: string | ((ctx: HoaContext) => Promise<string> | string)
  wait?: boolean
  cacheControl?: string
  vary?: string | string[]
  keyGenerator?: (ctx: HoaContext) => Promise<string> | string
  cacheableStatusCodes?: number[]
}

/**
 * Cache middleware for Hoa.
 *
 * @param {Object} options - The options for the cache middleware.
 * @param {string | ((ctx: HoaContext) => Promise<string> | string)} [options.cacheName='cache'] - The name of the cache. Supports dynamic or async names to separate caches per route or context, enabling multiple caches with different identifiers.
 * @param {boolean} [options.wait=false] - Whether Hoa should wait for the Promise from `cache.put` before continuing the request. In Deno or environments with an execution context, prefer `wait=true` or pass `executionCtx` and use `waitUntil`.
 * @param {string} [options.cacheControl] - Directives for the `Cache-Control` header. If a handler already sets this header, directives are merged and de-duplicated; directives without values are appended.
 * @param {string | string[]} [options.vary] - Sets the `Vary` header. Merges with existing values, removes duplicates case-insensitively, normalizes to lowercase, and forbids "*".
 * @param {((ctx: HoaContext) => Promise<string> | string)} [options.keyGenerator] - Generates keys per request in the `cacheName` store; defaults to the request URL. Can be async and use route or context parameters.
 * @param {number[]} [options.cacheableStatusCodes=[200]] - An array of status codes that can be cached.
 * @returns {HoaMiddleware} The middleware handler function.
 * @throws {Error} If the `vary` option includes "*".
 */
export function cache (options: CacheOptions = {}): HoaMiddleware {
  const {
    cacheName = 'cache',
    wait = false,
    cacheControl,
    vary,
    keyGenerator,
    cacheableStatusCodes = DEFAULT_CACHEABLE_STATUS_CODES
  } = options
  if (!globalThis.caches) {
    return async (ctx, next) => await next()
  }

  const cacheControlDirectives = cacheControl?.split(',').map(directive => directive.toLowerCase())
  const varyDirectives = Array.isArray(vary) ? vary : vary?.split(',').map(directive => directive.trim())
  if (vary?.includes('*')) {
    throw new Error('Cache Middleware vary configuration cannot include "*", as it disallows effective caching')
  }
  const cacheableStatusCodeSet = new Set(cacheableStatusCodes)

  function addHeader (ctx: HoaContext) {
    if (cacheControlDirectives) {
      const existedDirectives = ctx.res.get('Cache-Control')?.split(',')
        .map(d => d.trim().split('=', 1)[0].toLowerCase()) ?? []
      for (const directive of cacheControlDirectives) {
        let [name, value] = directive.trim().split('=', 2)
        name = name.toLowerCase()
        if (!existedDirectives.includes(name)) {
          ctx.res.append('Cache-Control', `${name}${value ? `=${value}` : ''}`)
        }
      }
    }
    if (varyDirectives) {
      const existedDirectives = ctx.res.get('Vary')?.split(',').map(d => d.trim()) ?? []
      const vary = Array.from(
        new Set([...existedDirectives, ...varyDirectives].map(d => d.toLowerCase()))
      ).sort()
      if (vary.includes('*')) {
        ctx.res.set('Vary', '*')
      } else {
        ctx.res.set('Vary', vary.join(', '))
      }
    }
  }

  return async function cacheMiddleware (ctx, next) {
    let key = ctx.req.href
    if (keyGenerator) {
      key = await keyGenerator(ctx)
    }

    const resolvedCacheName = typeof cacheName === 'function' ? await cacheName(ctx) : cacheName
    const cache = await caches.open(resolvedCacheName)
    const cacheResponse = await cache.match(key)
    if (cacheResponse) {
      ctx.res.status = cacheResponse.status
      ctx.res.statusText = cacheResponse.statusText
      ctx.res.headers = cacheResponse.headers
      ctx.res.body = cacheResponse.body
      return
    }

    await next()
    if (!cacheableStatusCodeSet.has(ctx.res.status)) {
      return
    }
    addHeader(ctx)
    const response = ctx.response
    if (wait) {
      await cache.put(key, response)
    } else if (ctx.executionCtx?.waitUntil) {
      ctx.executionCtx.waitUntil(cache.put(key, response))
    } else {
      cache.put(key, response)
    }
  }
}

export default cache
