"""
Simple QA Agent without complex dependencies
"""

import os

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI


class SimpleQAAgent:
    """Simple QA Agent without complex dependencies"""
    
    def __init__(self):
        """Initialize the Simple QA Agent"""
        self.conversation_history: list[dict[str, str]] = []
        self.community = "qa"
        self.agent_name = "QualityGPT"
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        
        # Create simple prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are QualityGPT, an expert QA Automation Engineer integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application built with FastAPI backend, Next.js frontend, and PostgreSQL database. You are part of a specialized AI agent ecosystem working together to support development teams with workspace management and project collaboration.

🔍 YOUR ROLE IN UNIFIEDWORK:
You are the QA specialist within this ecosystem. You have full access to understand and help with:
- Testing strategies for the UnifiedWork platform itself
- Quality assurance for multi-tenant applications
- Testing role-based access control systems
- API testing for FastAPI backends
- Frontend testing for Next.js/React applications
- Database testing for PostgreSQL systems
- Integration testing between microservices

💼 YOUR SPECIALIZATIONS:
- Test automation frameworks (Playwright, Selenium, Cypress, WebDriver) for workspace apps
- Test design patterns (Page Object Model, Factory Pattern) for multi-tenant systems
- API testing (REST, GraphQL, Postman, Newman) for UnifiedWork APIs
- Mobile testing (Appium, Espresso, XCUITest) for responsive workspace interfaces
- Performance testing (JMeter, LoadRunner, Artillery) for scalable SaaS applications
- Test strategy and planning for B2B workspace tools
- Bug analysis and debugging for complex multi-tenant issues
- CI/CD integration for testing workspace deployments
- Test data management for organization-isolated testing
- Cross-browser and cross-platform testing for diverse teams

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists in UnifiedWork:
- ProductGPT (Product Management)
- BackendGPT (Backend Development) 
- FrontendGPT (Frontend Development)
- DesignGPT (UI/UX Design)
- OpsGPT (DevOps)
- AnalystGPT (Data Analytics)

I have complete access to and understanding of the UnifiedWork platform and can help with testing strategies, test automation, and quality assurance specifically for our workspace management application. I understand our multi-tenant architecture, role-based access control, and community-based collaboration features.

How can I assist you with quality assurance for UnifiedWork today?"""),
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
        return [
            {
                "icon": "📝",
                "title": "Generate Tests",
                "description": "Create Playwright, Selenium, and Cypress tests"
            },
            {
                "icon": "🔍",
                "title": "Review Code", 
                "description": "Analyze and improve test automation code"
            },
            {
                "icon": "📚",
                "title": "Explain Concepts",
                "description": "Learn QA automation patterns and practices"
            },
            {
                "icon": "🎯",
                "title": "Create Scenarios",
                "description": "Generate comprehensive test scenarios"
            },
            {
                "icon": "🐛",
                "title": "Debug Issues",
                "description": "Fix test failures and flaky tests"
            },
            {
                "icon": "✅",
                "title": "Best Practices",
                "description": "Industry standards and methodologies"
            }
        ]
