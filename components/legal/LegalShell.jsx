import Link from 'next/link'
import { LEGAL_DETAILS } from '@/lib/legal.js'
import styles from './LegalShell.module.css'

const NAV_ITEMS = [
  { href: '/legal', label: 'Overview' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/licenses', label: 'Licences' },
  { href: '/feedback', label: 'Feedback' },
]

export function LegalShell({ current, title, kicker, summary, children }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Back to Leið">
          <span>Leið</span>
          <small>layth</small>
        </Link>
        <nav className={styles.nav} aria-label="Legal documents">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              className={current === item.href ? styles.active : undefined}
              href={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link className={styles.back} href="/">Open instrument →</Link>
      </header>

      <main className={styles.main}>
        <aside className={styles.rail} aria-hidden="true">
          <span>47.4979° N</span>
          <i />
          <span>19.0402° E</span>
        </aside>

        <article className={styles.document}>
          <div className={styles.hero}>
            <p className={styles.kicker}>{kicker}</p>
            <h1>{title}</h1>
            <p className={styles.summary}>{summary}</p>
            <dl className={styles.meta}>
              <div>
                <dt>Operator</dt>
                <dd>{LEGAL_DETAILS.operatorName}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd><time dateTime={LEGAL_DETAILS.updatedAtISO}>{LEGAL_DETAILS.updatedAt}</time></dd>
              </div>
              <div>
                <dt>Jurisdiction</dt>
                <dd>{LEGAL_DETAILS.governingLaw}</dd>
              </div>
            </dl>
          </div>

          <div className={styles.content}>{children}</div>

          <footer className={styles.footer}>
            <p>Questions about these documents?</p>
            <a href={`mailto:${LEGAL_DETAILS.contactEmail}`}>{LEGAL_DETAILS.contactEmail}</a>
          </footer>
        </article>
      </main>
    </div>
  )
}

export function LegalSection({ number, title, children }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <span>{String(number).padStart(2, '0')}</span>
        <h2>{title}</h2>
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

export function DataTable({ headers, rows }) {
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>{headers.map(header => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

