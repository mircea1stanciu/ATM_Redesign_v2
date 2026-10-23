import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { apiService, LOCAL_REPO_CHANGED_EVENT } from '@/services/api'
import OpenInIdeMenu, { type IdeTarget } from '@/components/ai/OpenInIdeMenu'
import type { LocalRepoStatus } from '@/types/domain'

/**
 * "Open in IDE" for the selected project: opens the local copy linked to it, with the selected Bruno collection /
 * test file as extra choices. Hidden when the project has no local copy or no IDE is installed on the station.
 * Render it with `key={projectId}` so a project switch starts from a clean state.
 */
export default function ProjectOpenInIde({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [local, setLocal] = useState<LocalRepoStatus | null>(null)
  const [reload, setReload] = useState(0)
  const runCollection = useAppStore(s => s.runCollection)
  const collections = useAppStore(s => s.collections)
  const collectionsProjectId = useAppStore(s => s.collectionsProjectId)
  const frameworkSelection = useAppStore(s => s.frameworkRunSelection)

  useEffect(() => {
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) setReload(n => n + 1)
    }
    window.addEventListener(LOCAL_REPO_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(LOCAL_REPO_CHANGED_EVENT, onChange)
  }, [projectId])

  useEffect(() => {
    let active = true
    apiService.getLocalRepoStatus(projectId)
      .then(status => { if (active) setLocal(status) })
      .catch(() => { if (active) setLocal(null) })
    return () => { active = false }
  }, [projectId, reload])

  const targets = useMemo<IdeTarget[]>(() => {
    if (!local?.is_git_repo || !local.path) return []
    const folder = local.path.split(/[\\/]/).filter(Boolean).pop() ?? local.path
    const result: IdeTarget[] = [{ label: `${projectName} · ${folder}`, path: '', detail: local.path, short: folder }]
    // The store's collections lag behind a project switch; only offer them once they belong to this project.
    if (runCollection && collectionsProjectId === projectId && collections.includes(runCollection)) {
      result.push({ label: `Selected collection · ${runCollection}`, path: runCollection })
    }
    if (frameworkSelection?.projectId === projectId) {
      const match = /^[^@]+@([^|]+)\|(?:file|spec|script|collection)\|(.+?)(?:\|.*)?$/.exec(frameworkSelection.target)
      if (match) {
        const path = match[1] === '.' ? match[2] : `${match[1]}/${match[2]}`
        result.push({ label: `Selected test file · ${path}`, path })
      }
    }
    return result
  }, [local, projectName, projectId, runCollection, collections, collectionsProjectId, frameworkSelection])

  return <OpenInIdeMenu projectId={projectId} targets={targets} />
}
