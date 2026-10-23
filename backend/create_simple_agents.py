
agents_config = [
    {
        "filename": "simple_backend_agent.py",
        "class_name": "SimpleBackendAgent",
        "community": "backend",
        "agent_name": "BackendGPT",
        "system_prompt": """You are BackendGPT, an expert Backend Developer specializing in:
- API Design and Development (REST, GraphQL, gRPC)
- Database Design and Optimization
- Microservices Architecture
- Cloud Infrastructure (AWS, GCP, Azure)
- DevOps and CI/CD Pipelines
- Security Best Practices
- Performance Optimization
- System Design and Scalability

Help users with backend development, architecture, and best practices.""",
        "capabilities": [
            {"icon": "🔧", "title": "API Design", "description": "Design and implement robust APIs"},
            {"icon": "🗄️", "title": "Database Design", "description": "Optimize database schemas and queries"},
            {"icon": "☁️", "title": "Cloud Architecture", "description": "Design scalable cloud solutions"},
            {"icon": "🔒", "title": "Security", "description": "Implement security best practices"},
            {"icon": "⚡", "title": "Performance", "description": "Optimize backend performance"},
            {"icon": "🏗️", "title": "System Design", "description": "Design scalable systems"}
        ]
    },
    {
        "filename": "simple_frontend_agent.py",
        "class_name": "SimpleFrontendAgent",
        "community": "frontend",
        "agent_name": "FrontendGPT",
        "system_prompt": """You are FrontendGPT, an expert Frontend Developer specializing in:
- React, Vue, Angular Development
- TypeScript and JavaScript
- CSS, SCSS, Tailwind CSS
- State Management (Redux, Zustand, Pinia)
- Build Tools (Webpack, Vite, Parcel)
- Testing (Jest, Cypress, Playwright)
- Mobile Development (React Native, Flutter)
- UI/UX Implementation

Help users with frontend development, frameworks, and best practices.""",
        "capabilities": [
            {"icon": "⚛️", "title": "React Development", "description": "Build modern React applications"},
            {"icon": "🎨", "title": "CSS & Styling", "description": "Create beautiful, responsive designs"},
            {"icon": "📱", "title": "Mobile Apps", "description": "Develop cross-platform mobile apps"},
            {"icon": "🔧", "title": "Build Tools", "description": "Configure and optimize build processes"},
            {"icon": "🧪", "title": "Testing", "description": "Implement comprehensive frontend testing"},
            {"icon": "⚡", "title": "Performance", "description": "Optimize frontend performance"}
        ]
    },
    {
        "filename": "simple_design_agent.py",
        "class_name": "SimpleDesignAgent",
        "community": "design",
        "agent_name": "DesignGPT",
        "system_prompt": """You are DesignGPT, an expert UI/UX Designer specializing in:
- User Experience (UX) Design
- User Interface (UI) Design
- Design Systems and Component Libraries
- Prototyping and Wireframing
- User Research and Testing
- Accessibility and Inclusive Design
- Visual Design and Branding
- Design Tools (Figma, Sketch, Adobe XD)

Help users with design decisions, user experience, and best practices.""",
        "capabilities": [
            {"icon": "🎨", "title": "UI Design", "description": "Create beautiful user interfaces"},
            {"icon": "👥", "title": "UX Research", "description": "Conduct user research and testing"},
            {"icon": "📐", "title": "Design Systems", "description": "Build consistent design systems"},
            {"icon": "♿", "title": "Accessibility", "description": "Ensure inclusive design practices"},
            {"icon": "📱", "title": "Prototyping", "description": "Create interactive prototypes"},
            {"icon": "🎯", "title": "User Journey", "description": "Map and optimize user journeys"}
        ]
    },
    {
        "filename": "simple_devops_agent.py",
        "class_name": "SimpleDevOpsAgent",
        "community": "devops",
        "agent_name": "OpsGPT",
        "system_prompt": """You are OpsGPT, an expert DevOps Engineer specializing in:
- CI/CD Pipeline Design and Implementation
- Infrastructure as Code (Terraform, Ansible)
- Container Orchestration (Docker, Kubernetes)
- Cloud Platforms (AWS, GCP, Azure)
- Monitoring and Observability
- Security and Compliance
- Automation and Scripting
- Site Reliability Engineering (SRE)

Help users with DevOps practices, infrastructure, and automation.""",
        "capabilities": [
            {"icon": "🔄", "title": "CI/CD", "description": "Design and implement pipelines"},
            {"icon": "🏗️", "title": "Infrastructure", "description": "Manage infrastructure as code"},
            {"icon": "🐳", "title": "Containers", "description": "Orchestrate containerized applications"},
            {"icon": "📊", "title": "Monitoring", "description": "Implement observability solutions"},
            {"icon": "🔒", "title": "Security", "description": "Secure infrastructure and deployments"},
            {"icon": "⚡", "title": "Automation", "description": "Automate operational tasks"}
        ]
    },
    {
        "filename": "simple_analyst_agent.py",
        "class_name": "SimpleAnalystAgent",
        "community": "analyst",
        "agent_name": "AnalystGPT",
        "system_prompt": """You are AnalystGPT, an expert Business/Data Analyst specializing in:
- Data Analysis and Visualization
- Business Intelligence and Reporting
- Statistical Analysis and Modeling
- SQL and Database Querying
- Python/R for Data Science
- Requirements Analysis
- Process Improvement
- KPI Development and Tracking

Help users with data analysis, business intelligence, and analytical insights.""",
        "capabilities": [
            {"icon": "📊", "title": "Data Analysis", "description": "Analyze and interpret complex data"},
            {"icon": "📈", "title": "Visualization", "description": "Create compelling data visualizations"},
            {"icon": "🔍", "title": "SQL Queries", "description": "Write efficient database queries"},
            {"icon": "📋", "title": "Requirements", "description": "Gather and analyze requirements"},
            {"icon": "📏", "title": "KPIs", "description": "Define and track key metrics"},
            {"icon": "🔧", "title": "Process Improvement", "description": "Optimize business processes"}
        ]
    }
]

template = '''"""
Simple {class_name} without complex dependencies
"""

import os
from typing import List, Dict
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate


class {class_name}:
    """Simple {class_name} without complex dependencies"""
    
    def __init__(self):
        """Initialize the {class_name}"""
        self.conversation_history: List[Dict[str, str]] = []
        self.community = "{community}"
        self.agent_name = "{agent_name}"
        
        # Initialize LLM
        self.llm = self._initialize_llm()
        
        # Create simple prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """{system_prompt}"""),
            ("human", "{{input}}")
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
            response = chain.invoke({{"input": query}})
            
            output = response.content if hasattr(response, 'content') else str(response)
            
            # Update conversation history
            self.conversation_history.append({{"role": "user", "content": query}})  
            self.conversation_history.append({{"role": "assistant", "content": output}})
            
            return output
            
        except Exception as e:
            error_msg = f"I encountered an error: {{str(e)}}\\n\\nPlease try rephrasing your question or provide more details."
            return error_msg
    
    def clear_history(self):
        """Clear conversation history"""
        self.conversation_history = []
    
    def get_history(self) -> List[Dict[str, str]]:
        """Get conversation history"""
        return self.conversation_history
    
    def get_capabilities(self) -> List[Dict[str, str]]:
        """Get agent capabilities for UI display"""
        return {capabilities}
'''

for config in agents_config:
    capabilities_str = str(config["capabilities"])
    config_copy = config.copy()
    config_copy["capabilities"] = capabilities_str
    content = template.format(**config_copy)
    
    with open(f'agents/{config["filename"]}', 'w') as f:
        f.write(content)
    
    print(f"Created {config['filename']}")

print("All simple agents created successfully!")
