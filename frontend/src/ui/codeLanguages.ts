import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'

/** Syntax highlighting for a file name (loaded on demand, like VS Code's language modes). */
export async function languageFor(path: string): Promise<Extension[]> {
  const name = path.split('/').pop()?.toLowerCase() ?? ''
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : name
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': case 'jsx':
      return [(await import('@codemirror/lang-javascript')).javascript({ jsx: true })]
    case 'ts': case 'mts': case 'cts': case 'tsx':
      return [(await import('@codemirror/lang-javascript')).javascript({ jsx: ext === 'tsx', typescript: true })]
    case 'json': case 'jsonc':
      return [(await import('@codemirror/lang-json')).json()]
    case 'py':
      return [(await import('@codemirror/lang-python')).python()]
    case 'java': case 'kt': case 'groovy': case 'gradle':
      return [(await import('@codemirror/lang-java')).java()]
    case 'xml': case 'pom': case 'xsd': case 'wsdl': case 'svg':
      return [(await import('@codemirror/lang-xml')).xml()]
    case 'html': case 'htm':
      return [(await import('@codemirror/lang-html')).html()]
    case 'css': case 'scss': case 'less':
      return [(await import('@codemirror/lang-css')).css()]
    case 'md': case 'markdown':
      return [(await import('@codemirror/lang-markdown')).markdown()]
    case 'yml': case 'yaml':
      return [(await import('@codemirror/lang-yaml')).yaml()]
    case 'sh': case 'bash': case 'zsh':
      return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell)]
    case 'properties': case 'ini': case 'env': case 'cfg': case 'conf': case 'gitignore': case 'editorconfig':
      return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties)]
    case 'toml':
      return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml)]
    case 'feature':
      return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/gherkin')).gherkin)]
    case 'bru':
      // Bruno files: block-structured with JavaScript in script/test blocks; JS highlighting fits best.
      return [(await import('@codemirror/lang-javascript')).javascript()]
    case 'dockerfile':
      return [StreamLanguage.define((await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile)]
    default:
      return []
  }
}
