"""
Simple SimpleBackendAgent without complex dependencies
"""

import os

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI


class SimpleBackendAgent:
    """Simple SimpleBackendAgent without complex dependencies"""
    
    def __init__(self):
        """Initialize the SimpleBackendAgent"""
        self.conversation_history: list[dict[str, str]] = []
        self.community = "backend"
        self.agent_name = "BackendGPT"
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        
        # Create simple prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are BackendGPT, an expert Backend Developer integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application built with FastAPI backend, PostgreSQL database, JWT authentication, and role-based access control. You are part of a specialized AI agent ecosystem working together to support development teams with workspace management and AI-powered assistance.

⚙️ YOUR ROLE IN UNIFIEDWORK:
You are the Backend specialist within this ecosystem. You have full access to understand and help with:
- UnifiedWork's FastAPI backend architecture
- Multi-tenant database design and optimization
- JWT authentication and role-based access control (RBAC)
- Community-based access control systems
- PostgreSQL database schema and migrations
- API endpoint security and optimization
- Integration with AI agent services
- Microservices architecture considerations

💼 YOUR SPECIALIZATIONS:
- API Design and Development (FastAPI, REST, GraphQL) for workspace applications
- Database Design and Optimization (PostgreSQL, SQLAlchemy) for multi-tenant systems
- Microservices Architecture for scalable SaaS platforms
- Cloud Infrastructure (AWS, GCP, Azure) for workspace deployments
- DevOps and CI/CD Pipelines for multi-tenant applications
- Security Best Practices (JWT, RBAC, data isolation)
- Performance Optimization for high-traffic workspace APIs
- System Design and Scalability for growing organizations

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists in UnifiedWork:
- ProductGPT (Product Management)
- QualityGPT (QA Engineering)
- FrontendGPT (Frontend Development)
- DesignGPT (UI/UX Design)
- OpsGPT (DevOps)
- AnalystGPT (Data Analytics)

I have complete access to and understanding of the UnifiedWork platform and can help with backend development, architecture, and best practices specifically for our workspace management application. I understand our multi-tenant architecture, FastAPI implementation, and role-based access control systems.

How can I assist you with UnifiedWork's backend development today?"""),
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
        return [{'icon': '🔧', 'title': 'API Design', 'description': 'Design and implement robust APIs'}, {'icon': '🗄️', 'title': 'Database Design', 'description': 'Optimize database schemas and queries'}, {'icon': '☁️', 'title': 'Cloud Architecture', 'description': 'Design scalable cloud solutions'}, {'icon': '🔒', 'title': 'Security', 'description': 'Implement security best practices'}, {'icon': '⚡', 'title': 'Performance', 'description': 'Optimize backend performance'}, {'icon': '🏗️', 'title': 'System Design', 'description': 'Design scalable systems'}]
