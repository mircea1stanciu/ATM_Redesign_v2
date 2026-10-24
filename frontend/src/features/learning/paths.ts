import { PROGRAMS, type Lesson, type Module, type Program } from './content'

/** A learning path: programs of the content library in the order to take them (docs/redesign/05-design.md). */
export interface LearningPath {
  id: string
  title: string
  description: string
  programs: string[]
}

// Every program belongs to at least one path; a language program comes before the frameworks that use it.
export const PATHS: LearningPath[] = [
  { id: 'api-bruno', title: 'Manual to API automation with Bruno', programs: ['bruno', 'postman'],
    description: 'From requests you try by hand to Git-tracked API suites that run in CI.' },
  { id: 'ui-playwright', title: 'UI automation with Playwright', programs: ['javascript', 'playwright'],
    description: 'JavaScript for testers, then reliable browser tests with Playwright.' },
  { id: 'java-automation', title: 'Java automation: Selenium, JUnit 5 and REST Assured', programs: ['java', 'junit5', 'selenium', 'restassured'],
    description: 'Java for testers, a test framework, browser automation and API checks in one stack.' },
  { id: 'mobile-appium', title: 'Mobile automation with Appium', programs: ['java', 'appium'],
    description: 'Automate Android and iOS apps with Appium and Java.' },
  { id: 'python-automation', title: 'Python test automation', programs: ['python', 'robotframework'],
    description: 'pytest and Python for testers, then keyword-driven suites with Robot Framework.' },
  { id: 'js-ui-frameworks', title: 'JavaScript UI testing: Cypress and WebdriverIO', programs: ['javascript', 'cypress', 'webdriverio'],
    description: 'Two more JavaScript frameworks for web UI tests, and when to choose which.' },
  { id: 'api-bdd-karate', title: 'API testing in BDD style with Karate', programs: ['karate'],
    description: 'Readable API scenarios with Karate, no Java coding needed.' },
  { id: 'performance-k6', title: 'Performance testing with k6', programs: ['javascript', 'k6'],
    description: 'Load and stress tests written in JavaScript, with thresholds that fail a slow build.' },
]

export function pathById(id: string | null | undefined): LearningPath | undefined {
  return PATHS.find(path => path.id === id)
}

export function programsOf(path: LearningPath): Program[] {
  return path.programs.map(id => PROGRAMS.find(p => p.id === id)).filter((p): p is Program => Boolean(p))
}

export interface LessonRef { program: Program; module: Module; lesson: Lesson }

const LESSONS = new Map<string, LessonRef>(
  PROGRAMS.flatMap(program => program.modules.flatMap(module => module.lessons.map(lesson => [lesson.id, { program, module, lesson }] as const))),
)
const MODULES = new Map<string, { program: Program; module: Module }>(
  PROGRAMS.flatMap(program => program.modules.map(module => [module.id, { program, module }] as const)),
)

export function findLesson(id: string): LessonRef | undefined {
  return LESSONS.get(id)
}

export function findModule(id: string): { program: Program; module: Module } | undefined {
  return MODULES.get(id)
}

/** Lessons and quizzes (one per module) of a path, and how many of them a person has done. */
export function pathProgress(path: LearningPath, lessonsDone: Record<string, unknown>, quizzes: Record<string, { passed: boolean }>) {
  const modules = programsOf(path).flatMap(p => p.modules)
  const lessons = modules.flatMap(m => m.lessons.map(l => l.id))
  const done = lessons.filter(id => id in lessonsDone).length
  const passed = modules.filter(m => quizzes[m.id]?.passed).length
  const total = lessons.length + modules.length
  return { lessons: lessons.length, lessonsDone: done, quizzes: modules.length, quizzesPassed: passed,
    percent: total ? Math.round(((done + passed) / total) * 100) : 0 }
}
