/**
 * Open a downloaded file in a new tab. The tab is opened synchronously on the
 * click (so pop-up blockers allow it) and navigated once the download finishes.
 */
export async function openBlobInNewTab(load: () => Promise<Blob>): Promise<void> {
  const win = window.open('', '_blank')
  if (win) {
    win.opener = null
    win.document.title = 'Loading report…'
    win.document.body.textContent = 'Loading report…'
  }
  try {
    const blob = await load()
    const url = URL.createObjectURL(blob)
    if (win && !win.closed) win.location.href = url
    else window.open(url, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
  } catch (error) {
    win?.close()
    throw error
  }
}
