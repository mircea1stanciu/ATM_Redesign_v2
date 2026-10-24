/**
 * Standard hints for test files: the same short advice a senior would give in a review. They need no AI and run in
 * the browser on the open file.
 */
export interface EditorHint {
  id: string
  text: string
}

interface Rule {
  id: string
  text: string
  applies: (file: { path: string; content: string; isTest: boolean }) => boolean
}

const TEST_FILE = /(\.spec\.|\.test\.|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|tests?\.(java|kt)$|\.bru$|\.feature$|\.robot$)/i
const ASSERTION = /\b(expect|assert\w*|should|verify\w*|assertThat|toBe|toEqual|toHave\w*|status\s*\(|res\.status)\b|^\s*(assert|tests)\s*\{/im
const HAS_TEST_BODY = /\b(test|it|describe)(\.\w+)?\s*\(|\bdef test_|@Test\b|\bScenario( Outline)?:|^\s*(get|post|put|patch|delete)\s*\{/im

const RULES: Rule[] = [
  {
    id: 'no-assertion',
    text: 'This test has no assertion yet. Add expect(…) (or an assert block in Bruno) so it can fail when the feature breaks.',
    applies: ({ isTest, content }) => isTest && HAS_TEST_BODY.test(content) && !ASSERTION.test(content),
  },
  {
    id: 'only',
    text: '.only runs just this test and skips the others in CI. Remove it before you commit.',
    applies: ({ isTest, content }) => isTest && /\b(test|it|describe)\.only\s*\(/.test(content),
  },
  {
    id: 'fixed-wait',
    text: 'A fixed wait makes the test slow and flaky. Wait for a condition instead: an element, a URL or a response.',
    applies: ({ content }) => /waitForTimeout\s*\(|Thread\.sleep\s*\(|time\.sleep\s*\(|cy\.wait\s*\(\s*\d/.test(content),
  },
  {
    id: 'hard-coded-secret',
    text: 'This looks like a hard-coded password or token. Read it from an environment variable or a Bruno environment.',
    applies: ({ content }) => /\b(password|passwd|pwd|token|secret|api[_-]?key)\b\s*[:=]\s*['"][^'"\s{$]{4,}['"]/i.test(content),
  },
  {
    id: 'brittle-selector',
    text: 'Prefer stable selectors (data-testid, role, label text) over absolute XPath or nth-child: layout changes break them.',
    applies: ({ isTest, content }) => isTest && /(['"]\/html\/body|:nth-child\(|\/\/div\[\d+\])/.test(content),
  },
]

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
}

export function hintsFor(path: string, content: string): EditorHint[] {
  const file = { path, content, isTest: isTestFile(path) }
  return RULES.filter(rule => rule.applies(file)).map(({ id, text }) => ({ id, text }))
}

/** Tips shown in the assistant panel when no AI provider is connected. */
export const GENERAL_TIPS = [
  'Keep one behaviour per test: when it fails, its name says what broke.',
  'Start from the acceptance criteria of the story: one test per criterion is a good first step.',
  'Run the tests you changed (Run changed tests) before you commit.',
]
