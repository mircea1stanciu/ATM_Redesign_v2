import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { languageFor } from './codeLanguages'

/** Whether the app is in dark mode (the `dark` class on <html>), updated live. */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export function useLanguage(path: string): Extension[] {
  const [language, setLanguage] = useState<Extension[]>([])
  useEffect(() => {
    let active = true
    setLanguage([])
    void languageFor(path).then(ext => { if (active) setLanguage(ext) }).catch(() => undefined)
    return () => { active = false }
  }, [path])
  return language
}

export const editorFont = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace", lineHeight: '1.5' },
})

/** VS Code-like code editor (VS Code Dark+/Light+ colours, syntax highlighting per file type). */
export default function CodeEditor({
  path,
  value,
  readOnly,
  onChange,
}: {
  path: string
  value: string
  readOnly?: boolean
  onChange: (value: string) => void
}) {
  const dark = useDarkMode()
  const language = useLanguage(path)
  const extensions = useMemo(() => [...language, editorFont], [language])
  return (
    <CodeMirror
      value={value}
      height="100%"
      className="h-full"
      theme={dark ? vscodeDark : vscodeLight}
      extensions={extensions}
      readOnly={readOnly}
      onChange={onChange}
      basicSetup={{ highlightActiveLine: true, foldGutter: true, bracketMatching: true, autocompletion: false }}
    />
  )
}
