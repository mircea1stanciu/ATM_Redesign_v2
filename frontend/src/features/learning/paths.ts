import { PROGRAMS, type Lesson, type Module, type Program } from './content'

/**
 * A learning path: programs of the content library in the order to take them. Stored on the server since phase 21,
 * where leads create, edit, order and delete them (usePaths).
 */
export interface LearningPath {
  id: string
  title: string
  description: string
  programs: string[]
  position: number
}

export function pathById(paths: LearningPath[], id: string | null | undefined): LearningPath | undefined {
  return paths.find(path => path.id === id)
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
