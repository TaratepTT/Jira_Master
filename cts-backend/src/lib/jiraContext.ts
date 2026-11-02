import { AsyncLocalStorage } from 'node:async_hooks'
import type { AxiosInstance } from 'axios'

// ── Who is talking to Jira for the current request ─────────────
// Every Jira call in lib/jira.ts asks jiraClient() for its HTTP client. Inside a request
// where the signed-in user has connected their own Atlassian account (OAuth), that is a
// client carrying THEIR token, so Jira records them as the author and applies their
// workflow permissions. Otherwise it is the shared API-token client (JIRA_EMAIL).
export interface JiraActor {
  client: AxiosInstance
  mode: 'user' | 'shared'
  /** Jira display name when mode = 'user' */
  displayName?: string
  /** set when the user HAD a connection but it could not be used (e.g. revoked) */
  fallbackReason?: string
}

export const jiraAls = new AsyncLocalStorage<JiraActor>()

export function currentJiraActor(): JiraActor | undefined {
  return jiraAls.getStore()
}

/** 'user' when the current request runs with the user's own Jira account */
export function jiraMode(): 'user' | 'shared' {
  return jiraAls.getStore()?.mode ?? 'shared'
}
