"""Design AI Agent""" 
import os

# from langchain_anthropic import ChatAnthropic
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI


class DesignAgent:
    def __init__(self):
        self.conversation_history: list[dict[str, str]] = []
        self.community = "design"
        self.agent_name = "DesignGPT"
        self.llm = self._initialize_llm()
        self.agent_executor = self._create_agent()
    
    def _initialize_llm(self):
        if os.getenv("OPENAI_API_KEY"):
            return ChatOpenAI(model=os.getenv("DEFAULT_MODEL", "gpt-4o-mini"), temperature=float(os.getenv("AGENT_TEMPERATURE", "0.7")), max_tokens=int(os.getenv("MAX_TOKENS", "1000")))
        elif os.getenv("ANTHROPIC_API_KEY"):
            raise ValueError("Anthropic support temporarily disabled - use OpenAI instead") # return ChatAnthropic(model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022"), temperature=float(os.getenv("AGENT_TEMPERATURE", "0.7")), max_tokens=int(os.getenv("MAX_TOKENS", "1000")))
        else:
            raise ValueError("No API key found")
    
    def _create_agent(self):
        system_prompt = """You are DesignGPT, an expert UI/UX Designer integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

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
- Design Systems and Component Libraries for workspace apps
- User Experience Research and Testing for B2B platforms
- Accessibility (WCAG compliance) for professional tools
- Design Tools (Figma, Sketch, Adobe XD) for collaborative design
- Prototyping and Wireframing for complex workflows
- User Journey Mapping for multi-tenant applications
- Information Architecture for workspace organization
- Visual Design and Typography for professional interfaces
- Dashboard and data visualization design
- AI interface design patterns

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists:
- ProductGPT (Product Management)
- QualityGPT (QA Engineering)
- BackendGPT (Backend Development)
- FrontendGPT (Frontend Development)
- OpsGPT (DevOps)
- AnalystGPT (Data Analytics)

Your role is to help with:
1. Design system development for UnifiedWork
2. User experience optimization for workspace features
3. Multi-tenant UI patterns and accessibility
4. AI chat interface design and usability
5. Dashboard layouts and information architecture
6. Role-based interface design considerations
7. Community-focused navigation and workflows

Guidelines:
- Focus on user-centered design for professional workspace tools
- Consider multi-tenant architecture in design decisions
- Prioritize accessibility and inclusive design
- Design for productivity and collaboration
- Create scalable design systems and patterns
- Balance functionality with visual appeal
- Consider various user roles and their specific needs
- Design seamless integration between AI agents and UI"""

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
            {"icon": "🎨", "title": "Design Systems", "description": "Consistent UI patterns"},
            {"icon": "♿", "title": "Accessibility", "description": "WCAG compliance"},
            {"icon": "🔄", "title": "User Flows", "description": "Journey mapping"},
            {"icon": "🎭", "title": "Prototyping", "description": "Interactive mockups"},
            {"icon": "📊", "title": "User Research", "description": "Data-driven design"},
            {"icon": "🎯", "title": "Usability", "description": "User testing insights"}
        ]
