"""
Backend Development AI Agent for UnifiedWork
Specialized agent for Backend Developers community
"""

import os

# from langchain_anthropic import ChatAnthropic
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI


class BackendAgent:
    """AI Agent specialized for Backend Developers"""
    
    def __init__(self):
        """Initialize the Backend Agent"""
        self.conversation_history: list[dict[str, str]] = []
        self.community = "backend"
        self.agent_name = "BackendGPT"
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        self.tools = []  # Add backend-specific tools here
        
        # Create a simple agent without tools for now
        self.agent_executor = self._create_agent()
    
    def _initialize_llm(self):
        """Initialize Language Model"""
        if os.getenv("OPENAI_API_KEY"):
            return ChatOpenAI(
                model=os.getenv("DEFAULT_MODEL", "gpt-4o-mini"),
                temperature=float(os.getenv("AGENT_TEMPERATURE", "0.7")),
                max_tokens=int(os.getenv("MAX_TOKENS", "1000"))
            )
        elif os.getenv("ANTHROPIC_API_KEY"):
            raise ValueError("Anthropic support temporarily disabled - use OpenAI instead")
        else:
            raise ValueError("No API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY")
    
    def _create_agent(self):
        """Create the Backend specialized agent"""
        
        system_prompt = """You are BackendGPT, an expert Backend Developer and Architect integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application built with FastAPI backend, PostgreSQL database, JWT authentication, and role-based access control. You are part of a specialized AI agent ecosystem working together to support development teams with workspace management, project collaboration, and AI-powered assistance.

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
- API Development (REST, GraphQL, gRPC)
- Database Design (PostgreSQL, SQLAlchemy, migrations)
- Server Architecture (FastAPI, microservices, monoliths)
- Security (JWT, RBAC, authentication, authorization, encryption)
- Performance Optimization (caching, indexing, scaling)
- DevOps Integration (CI/CD, containerization, Docker)
- Framework Expertise (FastAPI, Django, Express, Spring Boot)
- Cloud Platforms (AWS, GCP, Azure)
- Multi-tenant application architecture
- AI service integration patterns

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists:
- ProductGPT (Product Management)
- QualityGPT (QA Engineering)
- FrontendGPT (Frontend Development)
- DesignGPT (UI/UX Design)
- OpsGPT (DevOps)
- AnalystGPT (Data Analytics)

Your role is to help with:
1. API design and implementation for UnifiedWork features
2. Database schema design and optimization
3. System architecture decisions for multi-tenant applications
4. Security best practices and RBAC implementation
5. Performance tuning and scaling strategies
6. Code review and refactoring
7. Troubleshooting backend issues
8. Integration patterns for AI agents

Guidelines:
- Write clean, maintainable, and secure code
- Follow REST and API design principles
- Emphasize performance and scalability for multi-tenant apps
- Include proper error handling
- Focus on production-ready solutions
- Consider multi-tenant architecture implications
- Explain architectural decisions
- Consider security implications for RBAC systems"""

        # Simple prompt template without tools
        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="chat_history", optional=True),
            ("human", "{input}"),
        ])
        
        # Return a simple chain instead of agent
        return prompt | self.llm
    
    def process_query(self, query: str) -> str:
        """Process user query and return response"""
        try:
            # Prepare chat history
            chat_history = []
            for msg in self.conversation_history[-10:]:
                if msg["role"] == "user":
                    chat_history.append(HumanMessage(content=msg["content"]))
                else:
                    chat_history.append(AIMessage(content=msg["content"]))
            
            # Invoke the chain
            response = self.agent_executor.invoke({
                "input": query,
                "chat_history": chat_history
            })
            
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
                "icon": "🔧",
                "title": "API Design",
                "description": "REST, GraphQL, and gRPC APIs"
            },
            {
                "icon": "🗄️",
                "title": "Database Design", 
                "description": "Schema design and optimization"
            },
            {
                "icon": "🔒",
                "title": "Security",
                "description": "Authentication and authorization"
            },
            {
                "icon": "⚡",
                "title": "Performance",
                "description": "Optimization and scaling"
            },
            {
                "icon": "🐛",
                "title": "Debug Issues",
                "description": "Server-side troubleshooting"
            },
            {
                "icon": "📊",
                "title": "Monitoring",
                "description": "Logging and metrics"
            }
        ]
