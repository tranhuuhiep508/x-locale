/** Keep the current child page and filters when replacing a legacy UUID URL. */
export function canonicalProjectHref(
  pathname: string,
  href: string,
  projectRef: string,
  slug: string,
): string {
  const prefix = `/projects/${projectRef}`
  return `/projects/${slug}${pathname.slice(prefix.length)}${href.slice(pathname.length)}`
}
