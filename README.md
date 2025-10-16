## @hoajs/cache

Cache middleware for Hoa.

## Installation

```bash
$ npm i @hoajs/cache --save
```

## Quick Start

```js
import { Hoa } from 'hoa'
import { cache } from '@hoajs/cache'

const app = new Hoa()
app.use(cache())

app.use(async (ctx) => {
  ctx.res.body = `Hello, Hoa!`
})

export default app
```

## Documentation

The documentation is available on [hoa-js.com](https://hoa-js.com/middleware/cache.html)

## Test (100% coverage)

```sh
$ npm test
```

## License

MIT
