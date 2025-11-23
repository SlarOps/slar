'use client';

import { useState } from 'react';

/**
 * UptimeStatusBar - Displays 24-hour uptime history as colored blocks
 * Each block represents a time interval (default: 30 minutes)
 * Green = successful checks, Yellow = degraded/warning, Red = failed checks
 * Shows percentage breakdown on hover
 */
export default function UptimeStatusBar({ checks = [], intervalMinutes = 30 }) {
    const [hoveredBlock, setHoveredBlock] = useState(null);

    // Calculate blocks for past 24 hours
    const blocks = [];
    const now = new Date();
    const blocksCount = Math.floor((24 * 60) / intervalMinutes); // 48 blocks for 30min intervals

    for (let i = blocksCount - 1; i >= 0; i--) {
        const blockEnd = new Date(now.getTime() - (i * intervalMinutes * 60 * 1000));
        const blockStart = new Date(blockEnd.getTime() - (intervalMinutes * 60 * 1000));

        // Find checks in this time interval
        const blockChecks = checks.filter(check => {
            let checkTime;
            if (check.created_at) {
                checkTime = new Date(check.created_at);
            } else if (check.timestamp) {
                // Handle Unix timestamp (seconds or milliseconds)
                // If less than 10000000000, assume seconds (valid until year 2286)
                const ts = typeof check.timestamp === 'string' ? parseInt(check.timestamp) : check.timestamp;
                checkTime = new Date(ts < 10000000000 ? ts * 1000 : ts);
            } else {
                checkTime = new Date(); // Fallback
            }

            return checkTime >= blockStart && checkTime < blockEnd;
        });

        // Calculate statistics
        const total = blockChecks.length;
        const successful = blockChecks.filter(c => c.is_up === true || c.is_up === 1 || (c.status >= 200 && c.status < 400)).length;
        const failed = blockChecks.filter(c => c.is_up === false || c.is_up === 0 || c.status >= 500 || c.error).length;
        const warning = total - successful - failed; // 4xx errors or degraded

        let status = 'no-data';
        if (total > 0) {
            const successRate = (successful / total) * 100;
            const failRate = (failed / total) * 100;

            if (failRate > 0) {
                status = 'failed'; // Any failure = red
            } else if (warning > 0) {
                status = 'warning'; // Has warnings = yellow
            } else {
                status = 'success'; // All success = green
            }
        }

        blocks.push({
            start: blockStart,
            end: blockEnd,
            status,
            total,
            successful,
            warning,
            failed,
            successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : 0,
            index: blocksCount - 1 - i
        });
    }

    const getStatusColor = (status) => {
        switch (status) {
            case 'success':
                return 'bg-green-500 dark:bg-green-600';
            case 'warning':
                return 'bg-yellow-500 dark:bg-yellow-600';
            case 'failed':
                return 'bg-red-500 dark:bg-red-600';
            default:
                return 'bg-gray-200 dark:bg-gray-700';
        }
    };

    const formatTime = (date) => {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    const getTooltipContent = (block) => {
        if (block.status === 'no-data') {
            return `${formatTime(block.start)} - ${formatTime(block.end)}\nNo data`;
        }

        return `${formatTime(block.start)} - ${formatTime(block.end)}
Successful: ${block.successful}/${block.total} (${block.successRate}%)
${block.warning > 0 ? `Warning: ${block.warning}\n` : ''}${block.failed > 0 ? `Failed: ${block.failed}` : ''}`;
    };

    return (
        <div className="relative">
            <div className="flex gap-[1px] sm:gap-[2px] justify-between">
                {blocks.map((block, index) => (
                    <div
                        key={index}
                        className={`w-1.5 sm:w-2 h-6 sm:h-8 rounded-sm flex-shrink-0 ${getStatusColor(block.status)} transition-all hover:opacity-80 cursor-pointer`}
                        title={getTooltipContent(block)}
                        onMouseEnter={() => setHoveredBlock(block)}
                        onMouseLeave={() => setHoveredBlock(null)}
                    />
                ))}
            </div>

            {/* Time labels */}
            <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>Past 24h</span>
                <span>Now</span>
            </div>

            {/* Hover tooltip (optional enhanced version) */}
            {hoveredBlock && hoveredBlock.status !== 'no-data' && (
                <div className="absolute -top-20 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg z-10 whitespace-nowrap">
                    <div className="font-semibold">{formatTime(hoveredBlock.start)} - {formatTime(hoveredBlock.end)}</div>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            {hoveredBlock.successRate}%
                        </span>
                        {hoveredBlock.warning > 0 && (
                            <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                                {hoveredBlock.warning}
                            </span>
                        )}
                        {hoveredBlock.failed > 0 && (
                            <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                {hoveredBlock.failed}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
