import { webPageUrlAccepted, type WebPageSourceDto } from '@invimport/contracts'

/** A cited page's title or address; only a URL the contract accepts becomes a link. */
export function WebPageLink({ page }: { page: WebPageSourceDto }) {
  const label = page.title ?? page.url
  if (!webPageUrlAccepted(page.url)) {
    return <span>{label}</span>
  }
  return (
    <a href={page.url} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  )
}
