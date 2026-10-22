import { HomeRoom } from './HomeRoom'

export { HomeRoom }

const WS_PATH = /^\/api\/homes\/([\w-]{8,64})\/ws$/

/** Serves only /api/*; everything else is static assets (see wrangler.jsonc). */
export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const match = WS_PATH.exec(new URL(request.url).pathname)
    if (!match) return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 })
    return env.HOME_ROOM.get(env.HOME_ROOM.idFromName(match[1])).fetch(request)
  },
} satisfies ExportedHandler<Env>
