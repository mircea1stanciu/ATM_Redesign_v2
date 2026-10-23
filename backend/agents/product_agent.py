"""Product Management AI Agent""" 
import os

# from langchain_anthropic import ChatAnthropic
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI


class ProductAgent:
    def __init__(self):
        self.conversation_history: list[dict[str, str]] = []
        self.community = "product"
        self.agent_name = "ProductGPT"
        self.llm = self._initialize_llm()
        self.agent_executor = self._create_agent()
    
    def _initialize_llm(self):
        if os.getenv("OPENAI_API_KEY"):
            return ChatOpenAI(
                model=os.getenv("DEFAULT_MODEL", "gpt-4o-mini"), 
                temperature=float(os.getenv("AGENT_TEMPERATURE", "0.7")), 
                max_tokens=int(os.getenv("MAX_TOKENS", "1000"))
            )
        elif os.getenv("ANTHROPIC_API_KEY"):
            raise ValueError("Anthropic support temporarily disabled - use OpenAI instead")
        else:
            raise ValueError("No API key found")
    
    def _create_agent(self):
        system_prompt = """You are ProductGPT, an AI Product Manager integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application that provides AI-powered assistance for software development teams. The platform includes specialized AI agents for different roles (QA, Backend, Frontend, Design, Product, DevOps, Analytics) and features project management, user management, role-based access control, and community-based collaboration.

🎯 YOUR ROLE IN UNIFIEDWORK:
You are the Product Management specialist within this ecosystem. You have full access to understand and help with:
- UnifiedWork's product strategy and feature development
- Project management within the platform
- User experience optimization for the workspace
- Feature prioritization and roadmapping
- Integration strategies between different AI agents
- Multi-tenant architecture considerations
- Community-based access control features

💼 YOUR SPECIALIZATIONS:
- Product Strategy and Roadmapping
- Requirements Gathering and Documentation  
- User Stories and Acceptance Criteria
- Market Research and Competitive Analysis
- Data Analytics and KPI Definition
- Stakeholder Management
- Agile/Scrum Methodologies
- Go-to-Market Strategy
- SaaS Product Management
- Multi-tenant Platform Strategy

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists:
- QualityGPT (QA Engineering)
- BackendGPT (Backend Development) 
- FrontendGPT (Frontend Development)
- DesignGPT (UI/UX Design)
- OpsGPT (DevOps)
- AnalystGPT (Data Analytics)

Always provide practical, actionable advice that considers the UnifiedWork platform context and multi-tenant architecture."""

        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="chat_history", optional=True),
            ("human", "{input}"),
        ])
        return prompt | self.llm
    
    def process_query(self, query: str) -> str:
        try:
            chat_history = []
            for msg in self.conversation_history[-10:]:
                if msg["role"] == "user":
                    chat_history.append(HumanMessage(content=msg["content"]))
                else:
                    chat_history.append(AIMessage(content=msg["content"]))
            
            response = self.agent_executor.invoke({"input": query, "chat_history": chat_history})
            output = response.content if hasattr(response, 'content') else str(response)
            
            self.conversation_history.append({"role": "user", "content": query})
            self.conversation_history.append({"role": "assistant", "content": output})
            return output
        except Exception as e:
            return f"Error: {str(e)}"
    
    def clear_history(self):
        self.conversation_history = []
    
    def get_history(self) -> list[dict[str, str]]:
        return self.conversation_history
    
    def get_capabilities(self) -> list[dict[str, str]]:
        return [
            {"icon": "📋", "title": "Requirements", "description": "Feature specifications"},
            {"icon": "📖", "title": "User Stories", "description": "Agile methodology"},
            {"icon": "🗺️", "title": "Roadmaps", "description": "Strategic planning"},
            {"icon": "📊", "title": "Analytics", "description": "Data-driven decisions"},
            {"icon": "👥", "title": "Stakeholder Management", "description": "Communication"},
            {"icon": "🎯", "title": "Market Research", "description": "Competitive analysis"}
        ]
