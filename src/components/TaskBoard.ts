/**
 * Task Board - Four Quadrants (Eisenhower Matrix)
 * 
 * Quadrants:
 * 1. Urgent & Important - Do first
 * 2. Not Urgent but Important - Schedule
 * 3. Urgent but Not Important - Delegate
 * 4. Not Urgent & Not Important - Eliminate
 */

export type TaskQuadrant = 
  | 'urgent-important' 
  | 'not-urgent-important' 
  | 'urgent-not-important' 
  | 'not-urgent-not-important';

export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  title: string;
  description?: string;
  quadrant: TaskQuadrant;
  priority: TaskPriority;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
  dueDate?: number;
  tags?: string[];
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  quadrant?: TaskQuadrant;
  priority?: TaskPriority;
  dueDate?: number;
  tags?: string[];
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new task
 */
export function createTask(input: CreateTaskInput): Task {
  const now = Date.now();
  return {
    id: generateId(),
    title: input.title,
    description: input.description || '',
    quadrant: input.quadrant || 'not-urgent-not-important',
    priority: input.priority || 'medium',
    completed: false,
    createdAt: now,
    updatedAt: now,
    dueDate: input.dueDate,
    tags: input.tags || [],
  };
}

/**
 * Move task to a different quadrant
 */
export function moveTask(task: Task, newQuadrant: TaskQuadrant): Task {
  return {
    ...task,
    quadrant: newQuadrant,
    updatedAt: Date.now(),
  };
}

/**
 * Update task properties
 */
export function updateTask(task: Task, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): Task {
  return {
    ...task,
    ...updates,
    updatedAt: Date.now(),
  };
}

/**
 * Delete a task from the list
 */
export function deleteTask(tasks: Task[], taskId: string): Task[] {
  return tasks.filter(t => t.id !== taskId);
}

/**
 * Get tasks filtered by quadrant
 */
export function getTasksByQuadrant(tasks: Task[], quadrant: TaskQuadrant): Task[] {
  return tasks
    .filter(task => task.quadrant === quadrant)
    .sort((a, b) => {
      // Sort by completion status (incomplete first)
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      // Then by priority (high > medium > low)
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (a.priority !== b.priority) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      // Then by creation date (newest first)
      return b.createdAt - a.createdAt;
    });
}

/**
 * Toggle task completion status
 */
export function toggleTaskCompletion(task: Task): Task {
  return {
    ...task,
    completed: !task.completed,
    updatedAt: Date.now(),
  };
}

/**
 * Get all tasks sorted by priority and completion
 */
export function getAllTasksSorted(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // Sort by completion status
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    // Then by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Get task statistics
 */
export function getTaskStats(tasks: Task[]) {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const byQuadrant = {
    'urgent-important': tasks.filter(t => t.quadrant === 'urgent-important').length,
    'not-urgent-important': tasks.filter(t => t.quadrant === 'not-urgent-important').length,
    'urgent-not-important': tasks.filter(t => t.quadrant === 'urgent-not-important').length,
    'not-urgent-not-important': tasks.filter(t => t.quadrant === 'not-urgent-not-important').length,
  };

  return {
    total,
    completed,
    pending: total - completed,
    byQuadrant,
  };
}

/**
 * Quadrant display names
 */
export const QUADRANT_NAMES: Record<TaskQuadrant, { title: string; subtitle: string; color: string }> = {
  'urgent-important': {
    title: '立刻去做',
    subtitle: '紧急且重要',
    color: 'bg-red-50 border-red-200',
  },
  'not-urgent-important': {
    title: '计划去做',
    subtitle: '不紧急但重要',
    color: 'bg-blue-50 border-blue-200',
  },
  'urgent-not-important': {
    title: '委托他人',
    subtitle: '紧急但不重要',
    color: 'bg-yellow-50 border-yellow-200',
  },
  'not-urgent-not-important': {
    title: '渐少消除',
    subtitle: '不紧急且不重要',
    color: 'bg-gray-50 border-gray-200',
  },
};

/**
 * Priority display config
 */
export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  high: { label: '高', color: 'text-red-600 bg-red-100' },
  medium: { label: '中', color: 'text-yellow-600 bg-yellow-100' },
  low: { label: '低', color: 'text-green-600 bg-green-100' },
};
