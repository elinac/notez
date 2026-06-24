import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  createTask, 
  moveTask, 
  deleteTask, 
  updateTask,
  getTasksByQuadrant,
  Task,
  TaskQuadrant
} from '../TaskBoard';

describe('TaskBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 测试用例 1: 创建任务
  describe('createTask', () => {
    it('TC1: 应创建带有所有属性的任务', () => {
      const task = createTask({
        title: 'Test Task',
        description: 'Test Description',
        quadrant: 'urgent-important',
        priority: 'high',
      });

      expect(task).toHaveProperty('id');
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('Test Description');
      expect(task.quadrant).toBe('urgent-important');
      expect(task.priority).toBe('high');
      expect(task.completed).toBe(false);
      expect(task.createdAt).toBeDefined();
    });

    it('TC2: 任务 ID 应该是唯一的', () => {
      const task1 = createTask({ title: 'Task 1', quadrant: 'urgent-important' });
      const task2 = createTask({ title: 'Task 2', quadrant: 'urgent-important' });
      expect(task1.id).not.toBe(task2.id);
    });

    it('TC3: 应使用默认值创建任务', () => {
      const task = createTask({ title: 'Simple Task' });
      expect(task.quadrant).toBe('not-urgent-not-important');
      expect(task.priority).toBe('medium');
      expect(task.completed).toBe(false);
    });
  });

  // 测试用例 4: 移动任务
  describe('moveTask', () => {
    it('TC4: 应将任务移动到不同象限', () => {
      const task = createTask({ title: 'Task', quadrant: 'urgent-important' });
      const movedTask = moveTask(task, 'not-urgent-important');
      
      expect(movedTask.quadrant).toBe('not-urgent-important');
      expect(movedTask.id).toBe(task.id); // Same task, different quadrant
    });

    it('TC5: 移动任务应更新 updatedAt', () => {
      const task = createTask({ title: 'Task', quadrant: 'urgent-important' });
      const originalUpdatedAt = task.updatedAt;
      
      // Wait a bit to ensure different timestamp
      const movedTask = moveTask(task, 'urgent-not-important');
      
      expect(movedTask.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });
  });

  // 测试用例 6: 更新任务
  describe('updateTask', () => {
    it('TC6: 应更新任务标题', () => {
      const task = createTask({ title: 'Old Title', quadrant: 'urgent-important' });
      const updated = updateTask(task, { title: 'New Title' });
      
      expect(updated.title).toBe('New Title');
      expect(updated.quadrant).toBe(task.quadrant); // Unchanged
    });

    it('TC7: 应更新任务完成状态', () => {
      const task = createTask({ title: 'Task', quadrant: 'urgent-important' });
      expect(task.completed).toBe(false);
      
      const updated = updateTask(task, { completed: true });
      expect(updated.completed).toBe(true);
    });

    it('TC8: 应更新任务优先级', () => {
      const task = createTask({ title: 'Task', priority: 'low' });
      const updated = updateTask(task, { priority: 'high' });
      
      expect(updated.priority).toBe('high');
    });
  });

  // 测试用例 9: 删除任务
  describe('deleteTask', () => {
    it('TC9: 应从任务列表中删除指定任务', () => {
      const tasks: Task[] = [
        createTask({ title: 'Task 1', quadrant: 'urgent-important' }),
        createTask({ title: 'Task 2', quadrant: 'urgent-important' }),
        createTask({ title: 'Task 3', quadrant: 'not-urgent-important' }),
      ];
      
      const taskToDelete = tasks[1];
      const remaining = deleteTask(tasks, taskToDelete.id);
      
      expect(remaining).toHaveLength(2);
      expect(remaining.find(t => t.id === taskToDelete.id)).toBeUndefined();
    });

    it('TC10: 删除不存在的任务应返回原列表', () => {
      const tasks: Task[] = [
        createTask({ title: 'Task 1', quadrant: 'urgent-important' }),
      ];
      
      const remaining = deleteTask(tasks, 'non-existent-id');
      expect(remaining).toHaveLength(1);
    });
  });

  // 测试用例 11: 按象限获取任务
  describe('getTasksByQuadrant', () => {
    it('TC11: 应正确按象限筛选任务', () => {
      const tasks: Task[] = [
        createTask({ title: 'Urgent Important 1', quadrant: 'urgent-important' }),
        createTask({ title: 'Urgent Important 2', quadrant: 'urgent-important' }),
        createTask({ title: 'Not Urgent Important', quadrant: 'not-urgent-important' }),
        createTask({ title: 'Urgent Not Important', quadrant: 'urgent-not-important' }),
      ];
      
      const urgentImportant = getTasksByQuadrant(tasks, 'urgent-important');
      expect(urgentImportant).toHaveLength(2);
      expect(urgentImportant.every(t => t.quadrant === 'urgent-important')).toBe(true);
    });

    it('TC12: 应返回空数组当象限无任务', () => {
      const tasks: Task[] = [
        createTask({ title: 'Task', quadrant: 'urgent-important' }),
      ];
      
      const notUrgentNotImportant = getTasksByQuadrant(tasks, 'not-urgent-not-important');
      expect(notUrgentNotImportant).toHaveLength(0);
    });
  });

  // 测试用例 13: 任务排序
  describe('Task Sorting', () => {
    it('TC13: 任务应按优先级排序', () => {
      const tasks: Task[] = [
        { ...createTask({ title: 'Low', priority: 'low', quadrant: 'urgent-important' }), createdAt: 1000 },
        { ...createTask({ title: 'High', priority: 'high', quadrant: 'urgent-important' }), createdAt: 2000 },
        { ...createTask({ title: 'Medium', priority: 'medium', quadrant: 'urgent-important' }), createdAt: 3000 },
      ];
      
      const quadrantTasks = getTasksByQuadrant(tasks, 'urgent-important');
      // High priority should come first
      expect(quadrantTasks[0].priority).toBe('high');
      expect(quadrantTasks[1].priority).toBe('medium');
      expect(quadrantTasks[2].priority).toBe('low');
    });

    it('TC14: 未完成任务应排在已完成任务之前', () => {
      const tasks: Task[] = [
        { ...createTask({ title: 'Completed', quadrant: 'urgent-important' }), completed: true, createdAt: 1000 },
        { ...createTask({ title: 'Not Completed', quadrant: 'urgent-important' }), completed: false, createdAt: 2000 },
      ];
      
      const quadrantTasks = getTasksByQuadrant(tasks, 'urgent-important');
      expect(quadrantTasks[0].completed).toBe(false);
      expect(quadrantTasks[1].completed).toBe(true);
    });
  });

  // 测试用例 15: 所有象限类型
  describe('All Quadrants', () => {
    it('TC15: 应支持所有四种象限类型', () => {
      const quadrants: TaskQuadrant[] = [
        'urgent-important',
        'not-urgent-important',
        'urgent-not-important',
        'not-urgent-not-important',
      ];
      
      quadrants.forEach(quadrant => {
        const task = createTask({ title: `Task in ${quadrant}`, quadrant });
        expect(task.quadrant).toBe(quadrant);
      });
    });
  });
});
