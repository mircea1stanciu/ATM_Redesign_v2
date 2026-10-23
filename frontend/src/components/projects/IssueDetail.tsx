import React, { useState, useEffect } from 'react';

interface User {
  id: number;
  full_name: string;
  username: string;
}

interface Comment {
  id: number;
  content: string;
  user: User;
  created_at: string;
}

interface Activity {
  id: number;
  action: string;
  field?: string;
  old_value?: string;
  new_value?: string;
  user: User;
  created_at: string;
}

interface Issue {
  id: number;
  key: string;
  title: string;
  description?: string;
  issue_type: 'story' | 'task' | 'bug' | 'epic';
  priority: 'lowest' | 'low' | 'medium' | 'high' | 'highest';
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'closed';
  assignee?: User;
  reporter?: User;
  story_points?: number;
  comments?: Comment[];
  activities?: Activity[];
  created_at: string;
  updated_at: string;
}

interface IssueDetailProps {
  projectId: number;
  issueId: number;
  onClose: () => void;
  onUpdate: () => void;
}

const statusOptions = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'closed', label: 'Closed' },
];

const priorityOptions = [
  { value: 'lowest', label: 'Lowest', icon: '▼', color: 'text-gray-400' },
  { value: 'low', label: 'Low', icon: '▼', color: 'text-blue-500' },
  { value: 'medium', label: 'Medium', icon: '=', color: 'text-yellow-500' },
  { value: 'high', label: 'High', icon: '▲', color: 'text-orange-500' },
  { value: 'highest', label: 'Highest', icon: '▲▲', color: 'text-red-500' },
];

const typeOptions = [
  { value: 'story', label: 'Story', icon: '📖' },
  { value: 'task', label: 'Task', icon: '✓' },
  { value: 'bug', label: 'Bug', icon: '🐛' },
  { value: 'epic', label: 'Epic', icon: '⚡' },
];

export default function IssueDetail({ projectId, issueId, onClose, onUpdate }: IssueDetailProps) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [activeTab, setActiveTab] = useState<'comments' | 'activity'>('comments');

  useEffect(() => {
    fetchIssue();
  }, [issueId]);

  const fetchIssue = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `http://localhost:8002/api/projects/${projectId}/issues/${issueId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setIssue(data);
      }
    } catch (error) {
      console.error('Failed to fetch issue:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateIssue = async (updates: Partial<Issue>) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `http://localhost:8002/api/projects/${projectId}/issues/${issueId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
        }
      );

      if (response.ok) {
        fetchIssue();
        onUpdate();
      }
    } catch (error) {
      console.error('Failed to update issue:', error);
    }
  };

  const addComment = async () => {
    if (!commentText.trim()) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `http://localhost:8002/api/projects/${projectId}/issues/${issueId}/comments`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: commentText }),
        }
      );

      if (response.ok) {
        setCommentText('');
        fetchIssue();
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  if (loading || !issue) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{typeOptions.find(t => t.value === issue.issue_type)?.icon}</span>
            <div>
              <div className="text-sm text-gray-500">{issue.key}</div>
              <input
                type="text"
                value={issue.title}
                onChange={(e) => updateIssue({ title: e.target.value })}
                className="text-xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 -ml-2"
              />
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-6">
            {/* Main content - 2 columns */}
            <div className="col-span-2 space-y-6">
              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={issue.description || ''}
                  onChange={(e) => updateIssue({ description: e.target.value })}
                  className="w-full border rounded-lg p-3 min-h-[120px] focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Add a description..."
                />
              </div>

              {/* Tabs for Comments and Activity */}
              <div>
                <div className="border-b flex gap-4 mb-4">
                  <button
                    onClick={() => setActiveTab('comments')}
                    className={`pb-2 px-1 ${
                      activeTab === 'comments'
                        ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                        : 'text-gray-600'
                    }`}
                  >
                    Comments ({issue.comments?.length || 0})
                  </button>
                  <button
                    onClick={() => setActiveTab('activity')}
                    className={`pb-2 px-1 ${
                      activeTab === 'activity'
                        ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                        : 'text-gray-600'
                    }`}
                  >
                    Activity ({issue.activities?.length || 0})
                  </button>
                </div>

                {activeTab === 'comments' && (
                  <div className="space-y-4">
                    {/* Add Comment */}
                    <div className="flex gap-2">
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        className="flex-1 border rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Add a comment..."
                        rows={2}
                      />
                      <button
                        onClick={addComment}
                        disabled={!commentText.trim()}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed h-fit"
                      >
                        Post
                      </button>
                    </div>

                    {/* Comments List */}
                    {issue.comments?.map((comment) => (
                      <div key={comment.id} className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-semibold">
                            {comment.user.full_name?.charAt(0) || comment.user.username?.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-sm">{comment.user.full_name || comment.user.username}</div>
                            <div className="text-xs text-gray-500">{formatDate(comment.created_at)}</div>
                          </div>
                        </div>
                        <div className="text-sm text-gray-700 whitespace-pre-wrap">{comment.content}</div>
                      </div>
                    ))}

                    {(!issue.comments || issue.comments.length === 0) && (
                      <div className="text-center text-gray-400 py-8">No comments yet</div>
                    )}
                  </div>
                )}

                {activeTab === 'activity' && (
                  <div className="space-y-2">
                    {issue.activities?.map((activity) => (
                      <div key={activity.id} className="flex gap-3 text-sm">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                          {activity.user.full_name?.charAt(0) || activity.user.username?.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div>
                            <span className="font-medium">{activity.user.full_name || activity.user.username}</span>
                            {' '}
                            <span className="text-gray-600">{activity.action}</span>
                            {activity.field && (
                              <>
                                {' '}
                                <span className="font-medium">{activity.field}</span>
                                {activity.old_value && activity.new_value && (
                                  <>
                                    {' from '}
                                    <span className="line-through text-gray-500">{activity.old_value}</span>
                                    {' to '}
                                    <span className="text-blue-600">{activity.new_value}</span>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">{formatDate(activity.created_at)}</div>
                        </div>
                      </div>
                    ))}

                    {(!issue.activities || issue.activities.length === 0) && (
                      <div className="text-center text-gray-400 py-8">No activity yet</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar - 1 column */}
            <div className="space-y-4">
              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={issue.status}
                  onChange={(e) => updateIssue({ status: e.target.value as any })}
                  className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={issue.priority}
                  onChange={(e) => updateIssue({ priority: e.target.value as any })}
                  className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {priorityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.icon} {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={issue.issue_type}
                  onChange={(e) => updateIssue({ issue_type: e.target.value as any })}
                  className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {typeOptions.map((option) => (
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
                  value={issue.story_points || ''}
                  onChange={(e) => updateIssue({ story_points: parseInt(e.target.value) || undefined })}
                  className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="0"
                  min="0"
                />
              </div>

              {/* Reporter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reporter</label>
                <div className="text-sm text-gray-600">
                  {issue.reporter?.full_name || issue.reporter?.username || 'Unknown'}
                </div>
              </div>

              {/* Assignee */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assignee</label>
                <div className="text-sm text-gray-600">
                  {issue.assignee?.full_name || issue.assignee?.username || 'Unassigned'}
                </div>
              </div>

              {/* Timestamps */}
              <div className="pt-4 border-t text-xs text-gray-500 space-y-1">
                <div>Created: {formatDate(issue.created_at)}</div>
                <div>Updated: {formatDate(issue.updated_at)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
