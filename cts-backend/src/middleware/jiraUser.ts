import type { Response, NextFunction } from 'express'
import { jiraAls, type JiraActor } from '../lib/jiraContext.js'
import { getUserJira } from '../lib/jiraOAuth.js'
import { sharedJiraClient } from '../lib/jira.js'
import type { AuthedRequest } from './requireAuth.js'

// Use AFTER requireAuth. Everything the rest of this request sends to Jira runs as the
// signed-in user's own Atlassian account when they connected one (OAuth), otherwise as the
// shared API token. A broken/revoked connection falls back to the shared token (and the
// reason is kept so responses can tell the user to reconnect).
export async function withUserJira(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  let actor: JiraActor = { client: sharedJiraClient, mode: 'shared' }
  try {
    if (req.user) {
      const r = await getUserJira(req.user.id)
      if (r && 'client' in r) actor = { client: r.client, mode: 'user', displayName: r.displayName }
      else if (r && 'error' in r) actor = { client: sharedJiraClient, mode: 'shared', fallbackReason: r.error }
    }
  } catch (err) {
    // e.g. the jira_connections table does not exist yet (before `prisma db push`) — keep working with the shared token
    console.error('[jira-oauth] could not load user connection:', err instanceof Error ? err.message : err)
  }
  jiraAls.run(actor, () => next())
}
