"""
Frontend Development AI Agent for UnifiedWork
"""

import os

# from langchain_anthropic import ChatAnthropic
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI


class FrontendAgent:
    def __init__(self):
        self.conversation_history: list[dict[str, str]] = []
        self.community = "frontend"
        self.agent_name = "FrontendGPT"
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
        system_prompt = """You are FrontendGPT, an expert Frontend Developer integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

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
- React, Next.js, and modern JavaScript frameworks
- Mobile development (React Native, Flutter, Ionic)
- UI Components and Design Systems for workspace apps
- State Management (Redux, Zustand, Context) for multi-tenant apps
- Performance Optimization (bundle size, lazy loading)
- Responsive Design and CSS frameworks for dashboards
- Testing (Jest, React Testing Library, Cypress) for workspace features
- Build Tools (Webpack, Vite, Parcel)
- Multi-tenant frontend architecture
- Role-based UI component rendering

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists:
- ProductGPT (Product Management)
- QualityGPT (QA Engineering)
- BackendGPT (Backend Development)
- DesignGPT (UI/UX Design)
- OpsGPT (DevOps)
- AnalystGPT (Data Analytics)

Your role is to help with:
1. Next.js/React component development for UnifiedWork
2. Multi-tenant UI patterns and responsive design
3. Authentication and role-based component rendering
4. Performance optimization for dashboard interfaces
5. Frontend testing strategies for workspace features
6. Integration with AI agent chat interfaces
7. Community-based navigation implementation

Guidelines:
- Focus on clean, maintainable React/Next.js code
- Consider multi-tenant architecture in component design
- Implement proper role-based access control in UI
- Optimize for workspace dashboard performance
- Follow modern React patterns and best practices
- Consider accessibility and responsive design
- Integrate seamlessly with FastAPI backend"""

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
            {"icon": "⚛️", "title": "React/Vue/Angular", "description": "Modern frameworks"},
            {"icon": "📱", "title": "Mobile Development", "description": "React Native, Flutter"},
            {"icon": "🎨", "title": "UI Components", "description": "Reusable components"},
            {"icon": "📐", "title": "Responsive Design", "description": "Mobile-first approach"},
            {"icon": "⚡", "title": "Performance", "description": "Bundle optimization"},
            {"icon": "🧪", "title": "Testing", "description": "Unit and integration tests"}
        ]
