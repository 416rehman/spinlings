// Every route module registers here, in this order. Each exports one function that takes the Api
// and adds its routes (apiRoute / publicRoute from game/ctx.ts for API operations, api.add for
// pages), and may add touch steps and sweeps. A route registered twice fails at start.
import type { Api } from '../app.ts'
import { registerRetention } from '../game/retention.ts'
import { registerTouch } from '../game/touch.ts'
import { pages } from '../pages.ts'
import { account } from './account.ts'
import { auth } from './auth.ts'
import { battles } from './battles.ts'
import { collection } from './collection.ts'
import { market } from './market.ts'
import { social } from './social.ts'

export function registerRoutes(api: Api): void {
  registerTouch(api)
  registerRetention(api)
  auth(api)
  account(api)
  battles(api)
  collection(api)
  social(api)
  market(api)
  pages(api)
}
