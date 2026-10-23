"""
AI Model Manager for UnifiedWork
Manages different AI models similar to GitHub Copilot
"""

import os
from enum import Enum
from typing import Optional

from langchain_openai import ChatOpenAI

# from langchain_anthropic import ChatAnthropic


class AIProvider(str, Enum):
    """AI Model Providers"""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    AZURE = "azure"


class AIModel:
    """AI Model Configuration"""
    def __init__(
        self,
        id: str,
        name: str,
        provider: AIProvider,
        model_name: str,
        description: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        cost_per_1k_tokens: float = 0.0,
        speed: str = "medium",  # slow, medium, fast
        capabilities: list[str] = None
    ):
        self.id = id
        self.name = name
        self.provider = provider
        self.model_name = model_name
        self.description = description
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.cost_per_1k_tokens = cost_per_1k_tokens
        self.speed = speed
        self.capabilities = capabilities or []


class ModelManager:
    """Manages AI models and provides GitHub Copilot-like functionality"""
    
    # Available models configuration
    AVAILABLE_MODELS: dict[str, AIModel] = {
        # OpenAI Models
        "gpt-4o": AIModel(
            id="gpt-4o",
            name="GPT-4o (Latest)",
            provider=AIProvider.OPENAI,
            model_name="gpt-4o",
            description="Most capable model with multimodal capabilities",
            max_tokens=8192,
            temperature=0.7,
            cost_per_1k_tokens=0.005,
            speed="medium",
            capabilities=["code", "analysis", "multimodal", "reasoning"]
        ),
        "gpt-4o-mini": AIModel(
            id="gpt-4o-mini",
            name="GPT-4o Mini",
            provider=AIProvider.OPENAI,
            model_name="gpt-4o-mini",
            description="Fast and affordable, great for most tasks",
            max_tokens=4096,
            temperature=0.7,
            cost_per_1k_tokens=0.0001,
            speed="fast",
            capabilities=["code", "analysis", "fast-response"]
        ),
        "gpt-4-turbo": AIModel(
            id="gpt-4-turbo",
            name="GPT-4 Turbo",
            provider=AIProvider.OPENAI,
            model_name="gpt-4-turbo-preview",
            description="Enhanced GPT-4 with larger context window",
            max_tokens=4096,
            temperature=0.7,
            cost_per_1k_tokens=0.01,
            speed="medium",
            capabilities=["code", "analysis", "reasoning", "large-context"]
        ),
        "gpt-3.5-turbo": AIModel(
            id="gpt-3.5-turbo",
            name="GPT-3.5 Turbo",
            provider=AIProvider.OPENAI,
            model_name="gpt-3.5-turbo",
            description="Fast and efficient for simpler tasks",
            max_tokens=4096,
            temperature=0.7,
            cost_per_1k_tokens=0.0005,
            speed="fast",
            capabilities=["code", "analysis"]
        ),
        
        # Anthropic Models
        "claude-3-5-sonnet": AIModel(
            id="claude-3-5-sonnet",
            name="Claude 3.5 Sonnet",
            provider=AIProvider.ANTHROPIC,
            model_name="claude-3-5-sonnet-20241022",
            description="Most intelligent Claude model, excellent for coding",
            max_tokens=8192,
            temperature=0.7,
            cost_per_1k_tokens=0.003,
            speed="medium",
            capabilities=["code", "analysis", "reasoning", "large-context"]
        ),
        "claude-3-opus": AIModel(
            id="claude-3-opus",
            name="Claude 3 Opus",
            provider=AIProvider.ANTHROPIC,
            model_name="claude-3-opus-20240229",
            description="Most powerful Claude model for complex tasks",
            max_tokens=4096,
            temperature=0.7,
            cost_per_1k_tokens=0.015,
            speed="slow",
            capabilities=["code", "analysis", "reasoning", "expert"]
        ),
        "claude-3-sonnet": AIModel(
            id="claude-3-sonnet",
            name="Claude 3 Sonnet",
            provider=AIProvider.ANTHROPIC,
            model_name="claude-3-sonnet-20240229",
            description="Balanced performance and speed",
            max_tokens=4096,
            temperature=0.7,
            cost_per_1k_tokens=0.003,
            speed="medium",
            capabilities=["code", "analysis", "reasoning"]
        ),
        "claude-3-haiku": AIModel(
            id="claude-3-haiku",
            name="Claude 3 Haiku",
            provider=AIProvider.ANTHROPIC,
            model_name="claude-3-haiku-20240307",
            description="Fastest Claude model, great for quick responses",
            max_tokens=4096,
            temperature=0.7,
            cost_per_1k_tokens=0.00025,
            speed="fast",
            capabilities=["code", "analysis", "fast-response"]
        ),
    }
    
    # Default model
    DEFAULT_MODEL = "gpt-4o-mini"
    
    @classmethod
    def get_available_models(cls) -> list[dict]:
        """Get list of available models for UI"""
        return [
            {
                "id": model.id,
                "name": model.name,
                "provider": model.provider.value,
                "description": model.description,
                "speed": model.speed,
                "capabilities": model.capabilities,
                "cost": model.cost_per_1k_tokens
            }
            for model in cls.AVAILABLE_MODELS.values()
        ]
    
    @classmethod
    def get_models_by_provider(cls, provider: AIProvider) -> list[dict]:
        """Get models filtered by provider"""
        return [
            {
                "id": model.id,
                "name": model.name,
                "description": model.description,
                "speed": model.speed,
                "capabilities": model.capabilities
            }
            for model in cls.AVAILABLE_MODELS.values()
            if model.provider == provider
        ]
    
    @classmethod
    def create_llm(cls, model_id: str, temperature: Optional[float] = None):
        """Create LLM instance from model ID"""
        if model_id not in cls.AVAILABLE_MODELS:
            model_id = cls.DEFAULT_MODEL
        
        model_config = cls.AVAILABLE_MODELS[model_id]
        temp = temperature if temperature is not None else model_config.temperature
        
        if model_config.provider == AIProvider.OPENAI:
            if not os.getenv("OPENAI_API_KEY"):
                raise ValueError("OPENAI_API_KEY not set")
            
            return ChatOpenAI(
                model=model_config.model_name,
                temperature=temp,
                max_tokens=model_config.max_tokens
            )
        
        elif model_config.provider == AIProvider.ANTHROPIC:
            raise ValueError("Anthropic support temporarily disabled - use OpenAI instead")
        
        else:
            raise ValueError(f"Unsupported provider: {model_config.provider}")
    
    @classmethod
    def get_model_info(cls, model_id: str) -> Optional[dict]:
        """Get detailed information about a specific model"""
        model = cls.AVAILABLE_MODELS.get(model_id)
        if not model:
            return None
        
        return {
            "id": model.id,
            "name": model.name,
            "provider": model.provider.value,
            "model_name": model.model_name,
            "description": model.description,
            "max_tokens": model.max_tokens,
            "temperature": model.temperature,
            "cost_per_1k_tokens": model.cost_per_1k_tokens,
            "speed": model.speed,
            "capabilities": model.capabilities
        }
    
    @classmethod
    def get_recommended_model(cls, task_type: str = "general") -> str:
        """Get recommended model based on task type"""
        recommendations = {
            "code": "claude-3-5-sonnet",  # Best for coding
            "fast": "gpt-4o-mini",  # Fastest responses
            "analysis": "gpt-4o",  # Best for complex analysis
            "budget": "claude-3-haiku",  # Most cost-effective
            "general": "gpt-4o-mini"  # Default
        }
        return recommendations.get(task_type, cls.DEFAULT_MODEL)
    
    @classmethod
    def validate_model_access(cls, model_id: str, user_subscription: str = "free") -> bool:
        """Check if user has access to model based on subscription"""
        # Define model access tiers
        free_models = ["gpt-4o-mini", "gpt-3.5-turbo", "claude-3-haiku"]
        pro_models = free_models + ["gpt-4o", "claude-3-sonnet", "claude-3-5-sonnet"]
        enterprise_models = list(cls.AVAILABLE_MODELS.keys())
        
        if user_subscription == "enterprise":
            return model_id in enterprise_models
        elif user_subscription == "pro":
            return model_id in pro_models
        else:  # free
            return model_id in free_models
