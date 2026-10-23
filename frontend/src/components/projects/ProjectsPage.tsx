import React, { useState } from 'react';
import ProjectList from './ProjectList';
import KanbanBoard from './KanbanBoard';
import IssueDetail from './IssueDetail';
import IssueCreateModal from './IssueCreateModal';
import ProjectCreateModal from './ProjectCreateModal';

interface ProjectsPageProps {
  communityId: string;
  communityName: string;
}

interface Project {
  id: number;
  key: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  is_active: boolean;
}

interface Issue {
  id: number;
  key: string;
  title: string;
  description?: string;
  issue_type: 'story' | 'task' | 'bug' | 'epic';
  priority: 'lowest' | 'low' | 'medium' | 'high' | 'highest';
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'closed';
  assignee_id?: number;
  story_points?: number;
}

export default function ProjectsPage({ communityId, communityName }: ProjectsPageProps) {
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [createIssueStatus, setCreateIssueStatus] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleProjectClick = (project: Project) => {
    setSelectedProject(project);
    setView('kanban');
  };

  const handleBackToProjects = () => {
    setSelectedProject(null);
    setView('list');
  };

  const handleIssueClick = (issue: Issue) => {
    setSelectedIssue(issue);
  };

  const handleCreateIssue = (status?: string) => {
    setCreateIssueStatus(status);
    setShowCreateIssue(true);
  };

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Top Navigation Bar */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {selectedProject && (
              <button
                onClick={handleBackToProjects}
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {selectedProject ? (
                  <div className="flex items-center gap-3">
                    {selectedProject.icon && <span className="text-3xl">{selectedProject.icon}</span>}
                    <div>
                      <div>{selectedProject.name}</div>
                      <div className="text-sm font-normal text-gray-500 font-mono">
                        {selectedProject.key}
                      </div>
                    </div>
                  </div>
                ) : (
                  'All Projects'
                )}
              </h1>
            </div>
          </div>

          {selectedProject && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCreateIssue()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Issue
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {view === 'list' ? (
          <ProjectList
            key={refreshKey}
            onProjectClick={handleProjectClick}
            onCreateProject={() => setShowCreateProject(true)}
          />
        ) : (
          selectedProject && (
            <KanbanBoard
              key={refreshKey}
              projectId={selectedProject.id}
              onIssueClick={handleIssueClick}
              onCreateIssue={handleCreateIssue}
            />
          )
        )}
      </div>

      {/* Modals */}
      {showCreateProject && (
        <ProjectCreateModal
          communityId={communityId}
          onClose={() => setShowCreateProject(false)}
          onCreate={() => {
            handleRefresh();
            setShowCreateProject(false);
          }}
        />
      )}

      {showCreateIssue && selectedProject && (
        <IssueCreateModal
          projectId={selectedProject.id}
          initialStatus={createIssueStatus}
          onClose={() => {
            setShowCreateIssue(false);
            setCreateIssueStatus(undefined);
          }}
          onCreate={() => {
            handleRefresh();
            setShowCreateIssue(false);
            setCreateIssueStatus(undefined);
          }}
        />
      )}

      {selectedIssue && selectedProject && (
        <IssueDetail
          projectId={selectedProject.id}
          issueId={selectedIssue.id}
          onClose={() => setSelectedIssue(null)}
          onUpdate={handleRefresh}
        />
      )}
    </div>
  );
}
