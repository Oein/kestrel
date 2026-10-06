import type { MailApi } from '../shared/types'

declare global {
  interface Window {
    api: MailApi
  }
}

export {}
