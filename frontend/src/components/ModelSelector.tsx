'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Zap, Brain, DollarSign, Info, Check } from 'lucide-react';

interface AIModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  speed: string;
  capabilities: string[];
  cost: number;
}

interface ModelSelectorProps {
  onModelSelect?: (modelId: string) => void;
  currentModel?: string;
}

export default function ModelSelector({ onModelSelect, currentModel }: ModelSelectorProps) {
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(currentModel || 'gpt-4o-mini');
  const [temperature, setTemperature] = useState<number>(0.7);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subscription, setSubscription] = useState<string>('free');
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    loadModels();
    loadPreferences();
  }, []);

  const loadModels = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:8002/api/ai-models', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      
      // Ensure models is always an array
      if (data && Array.isArray(data.models)) {
        setModels(data.models);
      } else {
        console.warn('Invalid models data received:', data);
        setModels([]); // Fallback to empty array
      }
      
      setSubscription(data?.subscription || 'free');
      setSelectedModel(data?.user_preference || 'gpt-4o-mini');
    } catch (error) {
      console.error('Failed to load models:', error);
      // Set default empty state on error
      setModels([]);
      setSubscription('free');
    } finally {
      setLoading(false);
    }
  };

  const loadPreferences = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:8002/api/user/preferences', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      setTemperature(parseFloat(data.ai_temperature) || 0.7);
    } catch (error) {
      console.error('Failed to load preferences:', error);
    }
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `http://localhost:8002/api/user/preferences/model?model_id=${selectedModel}&temperature=${temperature}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      if (response.ok) {
        if (onModelSelect) {
          onModelSelect(selectedModel);
        }
        alert('✅ Preferences saved! Your new model will be used for all future conversations.');
      } else {
        const error = await response.json();
        alert(`❌ Failed to save: ${error.detail}`);
      }
    } catch (error) {
      alert('❌ Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const getSpeedIcon = (speed: string) => {
    switch (speed) {
      case 'fast':
        return <Zap className="w-4 h-4 text-green-500" />;
      case 'medium':
        return <Brain className="w-4 h-4 text-blue-500" />;
      case 'slow':
        return <Sparkles className="w-4 h-4 text-purple-500" />;
      default:
        return <Brain className="w-4 h-4" />;
    }
  };

  const getProviderColor = (provider: string) => {
    return provider === 'openai' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
           provider === 'anthropic' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
           'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  };

  // Get maximum temperature based on subscription plan
  const getMaxTemperature = (): number => {
    switch (subscription.toLowerCase()) {
      case 'free':
        return 0.5;
      case 'basic':
        return 0.7;
      case 'premium':
      case 'enterprise':
        return 1.0;
      default:
        return 0.7;
    }
  };

  // Get contextual description based on temperature value
  const getTemperatureDescription = (): string => {
    if (temperature <= 0.2) {
      return '❄️ Very Precise: Highly focused and consistent responses. Best for code reviews and technical tasks.';
    } else if (temperature <= 0.4) {
      return '🎯 Focused: Balanced precision with some variation. Good for development work.';
    } else if (temperature <= 0.6) {
      return '⚖️ Balanced: Equal mix of precision and creativity. Ideal for most use cases.';
    } else if (temperature <= 0.8) {
      return '✨ Creative: More varied and exploratory responses. Great for brainstorming.';
    } else {
      return '🎨 Very Creative: Maximum creativity and variation. Perfect for innovative solutions.';
    }
  };

  // Get the next plan for upgrade prompts
  const getNextPlan = (): string => {
    switch (subscription.toLowerCase()) {
      case 'free':
        return 'Basic';
      case 'basic':
        return 'Premium';
      default:
        return 'Premium';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-500" />
            AI Model Selection
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Choose the AI model that best fits your needs
          </p>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          <Info className="w-4 h-4" />
          {showDetails ? 'Hide' : 'Show'} Details
        </button>
      </div>

      {/* Subscription Badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
        subscription === 'enterprise' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
        subscription === 'pro' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
        'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      }`}>
        <Sparkles className="w-3 h-3" />
        {subscription?.toUpperCase() || 'FREE'} Plan
      </div>

      {/* Model Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {models && models.length > 0 ? (
          models.map((model) => (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id)}
              className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                selectedModel === model.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-gray-800'
              }`}
            >
              {/* Selected Check */}
              {selectedModel === model.id && (
                <div className="absolute top-2 right-2">
                  <Check className="w-5 h-5 text-blue-500" />
                </div>
              )}

              {/* Model Name & Provider */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 dark:text-white">
                    {model.name}
                  </h4>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${getProviderColor(model.provider)}`}>
                    {model.provider}
                  </span>
                </div>
              </div>

              {/* Description */}
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {model.description}
              </p>

              {/* Attributes */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {/* Speed */}
                <div className="flex items-center gap-1">
                  {getSpeedIcon(model.speed)}
                  <span className="text-gray-600 dark:text-gray-400 capitalize">{model.speed}</span>
                </div>

                {/* Cost */}
                {showDetails && (
                  <div className="flex items-center gap-1">
                    <DollarSign className="w-4 h-4 text-yellow-500" />
                    <span className="text-gray-600 dark:text-gray-400">
                      ${model.cost.toFixed(4)}/1K
                    </span>
                  </div>
                )}

                {/* Capabilities */}
                {showDetails && (
                  <div className="flex flex-wrap gap-1 mt-2 w-full">
                    {model.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>
          ))
        ) : (
          <div className="col-span-2 text-center py-8 text-gray-500 dark:text-gray-400">
            <Info className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No AI models available. Please check your connection or try refreshing.</p>
          </div>
        )}
      </div>

      {/* Temperature Control - Enhanced */}
      <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-lg p-6 border border-purple-200 dark:border-purple-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <label className="text-sm font-semibold text-gray-900 dark:text-white">
              Creativity Level (Temperature)
            </label>
          </div>
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            {temperature.toFixed(1)}
          </div>
        </div>

        <style jsx>{`
          .gradient-slider {
            -webkit-appearance: none;
            width: 100%;
            height: 8px;
            border-radius: 5px;
            background: linear-gradient(to right, #60a5fa, #a78bfa, #ec4899);
            outline: none;
            opacity: 0.9;
            transition: opacity 0.2s;
          }

          .gradient-slider:hover {
            opacity: 1;
          }

          .gradient-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: linear-gradient(135deg, #8b5cf6, #ec4899);
            cursor: pointer;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          }

          .gradient-slider::-moz-range-thumb {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: linear-gradient(135deg, #8b5cf6, #ec4899);
            cursor: pointer;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          }
        `}</style>

        <input
          type="range"
          min="0"
          max={getMaxTemperature()}
          step="0.1"
          value={temperature}
          onChange={(e) => setTemperature(parseFloat(e.target.value))}
          className="gradient-slider mb-3"
        />

        <div className="flex justify-between text-xs font-medium text-gray-600 dark:text-gray-400 mb-4">
          <span>❄️ Precise</span>
          <span>⚖️ Balanced</span>
          <span>🎨 Creative</span>
        </div>

        {/* Temperature Description */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 mb-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {getTemperatureDescription()}
          </p>
        </div>

        {/* Subscription Limit Warning */}
        {getMaxTemperature() < 1.0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-yellow-800 dark:text-yellow-300">
                <p className="font-medium mb-1">
                  🔒 {subscription.toUpperCase()} Plan Limit
                </p>
                <p>
                  Temperature limited to {getMaxTemperature().toFixed(1)} on your current plan.{' '}
                  <a
                    href="/settings?tab=subscription"
                    className="underline hover:text-yellow-900 dark:hover:text-yellow-200"
                  >
                    Upgrade to {getNextPlan()}
                  </a>
                  {' '}for full creativity control (0.0 - 1.0).
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <button
        onClick={savePreferences}
        disabled={saving}
        className={`w-full px-4 py-3 rounded-lg font-medium transition-colors ${
          saving
            ? 'bg-gray-300 dark:bg-gray-700 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {saving ? 'Saving...' : '💾 Save Preferences'}
      </button>

      {/* Info Box */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex gap-3">
          <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 dark:text-blue-300">
            <p className="font-medium mb-1">GitHub Copilot-Style Experience</p>
            <p className="text-blue-700 dark:text-blue-400">
              Your selected model will be used across all communities. Switch anytime to match your task needs!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
