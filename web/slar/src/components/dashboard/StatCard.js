export default function StatCard({ title, value, subtitle, icon, trend, className = "", iconColor = "blue" }) {
  // Define gradient color schemes for different icon types
  const iconColorSchemes = {
    blue: "bg-gradient-to-br from-blue-500 to-blue-600 text-white",
    purple: "bg-gradient-to-br from-purple-500 to-purple-600 text-white",
    green: "bg-gradient-to-br from-green-500 to-green-600 text-white",
    orange: "bg-gradient-to-br from-orange-500 to-orange-600 text-white",
    red: "bg-gradient-to-br from-red-500 to-red-600 text-white",
    indigo: "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white",
    pink: "bg-gradient-to-br from-pink-500 to-pink-600 text-white",
    cyan: "bg-gradient-to-br from-cyan-500 to-cyan-600 text-white",
    amber: "bg-gradient-to-br from-amber-500 to-amber-600 text-white",
    emerald: "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white",
  };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
          {subtitle && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className={`p-3 rounded-xl ${iconColorSchemes[iconColor] || iconColorSchemes.blue} shadow-lg`}>
            {icon}
          </div>
        )}
      </div>
      {trend && (
        <div className="mt-3 flex items-center text-sm">
          <span className={`font-medium ${
            trend.type === 'up' ? 'text-green-600' : 
            trend.type === 'down' ? 'text-red-600' : 
            'text-gray-500'
          }`}>
            {trend.value}
          </span>
          <span className="text-gray-500 ml-1">{trend.label}</span>
        </div>
      )}
    </div>
  );
}
