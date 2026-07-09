/* Copyright 2017-present, The Visdom Authors */
import React from 'react';
import { CheckCircle, CreditCard, Rocket, Sparkles, Zap } from 'lucide-react';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    icon: Zap,
    price: 0,
    features: ['1 workspace', '3 team members', '7-day log retention', 'Community support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    icon: Sparkles,
    price: 29,
    features: ['10 workspaces', 'Unlimited members', '90-day log retention', 'Priority support', 'Shared links'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    icon: Rocket,
    price: null,
    features: ['Unlimited workspaces', 'SSO & audit logs', 'Unlimited retention', 'Dedicated support', 'Custom SLAs'],
  },
];

const USAGE = [
  { label: 'Workspaces', used: 2, total: 10 },
  { label: 'API Calls (this month)', used: 4200, total: 10000 },
  { label: 'Storage', used: 1.4, total: 5, unit: 'GB' },
];

const BillingTab = ({ user }) => {
  const currentTier = user?.tier || 'free';

  return (
    <div className="gc-flex-col-gap-lg">
      <section className="gc-panel">
        <div className="gc-panel-header">
          <span className="gc-panel-title">
            <CreditCard size={15} />
            Subscription Plans
          </span>
        </div>

        <div className="gc-pricing-grid">
          {PLANS.map((plan) => {
            const Icon = plan.icon;
            const isCurrent = plan.id === currentTier;
            return (
              <div key={plan.id} className={`gc-price-card ${isCurrent ? 'current' : ''}`}>
                {isCurrent && <span className="gc-current-pill">Current Plan</span>}
                <div className="gc-price-card-header">
                  <Icon size={16} />
                  {plan.name}
                </div>
                <div className="gc-price-amount">
                  {plan.price === null ? 'Custom' : `$${plan.price}`}
                  {plan.price !== null && <span> / month</span>}
                </div>
                <ul className="gc-price-features">
                   {plan.features.map((feature) => (
                    <li key={feature}>
                      <CheckCircle size={13} className="gc-shrink-0 gc-text-success" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section className="gc-panel">
        <div className="gc-panel-header">
          <span className="gc-panel-title">Usage This Cycle</span>
        </div>

        {USAGE.map((item) => {
          const pct = Math.min(100, Math.round((item.used / item.total) * 100));
          return (
            <div key={item.label} className="gc-meter">
              <div className="gc-meter-label">
                <span>{item.label}</span>
                <span>
                  {item.used.toLocaleString()}
                  {item.unit ? ` ${item.unit}` : ''} / {item.total.toLocaleString()}
                  {item.unit ? ` ${item.unit}` : ''}
                </span>
              </div>
              <div className="gc-meter-track">
                <div className="gc-meter-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
};

export default BillingTab;
