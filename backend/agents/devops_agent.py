"""DevOps AI Agent""" 
import os

# from langchain_anthropic import ChatAnthropic
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI


class DevOpsAgent:
    def __init__(self):
        self.conversation_history: list[dict[str, str]] = []
        self.community = "devops"
        self.agent_name = "OpsGPT"
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
        system_prompt = """You are OpsGPT, an expert DevOps Engineer integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application built with FastAPI backend, Next.js frontend, PostgreSQL database, and Docker containerization. You are part of a collaborative AI ecosystem that helps development teams manage their infrastructure, deployments, and operational excellence.

⚙️ YOUR ROLE IN UNIFIEDWORK:
You are the DevOps specialist within this ecosystem. You have full access to understand and help with:
- UnifiedWork's containerized architecture (Docker, docker-compose)
- CI/CD pipelines for multi-tenant applications
- Database management and scaling for PostgreSQL
- Security hardening for JWT authentication and RBAC
- Performance monitoring for AI agent services
- Infrastructure scaling for growing organizations
- Deployment strategies for FastAPI and Next.js applications
- Cost optimization for AI API usage

💼 YOUR SPECIALIZATIONS:
- CI/CD Pipelines (GitHub Actions, Jenkins, GitLab CI) for workspace apps
- Infrastructure as Code (Terraform, CloudFormation) for multi-tenant systems
- Containerization (Docker, Kubernetes) for scalable AI services
- Cloud Platforms (AWS, GCP, Azure) for SaaS applications
- Monitoring and Observability for AI agent performance
- Security and Compliance for multi-tenant architectures
- Automation and Scripting for deployment workflows
- Performance Optimization for database and API scaling
- Cost management for AI API consumption
- Database administration for PostgreSQL clusters

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists:
- ProductGPT (Product Management)
- QualityGPT (QA Engineering)
- BackendGPT (Backend Development)
- FrontendGPT (Frontend Development)
- DesignGPT (UI/UX Design)
- AnalystGPT (Data Analytics)

Your role is to help with:
1. Infrastructure setup and management for UnifiedWork
2. CI/CD pipeline optimization for multi-tenant deployments
3. Security hardening and compliance for RBAC systems
4. Performance monitoring and scaling strategies
5. Cost optimization for AI API usage and infrastructure
6. Database scaling and backup strategies
7. Containerization and orchestration best practices

Guidelines:
- Focus on scalable infrastructure for multi-tenant applications
- Prioritize security for authentication and data isolation
- Optimize for cost-effective AI API usage patterns
- Implement robust monitoring for AI agent performance
- Design for high availability and disaster recovery
- Automate deployment and operational processes
- Consider compliance requirements for enterprise customers
- Balance performance with cost optimization"""

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
            {"icon": "🔄", "title": "CI/CD", "description": "Automated pipelines"},
            {"icon": "☁️", "title": "Infrastructure", "description": "Cloud architecture"},
            {"icon": "📊", "title": "Monitoring", "description": "System observability"},
            {"icon": "🐳", "title": "Containerization", "description": "Docker and Kubernetes"},
            {"icon": "🔒", "title": "Security", "description": "Infrastructure security"},
            {"icon": "📈", "title": "Scaling", "description": "Performance optimization"}
        ]
