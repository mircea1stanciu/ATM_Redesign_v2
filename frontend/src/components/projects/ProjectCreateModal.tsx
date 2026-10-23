import React, { useState } from 'react';

interface ProjectCreateModalProps {
  communityId: string;
  onClose: () => void;
  onCreate: () => void;
}

const emojiOptions = ['📊', '🚀', '💡', '🎯', '⚡', '🔧', '🎨', '📱', '🌟', '🔥'];
const colorOptions = [
  { value: '#3B82F6', label: 'Blue' },
  { value: '#10B981', label: 'Green' },
  { value: '#F59E0B', label: 'Orange' },
  { value: '#EF4444', label: 'Red' },
  { value: '#8B5CF6', label: 'Purple' },
  { value: '#EC4899', label: 'Pink' },
];

export default function ProjectCreateModal({ communityId, onClose, onCreate }: ProjectCreateModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    key: '',
    description: '',
    icon: '📊',
    color: '#3B82F6',
  });
  const [creating, setCreating] = useState(false);

  const handleKeyChange = (name: string) => {
    // Auto-generate key from name (uppercase, no spaces)
    const key = name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, 10);
    setFormData({ ...formData, name, key });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.key.trim()) {
      alert('Please enter a project name and key');
      return;
    }

    setCreating(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:8002/api/projects/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          key: formData.key,
          description: formData.description || undefined,
          community_id: communityId,
          icon: formData.icon,
          color: formData.color,
        }),
      });

      if (response.ok) {
        onCreate();
        onClose();
      } else {
        const error = await response.json();
        alert(`Failed to create project: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('Failed to create project. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Create New Project</h2>
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
          {/* Icon Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Icon</label>
            <div className="flex gap-2">
              {emojiOptions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setFormData({ ...formData, icon: emoji })}
                  className={`text-2xl p-2 rounded-lg border-2 transition-colors ${
                    formData.icon === emoji
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Color Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div className="flex gap-2">
              {colorOptions.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, color: color.value })}
                  className={`w-10 h-10 rounded-lg border-2 transition-all ${
                    formData.color === color.value
                      ? 'border-gray-900 scale-110'
                      : 'border-gray-200 hover:scale-105'
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.label}
                />
              ))}
            </div>
          </div>

          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleKeyChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="My Awesome Project"
              autoFocus
              required
            />
          </div>

          {/* Project Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Key *
              <span className="text-xs text-gray-500 ml-2">(Auto-generated, can be edited)</span>
            </label>
            <input
              type="text"
              value={formData.key}
              onChange={(e) => setFormData({ ...formData, key: e.target.value.toUpperCase() })}
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              placeholder="MAP"
              required
              maxLength={10}
            />
            <p className="text-xs text-gray-500 mt-1">
              Issues will be named like: {formData.key || 'KEY'}-1, {formData.key || 'KEY'}-2, etc.
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="What is this project about?"
              rows={3}
            />
          </div>

          {/* Preview */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-xs text-gray-500 mb-2">Preview:</div>
            <div className="flex items-center gap-3">
              <span className="text-3xl">{formData.icon}</span>
              <div>
                <div className="font-semibold text-gray-900">{formData.name || 'Project Name'}</div>
                <div className="text-sm text-gray-500 font-mono">{formData.key || 'KEY'}</div>
              </div>
              <div
                className="w-3 h-3 rounded-full ml-auto"
                style={{ backgroundColor: formData.color }}
              />
            </div>
          </div>

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
              disabled={creating || !formData.name.trim() || !formData.key.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Creating...
                </div>
              ) : (
                'Create Project'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
