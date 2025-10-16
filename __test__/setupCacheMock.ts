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
      async put (key: string | Request, value) {
        return new Promise(resolve => {
          setTimeout(() => {
            m.set(key, value)
            resolve()
          }, 10)
        })
      },
    }
  },
}
