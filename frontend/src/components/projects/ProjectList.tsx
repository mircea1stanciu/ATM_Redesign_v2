import React, { useState, useEffect } from 'react';

interface Project {
  id: number;
  key: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  is_active: boolean;
  issue_count?: number;
  lead?: {
    id: number;
    full_name: string;
    username: string;
  };
}

interface ProjectListProps {
  onProjectClick: (project: Project) => void;
  onCreateProject: () => void;
}

export default function ProjectList({ onProjectClick, onCreateProject }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [canManageProjects, setCanManageProjects] = useState(false);

  useEffect(() => {
    checkPermissions();
    fetchProjects();
  }, []); // No dependencies since we fetch all organization projects

  const checkPermissions = () => {
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        
        // Super admins and org admins can manage
        if (user.role === 'super_admin' || user.role === 'org_admin') {
          setCanManageProjects(true);
          return;
        }
        
        // Check if user has "product" in assigned communities (works for any role)
        if (user.assigned_communities) {
          const communities = Array.isArray(user.assigned_communities) 
            ? user.assigned_communities 
            : JSON.parse(user.assigned_communities || '[]');
          setCanManageProjects(communities.includes('product'));
        }
      }
    } catch (error) {
      console.error('Failed to check permissions:', error);
    }
  };

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token');
      // Fetch all organization projects instead of community-specific
      const response = await fetch(
        `http://localhost:8002/api/projects/organization`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId: number, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering onProjectClick
    
    if (!confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      return;
    }

    try {
      setDeletingId(projectId);
      const token = localStorage.getItem('token');
      const response = await fetch(
        `http://localhost:8002/api/projects/${projectId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        // Remove project from list
        setProjects(projects.filter(p => p.id !== projectId));
      } else {
        const error = await response.json();
        alert(error.detail || 'Failed to delete project');
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
      alert('Failed to delete project');
    } finally {
      setDeletingId(null);
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
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Organization Projects</h2>
          <p className="text-gray-600 mt-1">All projects across your organization</p>
        </div>
        {canManageProjects && (
          <button
            onClick={onCreateProject}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Project
          </button>
        )}
      </div>

      {/* Projects Grid */}
      {projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => onProjectClick(project)}
              className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow cursor-pointer relative"
              style={{ borderLeftWidth: '4px', borderLeftColor: project.color || '#3B82F6' }}
            >
              {/* Delete Button - Only for Product Managers */}
              {canManageProjects && (
                <button
                  onClick={(e) => handleDeleteProject(project.id, e)}
                  disabled={deletingId === project.id}
                  className="absolute top-4 right-4 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete project"
                >
                  {deletingId === project.id ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-600"></div>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              )}

              {/* Project Header */}
              <div className="flex items-start justify-between mb-4 pr-8">
                <div className="flex items-center gap-3">
                  {project.icon ? (
                    <span className="text-3xl">{project.icon}</span>
                  ) : (
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-xl"
                      style={{ backgroundColor: project.color || '#3B82F6' }}
                    >
                      {project.key.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-lg text-gray-900">{project.name}</h3>
                    <span className="text-sm text-gray-500 font-mono">{project.key}</span>
                  </div>
                </div>

                {/* Status Badge */}
                {project.is_active && (
                  <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                    Active
                  </span>
                )}
              </div>

              {/* Description */}
              {project.description && (
                <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                  {project.description}
                </p>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span>{project.issue_count || 0} issues</span>
                </div>

                {project.lead && (
                  <div className="flex items-center gap-1 text-sm">
                    <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-semibold">
                      {project.lead.full_name?.charAt(0) || project.lead.username?.charAt(0)}
                    </div>
                    <span className="text-gray-600 truncate max-w-[100px]">
                      {project.lead.full_name || project.lead.username}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
          <p className="text-gray-600 mb-4">Get started by creating your first project</p>
          {canManageProjects && (
            <button
              onClick={onCreateProject}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Project
            </button>
          )}
        </div>
      )}
    </div>
  );
}
