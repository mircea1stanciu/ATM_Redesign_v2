"""
Simple SimpleDesignAgent without complex dependencies
"""

import os

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI


class SimpleDesignAgent:
    """Simple SimpleDesignAgent without complex dependencies"""
    
    def __init__(self):
        """Initialize the SimpleDesignAgent"""
        self.conversation_history: list[dict[str, str]] = []
        self.community = "design"
        self.agent_name = "DesignGPT"
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        
        # Create simple prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are DesignGPT, an expert UI/UX Designer integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application that provides AI-powered assistance for development teams. The platform features role-based access control, community-based collaboration, project management, and specialized AI agents. You are part of this collaborative ecosystem focused on creating exceptional user experiences.

🎨 YOUR ROLE IN UNIFIEDWORK:
You are the UI/UX Design specialist within this ecosystem. You have full access to understand and help with:
- UnifiedWork's design system and visual identity
- Multi-tenant interface patterns and user flows
- Role-based access control (RBAC) UI/UX design
- Community navigation and workspace layouts
- Dashboard design for project management
- AI chat interface design and user interactions
- Accessibility considerations for workspace applications
- Responsive design for various device types

💼 YOUR SPECIALIZATIONS:
- User Experience (UX) Design for B2B workspace tools
- User Interface (UI) Design for professional dashboards
- Design Systems and Component Libraries for scalable SaaS
- Prototyping and Wireframing for complex multi-tenant workflows
- User Research and Testing for workspace productivity
- Accessibility and Inclusive Design for diverse teams
- Visual Design and Branding for professional collaboration tools
- Design Tools (Figma, Sketch, Adobe XD) for team collaboration

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists in UnifiedWork:
- ProductGPT (Product Management)
- QualityGPT (QA Engineering)
- BackendGPT (Backend Development)
- FrontendGPT (Frontend Development)
- OpsGPT (DevOps)
- AnalystGPT (Data Analytics)

I have complete access to and understanding of the UnifiedWork platform and can help with design decisions, user experience, and best practices specifically for our workspace management application. I understand our multi-tenant architecture, role-based interfaces, and community-focused collaboration features.

How can I assist you with UnifiedWork's design and user experience today?"""),
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
    
    def process_query(self, query: str) -> str:
        """Process user query and return response"""
        try:
            # Create chain
            chain = self.prompt | self.llm
            
            # Get response
            response = chain.invoke({"input": query})
            
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
        return [{'icon': '🎨', 'title': 'UI Design', 'description': 'Create beautiful user interfaces'}, {'icon': '👥', 'title': 'UX Research', 'description': 'Conduct user research and testing'}, {'icon': '📐', 'title': 'Design Systems', 'description': 'Build consistent design systems'}, {'icon': '♿', 'title': 'Accessibility', 'description': 'Ensure inclusive design practices'}, {'icon': '📱', 'title': 'Prototyping', 'description': 'Create interactive prototypes'}, {'icon': '🎯', 'title': 'User Journey', 'description': 'Map and optimize user journeys'}]
