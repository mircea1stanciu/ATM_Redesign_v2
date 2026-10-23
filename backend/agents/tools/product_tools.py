"""
Product Management Tools for UnifiedWork AI Agent
Provides actionable capabilities for ProductGPT within user's organization and assigned communities
"""

import json
from datetime import datetime

import requests


class UnifiedWorkAPI:
    """API client for UnifiedWork platform actions"""
    
    def __init__(self, base_url: str = "http://localhost:8000", auth_token: str = None):
        self.base_url = base_url
        self.auth_token = auth_token
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_token}" if auth_token else None
        }
    
    def get_user_context(self) -> dict:
        """Get current user's context including organization and assigned communities"""
        try:
            response = requests.get(f"{self.base_url}/api/auth/me", headers=self.headers)
            if response.status_code == 200:
                return response.json()
            return {"error": f"Failed to get user context: {response.text}"}
        except Exception as e:
            return {"error": f"API request failed: {str(e)}"}
    
    def get_projects(self, organization_id: int = None) -> list[dict]:
        """Get projects within user's organization"""
        try:
            url = f"{self.base_url}/api/projects"
            if organization_id:
                url += f"?organization_id={organization_id}"
            
            response = requests.get(url, headers=self.headers)
            if response.status_code == 200:
                return response.json()
            return {"error": f"Failed to get projects: {response.text}"}
        except Exception as e:
            return {"error": f"API request failed: {str(e)}"}
    
    def create_project(self, project_data: dict) -> dict:
        """Create a new project"""
        try:
            response = requests.post(
                f"{self.base_url}/api/projects", 
                headers=self.headers,
                json=project_data
            )
            if response.status_code == 201:
                return response.json()
            return {"error": f"Failed to create project: {response.text}"}
        except Exception as e:
            return {"error": f"API request failed: {str(e)}"}
    
    def update_project(self, project_id: int, project_data: dict) -> dict:
        """Update an existing project"""
        try:
            response = requests.put(
                f"{self.base_url}/api/projects/{project_id}",
                headers=self.headers,
                json=project_data
            )
            if response.status_code == 200:
                return response.json()
            return {"error": f"Failed to update project: {response.text}"}
        except Exception as e:
            return {"error": f"API request failed: {str(e)}"}
    
    def get_organization_users(self, organization_id: int) -> list[dict]:
        """Get users in the organization"""
        try:
            response = requests.get(
                f"{self.base_url}/api/organizations/{organization_id}/users",
                headers=self.headers
            )
            if response.status_code == 200:
                return response.json()
            return {"error": f"Failed to get organization users: {response.text}"}
        except Exception as e:
            return {"error": f"API request failed: {str(e)}"}


class ProductManagementTools:
    """Product Management tools for AI agent actions"""
    
    def __init__(self, auth_token: str = None):
        self.api = UnifiedWorkAPI(auth_token=auth_token)
        self.user_context = None
    
    def initialize_user_context(self) -> dict:
        """Initialize and validate user context"""
        self.user_context = self.api.get_user_context()
        return self.user_context
    
    def check_community_access(self, community: str) -> bool:
        """Check if user has access to specific community"""
        if not self.user_context:
            self.initialize_user_context()
        
        if "error" in self.user_context:
            return False
        
        user_role = self.user_context.get("role", "")
        assigned_communities = self.user_context.get("assigned_communities", [])
        
        # Super admin and org admin have access to all communities
        if user_role in ["super_admin", "org_admin"]:
            return True
        
        # Regular users and community leads need assigned access
        return community in assigned_communities
    
    def request_permission(self, action: str, details: dict) -> str:
        """Format permission request for user approval"""
        permission_message = f"""
🔐 **PERMISSION REQUEST**

**Action**: {action}
**Details**: {json.dumps(details, indent=2)}
**Scope**: Your organization ({self.user_context.get('organization_id', 'Unknown')})
**Communities**: {details.get('communities', 'N/A')}

**Impact**: {details.get('impact', 'No impact specified')}

Do you want me to proceed with this action? Please respond with:
- ✅ **Yes** - to approve and proceed  
- ❌ **No** - to cancel the action
- ❓ **More info** - if you need more details

I will only proceed after your explicit approval.
"""
        return permission_message
    
    def analyze_projects(self, filters: dict = None) -> dict:
        """Analyze projects within user's scope"""
        if not self.check_community_access("product"):
            return {"error": "Access denied. You need access to Product Management community."}
        
        projects = self.api.get_projects(self.user_context.get("organization_id"))
        
        if "error" in projects:
            return projects
        
        analysis = {
            "total_projects": len(projects),
            "projects_by_status": {},
            "recent_activity": [],
            "recommendations": []
        }
        
        # Analyze project statuses
        for project in projects:
            status = project.get("status", "unknown")
            analysis["projects_by_status"][status] = analysis["projects_by_status"].get(status, 0) + 1
        
        return analysis
    
    def create_project_with_permission(self, project_data: dict) -> str:
        """Create project after requesting permission"""
        if not self.check_community_access("product"):
            return "❌ Access denied. You need access to Product Management community to create projects."
        
        # Request permission first
        permission_details = {
            "communities": ["product"],
            "impact": f"Will create new project: {project_data.get('name', 'Unnamed Project')}",
            "project_data": project_data
        }
        
        return self.request_permission("Create Project", permission_details)
    
    def update_project_with_permission(self, project_id: int, updates: dict) -> str:
        """Update project after requesting permission"""
        if not self.check_community_access("product"):
            return "❌ Access denied. You need access to Product Management community to update projects."
        
        # Request permission first
        permission_details = {
            "communities": ["product"],
            "impact": f"Will update project ID {project_id} with: {updates}",
            "project_id": project_id,
            "updates": updates
        }
        
        return self.request_permission("Update Project", permission_details)
    
    def generate_user_stories(self, requirements: str) -> list[dict]:
        """Generate user stories from requirements"""
        if not self.check_community_access("product"):
            return [{"error": "Access denied. You need access to Product Management community."}]
        
        # This would integrate with the AI to generate user stories
        # For now, return a template
        user_stories = [
            {
                "title": "User Story Template",
                "description": "As a [user type], I want [functionality] so that [benefit]",
                "acceptance_criteria": [
                    "Given [context]",
                    "When [action]", 
                    "Then [outcome]"
                ],
                "priority": "Medium",
                "story_points": 3
            }
        ]
        
        return user_stories
    
    def get_team_metrics(self) -> dict:
        """Get team productivity metrics"""
        if not self.user_context:
            self.initialize_user_context()
        
        org_id = self.user_context.get("organization_id")
        if not org_id:
            return {"error": "No organization context found"}
        
        users = self.api.get_organization_users(org_id)
        projects = self.api.get_projects(org_id)
        
        metrics = {
            "team_size": len(users) if not isinstance(users, dict) else 0,
            "active_projects": len([p for p in projects if p.get("status") == "active"]) if not isinstance(projects, dict) else 0,
            "organization_id": org_id,
            "timestamp": datetime.now().isoformat()
        }
        
        return metrics


# Tool functions that can be called by the AI agent
def analyze_current_projects(auth_token: str = None) -> str:
    """Analyze projects in user's organization"""
    tools = ProductManagementTools(auth_token)
    result = tools.analyze_projects()
    
    if "error" in result:
        return f"❌ {result['error']}"
    
    return f"""
📊 **PROJECT ANALYSIS**

**Total Projects**: {result['total_projects']}
**Status Distribution**: {result['projects_by_status']}

**Quick Insights**:
- You have {result['total_projects']} projects in your organization
- Status breakdown shows current project health

Would you like me to dive deeper into any specific area?
"""

def request_create_project(project_name: str, description: str, auth_token: str = None) -> str:
    """Request permission to create a new project"""
    tools = ProductManagementTools(auth_token)
    tools.initialize_user_context()
    
    project_data = {
        "name": project_name,
        "description": description,
        "status": "planning",
        "created_by": tools.user_context.get("id")
    }
    
    return tools.create_project_with_permission(project_data)

def request_update_project(project_id: int, updates: dict, auth_token: str = None) -> str:
    """Request permission to update a project"""
    tools = ProductManagementTools(auth_token)
    tools.initialize_user_context()
    
    return tools.update_project_with_permission(project_id, updates)

def generate_product_user_stories(requirements: str, auth_token: str = None) -> str:
    """Generate user stories from requirements"""
    tools = ProductManagementTools(auth_token)
    tools.initialize_user_context()
    
    stories = tools.generate_user_stories(requirements)
    
    if isinstance(stories, list) and stories and "error" in stories[0]:
        return f"❌ {stories[0]['error']}"
    
    return f"""
📝 **GENERATED USER STORIES**

Based on your requirements: "{requirements}"

{json.dumps(stories, indent=2)}

Would you like me to refine these user stories or create more specific ones?
"""

def get_team_productivity_metrics(auth_token: str = None) -> str:
    """Get team productivity metrics"""
    tools = ProductManagementTools(auth_token)
    tools.initialize_user_context()
    
    metrics = tools.get_team_metrics()
    
    if "error" in metrics:
        return f"❌ {metrics['error']}"
    
    return f"""
📈 **TEAM PRODUCTIVITY METRICS**

**Organization**: {metrics['organization_id']}
**Team Size**: {metrics['team_size']} members
**Active Projects**: {metrics['active_projects']}
**Last Updated**: {metrics['timestamp']}

**Insights**:
- Your team has {metrics['team_size']} active members
- Currently managing {metrics['active_projects']} active projects
- Team productivity appears {"healthy" if metrics['active_projects'] <= metrics['team_size'] * 2 else "stretched"}

Would you like me to analyze specific productivity patterns or suggest optimizations?
"""
