import React, { useState } from 'react';

interface IssueCreateModalProps {
  projectId: number;
  initialStatus?: string;
  onClose: () => void;
  onCreate: () => void;
}

const typeOptions = [
  { value: 'task', label: 'Task', icon: '✓', description: 'A task that needs to be done' },
  { value: 'story', label: 'Story', icon: '📖', description: 'A user story' },
  { value: 'bug', label: 'Bug', icon: '🐛', description: 'A problem that needs to be fixed' },
  { value: 'epic', label: 'Epic', icon: '⚡', description: 'A large body of work' },
];

const priorityOptions = [
  { value: 'lowest', label: 'Lowest', icon: '▼', color: 'text-gray-400' },
  { value: 'low', label: 'Low', icon: '▼', color: 'text-blue-500' },
  { value: 'medium', label: 'Medium', icon: '=', color: 'text-yellow-500' },
  { value: 'high', label: 'High', icon: '▲', color: 'text-orange-500' },
  { value: 'highest', label: 'Highest', icon: '▲▲', color: 'text-red-500' },
];

export default function IssueCreateModal({ projectId, initialStatus, onClose, onCreate }: IssueCreateModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    issue_type: 'task',
    priority: 'medium',
    status: initialStatus || 'backlog',
    story_points: '',
  });
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      alert('Please enter a title');
      return;
    }

    setCreating(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `http://localhost:8002/api/projects/${projectId}/issues`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: formData.title,
            description: formData.description || undefined,
            issue_type: formData.issue_type,
            priority: formData.priority,
            status: formData.status,
            story_points: formData.story_points ? parseInt(formData.story_points) : undefined,
          }),
        }
      );

      if (response.ok) {
        onCreate();
        onClose();
      } else {
        const error = await response.json();
        alert(`Failed to create issue: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to create issue:', error);
      alert('Failed to create issue. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Create Issue</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Issue Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type *</label>
            <div className="grid grid-cols-2 gap-2">
              {typeOptions.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, issue_type: type.value })}
                  className={`p-3 border rounded-lg text-left transition-colors ${
                    formData.issue_type === type.value
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{type.icon}</span>
                    <span className="font-medium">{type.label}</span>
                  </div>
                  <div className="text-xs text-gray-500">{type.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="What needs to be done?"
              autoFocus
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Add more details..."
              rows={4}
            />
          </div>

          {/* Priority and Story Points */}
          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority *</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {priorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.icon} {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Story Points */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Story Points</label>
              <input
                type="number"
                value={formData.story_points}
                onChange={(e) => setFormData({ ...formData, story_points: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
                min="0"
                max="100"
              />
            </div>
          </div>

          {/* Status (if not pre-selected) */}
          {!initialStatus && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="backlog">Backlog</option>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="in_review">In Review</option>
                <option value="done">Done</option>
              </select>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !formData.title.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Creating...
                </div>
              ) : (
                'Create Issue'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
