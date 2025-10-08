// Small badge component
export const Badge = ({ children, color }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
    {children}
  </span>
);
