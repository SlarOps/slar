'use client';

/**
 * UptimeStatusBar - Displays 90-day uptime history as colored blocks
 * Green = up (>95% uptime), Red = down (<95%), Gray = no data
 * Mobile: Shows last 40 days, Desktop: Shows all 90 days
 */
export default function UptimeStatusBar({ history = [] }) {
    // Fill missing days with no-data status
    const blocks = [];
    const today = new Date();

    for (let i = 89; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        const dayData = history.find(h => h.date === dateStr);
        blocks.push({
            date: dateStr,
            status: dayData?.status || 'no-data',
            uptimePercent: dayData?.uptime_percent || 0,
            index: 89 - i // 0 is oldest, 89 is newest
        });
    }

    const getStatusColor = (status) => {
        switch (status) {
            case 'up':
                return 'bg-green-500';
            case 'down':
                return 'bg-red-500';
            default:
                return 'bg-gray-300 dark:bg-gray-600';
        }
    };

    return (
        <div className="flex gap-[1px] sm:gap-[2px] justify-between">
            {blocks.map((block, index) => (
                <div
                    key={index}
                    // Hide blocks older than 40 days on mobile (index < 50)
                    className={`w-1.5 sm:w-2 h-6 sm:h-8 rounded-sm flex-shrink-0 ${getStatusColor(block.status)} transition-colors hover:opacity-80 ${block.index < 50 ? 'hidden sm:block' : ''
                        }`}
                    title={`${block.date}: ${block.status === 'no-data' ? 'No data' : `${block.uptimePercent.toFixed(1)}% uptime`}`}
                />
            ))}
        </div>
    );
}
