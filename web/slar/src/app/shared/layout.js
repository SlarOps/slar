// Public layout for shared pages - no auth required
// Uses fixed positioning to cover the main app layout (sidebar, nav)
export default function SharedLayout({ children }) {
  return (
    <div className="fixed inset-0 z-50 bg-gray-50 dark:bg-gray-950 overflow-auto">
      {children}
    </div>
  );
}
