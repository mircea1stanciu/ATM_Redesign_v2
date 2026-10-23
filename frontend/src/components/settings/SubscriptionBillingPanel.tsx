import { useEffect, useState } from 'react'
import {
  CreditCard,
  AlertCircle,
  Check,
  Zap,
  Plus,
  Trash2,
  CheckCircle,
} from 'lucide-react'
import apiService from '@/services/api'

interface Subscription {
  plan: string
  status: string
  billing_cycle: string
  monthly_cost: string
  yearly_cost: string
  storage_limit_gb: number
  max_team_members: number
  api_rate_limit: number
  is_trial: boolean
  trial_ends_at?: string
  current_period_start?: string
  current_period_end?: string
  renewal_date?: string
}

interface Invoice {
  id: number
  invoice_number: string
  amount: string
  currency: string
  description: string
  status: string
  period_start?: string
  period_end?: string
  due_date?: string
  paid_at?: string
  issued_at: string
}

interface PaymentMethod {
  id: number
  type: string
  card_brand?: string
  card_last4?: string
  card_exp_month?: number
  card_exp_year?: number
  bank_name?: string
  bank_account_last4?: string
  is_default: boolean
  is_valid: boolean
  billing_name?: string
  created_at: string
}

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: { monthly: '$0', yearly: '$0' },
    features: ['5 GB storage', '1 team member', '1K API calls/day'],
    highlighted: false,
  },
  {
    id: 'starter',
    name: 'Starter',
    price: { monthly: '$29', yearly: '$290' },
    features: ['50 GB storage', '5 team members', '10K API calls/day', 'Priority support'],
    highlighted: true,
  },
  {
    id: 'professional',
    name: 'Professional',
    price: { monthly: '$99', yearly: '$990' },
    features: ['500 GB storage', '50 team members', '100K API calls/day', '24/7 support'],
    highlighted: false,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: { monthly: '$299', yearly: '$2,990' },
    features: ['5 TB storage', 'Unlimited team members', 'Unlimited API calls', 'Dedicated support'],
    highlighted: false,
  },
]

export default function SubscriptionBillingPanel() {
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [newPaymentType, setNewPaymentType] = useState('credit_card')
  const [newPaymentName, setNewPaymentName] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [subRes, invoicesRes, methodsRes] = await Promise.all([
        apiService.getSubscription(),
        apiService.listInvoices(),
        apiService.listPaymentMethods(),
      ])
      setSubscription(subRes)
      setInvoices(invoicesRes.invoices || [])
      setPaymentMethods(methodsRes.payment_methods || [])
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleUpgradePlan = async () => {
    if (!selectedPlan) {
      setError('Please select a plan')
      return
    }

    try {
      setLoading(true)
      const result = await apiService.upgradeSubscription(selectedPlan, billingCycle)
      setSuccess(result.message || 'Plan upgraded successfully!')
      setShowUpgradeModal(false)
      setSelectedPlan(null)
      await loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleAddPaymentMethod = async () => {
    if (!newPaymentName) {
      setError('Please enter a name for this payment method')
      return
    }

    try {
      setLoading(true)
      const result = await apiService.addPaymentMethod(newPaymentType, undefined, newPaymentName)
      setSuccess(result.message || 'Payment method added successfully!')
      setShowPaymentForm(false)
      setNewPaymentType('credit_card')
      setNewPaymentName('')
      await loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleDeletePaymentMethod = async (methodId: number) => {
    if (!window.confirm('Remove this payment method?')) return

    try {
      setLoading(true)
      const result = await apiService.deletePaymentMethod(methodId)
      setSuccess(result.message || 'Payment method removed')
      await loadData()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(apiService.errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const getPlanName = (planId: string) => {
    return PLANS.find((p) => p.id === planId)?.name || planId
  }

  return (
    <div className="space-y-8">
      {/* Current Plan */}
      <div className="bg-white dark:bg-gray-800/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Zap size={24} className="text-yellow-600 dark:text-yellow-400" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Current Plan</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Manage your subscription</p>
            </div>
          </div>
        </div>

        {subscription ? (
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-2">Plan</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white capitalize">
                {getPlanName(subscription.plan)}
              </p>
              <p className="text-gray-600 dark:text-gray-400 text-sm mt-2">
                {subscription.status === 'active' ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle size={14} className="text-green-600" /> Active
                  </span>
                ) : (
                  <span className="text-orange-600 dark:text-orange-400">{subscription.status}</span>
                )}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-gray-600 dark:text-gray-400 text-sm">Billing Cycle</p>
                <p className="font-medium text-gray-900 dark:text-white capitalize">{subscription.billing_cycle}</p>
              </div>
              <div>
                <p className="text-gray-600 dark:text-gray-400 text-sm">Price</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {subscription.billing_cycle === 'monthly' ? subscription.monthly_cost : subscription.yearly_cost}/
                  {subscription.billing_cycle === 'monthly' ? 'month' : 'year'}
                </p>
              </div>
              {subscription.renewal_date && (
                <div>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">Renews on</p>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {new Date(subscription.renewal_date).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {subscription?.plan !== 'enterprise' && (
          <button
            onClick={() => setShowUpgradeModal(true)}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Zap size={18} /> Upgrade Plan
          </button>
        )}
      </div>

      {/* Plan Features */}
      <div className="bg-white dark:bg-gray-800/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Limits & Features</h3>
        {subscription ? (
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-1">Storage</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{subscription.storage_limit_gb} GB</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Maximum storage</p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-1">Team Members</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{subscription.max_team_members}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Maximum members</p>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-1">API Rate</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{(subscription.api_rate_limit / 1000).toFixed(0)}K</p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Calls per day</p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-screen overflow-y-auto">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Choose a Plan</h3>

            <div className="mb-6">
              <div className="flex gap-4 mb-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={billingCycle === 'monthly'}
                    onChange={() => setBillingCycle('monthly')}
                    className="w-4 h-4"
                  />
                  <span className="text-gray-900 dark:text-white">Monthly</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={billingCycle === 'yearly'}
                    onChange={() => setBillingCycle('yearly')}
                    className="w-4 h-4"
                  />
                  <span className="text-gray-900 dark:text-white">Yearly (Save 10%)</span>
                </label>
              </div>

              <div className="grid md:grid-cols-4 gap-4">
                {PLANS.filter((p) => p.id !== 'free').map((plan) => (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition ${
                      selectedPlan === plan.id
                        ? 'border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500'
                    }`}
                  >
                    <h4 className="font-bold text-gray-900 dark:text-white mb-2">{plan.name}</h4>
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400 mb-3">
                      {billingCycle === 'monthly' ? plan.price.monthly : plan.price.yearly}
                    </p>
                    <ul className="space-y-2">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2">
                          <Check size={14} className="text-green-600" /> {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleUpgradePlan}
                disabled={loading || !selectedPlan}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Upgrading...' : 'Upgrade'}
              </button>
              <button
                onClick={() => {
                  setShowUpgradeModal(false)
                  setSelectedPlan(null)
                }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Methods */}
      <div className="bg-white dark:bg-gray-800/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <CreditCard size={24} className="text-green-600 dark:text-green-400" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Payment Methods</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Manage your payment options</p>
            </div>
          </div>
          <button
            onClick={() => setShowPaymentForm(!showPaymentForm)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <Plus size={18} /> Add Payment
          </button>
        </div>

        {showPaymentForm && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Payment Method Type
              </label>
              <select
                value={newPaymentType}
                onChange={(e) => setNewPaymentType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="credit_card">Credit Card</option>
                <option value="debit_card">Debit Card</option>
                <option value="bank_account">Bank Account</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Name
              </label>
              <input
                type="text"
                placeholder="e.g., Personal Visa"
                value={newPaymentName}
                onChange={(e) => setNewPaymentName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <button
              onClick={handleAddPaymentMethod}
              disabled={loading}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Payment Method'}
            </button>
          </div>
        )}

        <div className="space-y-3">
          {paymentMethods.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400 text-sm">No payment methods saved</p>
          ) : (
            paymentMethods.map((method) => (
              <div key={method.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CreditCard size={18} className="text-gray-400" />
                    <p className="font-medium text-gray-900 dark:text-white">{method.billing_name}</p>
                    {method.is_default && (
                      <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 capitalize">
                    {method.card_brand && `${method.card_brand} ••••${method.card_last4}`}
                    {method.bank_name && `${method.bank_name} ••••${method.bank_account_last4}`}
                    {!method.card_brand && !method.bank_name && method.type}
                  </p>
                </div>
                <button
                  onClick={() => handleDeletePaymentMethod(method.id)}
                  className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Billing History */}
      <div className="bg-white dark:bg-gray-800/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Billing History</h3>
        <div className="space-y-3">
          {invoices.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400 text-sm">No invoices yet</p>
          ) : (
            invoices.map((invoice) => (
              <div key={invoice.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{invoice.description}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Invoice #{invoice.invoice_number}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    {new Date(invoice.issued_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900 dark:text-white">
                    {invoice.currency} {invoice.amount}
                  </p>
                  <span className={`inline-block text-xs px-2 py-1 rounded mt-1 ${
                    invoice.status === 'paid'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : invoice.status === 'pending'
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                  }`}>
                    {invoice.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg flex gap-3">
          <AlertCircle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0" />
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg flex gap-3">
          <Check size={20} className="text-green-600 dark:text-green-400 flex-shrink-0" />
          <p className="text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}
    </div>
  )
}
