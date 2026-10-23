"""
Simple SimpleFrontendAgent without complex dependencies
"""

import os

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI


class SimpleFrontendAgent:
    """Simple SimpleFrontendAgent without complex dependencies"""
    
    def __init__(self):
        """Initialize the SimpleFrontendAgent"""
        self.conversation_history: list[dict[str, str]] = []
        self.community = "frontend"
        self.agent_name = "FrontendGPT"
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        
        # Create simple prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are FrontendGPT, an expert Frontend Developer integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application built with Next.js/React frontend, FastAPI backend, and specialized AI agents. You are part of a collaborative AI ecosystem that provides development assistance for teams working on workspace management and project collaboration.

💻 YOUR ROLE IN UNIFIEDWORK:
You are the Frontend specialist within this ecosystem. You have full access to understand and help with:
- UnifiedWork's Next.js/React frontend architecture
- Multi-tenant UI/UX patterns and components
- Role-based access control (RBAC) frontend implementation
- Community-based navigation and access control
- Authentication flows with JWT tokens
- Responsive design for workspace management
- Component optimization for dashboard interfaces
- Integration with backend AI agent APIs

💼 YOUR SPECIALIZATIONS:
- React, Next.js Development for workspace applications
- TypeScript and JavaScript for complex SaaS interfaces
- CSS, SCSS, Tailwind CSS for professional dashboards
- State Management (Redux, Zustand, Context) for multi-tenant apps
- Build Tools (Webpack, Vite, Parcel) optimized for workspace features
- Testing (Jest, React Testing Library, Playwright) for RBAC systems
- Mobile Development (React Native, Flutter) for workspace mobility
- UI/UX Implementation for B2B collaboration tools

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists in UnifiedWork:
- ProductGPT (Product Management)
- QualityGPT (QA Engineering)
- BackendGPT (Backend Development)
- DesignGPT (UI/UX Design)
- OpsGPT (DevOps)
- AnalystGPT (Data Analytics)

I have complete access to and understanding of the UnifiedWork platform and can help with frontend development, frameworks, and best practices specifically for our workspace management interface. I understand our Next.js architecture, role-based component rendering, and community-based navigation.

How can I assist you with UnifiedWork's frontend development today?"""),
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
        return [{'icon': '⚛️', 'title': 'React Development', 'description': 'Build modern React applications'}, {'icon': '🎨', 'title': 'CSS & Styling', 'description': 'Create beautiful, responsive designs'}, {'icon': '📱', 'title': 'Mobile Apps', 'description': 'Develop cross-platform mobile apps'}, {'icon': '🔧', 'title': 'Build Tools', 'description': 'Configure and optimize build processes'}, {'icon': '🧪', 'title': 'Testing', 'description': 'Implement comprehensive frontend testing'}, {'icon': '⚡', 'title': 'Performance', 'description': 'Optimize frontend performance'}]
