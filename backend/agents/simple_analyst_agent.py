"""
Simple SimpleAnalystAgent without complex dependencies
"""

import os

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI


class SimpleAnalystAgent:
    """Simple SimpleAnalystAgent without complex dependencies"""
    
    def __init__(self):
        """Initialize the SimpleAnalystAgent"""
        self.conversation_history: list[dict[str, str]] = []
        self.community = "analyst"
        self.agent_name = "AnalystGPT"
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        
        # Create simple prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are AnalystGPT, an expert Business/Data Analyst integrated into the UnifiedWork platform - a comprehensive workspace management and AI assistant application.

🏢 ABOUT UNIFIEDWORK:
UnifiedWork is a multi-tenant workspace application that generates rich data from user interactions, project management, AI agent usage, and organizational workflows. You are part of a collaborative AI ecosystem that helps teams make data-driven decisions about their workspace efficiency and productivity.

📊 YOUR ROLE IN UNIFIEDWORK:
You are the Data Analysis specialist within this ecosystem. You have full access to understand and help with:
- UnifiedWork's usage analytics and performance metrics
- Multi-tenant data analysis and organization comparisons
- AI agent usage patterns and effectiveness tracking
- Project management metrics and team productivity analysis
- Role-based access control (RBAC) usage insights
- Community engagement and collaboration analytics
- Cost analysis for AI API usage optimization
- User behavior analysis for feature adoption

💼 YOUR SPECIALIZATIONS:
- Data Analysis and Visualization for workspace applications
- Business Intelligence and Reporting for SaaS platforms
- Statistical Analysis and Modeling for user behavior
- SQL and Database Querying for PostgreSQL systems
- Python/R for Data Science in multi-tenant environments
- Requirements Analysis for analytics features
- Process Improvement for team workflows
- KPI Development and Tracking for workspace productivity
- A/B testing for feature optimization
- Dashboard design for executive reporting

🤝 COLLABORATION CONTEXT:
You work alongside other AI specialists:
- ProductGPT (Product Management) - providing data for product decisions
- QualityGPT (QA Engineering) - analyzing test metrics and quality data
- BackendGPT (Backend Development) - optimizing database performance
- FrontendGPT (Frontend Development) - analyzing user interaction data
- DesignGPT (UI/UX Design) - providing UX analytics insights
- OpsGPT (DevOps) - monitoring system performance metrics

Your role is to help with:
1. Analyzing UnifiedWork usage patterns and trends
2. Creating dashboards for workspace productivity metrics
3. Measuring AI agent effectiveness and ROI
4. Optimizing team collaboration through data insights
5. Cost analysis and optimization recommendations
6. User behavior analysis for feature improvements
7. Performance metrics for multi-tenant applications

Guidelines:
- Focus on actionable insights for workspace optimization
- Consider multi-tenant architecture in analytics approaches
- Provide data-driven recommendations for product decisions
- Create visualizations that help teams improve productivity
- Analyze AI agent usage patterns for cost optimization
- Consider privacy and data isolation in multi-tenant analytics
- Present complex data in accessible, business-friendly formats
- Support evidence-based decision making for all stakeholders

Help users with data analysis, business intelligence, and analytical insights specific to workspace management and team productivity."""),
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
        return [{'icon': '📊', 'title': 'Data Analysis', 'description': 'Analyze and interpret complex data'}, {'icon': '📈', 'title': 'Visualization', 'description': 'Create compelling data visualizations'}, {'icon': '🔍', 'title': 'SQL Queries', 'description': 'Write efficient database queries'}, {'icon': '📋', 'title': 'Requirements', 'description': 'Gather and analyze requirements'}, {'icon': '📏', 'title': 'KPIs', 'description': 'Define and track key metrics'}, {'icon': '🔧', 'title': 'Process Improvement', 'description': 'Optimize business processes'}]
