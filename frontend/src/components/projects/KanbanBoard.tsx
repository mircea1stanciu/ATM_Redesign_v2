import React, { useState, useEffect } from 'react';

interface Issue {
  id: number;
  key: string;
  title: string;
  description?: string;
  issue_type: 'story' | 'task' | 'bug' | 'epic';
  priority: 'lowest' | 'low' | 'medium' | 'high' | 'highest';
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'closed';
  assignee_id?: number;
  assignee?: {
    id: number;
    full_name: string;
    username: string;
  };
  story_points?: number;
}

interface KanbanBoardProps {
  projectId: number;
  onIssueClick: (issue: Issue) => void;
  onCreateIssue: (status: string) => void;
}

const statusColumns = [
  { key: 'backlog', label: 'Backlog', color: 'bg-gray-100' },
  { key: 'todo', label: 'To Do', color: 'bg-blue-50' },
  { key: 'in_progress', label: 'In Progress', color: 'bg-yellow-50' },
  { key: 'in_review', label: 'In Review', color: 'bg-purple-50' },
  { key: 'done', label: 'Done', color: 'bg-green-50' },
];

const priorityColors = {
  lowest: 'text-gray-400',
  low: 'text-blue-500',
  medium: 'text-yellow-500',
  high: 'text-orange-500',
  highest: 'text-red-500',
};

const typeIcons = {
  story: '📖',
  task: '✓',
  bug: '🐛',
  epic: '⚡',
};

export default function KanbanBoard({ projectId, onIssueClick, onCreateIssue }: KanbanBoardProps) {
  const [issues, setIssues] = useState<Record<string, Issue[]>>({});
  const [loading, setLoading] = useState(true);
  const [draggedIssue, setDraggedIssue] = useState<Issue | null>(null);

  useEffect(() => {
    fetchIssues();
  }, [projectId]);

  const fetchIssues = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:8002/api/projects/${projectId}/issues`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        
        // Group issues by status
        const grouped: Record<string, Issue[]> = {
          backlog: [],
          todo: [],
          in_progress: [],
          in_review: [],
          done: [],
        };

        // Backend returns {issues: [...]} not just [...]
        const issuesList = data.issues || data;
        issuesList.forEach((issue: Issue) => {
          if (grouped[issue.status]) {
            grouped[issue.status].push(issue);
          }
        });

        setIssues(grouped);
      }
    } catch (error) {
      console.error('Failed to fetch issues:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (issue: Issue) => {
    setDraggedIssue(issue);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (newStatus: string) => {
    if (!draggedIssue) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `http://localhost:8002/api/projects/${projectId}/issues/${draggedIssue.id}/move`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            new_status: newStatus,
            order_index: 0,
          }),
        }
      );

      if (response.ok) {
        fetchIssues(); // Refresh the board
      }
    } catch (error) {
      console.error('Failed to move issue:', error);
    } finally {
      setDraggedIssue(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto p-4 h-full">
      {statusColumns.map((column) => (
        <div
          key={column.key}
          className="flex-shrink-0 w-80"
          onDragOver={handleDragOver}
          onDrop={() => handleDrop(column.key)}
        >
          {/* Column Header */}
          <div className={`${column.color} rounded-t-lg p-3 border-b-2 border-gray-300`}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">
                {column.label}
                <span className="ml-2 text-sm text-gray-500">
                  ({issues[column.key]?.length || 0})
                </span>
              </h3>
              <button
                onClick={() => onCreateIssue(column.key)}
                className="text-gray-500 hover:text-gray-700"
                title="Add issue"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          {/* Issues List */}
          <div className="bg-gray-50 rounded-b-lg p-2 min-h-[200px] max-h-[calc(100vh-300px)] overflow-y-auto">
            {issues[column.key]?.map((issue) => (
              <div
                key={issue.id}
                draggable
                onDragStart={() => handleDragStart(issue)}
                onClick={() => onIssueClick(issue)}
                className="bg-white rounded-lg p-3 mb-2 shadow-sm hover:shadow-md cursor-pointer transition-shadow border border-gray-200"
              >
                {/* Issue Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{typeIcons[issue.issue_type]}</span>
                    <span className="text-xs font-mono text-gray-500">{issue.key}</span>
                  </div>
                  <span className={`text-xl ${priorityColors[issue.priority]}`} title={issue.priority}>
                    {'▲'.repeat(issue.priority === 'highest' ? 3 : issue.priority === 'high' ? 2 : 1)}
                  </span>
                </div>

                {/* Issue Title */}
                <h4 className="text-sm font-medium text-gray-900 mb-2 line-clamp-2">
                  {issue.title}
                </h4>

                {/* Issue Footer */}
                <div className="flex items-center justify-between text-xs">
                  {issue.assignee ? (
                    <div className="flex items-center gap-1">
                      <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-semibold">
                        {issue.assignee.full_name?.charAt(0) || issue.assignee.username?.charAt(0)}
                      </div>
                      <span className="text-gray-600 truncate max-w-[120px]">
                        {issue.assignee.full_name || issue.assignee.username}
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-400">Unassigned</span>
                  )}

                  {issue.story_points && (
                    <span className="bg-gray-100 px-2 py-1 rounded text-gray-700 font-medium">
                      {issue.story_points} pts
                    </span>
                  )}
                </div>
              </div>
            ))}

            {(!issues[column.key] || issues[column.key].length === 0) && (
              <div className="text-center text-gray-400 py-8">
                No issues
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
