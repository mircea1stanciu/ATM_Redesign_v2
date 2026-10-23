"""
QA Automation AI Agent for UnifiedWork
Specialized agent for QA Engineers community
"""

import os

# # from langchain_anthropic import ChatAnthropic
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI

from tools.qa_tools import (
    create_page_object,
    debug_test_failure,
    explain_qa_concept,
    generate_playwright_test,
    generate_test_scenarios,
    get_qa_best_practices,
    review_test_code,
)


class QAAgent:
    """AI Agent specialized for QA Engineers"""
    
    def __init__(self, model_id: str = None):
        """Initialize the QA Agent with optional model selection"""
        self.conversation_history: list[dict[str, str]] = []
        self.community = "qa"
        self.agent_name = "QualityGPT"
        self.model_id = model_id
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        
        # Initialize tools
        self.tools = [
            generate_playwright_test,
            review_test_code,
            explain_qa_concept,
            generate_test_scenarios,
            debug_test_failure,
            get_qa_best_practices,
            create_page_object
        ]
        
        # Create agent
        self.agent_executor = self._create_agent()
    
    def _initialize_llm(self):
        """Initialize Language Model with model selection support"""
        if self.model_id:
            # Use model manager for dynamic model selection
            try:
                from core.model_manager import ModelManager
                return ModelManager.create_llm(self.model_id)
            except Exception as e:
                print(f"Failed to create LLM with model {self.model_id}: {e}")
                # Fall back to default
        
        # Default behavior
        if os.getenv("OPENAI_API_KEY"):
            return ChatOpenAI(
                model=os.getenv("DEFAULT_MODEL", "gpt-4o-mini"),
                temperature=float(os.getenv("AGENT_TEMPERATURE", "0.7")),
                max_tokens=int(os.getenv("MAX_TOKENS", "1000"))
            )
        elif os.getenv("ANTHROPIC_API_KEY"):
            # Temporarily disabled due to compatibility issues
            raise ValueError("Anthropic support temporarily disabled - use OpenAI instead")
        else:
            raise ValueError("No API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY")
    
    def _create_agent(self) -> AgentExecutor:
        """Create the QA specialized agent"""
        
        system_prompt = """You are QualityGPT, an expert QA Automation Engineer integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application that provides AI-powered assistance for software development teams. You are part of a specialized AI agent ecosystem that includes Backend, Frontend, Design, Product, DevOps, and Analytics specialists, all working together to support development teams.

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
- Test automation frameworks (Playwright, Selenium, Cypress, WebDriver)
- Test design patterns (Page Object Model, Factory Pattern)
- API testing (REST, GraphQL, Postman, Newman)
- Mobile testing (Appium, Espresso, XCUITest)
- Performance testing (JMeter, LoadRunner, Artillery)
- Test strategy and planning
- Bug analysis and debugging
- CI/CD integration for testing
- Test data management
- Cross-browser and cross-platform testing
- Multi-tenant application testing
- Security testing for RBAC systems

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists:
- ProductGPT (Product Management)
- BackendGPT (Backend Development) 
- FrontendGPT (Frontend Development)
- DesignGPT (UI/UX Design)
- OpsGPT (DevOps)
- AnalystGPT (Data Analytics)

Your role is to:
1. Generate high-quality, maintainable test code
2. Review and improve existing test automation
3. Explain testing concepts and best practices
4. Create comprehensive test scenarios for UnifiedWork features
5. Help debug test failures and flaky tests
6. Provide guidance on test automation strategy
7. Teach modern testing techniques
8. Ensure quality for multi-tenant applications

Guidelines:
- Write clean, readable, and maintainable test code
- Follow Page Object Model and other design patterns
- Use modern async/await patterns
- Include proper error handling and assertions
- Provide clear explanations and documentation
- Focus on practical, real-world solutions
- Consider multi-tenant architecture in testing strategies
- Ask clarifying questions when needed
- Be encouraging and supportive to learners

Available tools:
- generate_playwright_test: Generate Playwright test code
- review_test_code: Review and improve test code
- explain_qa_concept: Explain testing concepts
- generate_test_scenarios: Create test scenarios
- debug_test_failure: Help debug test failures
- get_qa_best_practices: Provide best practices
- create_page_object: Generate Page Object classes

Use these tools when appropriate to provide the best assistance."""

        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="chat_history", optional=True),
            ("human", "{input}"),
            MessagesPlaceholder(variable_name="agent_scratchpad"),
        ])
        
        agent = create_openai_functions_agent(
            llm=self.llm,
            tools=self.tools,
            prompt=prompt
        )
        
        return AgentExecutor(
            agent=agent,
            tools=self.tools,
            verbose=True,
            handle_parsing_errors=True,
            max_iterations=5
        )
    
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
            
            # Invoke agent
            response = self.agent_executor.invoke({
                "input": query,
                "chat_history": chat_history
            })
            
            output = response.get("output", "I apologize, I couldn't process that request.")
            
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
