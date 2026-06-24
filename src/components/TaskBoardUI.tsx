import { useState } from 'react';
import { Plus, Trash2, Check, X, Edit2, Move } from 'lucide-react';
import { 
  Task, 
  TaskQuadrant, 
  TaskPriority,
  createTask, 
  deleteTask, 
  updateTask, 
  moveTask,
  getTasksByQuadrant,
  toggleTaskCompletion,
  QUADRANT_NAMES,
  PRIORITY_CONFIG,
} from './TaskBoard';

interface TaskBoardUIProps {
  tasks: Task[];
  onTasksChange: (tasks: Task[]) => void;
}

export function TaskBoardUI({ tasks, onTasksChange }: TaskBoardUIProps) {
  const [showAddForm, setShowAddForm] = useState<TaskQuadrant | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium');

  const quadrants: TaskQuadrant[] = [
    'urgent-important',
    'not-urgent-important',
    'urgent-not-important',
    'not-urgent-not-important',
  ];

  const handleAddTask = (quadrant: TaskQuadrant) => {
    if (newTaskTitle.trim()) {
      const newTask = createTask({
        title: newTaskTitle,
        quadrant,
        priority: newTaskPriority,
      });
      onTasksChange([...tasks, newTask]);
      setNewTaskTitle('');
      setNewTaskPriority('medium');
      setShowAddForm(null);
    }
  };

  const handleDeleteTask = (taskId: string) => {
    onTasksChange(deleteTask(tasks, taskId));
  };

  const handleToggleComplete = (task: Task) => {
    const updated = toggleTaskCompletion(task);
    onTasksChange(tasks.map(t => t.id === updated.id ? updated : t));
  };

  const handleMoveTask = (task: Task, newQuadrant: TaskQuadrant) => {
    const moved = moveTask(task, newQuadrant);
    onTasksChange(tasks.map(t => t.id === moved.id ? moved : t));
  };

  const handleUpdateTask = () => {
    if (editingTask && editingTask.title.trim()) {
      const updated = updateTask(
        tasks.find(t => t.id === editingTask.id)!,
        { title: editingTask.title, priority: editingTask.priority, description: editingTask.description, dueDate: editingTask.dueDate }
      );
      onTasksChange(tasks.map(t => t.id === updated.id ? updated : t));
      setEditingTask(null);
    }
  };

  return (
    <div className="h-full p-4 bg-gray-50">
      <h2 className="text-xl font-bold mb-4">任务看板 · 四象限</h2>
      
      <div className="grid grid-cols-2 gap-4 h-[calc(100%-3rem)]">
        {quadrants.map(quadrant => {
          const quadrantTasks = getTasksByQuadrant(tasks, quadrant);
          const config = QUADRANT_NAMES[quadrant];
          
          return (
            <div 
              key={quadrant}
              className={`${config.color} border-2 rounded-lg p-3 flex flex-col`}
            >
              {/* Quadrant Header */}
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-bold text-sm">{config.title}</h3>
                  <p className="text-xs text-gray-600">{config.subtitle}</p>
                </div>
                <span className="text-xs bg-white px-2 py-1 rounded-full">
                  {quadrantTasks.length}
                </span>
              </div>

              {/* Task List */}
              <div className="flex-1 overflow-auto space-y-2">
                {quadrantTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onToggle={() => handleToggleComplete(task)}
                    onDelete={() => handleDeleteTask(task.id)}
                    onEdit={() => setEditingTask(task)}
                    onMove={(q) => handleMoveTask(task, q)}
                  />
                ))}
              </div>

              {/* Add Task Button */}
              {showAddForm === quadrant ? (
                <div className="mt-2 bg-white p-2 rounded border">
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="任务标题..."
                    className="w-full px-2 py-1 text-sm border rounded mb-2"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTask(quadrant);
                      if (e.key === 'Escape') setShowAddForm(null);
                    }}
                  />
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
                    className="w-full px-2 py-1 text-sm border rounded mb-2"
                  >
                    <option value="high">高优先级</option>
                    <option value="medium">中优先级</option>
                    <option value="low">低优先级</option>
                  </select>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleAddTask(quadrant)}
                      className="flex-1 px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                    >
                      添加
                    </button>
                    <button
                      onClick={() => setShowAddForm(null)}
                      className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddForm(quadrant)}
                  className="mt-2 flex items-center justify-center gap-1 px-3 py-2 bg-white border border-dashed border-gray-300 rounded text-sm text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-colors"
                >
                  <Plus size={14} />
                  添加任务
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit Task Modal */}
      {editingTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-80">
            <h3 className="font-bold mb-3">编辑任务</h3>
            <input
              type="text"
              value={editingTask.title}
              onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
              placeholder="标题"
              className="w-full px-3 py-2 border rounded mb-2"
              autoFocus
            />
            <textarea
              value={editingTask.description ?? ''}
              onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
              placeholder="描述（可选）"
              rows={3}
              className="w-full px-3 py-2 border rounded mb-2 text-sm resize-none"
            />
            <select
              value={editingTask.priority}
              onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value as TaskPriority })}
              className="w-full px-3 py-2 border rounded mb-2"
            >
              <option value="high">高优先级</option>
              <option value="medium">中优先级</option>
              <option value="low">低优先级</option>
            </select>
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">截止日期</label>
              <input
                type="date"
                value={editingTask.dueDate ? new Date(editingTask.dueDate).toISOString().split('T')[0] : ''}
                onChange={(e) => setEditingTask({
                  ...editingTask,
                  dueDate: e.target.value ? new Date(e.target.value).getTime() : undefined,
                })}
                className="w-full px-3 py-1.5 border rounded text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleUpdateTask}
                className="flex-1 px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                保存
              </button>
              <button
                onClick={() => setEditingTask(null)}
                className="px-3 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onMove: (quadrant: TaskQuadrant) => void;
}

function TaskCard({ task, onToggle, onDelete, onEdit, onMove }: TaskCardProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const priorityConfig = PRIORITY_CONFIG[task.priority];

  const quadrants: TaskQuadrant[] = [
    'urgent-important',
    'not-urgent-important',
    'urgent-not-important',
    'not-urgent-not-important',
  ];

  return (
    <div className={`bg-white p-2 rounded border shadow-sm ${task.completed ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <button
          onClick={onToggle}
          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${
            task.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'
          }`}
        >
          {task.completed && <Check size={10} />}
        </button>
        
        <div className="flex-1 min-w-0">
          <p className={`text-sm truncate ${task.completed ? 'line-through text-gray-500' : ''}`}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{task.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-block px-1.5 py-0.5 text-xs rounded ${priorityConfig.color}`}>
              {priorityConfig.label}
            </span>
            {task.dueDate && (
              <span className={`text-xs ${
                task.dueDate < Date.now() && !task.completed ? 'text-red-500' : 'text-gray-400'
              }`}>
                {new Date(task.dueDate).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <div className="relative">
            <button
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
              title="移动到..."
            >
              <Move size={12} />
            </button>
            
            {showMoveMenu && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white border rounded shadow-lg z-10">
                {quadrants.map(q => (
                  <button
                    key={q}
                    onClick={() => {
                      onMove(q);
                      setShowMoveMenu(false);
                    }}
                    disabled={task.quadrant === q}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100 ${
                      task.quadrant === q ? 'text-gray-400 cursor-not-allowed' : ''
                    }`}
                  >
                    {QUADRANT_NAMES[q].title}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={onEdit}
            className="p-1 text-gray-400 hover:text-blue-600 rounded"
            title="编辑"
          >
            <Edit2 size={12} />
          </button>
          
          <button
            onClick={onDelete}
            className="p-1 text-gray-400 hover:text-red-600 rounded"
            title="删除"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
