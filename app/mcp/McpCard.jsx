// Shared chrome for the MCP OAuth pages (/mcp/sign-in, /mcp/consent): a centred
// card on the grid backdrop the legal pages use. These routes render outside the
// DAW shell, so none of components/app.css is loaded here — everything they need
// is in mcpCard.module.css.

import styles from './mcpCard.module.css'

export { styles }

export function McpShell({ children }) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.brand}>LEIÐ</p>
        {children}
      </section>
    </main>
  )
}

// A Client ID Metadata Document id is a URL; its host is the recognisable part.
export function clientHost(clientId) {
  try { return new URL(clientId).hostname } catch { return clientId }
}

// The requesting client: host name up front, the full client id below it so the
// user can still check exactly which metadata document is asking.
export function ClientChip({ clientId }) {
  if (!clientId) return null
  const host = clientHost(clientId)
  return (
    <div className={styles.client}>
      <span className={styles.clientMark} aria-hidden="true">{host.charAt(0)}</span>
      <div className={styles.clientText}>
        <p className={styles.clientName}>{host}</p>
        {host !== clientId && <p className={styles.clientId}>{clientId}</p>}
      </div>
    </div>
  )
}
