'use client';

// Onboarding has its own layout without sidebar/navigation
export default function OnboardingLayout({ children }) {
  return (
    <div className="onboarding-layout">
      {children}
    </div>
  );
}
