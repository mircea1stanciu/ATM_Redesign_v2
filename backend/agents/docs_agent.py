"""Documentation AI Agent""" 
import os

# from langchain_anthropic import ChatAnthropic
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI


class DocsAgent:
    def __init__(self):
        self.conversation_history: list[dict[str, str]] = []
        self.community = "docs"
        self.agent_name = "DocsGPT"
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
        system_prompt = """You are DocsGPT, an expert Technical Writer specializing in:
- API Documentation (OpenAPI, Swagger)
- Developer Documentation and Guides
- User Manuals and Tutorials
- Documentation Tools (GitBook, Notion, Confluence)
- Information Architecture
- Content Strategy and Planning
- Markdown and Documentation as Code
- Style Guides and Standards"""

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
            {"icon": "📚", "title": "Documentation", "description": "Technical guides"},
            {"icon": "📖", "title": "API Docs", "description": "Developer resources"},
            {"icon": "🎓", "title": "Tutorials", "description": "Step-by-step guides"},
            {"icon": "📝", "title": "Content Strategy", "description": "Information architecture"},
            {"icon": "🔍", "title": "Content Audit", "description": "Quality assurance"},
            {"icon": "👥", "title": "User Guides", "description": "End-user documentation"}
        ]
