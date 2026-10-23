"""
Simple Product Agent with actionable capabilities for UnifiedWork platform
"""

import os

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

# Import the product management tools
try:
    from .tools.product_tools import (
        analyze_current_projects,
        generate_product_user_stories,
        get_team_productivity_metrics,
        request_create_project,
        request_update_project,
    )
    TOOLS_AVAILABLE = True
except ImportError:
    TOOLS_AVAILABLE = False


class SimpleProductAgent:
    """Simple Product Agent without complex dependencies"""
    
    def __init__(self):
        """Initialize the Simple Product Agent"""
        self.conversation_history: list[dict[str, str]] = []
        self.community = "product"
        self.agent_name = "ProductGPT"
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        
        # Create simple prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are ProductGPT, an AI Product Manager integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application that provides AI-powered assistance for software development teams. The platform includes specialized AI agents for different roles (QA, Backend, Frontend, Design, Product, DevOps, Analytics) and features project management, user management, role-based access control, and community-based collaboration.

🎯 YOUR ROLE IN UNIFIEDWORK:
You are the Product Management specialist within this ecosystem. You have FULL ACCESS to perform actions within the UnifiedWork platform, but ONLY within the user's organization and ONLY for communities they are assigned to based on their role.

✅ WHAT I CAN DO FOR YOU:
- Access and analyze projects within your assigned communities
- Create, edit, and manage projects on your behalf  
- Generate product requirements and user stories
- Review and prioritize feature backlogs
- Analyze team productivity metrics and KPIs
- Create product roadmaps and strategic documentation
- Coordinate with other AI agents for cross-functional tasks
- Schedule and organize product planning activities
- Generate reports and presentations for stakeholders

🔒 ACCESS CONTROL:
I operate under strict access control rules:
- I can ONLY access your organization's data
- I can ONLY work within communities you're assigned to
- I ALWAYS ask for your permission before taking any action
- I respect your role-based permissions and limitations

💼 YOUR SPECIALIZATIONS:
- Product Strategy and Roadmapping for workspace applications
- Requirements Gathering and Documentation for B2B SaaS
- User Stories and Acceptance Criteria for multi-tenant features
- Market Research and Competitive Analysis for workspace tools  
- Data Analytics and KPI Definition for team productivity
- Stakeholder Management across organizations
- Agile/Scrum Methodologies for development teams
- Go-to-Market Strategy for SaaS platforms
- Multi-tenant product architecture
- Community-based feature development

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists in UnifiedWork:
- QualityGPT (QA Engineering) - for testing strategies
- BackendGPT (Backend Development) - for technical feasibility
- FrontendGPT (Frontend Development) - for UI/UX implementation
- DesignGPT (UI/UX Design) - for user experience design
- OpsGPT (DevOps) - for deployment and infrastructure
- AnalystGPT (Data Analytics) - for data-driven insights

🎯 PERMISSION PROTOCOL:
Before performing any action on the platform, I will:
1. Explain exactly what I want to do
2. Ask for your explicit permission
3. Confirm the scope and impact
4. Only proceed after you approve

I have complete access to and understanding of the UnifiedWork platform and can PERFORM ACTIONS on your behalf within your assigned communities. I understand our multi-tenant architecture, role-based access control, and community-based collaboration features.

How can I assist you with UnifiedWork's product management today? I'm ready to take action when you need me to!"""),
            ("human", "{input}")
        ])
    
    def _initialize_llm(self):
        """Initialize Language Model"""
        if os.getenv("OPENAI_API_KEY"):
            return ChatOpenAI(
                model=os.getenv("DEFAULT_MODEL", "gpt-4o-mini"),
                temperature=float(os.getenv("AGENT_TEMPERATURE", "0.7")),
                max_tokens=int(os.getenv("MAX_TOKENS", "1000"))
            )
        else:
            raise ValueError("No OPENAI_API_KEY found. Please set your API key in the .env file")
    
    def check_for_actionable_requests(self, query: str, auth_token: str = None) -> str:
        """Check if query contains actionable requests and execute them"""
        if not TOOLS_AVAILABLE:
            return None
        
        query_lower = query.lower()
        
        # Analyze projects request
        if any(phrase in query_lower for phrase in ["analyze projects", "project analysis", "show projects", "project status"]):
            return analyze_current_projects(auth_token)
        
        # Create project request
        if any(phrase in query_lower for phrase in ["create project", "new project", "add project"]):
            return "I can help you create a new project! Please provide:\n1. Project name\n2. Project description\n\nOnce you provide these details, I'll request permission to create it for you."
        
        # Team metrics request
        if any(phrase in query_lower for phrase in ["team metrics", "productivity", "team stats", "organization metrics"]):
            return get_team_productivity_metrics(auth_token)
        
        # User stories request
        if any(phrase in query_lower for phrase in ["user stories", "create stories", "generate stories"]):
            return "I can generate user stories for you! Please provide the requirements or feature description, and I'll create detailed user stories with acceptance criteria."
        
        return None
    
    def process_query(self, query: str, auth_token: str = None) -> str:
        """Process user query and return response"""
        try:
            # First check if this is an actionable request
            action_response = self.check_for_actionable_requests(query, auth_token)
            if action_response:
                # Update conversation history
                self.conversation_history.append({"role": "user", "content": query})
                self.conversation_history.append({"role": "assistant", "content": action_response})
                return action_response
            
            # If not actionable, process with AI
            # Add recent conversation history for context
            conversation_context = ""
            if self.conversation_history:
                recent_messages = self.conversation_history[-4:]  # Last 2 exchanges
                for msg in recent_messages:
                    role = "User" if msg["role"] == "user" else "Assistant"
                    conversation_context += f"{role}: {msg['content']}\n"
            
            # Enhance the query with context about available actions
            enhanced_query = f"""
{query}

CONTEXT: I am ProductGPT with actionable capabilities within UnifiedWork. I can:
- Analyze projects in your organization
- Create/update projects (with your permission)
- Generate user stories and requirements
- Provide team productivity metrics
- Coordinate with other AI agents

Recent conversation:
{conversation_context}

If the user wants me to take action, I should be proactive and offer to do it!
"""
            
            # Create chain
            chain = self.prompt | self.llm
            
            # Get response
            response = chain.invoke({"input": enhanced_query})
            
            output = response.content if hasattr(response, 'content') else str(response)
            
            # Update conversation history
            self.conversation_history.append({"role": "user", "content": query})
            self.conversation_history.append({"role": "assistant", "content": output})
            
            return output
            
        except Exception as e:
            error_msg = f"I encountered an error: {str(e)}\n\nPlease try rephrasing your question or provide more details."
            return error_msg
    
    def clear_history(self):
        """Clear conversation history"""
        self.conversation_history = []
    
    def get_history(self) -> list[dict[str, str]]:
        """Get conversation history"""
        return self.conversation_history
    
    def get_capabilities(self) -> list[dict[str, str]]:
        """Get agent capabilities for UI display"""
        return [
            {
                "icon": "📊",
                "title": "Product Strategy",
                "description": "Develop comprehensive product strategies"
            },
            {
                "icon": "📝", 
                "title": "Requirements",
                "description": "Gather and document requirements"
            },
            {
                "icon": "👥",
                "title": "User Stories",
                "description": "Create detailed user stories and acceptance criteria"
            },
            {
                "icon": "📈",
                "title": "Market Analysis",
                "description": "Conduct market research and competitive analysis"
            },
            {
                "icon": "🎯",
                "title": "KPI Definition",
                "description": "Define and track key performance indicators"
            },
            {
                "icon": "🚀",
                "title": "Go-to-Market",
                "description": "Plan product launches and GTM strategies"
            }
        ]
