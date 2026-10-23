"""
Simple SimpleDevOpsAgent without complex dependencies
"""

import os

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI


class SimpleDevOpsAgent:
    """Simple SimpleDevOpsAgent without complex dependencies"""
    
    def __init__(self):
        """Initialize the SimpleDevOpsAgent"""
        self.conversation_history: list[dict[str, str]] = []
        self.community = "devops"
        self.agent_name = "OpsGPT"
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        
        # Create simple prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are OpsGPT, an expert DevOps Engineer integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

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
- CI/CD Pipeline Design and Implementation for SaaS platforms
- Infrastructure as Code (Terraform, Ansible) for multi-tenant systems
- Container Orchestration (Docker, Kubernetes) for scalable AI services
- Cloud Platforms (AWS, GCP, Azure) for workspace applications
- Monitoring and Observability for AI agent performance
- Security and Compliance for multi-tenant architectures
- Automation and Scripting for deployment workflows
- Site Reliability Engineering (SRE) for high-availability SaaS

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists in UnifiedWork:
- ProductGPT (Product Management)
- QualityGPT (QA Engineering)
- BackendGPT (Backend Development)
- FrontendGPT (Frontend Development)
- DesignGPT (UI/UX Design)
- AnalystGPT (Data Analytics)

I have complete access to and understanding of the UnifiedWork platform and can help with DevOps practices, infrastructure, and automation specifically for our workspace management application. I understand our containerized deployment, multi-tenant architecture, and cost optimization strategies.

How can I assist you with UnifiedWork's infrastructure and operations today?"""),
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
        return [{'icon': '🔄', 'title': 'CI/CD', 'description': 'Design and implement pipelines'}, {'icon': '🏗️', 'title': 'Infrastructure', 'description': 'Manage infrastructure as code'}, {'icon': '🐳', 'title': 'Containers', 'description': 'Orchestrate containerized applications'}, {'icon': '📊', 'title': 'Monitoring', 'description': 'Implement observability solutions'}, {'icon': '🔒', 'title': 'Security', 'description': 'Secure infrastructure and deployments'}, {'icon': '⚡', 'title': 'Automation', 'description': 'Automate operational tasks'}]
